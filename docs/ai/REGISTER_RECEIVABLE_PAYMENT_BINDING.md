# REGISTER_RECEIVABLE_PAYMENT — Domain Binding (Commit 14A)

Status: **canonical domain verified — ready for PR**
AI write execution: **not implemented** (Commit 14B)

## Product goal

Conversational examples (future):

- “José me pagó 35 mil.” → received money (needs destination)
- “José me pagó 35 mil a bancos.” → `BANK`
- “José le pagó 100 mil a Pepe.” → `APPLY_TO_PAYABLE`
- “me pagó en USDT / crypto” → **unsupported** (clarify; no crypto mutation)

Two **distinct** economic flows:

| Case | Meaning | Liquidity |
|---|---|---|
| **A. Received money** | CXC ↓ + CASH/BANK/CESAR ↑ | changes |
| **B. Account-to-account settlement** | CXC ↓ + CXP ↓ | **unchanged** |

Do not conflate them.

## Non-negotiable safety

Manual Cuentas UI and future AI must share the same canonical command:

`ReceivablePaymentService.register()`

No AI-specific accounting formulas.

---

## Deal Payment vs AccountPayment (source of truth)

**Decision: dual-ledger, single economic write per path — no double-write.**

| Path | Writes | Treasury |
|---|---|---|
| Canonical sale / Ventas `addPayment` | Deal `Payment` | `createFromDealPayment` (+ optional BANCOS fee) |
| Cuentas / future AI `ReceivablePaymentService` | `AccountPayment` on the existing `AccountEntry` | `createFromAccountPayment` (**no** bank fee) |

**Answer to the gate:**

- Deal `Payment` rows are **not** only initial-at-sale snapshots.
- They represent money collected through the **Ventas / sale-registration** path.
- Post-sale collections through **Cuentas / AI** use `AccountPayment` and must **not** also create a Deal `Payment` for the same event.

Canonical deal-linked outstanding:

```
paid = Σ Deal.Payment(PAID, deletedAt null)
     + Σ AccountPayment(on the deal’s AccountEntry, deletedAt null)

outstanding = AccountEntry.totalAmount − paid
```

This keeps Cuentas, Ventas payment-summary, OI CXC, and `syncDealReceivable` status aligned **without** a new FK / sync migration.

Do **not** invent `AccountPayment.dealPaymentId` unless a future product requires listing a single merged payment timeline with durable cross-links.

Effects that must **not** change on collection:

- Deal stage / `CLOSED_WON`
- Watch `SOLD`
- `agreedPrice`, cost basis, original sale date

---

## Payable-entry eligibility

A RECEIVABLE is payable when:

- same tenant
- `deletedAt = null`
- `type = RECEIVABLE`
- status not `CANCELLED` / not already fully paid (outstanding > 0)
- currency MXN or USD

Sources eligible:

- `MANUAL`
- `DEAL_AUTO` / `dealId != null` (sale-generated CXC)

`assertManualEntry` remains only for:

- PAYABLE treasury outflows
- in-place `updatePayment`
- settlement **target** PAYABLE (must stay manual / non-deal)

Root cause of the old block: `assertManualEntry` assumed all deal-linked outstanding lived only in Deal `Payment`, so Cuentas `AccountPayment` was forbidden. That mixed an outstanding-model concern with payment eligibility.

---

## Records written

### Endpoint

`POST /cuentas/entries/:id/payments` → `CuentasService.createPayment` → `ReceivablePaymentService.register()` for RECEIVABLE + `APPLY_TO_PAYABLE`.

Auth: `JwtAuthGuard` only (any authenticated tenant member). No role ACL today.

### CASH / BANK / CESAR (MANUAL or DEAL_AUTO)

1. `AccountPayment` (`cashAccount` set)
2. `TreasuryEntry` INFLOW (`accountPaymentId` 1:1, provenance `account-payment:<id>`)
3. `AccountEntry.status` OPEN → PARTIAL → PAID

No second `AccountEntry`. No Deal rewrite. No Watch rewrite. No Deal `Payment` row from this command.

### APPLY_TO_PAYABLE (including deal-linked CXC)

1. Receivable `AccountPayment` `SETTLEMENT`
2. Payable `AccountPayment` `SETTLEMENT`
3. `AccountSettlement`
4. Status refresh both sides

Treasury unchanged. Deal / Watch unchanged.

### Frontend

One `createAccountPayment` request. No separate Treasury API.

### Bank fees on CXC receipt

**Not modeled.** “José me pagó 35 mil a bancos” → BANK +35,000 only. Do not borrow sale-acquiring BANCOS fee policy.

