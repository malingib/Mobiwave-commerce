import { getRequestUser } from "@/lib/request-user";
import { isVerifiedSuperAdmin } from "@/lib/security";

export async function getSuperAdmin() {
  const user = await getRequestUser();
  if (!isVerifiedSuperAdmin(user?.email, user?.emailVerified === true, process.env.SUPERADMIN_EMAILS)) {
    return null;
  }
  return user;
}
