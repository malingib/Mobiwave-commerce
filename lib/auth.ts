import { betterAuth } from "better-auth";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Keep build-time imports safe; actual requests still fail clearly without configuration.
}

const pool = connectionString
  ? new Pool({
      connectionString,
      max: process.env.NODE_ENV === "production" ? 5 : 2,
      connectionTimeoutMillis: 5_000,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
    })
  : undefined;

export const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ],
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
