import { Pool } from "pg";

const globalForDb = globalThis as unknown as { commercePool?: Pool };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  return new Pool({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 5 : 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });
}

export const db = globalForDb.commercePool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.commercePool = db;
