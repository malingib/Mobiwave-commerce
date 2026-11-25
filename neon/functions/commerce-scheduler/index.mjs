const APP_ORIGIN = "https://mobiwave-commerce.vercel.app";
const ROUTES = Object.freeze({
  "/webhooks": {
    triggerName: "commerce-channel-webhooks",
    url: `${APP_ORIGIN}/api/internal/channels/process?limit=50`,
    secretName: "CHANNEL_WORKER_SECRET",
    timeoutMs: 45_000,
  },
  "/outbound": {
    triggerName: "commerce-channel-outbound",
    url: `${APP_ORIGIN}/api/internal/channels/send?limit=4`,
    secretName: "CHANNEL_WORKER_SECRET",
    timeoutMs: 75_000,
  },
  "/outbox": {
    triggerName: "commerce-message-outbox",
    url: `${APP_ORIGIN}/api/internal/messages/process`,
    secretName: "CHANNEL_WORKER_SECRET",
    timeoutMs: 45_000,
  },
  "/billing": {
    triggerName: "commerce-subscription-billing",
    url: `${APP_ORIGIN}/api/workers/subscription-billing`,
    secretName: "COMMERCE_BILLING_WORKER_TOKEN",
    timeoutMs: 55_000,
  },
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function createHandler({ env = process.env, fetcher = fetch, logger = console } = {}) {
  return async function handle(request) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const route = ROUTES[new URL(request.url).pathname];
    if (!route) return json({ error: "not_found" }, 404);

    const headerInvocationId = request.headers.get("x-neon-trigger-invocation-id");
    if (!headerInvocationId) return json({ error: "not_a_neon_trigger_invocation" }, 401);

    let delivery;
    try { delivery = await request.json(); }
    catch { return json({ error: "invalid_trigger_payload" }, 400); }

    if (
      delivery?.version !== 1 ||
      typeof delivery.invocation_id !== "string" ||
      delivery.invocation_id !== headerInvocationId ||
      delivery?.trigger?.type !== "schedule" ||
      delivery?.trigger?.name !== route.triggerName
    ) return json({ error: "invalid_trigger_delivery" }, 401);

    const secret = env[route.secretName];
    if (typeof secret !== "string" || secret.length < 32) {
      logger.error("Commerce worker secret is not configured", { trigger: route.triggerName, secretName: route.secretName });
      return json({ error: "worker_secret_not_configured" }, 503);
    }

    logger.info("Commerce scheduled worker started", { trigger: route.triggerName, invocationId: headerInvocationId });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), route.timeoutMs);
    try {
      const response = await fetcher(route.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-mobiwave-scheduler": "neon-function-trigger",
        },
        body: "{}",
        cache: "no-store",
        signal: controller.signal,
      });
      const responseText = await response.text();
      let result;
      try { result = JSON.parse(responseText); }
      catch { result = { response: responseText.slice(0, 1000) }; }
      if (!response.ok) {
        logger.error("Commerce worker returned non-2xx", {
          trigger: route.triggerName, status: response.status, invocationId: headerInvocationId,
        });
        return json({ ok: false, trigger: route.triggerName, upstreamStatus: response.status, result }, 502);
      }
      logger.info("Commerce scheduled worker completed", { trigger: route.triggerName, invocationId: headerInvocationId, upstreamStatus: response.status });
      return json({ ok: true, trigger: route.triggerName, invocationId: headerInvocationId, result });
    } catch (error) {
      logger.error("Commerce worker invocation failed", {
        trigger: route.triggerName, invocationId: headerInvocationId,
        error: error instanceof Error ? error.name : "unknown",
      });
      return json({ ok: false, trigger: route.triggerName, error: "worker_invocation_failed" }, 502);
    } finally { clearTimeout(timeout); }
  };
}

export default { fetch: createHandler() };
