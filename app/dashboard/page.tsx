import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  return <DashboardClient name={user.name} email={user.email} />;
}
