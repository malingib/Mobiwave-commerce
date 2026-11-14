import { getRequestUser } from "@/lib/request-user";

type AdminIdentity = { email?: string | null; emailVerified?: boolean | null };

export function isVerifiedSuperAdmin(user: AdminIdentity | null | undefined, allowlist: string) {
  if (!user?.email || user.emailVerified !== true) return false;
  const allowed = allowlist
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email.trim().toLowerCase());
}

export async function getSuperAdmin() {
  const user = await getRequestUser();
  if (!isVerifiedSuperAdmin(user, process.env.SUPERADMIN_EMAILS || "")) return null;
  return user;
}
