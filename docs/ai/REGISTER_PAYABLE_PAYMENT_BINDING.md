# REGISTER_PAYABLE_PAYMENT — Domain Contract (Commit 21A)

Status: **Domain ready — AI write binding unbound**
Canonical command: `PayablePaymentService.register()` / `reverse()`

Exactly six WRITE capabilities remain executable. This document is the domain + future-AI contract only.

---

## Product goal

Conversational examples (future 21B):

- “Págale 80 mil a José desde bancos.” → `BANK` + preview → **Confirmar pago**
- “Liquida lo que le debemos a Roberto en efectivo.” → full outstanding + `CASH`
- “Abona 50 mil a la cuenta por pagar de Pepe desde Cuenta César.” → partial + `CESAR`
- “Compensa lo que José nos debe contra lo que le debemos.” → **`REGISTER_SETTLEMENT`**, not this capability

Hard boundary:

| Flow | CXC | CXP | Treasury |
|---|---|---|---|
| **A. PAYABLE cash payment** | unchanged | ↓ | OUTFLOW (liquidity ↓) |
| **B. Settlement / APPLY_TO_PAYABLE** | ↓ | ↓ | unchanged |

Do not merge these into one Assistant capability.

---

## Current manual PAYABLE payment flow (pre/post 21A)

### Endpoint

`POST /cuentas/entries/:id/payments` → `CuentasController.createPayment` → `CuentasService.createPayment`

For `AccountEntryType.PAYABLE` with destination `CASH|BANK|CESAR`:

→ **`PayablePaymentService.register()`** (canonical)

UI: Admin Cuentas (`apps/admin/.../cuentas/page.tsx`) via `createAccountPayment`.

Frontend does **not** create Treasury separately. Backend owns the transaction.

### Records written

1. `AccountPayment` on the PAYABLE entry (`cashAccount`, `method`, `paidAt`, optional `registerIdempotencyKey`)
2. `TreasuryEntry` OUTFLOW (`provenanceKey = account-payment:<accountPaymentId>`)
3. `AccountEntry.status` / `closedAt` refresh inside the same Serializable transaction

No `OperatingExpense`. No commission / bank fee on this path. No new purchase / Deal mutation.

### Reverse

`DELETE /cuentas/entries/:id/payments/:paymentId` → for PAYABLE cash legs → `PayablePaymentService.reverse()`:

- soft-delete `AccountPayment`
- soft-delete linked Treasury OUTFLOW (`deleteByAccountPaymentId`)
- restore outstanding / status

Settlement-linked legs must reverse via settlement reverse (blocked here).

---

## PAYABLE eligibility / sources

Eligible cash-payment sources:

- `MANUAL`
- `PURCHASE_AUTO`

Rejected:

- `DEAL_AUTO` / any `dealId != null`
- deleted / cancelled / fully `PAID`
- non-PAYABLE types (RECEIVABLE → use `ReceivablePaymentService`)
- unsupported sources

Admin UI now allows **Pagar** on `PURCHASE_AUTO` as well as `MANUAL` (backend already allowed non-deal PAYABLE).

---

## Outstanding source of truth

For PAYABLE cash payment (and settlement legs on the same entry):

```
paid = Σ AccountPayment(entryId, deletedAt = null).amount
outstanding = AccountEntry.totalAmount − paid
```

Settlement creates SETTLEMENT-method `AccountPayment` rows on both CXC and CXP; those legs reduce outstanding the same way. There is **no** separate purchase payment ledger for `PURCHASE_AUTO` CXP.

One source of truth: AccountEntry + non-deleted AccountPayment legs.

---

## Amount / status semantics

| Rule | Behavior |
|---|---|
| `amount <= 0` | reject |
| `amount > outstanding` | reject (no silent cap) |
| `0 < amount < outstanding` | status → `PARTIAL` |
| `amount == outstanding` | status → `PAID` + `closedAt` |

USD requires `exchangeRateUsed` (same as receivable / prior Cuentas policy). MXN does not invent FX.

---

## Funding sources (V1 freeze)

From real Treasury enum used by Cuentas payments:

- `CASH`
- `BANK`
- `CESAR`

`CRYPTO` / arbitrary account strings: unsupported.

Bank fees: **none** on CXP cash payment (mirrors receivable collection; sale BANCOS fee remains deal-specific).

---

## Currency

