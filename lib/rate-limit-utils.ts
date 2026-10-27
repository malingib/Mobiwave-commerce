import { createHash } from "node:crypto";

export function clientAddress(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 64) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && forwarded.length <= 64 ? forwarded : "unknown";
}

export function rateLimitKey(scope: string, address: string): string {
  return createHash("sha256").update(`${scope}:${address}`).digest("hex");
}
