# Commerce scheduler

This directory contains the source deployed as the Neon Function `commercescheduler` on the production `main` branch.

Neon Function Triggers invoke the existing Vercel internal worker routes; queue processing, tenant scoping, atomic claims, provider calls, and retry behavior remain in the Commerce application.

| Trigger | UTC schedule | Function path | Existing application worker |
| --- | --- | --- | --- |
| `commerce-channel-webhooks` | `* * * * *` | `/webhooks` | `POST /api/internal/channels/process?limit=50` |
| `commerce-channel-outbound` | `* * * * *` | `/outbound` | `POST /api/internal/channels/send?limit=4` |
| `commerce-message-outbox` | `* * * * *` | `/outbox` | `POST /api/internal/messages/process` |

The function requires `CHANNEL_WORKER_SECRET` in its Neon Function environment. The same secret must be configured as a sensitive Production environment variable in Vercel. Neon trigger deliveries are authenticated by validating the proxy-issued `x-neon-trigger-invocation-id` header against the invocation ID in the request body; the Neon Functions proxy strips caller-supplied `x-neon-*` headers.

Deploy updates by bundling this entry point for Node.js 24 and deploying it to the existing Neon main branch. Do not create a second database or a separate scheduler service.
