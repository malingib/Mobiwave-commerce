import { headers } from "next/headers";
import { createAuth } from "@/lib/auth";

export async function getRequestUser() {
  const session = await createAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
