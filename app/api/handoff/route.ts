import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, phone, company, message, transcript } = body;

    const webhook = process.env.SLACK_WEBHOOK_URL;

    if (!webhook) {
      return NextResponse.json(
        { error: "Missing Slack webhook URL" },
        { status: 500 }
      );
    }

    const payload = {
      text:
        `📞 *New Azence Live Chat Handoff*\n\n` +
        `*Name:* ${name}\n` +
        `*Email:* ${email}\n` +
        `*Phone:* ${phone || "N/A"}\n` +
        `*Company:* ${company || "N/A"}\n\n` +
        `*Message:* ${message}\n\n` +
        `-------------------------------\n` +
        `📝 *Conversation Transcript:*\n${transcript}`
    };

    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("Error in handoff:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
