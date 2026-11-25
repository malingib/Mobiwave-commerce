import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import { getSuperAdmin } from "@/lib/admin";
import LaunchReviewsClient from "./launch-reviews-client";

export const dynamic = "force-dynamic";

export default async function LaunchReviewsPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const admin = await getSuperAdmin();
  if (!admin) redirect("/dashboard");
  return <LaunchReviewsClient email={admin.email} />;
}
