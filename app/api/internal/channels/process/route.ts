import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processMetaWebhookBatch } from "@/lib/channels/webhook-worker";

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

  const limitValue = Number(new URL(request.url).searchParams.get("limit") || 25);
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(Math.floor(limitValue), 100)) : 25;
  try {
    const result = await processMetaWebhookBatch(limit);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "Pragma": "no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "Channel webhook batch processing failed" }, { status: 500 });
  }
}
