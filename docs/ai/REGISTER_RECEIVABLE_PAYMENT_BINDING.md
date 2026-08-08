# REGISTER_RECEIVABLE_PAYMENT — Write Binding (Commit 14B)

Status: **AI write execution implemented locally (Commit 14B)**
Domain prerequisite: **Commit 14A deployed** (`ReceivablePaymentService.register()`)

## Product goal

Conversational examples:

- “José me pagó 35 mil.” → needs destination clarify
- “José me pagó 35 mil a bancos.” → `BANK` + preview → **Confirmar pago**
- “José le pagó 100 mil a Pepe.” → `APPLY_TO_PAYABLE` + preview → **Confirmar pago**
- “me pagó en USDT / crypto” → unsupported (clarify; no crypto mutation)

Two **distinct** economic flows:

| Case | Meaning | Liquidity |
|---|---|---|
| **A. Received money** | CXC ↓ + CASH/BANK/CESAR ↑ | changes |
| **B. Account-to-account settlement** | CXC ↓ + CXP ↓ | **unchanged** |

Do not conflate them. Standalone `REGISTER_SETTLEMENT` remains **unbound**.

---

## Safety model

The LLM does **not** register payments. Canonical flow:

```
Natural language
→ REGISTER_RECEIVABLE_PAYMENT intent
→ trusted entity resolution
→ deterministic Planner
→ READY_FOR_CONFIRMATION
→ explicit authenticated confirmation
→ freshness validation
→ WritePlanRunner
→ REGISTER_RECEIVABLE_PAYMENT binding
→ ReceivablePaymentService.register()
→ receipt + immutable audit
```

No confirmation → no payment.
Duplicate / concurrent confirmation → one economic payment (durable idempotency).
Post-commit runtime failure → recover from durable payment/settlement marker.

---

## Executable writes after 14B

| Capability | Status |
|---|---|
| `REGISTER_SALE` | WRITE bound |
| `REGISTER_RECEIVABLE_PAYMENT` | WRITE bound |
| `REGISTER_PURCHASE` | unbound |
| `REGISTER_EXPENSE` | unbound |
| `REGISTER_SETTLEMENT` | unbound (standalone) |
| `REGISTER_CRYPTO_POSITION` | unbound |
| `REGISTER_CRYPTO_PRICE` | unbound |

`APPLY_TO_PAYABLE` is a **destination** inside receivable payment, not a separate executable intent.

---

## Dual ledger (from 14A — unchanged)

| Path | Writes | Treasury |
|---|---|---|
| Ventas / sale registration | Deal `Payment` | `createFromDealPayment` (+ optional BANCOS fee) |
| Cuentas / AI `ReceivablePaymentService` | `AccountPayment` | `createFromAccountPayment` (**no** bank fee) |

Outstanding for deal-linked CXC:

```
paid = Σ Deal.Payment(PAID) + Σ AccountPayment(on entry)
outstanding = totalAmount − paid
```

---

## Write binding

| Field | Value |
|---|---|
| Capability | `REGISTER_RECEIVABLE_PAYMENT` |
| Mode | `WRITE` |
| Version | `1.0.0` |
| Binding name | `register_receivable_payment_canonical@1.0.0` |
| Domain | `ReceivablePaymentService.register()` |
| Runner | same `WritePlanRunner` as `REGISTER_SALE` |

Trusted execution args:

```ts
{
  receivableEntryId, // planner accountId
  amount,
  destination: 'CASH' | 'BANK' | 'CESAR' | 'APPLY_TO_PAYABLE',
  payableEntryId?,   // APPLY_TO_PAYABLE only
  paymentDate?,
  notes?,
}
```

Server derives:

- received money: `registerIdempotencyKey = ai-action-run:<actionRunId>`
- settlement: `idempotencyKey = ai-action-run:<actionRunId>`

Client/LLM never supplies these keys. Fake IDs from text are stripped.

---

## Trusted resolution / disambiguation

```
customer reference → canonical client → eligible open CXC
→ unique → select (surfaced in preview warning/labels)
→ multiple → clarify (ENTITY_PICKER) — never silent first/oldest/largest
```

