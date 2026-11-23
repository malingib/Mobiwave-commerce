# Wallet-funded SMS implementation

## First implementation slice

This change introduces the store wallet ledger and idempotent wallet reservations required by the confirmed Commerce policy:

- SMS plan allowance is consumed before wallet billing.
- Only segments above the allowance are billable.
- Wallet amounts use integer minor currency units.
- A reservation deducts available balance before provider submission.
- Insufficient funds or a blocked wallet must stop chargeable SMS submission.
- Definite provider rejection can release a reservation.
- Ambiguous provider timeouts must remain reserved until delivery reconciliation; do not blindly retry or refund.
- Merchant-facing top-up and wallet history APIs are a subsequent slice and must only credit funds from verified payment callbacks or audited platform adjustments.

## Transaction contract

Call reserveStoreWalletFunds inside the same PostgreSQL transaction that creates or claims the SMS delivery attempt. It assumes the caller has begun a transaction and established the appropriate tenant/worker context. Commit or roll back the caller transaction as a unit.

Call settleStoreWalletReservation inside a transaction after a definitive provider outcome. The reservation functions set the transaction-local app.wallet_worker RLS context; callers must not use them outside a transaction.

## Safety

The wallet account row is locked before checking the idempotency key and available funds. This serializes concurrent spend attempts for one store. The wallet transaction table records signed movements and is intended as an append-only audit ledger. Do not expose direct wallet balance mutation to merchant-facing requests.
