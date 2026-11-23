import assert from "node:assert/strict";
import test from "node:test";
import { calculateSmsWalletCharge } from "@/lib/wallet";

test("SMS overage is charged only after the included allowance", () => {
  assert.deepEqual(calculateSmsWalletCharge(125, 100, 35), {
    totalSegments: 125, includedSegments: 100, billableSegments: 25, unitRateMinor: 35, amountMinor: 875,
  });
});
test("messages within the allowance do not consume wallet funds", () => {
  assert.equal(calculateSmsWalletCharge(80, 100, 35).amountMinor, 0);
});
test("zero allowance charges every segment", () => {
  assert.equal(calculateSmsWalletCharge(3, 0, 25).amountMinor, 75);
});
test("invalid or unsafe values are rejected", () => {
  assert.throws(() => calculateSmsWalletCharge(-1, 0, 25), /invalid_totalSegments/);
  assert.throws(() => calculateSmsWalletCharge(1, 0, -1), /invalid_unitRateMinor/);
  assert.throws(() => calculateSmsWalletCharge(Number.MAX_SAFE_INTEGER, 0, 2), /sms_charge_overflow/);
});
