import { betterAuth } from "better-auth";
import { Pool } from "pg";

let pool: Pool | undefined;

export function createAuth() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!connectionString || !secret || secret.length < 32) {
    throw new Error("Authentication is not configured: set DATABASE_URL and a BETTER_AUTH_SECRET of at least 32 characters.");
  }

  pool ??= new Pool({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 5 : 2,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });

  return betterAuth({
    database: pool,
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    secret,
    trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
  });
}
