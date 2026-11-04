import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { sendTransactionalEmail } from "@/lib/email";

let pool: Pool | undefined;

function getAuthBaseUrl() {
  // Preview deployments must derive their origin from the incoming request.
  // A production BETTER_AUTH_URL shared with Preview would send verification
  // links to the production deployment instead of the preview under test.
  if (process.env.VERCEL_ENV === "preview") return undefined;
  if (process.env.VERCEL_ENV === "production") {
    return process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  }
  return process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export function createAuth() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!connectionString || !secret || secret.length < 32) {
    throw new Error("Authentication is not configured: set DATABASE_URL and a BETTER_AUTH_SECRET of at least 32 characters.");
  }

  pool ??= new Pool({
    connectionString,
    // Auth and application queries must use the same restricted role. The
    // commerce_app login has BYPASSRLS; never leave this pool on that role.
    options: "-c role=commerce_runtime",
    max: process.env.NODE_ENV === "production" ? 5 : 2,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });

  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;

  return betterAuth({
    database: pool,
    baseURL: getAuthBaseUrl(),
    secret,
    trustedOrigins: [
      ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
      "https://mobiwave.co.ke",
      "https://*.mobiwave.co.ke",
      ...(vercelOrigin ? [vercelOrigin] : []),
      ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000"] : []),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendTransactionalEmail({
          to: user.email,
          name: user.name,
          subject: "Verify your MobiWave Commerce account",
          heading: "Verify your email address",
          intro: "Confirm this email address to secure your MobiWave Commerce account.",
          actionLabel: "Verify email address",
          actionUrl: url,
          outro: "This verification link expires after one hour. If you did not create this account, you can ignore this email.",
        });
      },
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
  });
}
