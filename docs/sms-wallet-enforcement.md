# SMS wallet enforcement

## Runtime policy

- SMS text is measured before submission using GSM-7 septets (including the two-septet extension table) or UCS-2 UTF-16 code units.
- Single/concatenated segment boundaries are 160/153 GSM-7 and 70/67 UCS-2.
- The platform controls each store's included monthly segment allowance, overage rate in integer minor units, currency, and enabled state in `store_sms_billing_config`.
- A missing or disabled billing configuration fails closed. Configure it before enabling outbound SMS for a store; no plan allowance or price is guessed in application code.
- The store billing-config row is locked while monthly usage is calculated and reserved. Concurrent sends for one store therefore cannot spend the same included allowance.
- Usage is recorded per outbox event in `store_sms_usage`. Reserved and committed events consume the allowance; released events do not.
- Wallet overage is reserved before provider submission. The wallet account and usage rows are updated in the same database transaction.
- A provider 429 is a definite rejection: the existing reservation remains held while the event is queued for retry.
- A permanent provider rejection releases the reservation.
- Provider timeout, network failure, 5xx, unreadable response, or lost worker lease remains `delivery_unknown`; the reservation is retained and the event is not automatically resent.
- A successful provider response commits the reservation and stores the provider reference in the usage ledger in the same transaction. If recording the outbox delivery state subsequently fails, the provider reference remains available for reconciliation and the event is never sent again.

## Configuration contract

A privileged platform-admin workflow must upsert one row per store in `store_sms_billing_config`:

- `included_segments_per_month`: non-negative integer.
- `unit_rate_minor`: non-negative integer, expressed in the currency's minor unit (KES cents for KES).
- `currency`: ISO 4217 currency code; it must match the store wallet currency whenever overage is billable.
- `enabled`: enable only after allowance and rate have been reviewed.

The migration intentionally does not seed a default rate or allowance. Until the platform-admin configuration workflow is available and a store is configured, its outbound Commerce SMS is blocked with `sms_billing_not_configured`. This prevents unpriced sends.

## Reconciliation

A future provider delivery-report adapter must use the provider's verified callback contract. It must authenticate callbacks, deduplicate provider event IDs, map provider references to the outbox event, and only settle/refund reservations on definitive outcomes. Do not release an ambiguous reservation based solely on a timeout or an unverified callback.
