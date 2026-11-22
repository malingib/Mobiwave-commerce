# Worker deployment configuration

The GitHub Actions worker schedules run every five minutes. A missing secret causes an intentional fail-fast error; it does not indicate a worker-code or database failure.

## GitHub Actions repository secrets

Configure these secrets in the repository's Actions secrets settings. Do not commit their values or paste them into pull requests.

| Secret | Used by | Value |
|---|---|---|
| `COMMERCE_BASE_URL` | All three workers | The canonical HTTPS production application origin, without a trailing path |
| `CRON_SECRET` | Transactional message outbox | Must exactly match the application's `CRON_SECRET` |
| `CHANNEL_WORKER_SECRET` | Meta inbound webhook and outbound message workers | Must exactly match the application's `CHANNEL_WORKER_SECRET` |

## Application environment

The deployed application must have both `CRON_SECRET` and `CHANNEL_WORKER_SECRET` configured as server-only environment variables. Use independently generated high-entropy values, at least 32 random bytes each. The GitHub Actions secret for each worker must be the exact corresponding application value.

Do not reuse the Meta App Secret, Meta webhook verify token, database password, or any provider access token as a worker secret.

## Acceptance sequence

1. Confirm the canonical production origin and active deployment.
2. Generate independent secrets and set them in the application hosting environment.
3. Set matching GitHub Actions repository secrets.
4. Redeploy the application so its runtime receives the new environment.
5. Run each workflow manually: **Message outbox**, **Channel webhook worker**, and **Channel outbound worker**.
6. Confirm all three requests return HTTP success and inspect application logs for processed/claimed counts.
7. Confirm the scheduled runs remain green at the next five-minute interval.

Never set placeholder values or mark a workflow green without a successful authenticated request. Production acceptance also requires a real test message and a real inbound Meta webhook event.
