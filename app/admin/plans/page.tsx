import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/admin";
import PlansClient from "./plans-client";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const user = await getSuperAdmin();
  if (!user) redirect("/admin");
  return <PlansClient email={user.email} />;
}
