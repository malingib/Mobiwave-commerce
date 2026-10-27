import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import OrdersClient from "./orders-client";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  return <OrdersClient storeId={storeId} userName={user.name} />;
}
