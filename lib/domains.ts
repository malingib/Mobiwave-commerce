export function normalizeCustomHostname(input: string, rootDomain: string) {
  const candidate = input.trim().toLowerCase().replace(/\.$/, "");
  if (!candidate || candidate.length > 253 || /[/:@?#\s]/.test(candidate)) return null;
  let hostname: string;
  try {
    const parsed = new URL(`https://${candidate}`);
    hostname = parsed.hostname.toLowerCase();
    if (parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  if (hostname !== candidate || !hostname.includes(".") || hostname === "localhost") return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const labels = hostname.split(".");
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  const root = rootDomain.trim().toLowerCase().replace(/\.$/, "");
  if (hostname === root || hostname.endsWith(`.${root}`)) return null;
  if (hostname === "mobiwave.co.ke" || hostname.endsWith(".mobiwave.co.ke") || hostname.endsWith(".vercel.app")) return null;
  return hostname;
}

export function domainVerificationRecordName(hostname: string) {
  return `_mobiwave-commerce.${hostname}`;
}

export function domainVerificationRecordValue(token: string) {
  return `mobiwave-commerce-verification=${token}`;
}
