import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/admin";
import ReconciliationClient from "./reconciliation-client";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const user = await getSuperAdmin();
  if (!user) redirect("/admin");
  return <ReconciliationClient email={user.email} />;
}
