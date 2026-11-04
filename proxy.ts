import { NextRequest, NextResponse } from "next/server";
import { resolveStoreSlug } from "@/lib/tenant";

export function proxy(request: NextRequest) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (!rootDomain) return NextResponse.next();

  const hostname = (request.headers.get("host") || request.nextUrl.hostname)
    .toLowerCase()
    .split(":")[0]
    .replace(/\.$/, "");
  const slug = resolveStoreSlug(hostname, rootDomain);
  if (slug) {
    const url = request.nextUrl.clone();
    url.pathname = `/shop/${slug}`;
    return NextResponse.rewrite(url);
  }

  const root = rootDomain.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (hostname === root || hostname.endsWith(`.${root}`)) return NextResponse.next();

  // Keep MobiWave-owned app/service hosts and Vercel deployment hosts on the
  // main application. Only externally verified merchant domains are routed.
  if (
    hostname === "mobiwave.co.ke" ||
    hostname.endsWith(".mobiwave.co.ke") ||
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  ) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/domain-store/${hostname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/"] };
