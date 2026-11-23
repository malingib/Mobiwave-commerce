import { createConnection } from "node:net";
import tls, { type TLSSocket } from "node:tls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Socket = ReturnType<typeof createConnection> | TLSSocket;

class SmtpChannel {
  private buffer = "";
  private waiting: Array<(value: string) => void> = [];
  private queued: string[] = [];
  private onData = (chunk: Buffer) => {
    this.buffer += chunk.toString("utf8");
    this.drain();
  };
  private onError = (error: Error) => {
    this.waiting.splice(0).forEach(resolve => resolve("500 " + error.message));
  };
  constructor(private socket: Socket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
  }
  private drain() {
    const lines = this.buffer.split("\r\n");
    const end = lines.findIndex(line => /^\d{3} /.test(line));
    if (end < 0) return;
    const response = lines.slice(0, end + 1).join("\n");
    this.buffer = lines.slice(end + 1).join("\r\n");
    const resolve = this.waiting.shift();
    if (resolve) resolve(response);
    else this.queued.push(response);
    if (this.buffer) this.drain();
  }
  read() {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<string>(resolve => this.waiting.push(resolve));
  }
  async command(command: string) {
    this.socket.write(command + "\r\n");
    return this.read();
  }
  detach() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
  }
}

function expect(response: string, codes: number[]) {
  const code = Number(response.slice(0, 3));
  if (!codes.includes(code)) throw new Error("SMTP server rejected a command (" + code + ").");
}
function clean(value: string) {
  return value.replace(/[\r\n\0]/g, " ").trim();
}
function encodedHeader(value: string) {
  return "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?=";
}
function textBody(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim();
}

async function deliverMail(input: { name: string; email: string; phone: string; subject: string; message: string }) {
  const host = process.env.SMTP_HOST || "mail.talksasa.com";
  const port = Number(process.env.SMTP_PORT || "587");
  const encryption = (process.env.SMTP_ENCRYPTION || "tls").toLowerCase();
  const username = process.env.SMTP_USERNAME || "no-reply@mobiwave.co.ke";
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.CONTACT_MAIL_FROM || username;
  const to = process.env.CONTACT_MAIL_TO || "sales@mobiwave.co.ke";
  if (!password) throw new Error("Contact email is not configured yet.");
  if (!host || !username || !from || !to || !Number.isInteger(port)) throw new Error("Contact email configuration is incomplete.");

  let socket: Socket;
  if (encryption === "ssl" || port === 465) {
    socket = tls.connect({ host, port, servername: host });
    await new Promise<void>((resolve, reject) => {
      (socket as TLSSocket).once("secureConnect", resolve);
      socket.once("error", reject);
    });
  } else {
    socket = createConnection({ host, port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
  }
  socket.setTimeout(15000, () => socket.destroy(new Error("SMTP connection timed out.")));
  let channel = new SmtpChannel(socket);
  try {
    expect(await channel.read(), [220]);
    expect(await channel.command("EHLO mobiwave.co.ke"), [250]);
    if (encryption !== "ssl" && port !== 465) {
      expect(await channel.command("STARTTLS"), [220]);
      channel.detach();
      const secure = tls.connect({ socket, servername: host });
      await new Promise<void>((resolve, reject) => {
        secure.once("secureConnect", resolve);
        secure.once("error", reject);
      });
      socket = secure;
      channel = new SmtpChannel(socket);
      expect(await channel.command("EHLO mobiwave.co.ke"), [250]);
    }
    expect(await channel.command("AUTH LOGIN"), [334]);
    expect(await channel.command(Buffer.from(username).toString("base64")), [334]);
    expect(await channel.command(Buffer.from(password).toString("base64")), [235]);
    expect(await channel.command("MAIL FROM:<" + from + ">"), [250]);
    expect(await channel.command("RCPT TO:<" + to + ">"), [250, 251]);
    expect(await channel.command("DATA"), [354]);

    const subject = "Commerce enquiry: " + input.subject;
    const body = [
      "A new message was submitted through the MobiWave Commerce contact page.",
      "",
      "Name: " + input.name,
      "Email: " + input.email,
      "Phone: " + (input.phone || "Not provided"),
      "Topic: " + input.subject,
      "",
      "Message:",
      input.message,
    ].join("\n");
    const headers = [
      'From: "MobiWave Commerce" <' + from + ">",
      "To: <" + to + ">",
      "Reply-To: <" + input.email + ">",
      "Subject: " + encodedHeader(subject),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "Date: " + new Date().toUTCString(),
    ].join("\r\n");
    const mime = headers + "\r\n\r\n" + textBody(body).replace(/(^|\r\n)\./g, "$1..") + "\r\n.\r\n";
    socket.write(mime);
    expect(await channel.read(), [250]);
    await channel.command("QUIT").catch(() => "");
  } finally {
    channel.detach();
    socket.end();
  }
}

const attempts = new Map<string, { count: number; resetAt: number }>();
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 12000) return Response.json({ error: "Your message is too large." }, { status: 413 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    } catch {
      return Response.json({ error: "Invalid request origin." }, { status: 403 });
    }
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const attempt = attempts.get(ip);
  if (attempt && attempt.resetAt > now && attempt.count >= 5) {
    return Response.json({ error: "Too many messages. Please try again later." }, { status: 429 });
  }
  attempts.set(ip, !attempt || attempt.resetAt <= now ? { count: 1, resetAt: now + 15 * 60 * 1000 } : { ...attempt, count: attempt.count + 1 });

  try {
    const data = await request.json() as Record<string, unknown>;
    if (typeof data.website === "string" && data.website.trim()) return Response.json({ ok: true });
    const name = typeof data.name === "string" ? clean(data.name) : "";
    const email = typeof data.email === "string" ? clean(data.email) : "";
    const phone = typeof data.phone === "string" ? clean(data.phone) : "";
    const subject = typeof data.subject === "string" ? clean(data.subject) : "";
    const message = typeof data.message === "string" ? data.message.replace(/\r/g, "").trim() : "";
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      phone.length > 40 || !subject || subject.length > 100 || message.length < 10 || message.length > 5000) {
      return Response.json({ error: "Please check the form fields and try again." }, { status: 400 });
    }
    await deliverMail({ name, email, phone, subject, message });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send your message.";
    const status = message.includes("not configured") || message.includes("configuration is incomplete") ? 503 : 502;
    return Response.json({ error: status === 503 ? "Our contact form is being configured. Please email sales@mobiwave.co.ke directly." : "We couldn't send your message just now. Please try again or email sales@mobiwave.co.ke." }, { status });
  }
}
