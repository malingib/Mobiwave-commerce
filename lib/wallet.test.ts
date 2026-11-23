import assert from "node:assert/strict";
import test from "node:test";
import { calculateSmsWalletCharge, countSmsSegments, creditStoreWalletFromMpesa } from "@/lib/wallet";

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
  assert.deepEqual(countSmsSegments("\f"), {encoding:"GSM-7",units:2,segments:1});
  assert.equal(countSmsSegments("A".repeat(306)).segments,2);
  assert.equal(countSmsSegments("A".repeat(307)).segments,3);
  assert.equal(countSmsSegments("€".repeat(81)).segments,2);
  assert.deepEqual(countSmsSegments("😀"), {encoding:"UCS-2",units:2,segments:1});
  assert.equal(countSmsSegments("漢".repeat(71)).segments,2);
});

test("M-Pesa wallet credit posts one append-only ledger movement", async () => {
  const statements:Array<{sql:string;params?:unknown[]}>=[];
  const client={
    query:async(sql:string,params?:unknown[])=>{
      statements.push({sql,params});
      if(sql.includes("SELECT currency,status,available_balance_minor"))return {rowCount:1,rows:[{currency:"KES",status:"active",available_balance_minor:"5000"}]};
      if(sql.includes("INSERT INTO store_wallet_transactions"))return {rowCount:1,rows:[{id:"ledger-1"}]};
      if(sql.includes("UPDATE store_wallet_accounts"))return {rowCount:1,rows:[{available_balance_minor:"15000"}]};
      return {rowCount:1,rows:[]};
    },
  } as unknown as import("pg").PoolClient;
  const result=await creditStoreWalletFromMpesa(client,{storeId:"store-1",attemptId:"attempt-1",amountMinor:10000,currency:"KES",receipt:"ABC123456"});
  assert.deepEqual(result,{ok:true,balanceMinor:15000});
  assert.equal(statements.some(entry=>entry.params?.[3]==="mpesa-topup:attempt-1"),true);
  assert.equal(statements.some(entry=>entry.sql.includes("ON CONFLICT (store_id,idempotency_key) DO NOTHING")),true);
});

test("M-Pesa duplicate wallet credit never increments the balance twice", async () => {
  let balanceUpdates=0;
  const client={
    query:async(sql:string)=>{
      if(sql.includes("SELECT currency,status,available_balance_minor"))return {rowCount:1,rows:[{currency:"KES",status:"active",available_balance_minor:"15000"}]};
      if(sql.includes("INSERT INTO store_wallet_transactions"))return {rowCount:0,rows:[]};
      if(sql.includes("UPDATE store_wallet_accounts")){balanceUpdates++;return {rowCount:1,rows:[{available_balance_minor:"25000"}]};}
      return {rowCount:1,rows:[]};
    },
  } as unknown as import("pg").PoolClient;
  const result=await creditStoreWalletFromMpesa(client,{storeId:"store-1",attemptId:"attempt-1",amountMinor:10000,currency:"KES",receipt:"ABC123456"});
  assert.deepEqual(result,{ok:false,reason:"duplicate_wallet_credit"});
  assert.equal(balanceUpdates,0);
});

test("M-Pesa wallet credit rejects currency mismatch and closed wallets", async () => {
  const makeClient=(currency:string,status:string)=>({
    query:async(sql:string)=>{
      if(sql.includes("SELECT set_config"))return {rowCount:1,rows:[]};
      if(sql.includes("SELECT currency,status,available_balance_minor"))return {rowCount:1,rows:[{currency,status,available_balance_minor:"0"}]};
      if(sql.includes("INSERT INTO store_wallet_accounts"))return {rowCount:1,rows:[]};
      throw new Error("ledger should not be written for invalid wallet state");
    },
  } as unknown as import("pg").PoolClient);
  const mismatch=await creditStoreWalletFromMpesa(makeClient("USD","active"),{storeId:"store-1",attemptId:"attempt-1",amountMinor:100,currency:"KES",receipt:"ABC123456"});
  const closed=await creditStoreWalletFromMpesa(makeClient("KES","closed"),{storeId:"store-1",attemptId:"attempt-2",amountMinor:100,currency:"KES",receipt:"ABC123457"});
  assert.deepEqual(mismatch,{ok:false,reason:"wallet_currency_mismatch"});
  assert.deepEqual(closed,{ok:false,reason:"wallet_closed"});
});

test("M-Pesa wallet credit only accepts whole-shilling integer amounts", async () => {
  const client={query:async()=>({rowCount:1,rows:[]})} as unknown as import("pg").PoolClient;
  await assert.rejects(creditStoreWalletFromMpesa(client,{storeId:"store-1",attemptId:"attempt-1",amountMinor:150,currency:"KES",receipt:"ABC123456"}),/invalid_mpesa_wallet_credit/);
});
