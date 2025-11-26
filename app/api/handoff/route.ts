import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Missing SLACK_WEBHOOK_URL env variable" },
        { status: 500 }
      );
    }

    // Format Slack message
    const text = `
🔥 *New Human Handoff Request*

• *Name:* ${body.name}
• *Email:* ${body.email}
• *Phone:* ${body.phone ?? "N/A"}
• *Company:* ${body.company ?? "N/A"}

📝 *Message:*  
${body.message}

💬 *Transcript:*  
${body.transcript ?? "(no transcript provided)"}
`;

    // Send to Slack
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error in /api/handoff:", err);
    return NextResponse.json({ error: "Failed to send handoff" }, { status: 500 });
  }
}
