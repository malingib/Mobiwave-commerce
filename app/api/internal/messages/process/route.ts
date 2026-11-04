import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processQueuedSmsBatch } from "@/lib/message-outbox";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Message worker is not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await processQueuedSmsBatch(30), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Message batch processing failed." }, { status: 500 });
  }
}

export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request) { return handle(request); }
