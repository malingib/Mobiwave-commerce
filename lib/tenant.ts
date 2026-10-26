const RESERVED_STORE_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "cdn",
  "checkout",
  "commerce",
  "dashboard",
  "developers",
  "docs",
  "help",
  "login",
  "mail",
  "media",
  "oauth",
  "payments",
  "pricing",
  "root",
  "security",
  "shop",
  "status",
  "support",
  "www",
]);

export type StoreSlugResult =
  | { ok: true; slug: string }
  | { ok: false; reason: "empty" | "invalid" | "reserved" };

/**
 * Normalize and validate a public store slug.
 * Call this during reservation and enforce uniqueness in the database as well.
 */
export function normalizeStoreSlug(input: string): StoreSlugResult {
  const slug = input
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) return { ok: false, reason: "empty" };
  if (slug.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return { ok: false, reason: "invalid" };
  }
  if (RESERVED_STORE_SLUGS.has(slug)) return { ok: false, reason: "reserved" };

  return { ok: true, slug };
}

/**
 * Resolve a single-level free subdomain to its store slug.
 *
 * This is only a pure hostname parser. Production must look the slug up in a
 * verified domain/store registry; a parsed slug is never proof of authorization.
 */
export function resolveStoreSlug(hostname: string, rootDomain: string): string | null {
  const host = hostname.toLowerCase().split(":")[0].replace(/\.$/, "");
  const root = rootDomain.toLowerCase().replace(/^\.+|\.+$/g, "");

  if (!host || !root || host === root || !host.endsWith(`.${root}`)) {
    return null;
  }

  const slug = host.slice(0, -(root.length + 1));
  if (!slug || slug.includes(".")) return null;

  const result = normalizeStoreSlug(slug);
  return result.ok ? result.slug : null;
}
