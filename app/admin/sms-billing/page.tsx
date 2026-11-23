import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/admin";
import SmsBillingClient from "./sms-billing-client";

export const dynamic = "force-dynamic";

export default async function AdminSmsBillingPage() {
  const user = await getSuperAdmin();
  if (!user) redirect("/admin");
  return <SmsBillingClient email={user.email} />;
}