Settlement:

```
Pepe (payableQuery) → unique client → eligible open CXP (same currency)
→ unique / clarify
```

MANUAL and DEAL_AUTO receivables both call the same domain command.

---

## Destination semantics

| Language | Destination |
|---|---|
| en efectivo | CASH |
| a bancos / me depositó / transferencia (explicit) | BANK |
| a la cuenta de César | CESAR |
| le pagó a Pepe | APPLY_TO_PAYABLE |
| en USDT / crypto / Bitcoin | unsupported / clarify |

Never mutate Crypto holdings from this binding.

---

## Amount validation (before READY_FOR_CONFIRMATION)

- `amount > 0`
- `amount <= receivable outstanding`
- settlement: `amount <= payable outstanding`
- currency compatibility
- no silent cap / min / max adjustment

Overpay → `NEEDS_CLARIFICATION` (not a soft warning that still confirms).

---

## Confirmation lifecycle

1. Planner builds HIGH-tier preview (`ACTION_PREVIEW_CARD`, `executable: true`)
2. Frontend CTA: **Confirmar pago** → `POST /ai/action-runs/:id/confirm` only
3. `WritePlanRunner` claims READY → EXECUTING, validates freshness, executes binding
4. COMPLETED + `SUCCESS_RECEIPT` only after durable domain + runtime finalize

Double-click / network retry reuses the **same** ActionRun.

---

## Freshness (immediately before execute)

Receivable: exists, same tenant, not deleted, RECEIVABLE, payable, outstanding sufficient, currency match.
Payable (settlement): exists, PAYABLE, outstanding sufficient, same currency.
Workspace: active run + fingerprint.
Actor: active tenant membership (same as manual Cuentas JwtAuthGuard V1).

Any change → `STALE_*` → **no payment**.

Future granular Cuentas permissions may harden both AI and manual paths together.

---

## Idempotency + post-commit recovery

| Flow | Marker |
|---|---|
| Received money | `AccountPayment.registerIdempotencyKey = ai-action-run:<id>` |
| Settlement | `AccountSettlement.idempotencyKey = ai-action-run:<id>` |

`EXECUTING` + marker exists → reconstruct receipt → COMPLETED.
`EXECUTING` + no marker → IN_PROGRESS (retry same confirm).
No in-memory lock as correctness boundary. No new schema in 14B.

---

## Receipt / correction

Received money receipt: `paymentId`, `receivableEntryId`, amount, currency, destination, `remainingReceivable`, paymentDate.
Settlement receipt: both remainings, `liquidityChanged: false`, settlement + two payment legs.

CTA: **Ver cuenta** / **Corregir en Cuentas**. No conversational reversal.

---

## Frontend safety matrix

| Intent | READY / preview / COMPLETED success |
|---|---|
| `REGISTER_SALE` | unchanged executable |
| `REGISTER_RECEIVABLE_PAYMENT` | allowed when receipt is canonical (`paymentId` + `receivableEntryId` + destination) |
| Other writes | COMPLETED still blocked |

Malformed payment success → fail closed.

---

## Schema gate

**NO migration in 14B.**
14A already deployed `AccountPayment.registerIdempotencyKey` (+ settlement key).

---

## Rollout plan

1. Local quality gates (this commit)
2. PR review — TYPE B (backend AI + TYPE A admin UX)
3. Merge → Railway + Vercel auto-deploy
4. Controlled DEMO QA: confirm payment, double-confirm, settlement, crypto reject, stale outstanding
5. Production Wrist Caviar only after DEMO green

---

## Audit

Reuse existing execution audit. Sanitized: actionRunId, capability, bindingVersion, planFingerprint, destination, amount/value per safe-money conventions, entity hashes, idempotency key hash, result hash, recovery flag, duration, failure type.

Never: customer names, raw provider text, full account objects, secrets.

---

## Domain reference (14A)

See also dual-ledger outstanding, MANUAL/DEAL_AUTO eligibility, settlement atomicity, and reverse via Cuentas soft-delete in the Commit 14A sections retained in git history / domain tests:

- `receivable-payment.service.spec.ts`
- settlement suite
- intent schema destination allowlist
