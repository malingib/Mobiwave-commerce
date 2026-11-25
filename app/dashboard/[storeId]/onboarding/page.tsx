import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import OnboardingClient from "./onboarding-client";

export const dynamic = "force-dynamic";

export default async function StoreOnboardingPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  return <OnboardingClient storeId={storeId} userName={user.name} />;
}
