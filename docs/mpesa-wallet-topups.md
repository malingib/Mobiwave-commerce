# M-Pesa wallet top-ups

## Initiation
- The authenticated store owner starts a top-up from Store Billing.
- Requests require a high-entropy `Idempotency-Key`; the key is unique per store and bound to a SHA-256 fingerprint of the normalized phone and amount.
- Top-ups are accepted in whole KES shillings, represented internally as integer minor units.
- Only the encrypted platform Daraja configuration is used. Merchant credentials and callback secrets are never returned to the browser.
- One pending or review-required top-up is allowed per store. A second request is rejected until the first is resolved.
- A timeout after the STK request begins is marked `review_required`, not failed, because Safaricom may have accepted the request.

## Callback crediting
- The shared Daraja callback route authenticates the configured callback token and looks up the exact CheckoutRequestID.
- A successful callback must match the expected amount, KES currency, normalized customer phone and receipt format.
- M-Pesa receipt claims are global across order, subscription and wallet top-up payments.
- The callback inserts one `top_up` wallet ledger movement with idempotency key `mpesa-topup:<attempt-id>` and increments the wallet balance in the same database transaction.
- The ledger insert is the idempotency gate: if it already exists, the balance is never incremented again.
- The wallet account, ledger credit, receipt claim and top-up status update commit atomically.
- Failed callbacks never credit the wallet. Amount, phone, receipt, currency or wallet-state mismatches are sent to manual reconciliation.
- A late success after a definitive failure is quarantined for manual reconciliation rather than automatically credited.

## Manual reconciliation
- Review-required top-ups appear in the platform Payment Reconciliation queue.
- Admins must verify the Safaricom receipt, exact amount and phone before marking paid.
- Manual crediting uses the same idempotent wallet ledger helper and receipt namespace as the callback.
- A reconciliation decision is audited. Existing receipt claims for the same attempt are reused safely; claims belonging to another attempt are rejected.

## Merchant experience
- Store Billing shows wallet balance/status, recent append-only ledger movements, monthly SMS segments and overage spend, plus recent top-up attempts.
- Only the store owner can initiate an STK wallet top-up. Managers can view the wallet and activity.
- The UI never treats an STK request response as a credit; it shows the top-up as pending until the verified callback or admin reconciliation posts the ledger credit.
