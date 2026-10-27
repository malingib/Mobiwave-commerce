import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import BillingClient from "./billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  return <BillingClient storeId={storeId} userName={user.name} />;
}
