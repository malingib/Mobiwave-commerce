import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import DomainsClient from "./domains-client";

export const dynamic = "force-dynamic";

export default async function DomainsPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  return <DomainsClient storeId={storeId} userName={user.name} />;
}
