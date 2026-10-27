import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import ProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  return <ProductsClient storeId={storeId} userName={user.name} />;
}
