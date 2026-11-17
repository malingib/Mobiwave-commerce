import { redirect } from "next/navigation";
import Link from "next/link";
import { getRequestUser } from "@/lib/request-user";
import { db } from "@/lib/db";
import InboxClient from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage({ params }: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  const client = await db.connect();
  let allowed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const membership = await client.query(
      "SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2",
      [storeId,user.id],
    );
    allowed = Boolean(membership.rowCount);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
  }
  if (!allowed) redirect("/dashboard");
  return <InboxClient storeId={storeId} userId={user.id} userName={user.name} />;
}
