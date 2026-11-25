# Commerce scheduler

This directory contains the source deployed as the Neon Function commercescheduler on the production main branch.

Neon Function Triggers invoke the existing Vercel internal worker routes; queue processing, tenant scoping, atomic claims, provider calls, and retry behavior remain in the Commerce application.

| Trigger | UTC schedule | Function path | Existing application worker |
| --- | --- | --- | --- |
| commerce-channel-webhooks | * * * * * | /webhooks | POST /api/internal/channels/process?limit=50 |
| commerce-channel-outbound | * * * * * | /outbound | POST /api/internal/channels/send?limit=4 |
| commerce-message-outbox | * * * * * | /outbox | POST /api/internal/messages/process |
| commerce-subscription-billing | 0 * * * * | /billing | POST /api/workers/subscription-billing |

The billing route is included in source but is not deployed or scheduled in production yet. Activate it only after explicit production approval, test-subscription acceptance, and configuration of the separate COMMERCE_BILLING_WORKER_TOKEN in both Vercel Production and the Neon Function environment.

The function requires CHANNEL_WORKER_SECRET for the webhook, outbound and message-outbox routes. The billing route requires COMMERCE_BILLING_WORKER_TOKEN. Both secrets must be at least 32 random bytes, independently generated, and kept distinct. Do not reuse the Meta App Secret, webhook verify token, database password, or provider access token.

Neon trigger deliveries are authenticated by validating the proxy-issued x-neon-trigger-invocation-id header against the invocation ID in the request body; the Neon Functions proxy strips caller-supplied x-neon-* headers.

Deploy updates by bundling this entry point for Node.js 24 and deploying it to the existing Neon main branch. Do not create a second database or a separate scheduler service.
