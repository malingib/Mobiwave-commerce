import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { normalizeCustomHostname } from "@/lib/domains";
import StorefrontClient from "@/app/storefront-client";

export const dynamic = "force-dynamic";

export default async function CustomDomainStorePage({ params }: { params: Promise<{ hostname: string }> }) {
  const { hostname: rawHostname } = await params;
  const hostname = normalizeCustomHostname(rawHostname, process.env.NEXT_PUBLIC_ROOT_DOMAIN || "shop.mobiwave.co.ke");
  if (!hostname) notFound();

  const result = await db.query(
    `SELECT s.slug
       FROM store_domains d
       JOIN stores s ON s.id=d.store_id
      WHERE d.hostname=$1
        AND d.status='active'
        AND d.verified_at IS NOT NULL
        AND s.status='active'
      LIMIT 1`,
    [hostname],
  );
  if (!result.rowCount) notFound();
  return <StorefrontClient slug={result.rows[0].slug} />;
}
