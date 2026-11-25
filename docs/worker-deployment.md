# Commerce worker deployment

GitHub Actions is used for CI/CD only. Durable scheduled Commerce work runs through Neon Function Triggers, which invoke the existing authenticated Vercel worker routes. Queue claims, tenant scoping, idempotency, provider calls and retry behavior remain in the application/database.

## Current production state — 25 November 2026

The production Neon main branch has one deployed commercescheduler function and three enabled one-minute triggers:

| Trigger | Schedule (UTC) | Function path | Application endpoint | Observed status |
|---|---|---|---|---|
| commerce-channel-webhooks | * * * * * | /webhooks | POST /api/internal/channels/process?limit=50 | Recent HTTP 200 |
| commerce-channel-outbound | * * * * * | /outbound | POST /api/internal/channels/send?limit=4 | Recent HTTP 200 |
| commerce-message-outbox | * * * * * | /outbox | POST /api/internal/messages/process | Recent HTTP 200 |

The subscription-billing worker endpoint exists, but its scheduled Neon trigger and dedicated production secret are not yet configured. The scheduler source in this change adds the /billing handler; this does not deploy the function, create the trigger, or activate billing automation.

## Secret boundaries

Configure the following as sensitive server-side Vercel Production environment variables and as environment variables on the Neon Function deployment:

| Secret | Used by | Requirement |
|---|---|---|
| CHANNEL_WORKER_SECRET | Webhook, outbound and SMS outbox workers | At least 32 random bytes; same value in Vercel and Neon Function |
| COMMERCE_BILLING_WORKER_TOKEN | Subscription dunning and merchant/billing email worker | Separate token, at least 32 random bytes; same value in Vercel and Neon Function |

Do not reuse the Meta App Secret, Meta webhook verify token, database password, channel encryption key or provider access token as a worker token. Never commit token values, include them in URLs, or expose them through NEXT_PUBLIC_* variables.

The Neon Function validates the proxy-issued x-neon-trigger-invocation-id header against the invocation ID in the signed trigger delivery body. The Neon Functions proxy strips caller-supplied x-neon-* headers. The Vercel endpoints independently validate their bearer tokens using constant-time comparison.

## Billing worker activation gate

The /billing route is intentionally not scheduled until production activation is explicitly approved. It invokes POST /api/workers/subscription-billing, which:

1. Processes subscription dunning transitions and idempotently queues Day 1, Day 2 and Day 3 notices.
2. Sends queued platform billing notices.
3. Sends queued merchant email messages after reserving the merchant's monthly plan allowance.

The existing one-minute message outbox continues to deliver queued SMS. The billing worker does not need a second SMS consumer.

After production approval:

1. Generate an independent high-entropy COMMERCE_BILLING_WORKER_TOKEN.
2. Add it as a sensitive Vercel Production variable.
3. Deploy the updated commercescheduler function with both worker secrets.
4. Add an enabled Neon schedule trigger named commerce-subscription-billing, path /billing, cron 0 * * * * (hourly UTC).
5. Run the trigger once manually and verify HTTP success, dunning/email result counts and Vercel application logs.
6. Confirm the next scheduled invocation succeeds before treating automated billing as active.

Do not enable this trigger until the merchant suspension and notification behavior has been reviewed against live subscriptions. Day 3 suspension removes paid entitlements; it does not delete store data.

## Acceptance checks

- The three existing triggers continue returning HTTP 200.
- The scheduler rejects non-POST requests, unknown paths, missing Neon invocation headers, mismatched trigger names and missing secrets.
- Each route uses only its designated secret.
- The billing route returns 502 if the upstream application worker fails.
- The billing worker runs dunning and both email queues without sending a duplicate SMS batch.
- A real test subscription and test merchant email are used before production activation.
