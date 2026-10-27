import { Pool } from "pg";

const globalForDb = globalThis as unknown as { commercePool?: Pool };
let localPool: Pool | undefined;

function getPool(): Pool {
  if (globalForDb.commercePool) return globalForDb.commercePool;
  if (localPool) return localPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  localPool = new Pool({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 5 : 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });
  if (process.env.NODE_ENV !== "production") globalForDb.commercePool = localPool;
  return localPool;
}

// Lazy initialization allows Next.js to collect route metadata during build without
// connecting to a database. Every actual database operation still fails closed if
// DATABASE_URL is missing.
export const db = new Proxy({} as Pool, {
  get(_target, property) {
    const pool = getPool();
    const value = Reflect.get(pool, property, pool) as unknown;
    return typeof value === "function" ? value.bind(pool) : value;
  },
});
