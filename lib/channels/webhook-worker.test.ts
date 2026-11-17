import { describe, expect, it } from "vitest";
import { mapProviderStatus, normalizeProviderTimestamp } from "@/lib/channels/webhook-worker";

describe("channel webhook worker normalization", () => {
  it("maps only supported provider delivery states", () => {
    expect(mapProviderStatus("sent")).toBe("sent");
    expect(mapProviderStatus("delivered")).toBe("delivered");
    expect(mapProviderStatus("read")).toBe("read");
    expect(mapProviderStatus("failed")).toBe("failed");
    expect(mapProviderStatus("deleted")).toBeNull();
    expect(mapProviderStatus(null)).toBeNull();
  });

  it("normalizes WhatsApp seconds and Instagram milliseconds", () => {
    expect(normalizeProviderTimestamp("1794912000")).toBe(new Date(1794912000000).toISOString());
    expect(normalizeProviderTimestamp(1794912000000)).toBe(new Date(1794912000000).toISOString());
    expect(normalizeProviderTimestamp("2026-11-17T10:00:00.000Z")).toBe("2026-11-17T10:00:00.000Z");
    expect(normalizeProviderTimestamp("not-a-date")).toBeNull();
  });
});
