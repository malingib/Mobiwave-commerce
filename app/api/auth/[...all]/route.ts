import { toNextJsHandler } from "better-auth/next-js";
import { createAuth } from "@/lib/auth";

export const runtime = "nodejs";

async function handlers() {
  return toNextJsHandler(createAuth());
}

export async function GET(request: Request) {
  const { GET: handle } = await handlers();
  return handle(request);
}

export async function POST(request: Request) {
  const { POST: handle } = await handlers();
  return handle(request);
}
