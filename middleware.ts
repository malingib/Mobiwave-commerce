import { NextRequest, NextResponse } from "next/server";
import { resolveStoreSlug } from "@/lib/tenant";

export function middleware(request: NextRequest) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (!rootDomain) return NextResponse.next();

  const hostname = request.headers.get("host") || request.nextUrl.hostname;
  const slug = resolveStoreSlug(hostname, rootDomain);
  if (!slug) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/shop/${slug}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/"] };
