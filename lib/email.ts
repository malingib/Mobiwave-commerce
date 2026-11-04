type TransactionalEmailInput = {
  to: string;
  name?: string;
  subject: string;
  heading: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  outro: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

export async function sendTransactionalEmail(input: TransactionalEmailInput) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "MobiWave Commerce";
  if (!apiKey || !senderEmail) {
    throw new Error("Transactional email is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.");
  }

  const actionUrl = new URL(input.actionUrl);
  if (actionUrl.protocol !== "https:" && actionUrl.hostname !== "localhost") {
    throw new Error("Verification links must use HTTPS.");
  }

  const name = input.name ? escapeHtml(input.name) : "there";
  const heading = escapeHtml(input.heading);
  const intro = escapeHtml(input.intro);
  const actionLabel = escapeHtml(input.actionLabel);
  const outro = escapeHtml(input.outro);
  const safeUrl = escapeHtml(actionUrl.toString());
  const htmlContent = `<!doctype html><html lang="en"><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#171923"><main style="max-width:560px;margin:40px auto;padding:36px;background:#fff;border:1px solid #e5e7eb;border-radius:12px"><p style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#5955D1">MOBIWAVE COMMERCE</p><h1 style="font-size:25px;line-height:1.25">${heading}</h1><p>Hello ${name},</p><p>${intro}</p><p style="margin:30px 0"><a href="${safeUrl}" style="display:inline-block;background:#171923;color:#fff;text-decoration:none;padding:13px 20px;border-radius:7px;font-weight:700">${actionLabel}</a></p><p style="font-size:13px;line-height:1.6;color:#626778">${outro}</p></main></body></html>`;
  const textContent = `${input.heading}\n\nHello ${input.name || "there"},\n\n${input.intro}\n\n${input.actionLabel}: ${actionUrl.toString()}\n\n${input.outro}`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "accept": "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: input.to, name: input.name || input.to }],
      subject: input.subject,
      htmlContent,
      textContent,
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (!response.ok) {
    // Do not include provider response bodies or credentials in application logs.
    throw new Error(`Transactional email delivery failed (HTTP ${response.status}).`);
  }
}
