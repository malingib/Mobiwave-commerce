import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import { getSuperAdmin } from "@/lib/admin";
import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const admin = await getSuperAdmin();
  if (!admin) redirect("/dashboard");
  return <AdminClient email={admin.email} />;
}
