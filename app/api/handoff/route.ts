import { NextResponse } from "next/server";

export const runtime = "edge";

// Automatically allow ONLY Azence-owned domains
const ALLOWED_ORIGINS = [
  "https://azence.com",
  "https://www.azence.com",
];

// Allow all subdomains such as:
// https://sub.azence.com, https://dev.azence.com, etc.
function isAzenceSubdomain(origin: string | null) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "azence.com" || hostname.endsWith(".azence.com");
  } catch {
    return false;
  }
}

function buildCorsHeaders(origin: string | null) {
  if (origin && (ALLOWED_ORIGINS.includes(origin) || isAzenceSubdomain(origin))) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }

  // Block external origins
  return {
    "Access-Control-Allow-Origin": "https://azence.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Handle CORS preflight
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("Origin");
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(origin),
  });
}

// Handle POST requests
export async function POST(req: Request) {
  const origin = req.headers.get("Origin");

  try {
    const body = await req.json();

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return new NextResponse(
        JSON.stringify({ error: "Missing SLACK_WEBHOOK_URL env variable" }),
        {
          status: 500,
          headers: buildCorsHeaders(origin),
        }
      );
    }

    // Unique ticket ID
    const ticketId = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Label based on type
    const label =
      body.type === "progressive_profile"
        ? "🟣 Progressive Profile Update"
        : "🟢 Human Handoff Request";

    const slackMessage = `
${label}  (#${ticketId})

*Name:* ${body.name}
*Email:* ${body.email}
*Phone:* ${body.phone || "N/A"}
*Company:* ${body.company || "N/A"}

*Message:*
${body.message || "_No message provided_"}

*Transcript:*
${body.transcript || "_No transcript provided_"}
`.trim();

    // Send to Slack
    const slackResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: slackMessage }),
    });

    // FIX: Remove `any`, replace with typed Record
    let slackData: Record<string, unknown> = {};
    try {
      slackData = await slackResp.json();
    } catch {
      slackData = {};
    }

    return new NextResponse(
      JSON.stringify({
        ok: true,
        ticketId,
        slackTs:
          typeof slackData.ts === "string" || typeof slackData.ts === "number"
            ? slackData.ts
            : null,
      }),
      {
        status: 200,
        headers: buildCorsHeaders(origin),
      }
    );
  } catch (err) {
    console.error("Error in /api/handoff:", err);

    return new NextResponse(
      JSON.stringify({ error: "Failed to process handoff" }),
      {
        status: 500,
        headers: buildCorsHeaders(origin),
      }
    );
  }
}
