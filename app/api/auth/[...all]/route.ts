import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { createAuth } from "@/lib/auth";

export const runtime = "nodejs";

function unavailable(method: "GET" | "POST", error: unknown) {
  const details = error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };

  console.error(`[auth] ${method} handler failed`, details);
  return NextResponse.json(
    { message: "Authentication is temporarily unavailable. Please try again shortly." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    const { GET: handle } = toNextJsHandler(createAuth());
    return await handle(request);
  } catch (error) {
    return unavailable("GET", error);
  }
}

export async function POST(request: Request) {
  try {
    const { POST: handle } = toNextJsHandler(createAuth());
    return await handle(request);
  } catch (error) {
    return unavailable("POST", error);
  }
}
