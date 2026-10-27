import { db } from "@/lib/db";
export { clientAddress, rateLimitKey } from "@/lib/rate-limit-utils";

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export async function consumeRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = await db.query(
    `INSERT INTO api_rate_limits (bucket_key, window_started_at, hits, updated_at)
     VALUES ($1, now(), 1, now())
     ON CONFLICT (bucket_key) DO UPDATE SET
       window_started_at = CASE
         WHEN api_rate_limits.window_started_at <= now() - make_interval(secs => $2)
         THEN now() ELSE api_rate_limits.window_started_at END,
       hits = CASE
         WHEN api_rate_limits.window_started_at <= now() - make_interval(secs => $2)
         THEN 1 ELSE api_rate_limits.hits + 1 END,
       updated_at = now()
     RETURNING hits, GREATEST(0, CEIL(EXTRACT(EPOCH FROM
       (window_started_at + make_interval(secs => $2) - now())))::integer) AS retry_after_seconds`,
    [bucketKey, windowSeconds],
  );
  const hits = Number(result.rows[0].hits);
  const retryAfterSeconds = Math.max(1, Number(result.rows[0].retry_after_seconds) || windowSeconds);
  return { allowed: hits <= limit, remaining: Math.max(0, limit - hits), retryAfterSeconds };
}
