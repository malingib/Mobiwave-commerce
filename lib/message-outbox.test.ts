import { describe, expect, it } from "vitest";
import { renderCommerceSms } from "@/lib/message-outbox";

describe("transactional commerce SMS templates", () => {
  it("renders order received details without trusting HTML", () => {
    const message = renderCommerceSms("order_received", {
      storeName: "Kilifi Store",
      customerName: "Amina",
      orderNumber: "MW-1001",
      totalMinor: 125050,
      currency: "KES",
    });
    expect(message).toContain("Amina");
    expect(message).toContain("MW-1001");
    expect(message).toContain("KES 1,250.5");
  });

  it("warns customers not to pay again while a payment is uncertain", () => {
    const message = renderCommerceSms("order_payment_failed", {
      storeName: "Test Store",
      customerName: "Amina",
      orderNumber: "MW-1002",
    });
    expect(message).toContain("If you were charged");
    expect(message).toContain("before paying again");
  });
});
