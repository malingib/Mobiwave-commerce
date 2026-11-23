import assert from "node:assert/strict";
import test from "node:test";
import { calculateSmsWalletCharge, countSmsSegments } from "@/lib/wallet";

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

test("GSM-7 and UCS-2 segment boundaries are calculated correctly", () => {
  assert.deepEqual(countSmsSegments("A".repeat(160)), {encoding:"GSM-7",units:160,segments:1});
  assert.equal(countSmsSegments("A".repeat(161)).segments,2);
  assert.deepEqual(countSmsSegments("^"), {encoding:"GSM-7",units:2,segments:1});
  assert.equal(countSmsSegments("€".repeat(81)).segments,2);
  assert.deepEqual(countSmsSegments("😀"), {encoding:"UCS-2",units:2,segments:1});
  assert.equal(countSmsSegments("漢".repeat(71)).segments,2);
});
