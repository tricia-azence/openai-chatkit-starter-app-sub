import { NextResponse } from "next/server";

type HandoffType = "progressive_profile" | "human_handoff" | undefined;

type HandoffBody = {
  type?: HandoffType;
  name?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  transcript?: string | null;
};

const SHARPSPRING_API_URL = "https://api.sharpspring.com/pubapi/v1.2/";

/**
 * Split a full name into firstName / lastName in a simple, safe way.
 */
function splitName(fullName: string | undefined | null): {
  firstName?: string;
  lastName?: string;
} {
  if (!fullName) return {};
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] };
  }
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
}

/**
 * Generic helper to call the SharpSpring API.
 * Does NOT throw; it logs errors and returns parsed JSON or null.
 */
async function callSharpSpring(
  method: string,
  params: Record<string, unknown>,
  requestId: string
): Promise<Record<string, unknown> | null> {
  const accountID = process.env.SHARPSPRING_ACCOUNT_ID;
  const secretKey = process.env.SHARPSPRING_SECRET_KEY;

  if (!accountID || !secretKey) {
    console.warn(
      "[SharpSpring] Missing SHARPSPRING_ACCOUNT_ID or SHARPSPRING_SECRET_KEY. Skipping CRM sync."
    );
    return null;
  }

  const query = new URLSearchParams({
    accountID,
    secretKey,
  }).toString();

  const url = `${SHARPSPRING_API_URL}?${query}`;

  const payload = {
    method,
    params,
    id: requestId,
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let json: Record<string, unknown> | null = null;

    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch (err) {
      console.error("[SharpSpring] Failed to parse JSON response", err, text);
      return null;
    }

    // Log API-level error if present
    if (json && json.error) {
      console.error("[SharpSpring] API-level error", json.error);
    }

    return json;
  } catch (err) {
    console.error("[SharpSpring] Network/request error", err);
    return null;
  }
}

/**
 * Upsert lead in SharpSpring, based on email.
 * - If lead exists (matched by emailAddress) → updateLeads
 * - Else → createLeads
 * Only sends fields that are actually provided (no blank overwrites).
 */
async function syncLeadToSharpSpring(body: HandoffBody): Promise<boolean> {
  const email = body.email?.trim();
  if (!email) {
    // Cannot create/update a lead without an email
    return false;
  }

  const { firstName, lastName } = splitName(body.name ?? undefined);

  // Build field map, ONLY including non-empty values (Option A)
  const leadFields: Record<string, string> = {
    emailAddress: email,
  };

  if (firstName) leadFields.firstName = firstName;
  if (lastName) leadFields.lastName = lastName;
  if (body.company && body.company.trim()) {
    leadFields.companyName = body.company.trim();
  }
  if (body.phone && body.phone.trim()) {
    leadFields.phoneNumber = body.phone.trim();
  }
  if (body.message && body.message.trim()) {
    // Optional: store the last explicit request as description
    leadFields.description = body.message.trim();
  }

  // 1) Try to find an existing lead by email
  const where = { emailAddress: email };
  const getResponse = await callSharpSpring(
    "getLeads",
    { where, limit: 1, offset: 0 },
    "getLeadByEmail"
  );

  const result = getResponse?.result as
    | { lead?: Array<Record<string, unknown>> }
    | undefined;

  const existingLeads = result?.lead ?? [];
  const existingLead = Array.isArray(existingLeads) && existingLeads.length > 0
    ? existingLeads[0]
    : undefined;

  // 2) Decide: create or update
  if (existingLead && typeof existingLead === "object") {
    const idRaw = (existingLead as Record<string, unknown>).id;
    const id =
      typeof idRaw === "string" || typeof idRaw === "number"
        ? String(idRaw)
        : null;

    if (!id) {
      console.warn(
        "[SharpSpring] Existing lead found but has no valid id. Creating new lead instead."
      );
    } else {
      // UPDATE existing lead
      const updateObjects = [
        {
          id,
          ...leadFields,
        },
      ];

      const updateResp = await callSharpSpring(
        "updateLeads",
        { objects: updateObjects },
        "updateLead"
      );

      if (updateResp?.result) {
        return true;
      }
      return false;
    }
  }

  // CREATE new lead
  const createObjects = [leadFields];

  const createResp = await callSharpSpring(
    "createLeads",
    { objects: createObjects },
    "createLead"
  );

  if (createResp?.result) {
    return true;
  }

  return false;
}

/**
 * MAIN HANDOFF ROUTE
 * - Sends nicely formatted ticket to Slack
 * - Also upserts a lead in SharpSpring CRM
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as HandoffBody;

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Missing SLACK_WEBHOOK_URL env variable" },
        { status: 500 }
      );
    }

    const ticketId = Math.random().toString(36).substring(2, 10).toUpperCase();

    const label: string =
      body.type === "progressive_profile"
        ? "🟣 Progressive Profile Update"
        : "🟢 New Human Handoff Request";

    const text = `
${label}  (#${ticketId})

*Name:* ${body.name || "N/A"}
*Email:* ${body.email || "N/A"}
*Phone:* ${body.phone || "N/A"}
*Company:* ${body.company || "N/A"}

*Message:*
${body.message || "_No message provided_"}

*Transcript (for context):*
${body.transcript || "_No transcript provided_"}
`.trim();

    // --- 1) Send to Slack ---
    const slackResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    let slackTs: string | null = null;
    try {
      const slackJson = (await slackResp.json().catch(() => null)) as
        | { ts?: string }
        | null;
      if (slackJson && typeof slackJson.ts === "string") {
        slackTs = slackJson.ts;
      }
    } catch {
      // ignore Slack JSON parsing errors
    }

    // --- 2) Sync to SharpSpring (non-blocking for user experience) ---
    const crmSynced = await syncLeadToSharpSpring(body);

    return NextResponse.json({
      ok: true,
      ticketId,
      slackTs,
      crmSynced,
    });
  } catch (err) {
    console.error("Error in /api/handoff:", err);
    return NextResponse.json(
      { error: "Failed to send handoff" },
      { status: 500 }
    );
  }
}
