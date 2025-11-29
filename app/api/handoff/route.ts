
import { NextResponse } from "next/server";

// 1. Handle "Pre-flight" checks (Browsers ask permission first)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*", // Allows any domain (including sub.azence.com)
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// 2. Handle the actual Data (The Handoff)
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Generate a unique Ticket ID
    const ticketId = Math.random().toString(36).substring(2, 10).toUpperCase();

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Missing SLACK_WEBHOOK_URL env variable" },
        { 
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" } // Allow error to be seen
        }
      );
    }

    // Format Slack ticket message
    const text = `
🟢 *New Human Handoff Request* (#${ticketId})

*Name:* ${body.name}
*Email:* ${body.email}
*Phone:* ${body.phone || "N/A"}
*Company:* ${body.company || "N/A"}

*Message:*
${body.message}

*Transcript (for context):*
${body.transcript || "_No transcript provided_"}
`;

    // --- Send to Slack & capture response ---
    const slackResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    // Slack webhook may return empty or JSON — safely attempt parsing
    let slackData: any = {};
    try {
      slackData = await slackResp.json();
    } catch {
      slackData = {};
    }

    // Return ticket details + CORS Headers (Crucial!)
    return NextResponse.json(
      {
        ok: true,
        ticketId,
        slackTs: slackData.ts || null,
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*", // <--- THIS FIXES THE CORS ERROR
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );

  } catch (err) {
    console.error("Error in /api/handoff:", err);
    return NextResponse.json(
      { error: "Failed to send handoff" },
      { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*", // Allow error to be seen
        } 
      }
    );
  }
}
