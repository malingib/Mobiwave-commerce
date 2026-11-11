import { describe, expect, it } from "vitest";
import { formatDarajaTimestamp } from "../lib/mpesa-time";

describe("formatDarajaTimestamp", () => {
  it("formats an instant in Africa/Nairobi rather than the host timezone", () => {
    expect(formatDarajaTimestamp(new Date("2026-11-11T12:34:56.000Z"))).toBe("20261111153456");
  });

  it("handles midnight in Nairobi using a 24-hour clock", () => {
    expect(formatDarajaTimestamp(new Date("2026-11-10T21:00:00.000Z"))).toBe("20261111000000");
  });

  it("rejects invalid dates", () => {
    expect(() => formatDarajaTimestamp(new Date("invalid"))).toThrow("A valid date is required");
  });
});