---

## Destination contract (frozen)

Exactly:

`CASH | BANK | CESAR | APPLY_TO_PAYABLE`

**CRYPTO is rejected** at:

- intent entity schema (`REGISTER_RECEIVABLE_PAYMENT`)
- domain command (`ReceivablePaymentService.register`)

Reason: crypto is an asset/liquidity position domain (`REGISTER_CRYPTO_*`), not a customer CXC payment destination. No USDT→holding mutation from payment language.

User-facing maps (future planner):

| Language | Destination |
|---|---|
| en efectivo | CASH |
| a bancos / me depositó / transferencia (when explicit) | BANK |
| a la cuenta de César | CESAR |
| le pagó a Pepe | APPLY_TO_PAYABLE |
| en USDT / crypto | unsupported / clarify |

---

## Canonical command

```ts
ReceivablePaymentService.register(tenantId, {
  receivableEntryId,
  amount,
  destination: 'CASH' | 'BANK' | 'CESAR' | 'APPLY_TO_PAYABLE',
  payableEntryId?,          // settlement only
  paymentDate?,
  notes?,
  currency?,
  exchangeRateUsed?,        // required if USD
  registerIdempotencyKey?,  // durable
  actorUserId?,
})
```

Result:

```ts
{
  destination,
  receivablePayment,
  receivableEntry,
  treasuryEntry?,      // null for settlement
  settlement?,         // { id, idempotencyKey } | null
  payablePayment?,
  payableEntry?,
  replayed: boolean,
}
```

---

## Idempotency

| Flow | Durable key | Unique |
|---|---|---|
| CASH/BANK/CESAR | `AccountPayment.registerIdempotencyKey` | `@@unique([tenantId, registerIdempotencyKey])` |
| APPLY_TO_PAYABLE | `AccountSettlement.idempotencyKey` | `@@unique([tenantId, idempotencyKey])` |

Applies to MANUAL and DEAL_AUTO receivables.

### Schema gate

Migration (local / not production-applied):

`prisma/migrations/20260808010000_account_payment_register_idempotency_key`

**No additional migration** required for deal-linked eligibility (dual-ledger outstanding formula).

---

## Recovery marker (for 14B)

| Flow | Marker |
|---|---|
| Received money | `AccountPayment.registerIdempotencyKey = ai-action-run:<actionRunId>` |
| Settlement | `AccountSettlement.idempotencyKey = ai-action-run:<actionRunId>` |

---

## Correction / reversal

| Flow | Reverse | Side effects |
|---|---|---|
| Received money | soft-delete `AccountPayment` + Treasury (atomic) | restores CXC outstanding/status; Deal/Watch untouched |
| Settlement | soft-delete settlement + both legs | restores CXC/CXP; Treasury n/a |

No conversational reversal in V1. Receipt CTA: “Corregir en Cuentas”.

---

## Permissions

Today: any JWT user in tenant.  
AI must inherit **same or stricter** policy.

---

## Future AI contract (design only)

Trusted:

- `receivableEntryId`
- `amount`
- `destination`

Conditional:

- `APPLY_TO_PAYABLE` → `payableEntryId`

Never:

- CRYPTO destination
- raw IDs from Claude/user text as trusted without resolution
- silent first-account selection

Clarify when multiple open CXC/CXP, ambiguous names, omitted destination, overpayment, currency mismatch.

### Preview

Received (BANK): CxC before→after + Bancos +amount. No Crypto.
Settlement: CxC + CxP before→after; Liquidez sin cambio.

---

## Atomicity

| Path | Status |
|---|---|
| RECEIVABLE CASH/BANK/CESAR | Serializable tx: AccountPayment + Treasury + status |
| Settlement | Serializable tx: settlement + both legs + status |
| removePayment | soft-delete payment + Treasury together |

---

## Blockers before Commit 14B

1. **Production migrate** `registerIdempotencyKey` (TYPE C).
2. AI write binding / confirmation runner (intentional next commit).
3. Planner must resolve trusted `receivableEntryId` / `payableEntryId` with disambiguation (no silent pick).

Deal-linked CXC + destination contract are **resolved** for domain readiness.

---

## Test coverage

- `receivable-payment.service.spec.ts` — MANUAL + DEAL_AUTO CASH/BANK/CESAR, status, overpay, idempotency, CRYPTO reject
- Settlement suite — APPLY_TO_PAYABLE
- Intent schema — destination allowlist
- Sale registration / OI / payments summary — dual-ledger outstanding
