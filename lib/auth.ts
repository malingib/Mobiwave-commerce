import { betterAuth } from "better-auth";
import { Pool } from "pg";

let pool: Pool | undefined;

export function createAuth() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!connectionString || !secret || secret.length < 32) {
    throw new Error("Authentication is not configured: set DATABASE_URL and a BETTER_AUTH_SECRET of at least 32 characters.");
  }

  const emailVerificationEnabled = Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);

  pool ??= new Pool({
    connectionString,
    // Authentication uses a dedicated least-privilege role, not the Neon owner
    // or the commerce application role. See db/roles/commerce-auth-runtime.sql.
    options: "-c role=commerce_auth_runtime",
    max: process.env.NODE_ENV === "production" ? 5 : 2,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });

  return betterAuth({
    database: pool,
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    secret,
    trustedOrigins: [
      process.env.NEXT_PUBLIC_APP_URL || "https://mobiwave-commerce.vercel.app",
      "https://*.vercel.app",
      "https://mobiwave.co.ke",
      "https://*.mobiwave.co.ke",
      ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: emailVerificationEnabled,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    emailVerification: {
      sendOnSignUp: emailVerificationEnabled,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.AUTH_EMAIL_FROM;
        if (!apiKey || !from) {
          throw new Error("Email verification is unavailable: configure RESEND_API_KEY and AUTH_EMAIL_FROM.");
        }

        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [user.email],
            subject: "Verify your MobiWave Commerce account",
            text: `Verify your MobiWave Commerce email address using this link: ${url}\n\nIf you did not create this account, you can ignore this message.`,
          }),
          cache: "no-store",
        });

        if (!response.ok) {
          // Do not log credentials, verification tokens, or provider response bodies.
          throw new Error("The verification email could not be delivered.");
        }
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
  });
}
