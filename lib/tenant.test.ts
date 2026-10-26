import { describe, expect, it } from "vitest";
import { normalizeStoreSlug, resolveStoreSlug } from "./tenant";

describe("normalizeStoreSlug", () => {
  it("normalizes human-entered store names", () => {
    expect(normalizeStoreSlug("  Malingi's Fashion & Beauty  ")).toEqual({
      ok: true,
      slug: "malingi-s-fashion-beauty",
    });
  });

  it("normalizes accented characters", () => {
    expect(normalizeStoreSlug("Café Nia")).toEqual({ ok: true, slug: "cafe-nia" });
  });

  it("rejects empty values", () => {
    expect(normalizeStoreSlug(" --- ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects reserved slugs", () => {
    expect(normalizeStoreSlug("admin")).toEqual({ ok: false, reason: "reserved" });
  });

  it("rejects slugs longer than DNS label limits", () => {
    expect(normalizeStoreSlug("a".repeat(64))).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns a canonical slug", () => {
    expect(normalizeStoreSlug("MAMA KENYA")).toEqual({ ok: true, slug: "mama-kenya" });
  });
});

describe("resolveStoreSlug", () => {
  const root = "shop.mobiwave.co.ke";

  it("resolves a valid single-level store hostname", () => {
    expect(resolveStoreSlug("Mama-Kenya.shop.mobiwave.co.ke", root)).toBe("mama-kenya");
  });

  it("accepts a trailing DNS dot and a local port", () => {
    expect(resolveStoreSlug("mama-kenya.shop.mobiwave.co.ke.:443", root)).toBe("mama-kenya");
  });

  it("does not resolve the root domain itself", () => {
    expect(resolveStoreSlug(root, root)).toBeNull();
  });

  it("does not accept a deceptive suffix", () => {
    expect(resolveStoreSlug("mama.shop.mobiwave.co.ke.evil.test", root)).toBeNull();
  });

  it("does not accept nested subdomains", () => {
    expect(resolveStoreSlug("x.mama.shop.mobiwave.co.ke", root)).toBeNull();
  });

  it("does not resolve reserved names", () => {
    expect(resolveStoreSlug("admin.shop.mobiwave.co.ke", root)).toBeNull();
  });
});
