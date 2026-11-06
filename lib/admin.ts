import { getRequestUser } from "@/lib/request-user";

export async function getSuperAdmin() {
  const user = await getRequestUser();
  // An email allowlist is an authorization boundary only after ownership of
  // that email has been verified by the authentication provider.
  if (!user?.email || user.emailVerified !== true) return null;

  const allowed = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(user.email.toLowerCase())) return null;
  return user;
}
