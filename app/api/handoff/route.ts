import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Generate a unique Ticket ID
    const ticketId = Math.random().toString(36).substring(2, 10).toUpperCase();

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Missing SLACK_WEBHOOK_URL env variable" },
        { status: 500 }
      );
    }

    // Decide label based on type
    const label =
      body.type === "progressive_profile"
        ? "🟣 Progressive Profile Update"
        : "🟢 New Human Handoff Request";

    // Format Slack ticket message
    const text = `
${label}  (#${ticketId})

*Name:* ${body.name}
*Email:* ${body.email}
*Phone:* ${body.phone || "N/A"}
*Company:* ${body.company || "N/A"}

*Message:*
${body.message || "_No message provided_"}

*Transcript (for context):*
${body.transcript || "_No transcript provided_"}
`;

    // --- Send to Slack & capture response (for thread TS) ---
    const slackResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    // Slack webhook may return empty or JSON — safely attempt parsing
    let slackData: unknown = null;
    try {
      slackData = await slackResp.json();
    } catch {
      slackData = null;
    }

    // Safely extract ts if present
    let slackTs: string | null = null;
    if (
      slackData &&
      typeof slackData === "object" &&
      "ts" in slackData &&
      typeof (slackData as { ts: unknown }).ts === "string"
    ) {
      slackTs = (slackData as { ts: string }).ts;
    }

    // Return ticket details + Slack thread ts (if available)
    return NextResponse.json({
      ok: true,
      ticketId,
      slackTs,
    });
  } catch (err) {
    console.error("Error in /api/handoff:", err);
    return NextResponse.json(
      { error: "Failed to send handoff" },
      { status: 500 }
    );
  }
}
