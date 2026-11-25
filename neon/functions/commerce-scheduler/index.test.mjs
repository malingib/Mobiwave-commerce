import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "./index.mjs";

const quietLogger = { info() {}, error() {} };
const invocationId = "neon-invocation-test-001";

function triggerRequest(path, triggerName, method = "POST") {
  return new Request(`https://scheduler.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-neon-trigger-invocation-id": invocationId,
    },
    body: method === "POST" ? JSON.stringify({
      version: 1,
      invocation_id: invocationId,
      trigger: { type: "schedule", name: triggerName },
    }) : undefined,
  });
}

test("rejects non-POST requests", async () => {
  const handler = createHandler({ logger: quietLogger });
  const response = await handler(triggerRequest("/billing", "commerce-subscription-billing", "GET"));
  assert.equal(response.status, 405);
});

test("rejects unknown function paths", async () => {
  const handler = createHandler({ logger: quietLogger });
  const response = await handler(triggerRequest("/unknown", "unknown"));
  assert.equal(response.status, 404);
});

test("rejects requests without a Neon-issued invocation header", async () => {
  const handler = createHandler({ logger: quietLogger });
  const request = new Request("https://scheduler.test/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, invocation_id: invocationId, trigger: { type: "schedule", name: "commerce-subscription-billing" } }),
  });
  const response = await handler(request);
  assert.equal(response.status, 401);
});

test("rejects a mismatched trigger name", async () => {
  const handler = createHandler({ logger: quietLogger });
  const response = await handler(triggerRequest("/billing", "commerce-message-outbox"));
  assert.equal(response.status, 401);
});

test("billing trigger uses its dedicated secret and endpoint", async () => {
  const token = "b".repeat(48);
  let calledUrl;
  let calledAuthorization;
  const handler = createHandler({
    env: { COMMERCE_BILLING_WORKER_TOKEN: token, CHANNEL_WORKER_SECRET: "c".repeat(48) },
    logger: quietLogger,
    fetcher: async (url, init) => {
      calledUrl = url;
      calledAuthorization = init.headers.authorization;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const response = await handler(triggerRequest("/billing", "commerce-subscription-billing"));
  assert.equal(response.status, 200);
  assert.equal(calledUrl, "https://mobiwave-commerce.vercel.app/api/workers/subscription-billing");
  assert.equal(calledAuthorization, `Bearer ${token}`);
});

test("billing trigger fails closed when its dedicated secret is missing", async () => {
  let called = false;
  const handler = createHandler({
    env: { CHANNEL_WORKER_SECRET: "c".repeat(48) },
    logger: quietLogger,
    fetcher: async () => { called = true; return new Response("{}", { status: 200 }); },
  });
  const response = await handler(triggerRequest("/billing", "commerce-subscription-billing"));
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("existing message outbox continues to use the channel worker secret", async () => {
  const token = "c".repeat(48);
  let calledAuthorization;
  const handler = createHandler({
    env: { CHANNEL_WORKER_SECRET: token },
    logger: quietLogger,
    fetcher: async (_url, init) => {
      calledAuthorization = init.headers.authorization;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const response = await handler(triggerRequest("/outbox", "commerce-message-outbox"));
  assert.equal(response.status, 200);
  assert.equal(calledAuthorization, `Bearer ${token}`);
});

test("propagates an upstream worker failure as 502", async () => {
  const handler = createHandler({
    env: { COMMERCE_BILLING_WORKER_TOKEN: "b".repeat(48) },
    logger: quietLogger,
    fetcher: async () => new Response(JSON.stringify({ error: "worker failed" }), { status: 503 }),
  });
  const response = await handler(triggerRequest("/billing", "commerce-subscription-billing"));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.upstreamStatus, 503);
});
