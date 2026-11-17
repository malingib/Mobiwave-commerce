import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOutboundMessageBatch } from "@/lib/channels/outbound-worker";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.CHANNEL_WORKER_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.CHANNEL_WORKER_SECRET) {
    return NextResponse.json({ error: "Channel worker is not configured" }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const value = Number(new URL(request.url).searchParams.get("limit") || 20);
  const limit = Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 100)) : 20;
  try {
    const result = await processOutboundMessageBatch(limit);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch {
    return NextResponse.json({ error: "Outbound message batch failed" }, { status: 500 });
  }
}
