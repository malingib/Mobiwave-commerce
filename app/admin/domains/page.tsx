import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/admin";
import AdminDomainsClient from "./domains-client";

export const dynamic = "force-dynamic";

export default async function AdminDomainsPage() {
  const user = await getSuperAdmin();
  if (!user) redirect("/admin");
  return <AdminDomainsClient email={user.email} />;
}
