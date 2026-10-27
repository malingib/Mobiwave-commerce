import { getRequestUser } from "@/lib/request-user";

export async function getSuperAdmin() {
  const user = await getRequestUser();
  if (!user?.email) return null;
  const allowed = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) return null;
  return user;
}
