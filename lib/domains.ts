export function normalizeCustomHostname(input: string, rootDomain: string) {
  const candidate = input.trim().toLowerCase().replace(/\.$/, "");
  if (!candidate || candidate.length > 253 || /[/:@?#\s]/.test(candidate)) return null;

  let hostname: string;
  try {
    const parsed = new URL(`https://${candidate}`);
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }

  // URL.hostname converts valid internationalized names to their ASCII/Punycode
  // form. Validate that canonical form rather than comparing it with the
  // original Unicode input.
  if (!hostname || hostname.length > 253 || !hostname.includes(".") || hostname === "localhost") return null;
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

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.ke","or.ke","ac.ke","go.ke","sc.ke","me.ke","ne.ke","mobi.ke",
  "co.uk","org.uk","ac.uk","gov.uk","com.au","net.au","org.au","co.nz","com.sg","com.my",
]);

export function isApexHostname(hostname: string) {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return true;
  return labels.length === 3 && MULTI_LABEL_PUBLIC_SUFFIXES.has(labels.slice(-2).join("."));
}

export function canonicalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return isApexHostname(normalized) ? `www.${normalized}` : normalized;
}
