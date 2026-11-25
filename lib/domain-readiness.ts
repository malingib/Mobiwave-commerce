import { isIP } from "node:net";
import { connect } from "node:tls";

export function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a,b,c] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
        value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") ||
        value.startsWith("feb") || value.startsWith("ff") || value.startsWith("::ffff:")) return false;
    return true;
  }
  return false;
}

export function isVercelDnsTarget(targets: string[], ipv4: string[]) {
  const cnameReady = targets.some(target => {
    const normalized = target.toLowerCase().replace(/\.$/, "");
    return normalized === "cname.vercel-dns.com" || normalized.endsWith(".vercel-dns.com");
  });
  return cnameReady || ipv4.includes("76.76.21.21");
}

export async function hasValidTlsCertificate(hostname: string, addresses: string[]) {
  for (const address of addresses.filter(isPublicAddress)) {
    const valid = await new Promise<boolean>(resolve => {
      const socket = connect({
        host: address,
        port: 443,
        servername: hostname,
        rejectUnauthorized: true,
        timeout: 8000,
      });
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.once("secureConnect", () => finish(socket.authorized));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
    });
    if (valid) return true;
  }
  return false;
}
