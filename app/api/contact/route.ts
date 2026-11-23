import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { consumeRateLimit, clientAddress, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContactPayload = {
  name?: unknown;
  email?: unknown;
  business?: unknown;
  subject?: unknown;
  message?: unknown;
  website?: unknown;
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeEqualOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!safeEqualOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 12_000) {
    return NextResponse.json({ error: "Your message is too large." }, { status: 413 });
  }

  let payload: ContactPayload;
  try {
    payload = await request.json() as ContactPayload;
  } catch {
    return NextResponse.json({ error: "Please submit a valid contact form." }, { status: 400 });
  }

  // Quietly accept bot submissions without sending mail.
  if (text(payload.website, 200)) {
    return NextResponse.json({ message: "Your message has been sent. Our team will get back to you." });
  }

  const address = clientAddress(request);
  const limit = await consumeRateLimit(rateLimitKey("commerce-contact", address), 4, 600);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many messages have been sent from this connection. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const name = text(payload.name, 100);
  const email = text(payload.email, 254).toLowerCase();
  const business = text(payload.business, 120);
  const subject = text(payload.subject, 80);
  const message = text(payload.message, 5000);

  if (name.length < 2 || !validEmail(email) || message.length < 10) {
    return NextResponse.json({ error: "Please check your name, email address and message." }, { status: 400 });
  }
  if (/[\r\n]/.test(subject) || /[\r\n]/.test(email)) {
    return NextResponse.json({ error: "Please check the submitted details." }, { status: 400 });
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.CONTACT_MAIL_FROM || user;
  const fromName = process.env.CONTACT_MAIL_FROM_NAME || "MobiWave Commerce";
  const to = process.env.CONTACT_MAIL_TO || "sales@mobiwave.co.ke";

  if (!host || !user || !pass || !from || !to || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("[contact] SMTP configuration is incomplete.");
    return NextResponse.json({ error: "Our contact form is temporarily unavailable. Please email sales@mobiwave.co.ke." }, { status: 503 });
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeBusiness = escapeHtml(business || "Not provided");
  const safeSubject = escapeHtml(subject || "General enquiry");
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");

  try {
    await transporter.sendMail({
      from: { name: fromName, address: from },
      to,
      replyTo: { name, address: email },
      subject: `Commerce website enquiry: ${subject || "General enquiry"}`,
      text: [
        "New MobiWave Commerce website enquiry",
        `Name: ${name}`,
        `Email: ${email}`,
        `Business: ${business || "Not provided"}`,
        `Subject: ${subject || "General enquiry"}`,
        "",
        message,
      ].join("\n"),
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0c243c;line-height:1.6"><main style="max-width:620px;margin:24px auto;padding:28px;border:1px solid #eeeef3;border-radius:12px"><p style="color:#5955d1;font-weight:700;letter-spacing:1px">MOBIWAVE COMMERCE</p><h2>New website enquiry</h2><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Business:</strong> ${safeBusiness}</p><p><strong>Subject:</strong> ${safeSubject}</p><hr style="border:0;border-top:1px solid #eeeef3"/><p>${safeMessage}</p></main></body></html>`,
    });
    return NextResponse.json({ message: "Your message has been sent. Our team will get back to you." });
  } catch (error) {
    console.error("[contact] SMTP delivery failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "We couldn't send your message just now. Please email sales@mobiwave.co.ke." }, { status: 502 });
  } finally {
    transporter.close();
  }
}
