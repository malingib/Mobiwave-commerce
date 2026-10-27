import { describe, expect, it } from "vitest";
import { clientAddress, rateLimitKey } from "./rate-limit";

describe("rate limit key helpers", () => {
  it("prefers the platform real-ip header", () => {
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.1" },
    });
    expect(clientAddress(request)).toBe("203.0.113.10");
  });

  it("uses the first forwarded address as a fallback", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "198.51.100.2, 198.51.100.3" },
    });
    expect(clientAddress(request)).toBe("198.51.100.2");
  });

  it("hashes keys and separates scopes", () => {
    expect(rateLimitKey("checkout", "1.2.3.4")).toMatch(/^[a-f0-9]{64}$/);
    expect(rateLimitKey("checkout", "1.2.3.4")).toBe(rateLimitKey("checkout", "1.2.3.4"));
    expect(rateLimitKey("checkout", "1.2.3.4")).not.toBe(rateLimitKey("login", "1.2.3.4"));
  });
});