- Liability amount stored in `AccountEntry.currency` (`MXN` | `USD`).
- Payment currency must match entry currency.
- Treasury stores MXN via `exchangeRateUsed` for USD (existing `createFromAccountPayment` path).
- No new FX invented in 21A.

---

## Atomicity

Single Prisma `$transaction` with **`Serializable`** isolation:

1. Load PAYABLE + active payments
2. Assert eligibility + outstanding
3. Create `AccountPayment`
4. Create Treasury OUTFLOW
5. Update entry status

Failure anywhere → full rollback. No payment-without-Treasury or Treasury-without-payment.

---

## Concurrent overpayment

Correctness boundary:

- Outstanding check + insert occur **inside** Serializable transaction
- Concurrent overpay losers either:
  - fail outstanding validation after serialization, or
  - surface `P2034` as typed `ConflictException` (retry with current outstanding)

No process-local mutex. Race tests (`70+70`, `40+60`, `40+40+40`) cover the invariant `Σ paid <= totalAmount`.

---

## Durable idempotency

Reuses `AccountPayment.registerIdempotencyKey` (`@@unique([tenantId, registerIdempotencyKey])`).

Future AI marker:

```
ai-action-run:<actionRunId>
```

Replay validates at least: `payableEntryId`, `amount`, `sourceAccount`.

Same key + conflicting payload → `409 Conflict`.
Same key concurrent → one payment + one Treasury OUTFLOW.

---

## P&L / Capital

Paying a liability is **not** a new expense:

- Purchase credit: Watch asset + CXP at recognition; later cash payment → CXP ↓ + BANK ↓; P&L Δ0
- Manual CXP that already represented an expense at entry creation must not re-recognize OpEx at payment

Capital / Analytics formulas unchanged in 21A unless a direct bug is found.

History: Cuentas payments historically have no dedicated History hooks; do not classify liability payment as OperatingExpense.

---

## Permissions

Manual path: `JwtAuthGuard` + tenant membership via `@CurrentUser()`. No extra role gate beyond that. Future AI must inherit same or stricter policy.

---

## Schema gate

**No TYPE C migration required for 21A.**

Existing sufficiency:

- `AccountPayment.registerIdempotencyKey`
- `TreasuryEntry.provenanceKey` (`account-payment:<id>`)
- `AccountEntry` PAYABLE + `PURCHASE_AUTO`
- Serializable transactions for concurrency

No new `PayablePayment` table.

---

## Future AI contract (21B — design only)

```
Natural language
→ REGISTER_PAYABLE_PAYMENT intent
→ trusted payable resolution (picker / ordinal — never silent oldest/largest)
→ deterministic Planner preview
→ READY_FOR_CONFIRMATION
→ WritePlanRunner
→ PayablePaymentService.register({ registerIdempotencyKey: ai-action-run:<id> })
→ receipt + recovery from durable marker
```

Trusted domain args:

```ts
{
  payableEntryId, // trusted — not LLM raw ID
  amount,
  sourceAccount: 'CASH' | 'BANK' | 'CESAR',
  paymentDate?,
  notes?,
}
```

V1 pays **one** explicit PAYABLE entry. No silent multi-entry allocation.

### Preview (partial)

```
Voy a registrar este pago:
A favor de José Hernández
Cuenta por pagar · Compra Rolex Daytona
Saldo actual $300,000 MXN
Pago $100,000 MXN
Desde Bancos
Saldo después $200,000 MXN
Efectos: CXP −100k · Bancos −100k · Utilidad sin cambio
```

### Overpay clarify

Outstanding 100k, user says 120k → clarify to liquidate 100k; **no** executable 120k plan.

### Post-commit recovery

Find `AccountPayment.registerIdempotencyKey = ai-action-run:<actionRunId>`, verify payable/amount/source + Treasury OUTFLOW, reconstruct receipt. No duplicate payment.

---

## Production rollout

| Item | 21A |
|---|---|
| AI binding | unbound |
| WRITE count | still 6 |
| Composition graph | unchanged |
| Migration | none |
| Deploy | domain + Admin UI only when merged |

Blockers before Commit 21B:

1. Wire `REGISTER_PAYABLE_PAYMENT` write binding + planner capability
2. Trusted payable resolver / disambiguation (ordinal / picker)
3. Preview + confirmation copy
4. Recovery path in WritePlanRunner
5. Keep settlement as separate unbound capability

---

## Safety model

The LLM must not invent payable IDs, auto-allocate across multiple CXPs, or route cash payment through settlement.
