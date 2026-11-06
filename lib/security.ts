export function isVerifiedSuperAdmin(
  email: string | null | undefined,
  emailVerified: boolean,
  allowlist: string | undefined,
): boolean {
  if (!email || !emailVerified) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const allowed = (allowlist || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(normalizedEmail);
}

export function normalizeKenyanPhone(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `254${digits}`;
  return null;
}
