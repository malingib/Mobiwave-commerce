import StorefrontClient from "@/app/storefront-client";

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StorefrontClient slug={slug} />;
}
