# REGISTER_SALE Write Binding — Canonical Sale Domain (Commit 12A)

**Status: CANONICAL SALE READY — AI WRITE BINDING NEXT (not implemented)**

Date: 2026-08-07  
Branch: `feature/ai-register-sale-write-binding`

This document describes the **canonical sale registration command** that manual Ventas and future AI `REGISTER_SALE` must share. AI write execution is **not** enabled in 12A.

---

## 1. Canonical sale command

| Layer | Path |
| --- | --- |
| Domain | `SaleRegistrationService.register()` — `apps/api/src/modules/deals/sale-registration.service.ts` |
| Manual HTTP | `POST /deals/register-sale` → `DealsService.registerSale` → canonical command |
| Follow-on payment | `SaleRegistrationService.addPayment` (Treasury + CXC atomic) |

Do **not** invent AI-only accounting. Do **not** use pipeline `create()`, storefront checkout, or receivables-only writers for sale registration.

### Input (business truth)

```ts
{
  watchId, clientId, agreedPrice, currency?, soldAt?, notes?,
  payment?: { amountReceived?, method?, bankChannel?, paidAt? },
  legacyFullPaymentMethod?, // paymentMethod alone ⇒ full payment
  registerIdempotencyKey?,
}
```

### Result

```ts
{ deal, watchId, payment?, treasuryEntry?, receivable?, bankFee?,
  bankFeeAmount, paidTotal, pendingAmount, computedStatus, bankChannel,
  canonicalMxn, replayed }
```

---

## 2. Final canonical sale semantics

| Mode | Deal | Watch | Payment | Treasury | CXC | Bank fee |
| --- | --- | --- | --- | --- | --- | --- |
| **PAID** (full received) | `CLOSED_WON` | `SOLD` | yes | INFLOW to CASH / BANK / CESAR | no outstanding (`PAID`) | OpEx `BANK_FEES` if BANCOS |
| **CREDIT** (no payment) | `CLOSED_WON` | `SOLD` | none | no inflow | full outstanding | none |
| **PARTIAL** | `CLOSED_WON` | `SOLD` | received amt | INFLOW received amt | remainder outstanding | OpEx if BANCOS on received amt |

There is still **no** persisted `PAID \| CREDIT \| PARTIAL` enum — status is amount-driven (`computedStatus`).

Payment methods: `CASH` \| `BANCOS` \| `CESAR`. `BANCOS` requires `bankChannel` `JOSE` (2%) / `MAYTE` (1%).

---

## 3. Treasury integration decision

Dashboard liquidity uses `TreasuryService.getAccountBalances` = Σ INFLOW − Σ OUTFLOW (`amountMxn`).

**Canonical BANCOS + fee (example 100,000 / 2% JOSE):**

| Row | Effect |
| --- | --- |
| Payment | amount **100,000** (customer paid — never netted) |
| Treasury INFLOW | +100,000 BANK (`dealPaymentId` + provenance `deal-payment:<id>:inflow`) |
| Treasury OUTFLOW | −2,000 BANK (`provenance deal-payment:<id>:bank-fee`, `commission=2000`) |
| Net BANK Δ | **+98,000** |
| P&L | −2,000 **exactly once** via `TreasuryEntry.commission` (monthly profit / capital) |
| OpEx BANK_FEES | **not created** for new sales (avoids double-count with commission) |

| PaymentMethod | TreasuryAccount |
| --- | --- |
| CASH | CASH (INFLOW only; no bank fee) |
| BANCOS | BANK (INFLOW + fee OUTFLOW when channel set) |
| CESAR | CESAR (INFLOW only; no bank fee) |

Analytics cash flow uses `amountMxn` only — fee cash is embedded in OUTFLOW; `commission` is informational for P&L KPIs and must not be added again on top of amountMxn.

---

## 4. Cuentas atomicity

`CuentasService.syncDealReceivable(dealId, tenantId, tx?)` accepts an optional Prisma transaction client.

Canonical sale runs **inside one** `$transaction`:

1. Deal `CLOSED_WON` (+ optional `registerIdempotencyKey`)
2. Payment (if received)
3. Treasury inflow (if payment)
4. OpEx bank fee (if BANCOS)
5. Watch → `SOLD`
6. `syncDealReceivable(..., tx)` → AccountEntry status

Failure anywhere rolls back all of the above. No post-commit best-effort AR sync on the canonical path.

Historical `sourceTag` deals still skip live AR (unchanged).

---

## 5. Durable Deal + Treasury idempotency

```prisma
Deal.registerIdempotencyKey String?
@@unique([tenantId, registerIdempotencyKey])

TreasuryEntry.provenanceKey String?
@@unique([tenantId, provenanceKey])
```

- Deal key: future AI `ai-action-run:<actionRunId>`; manual optional
- Treasury legs (one Payment may own two rows; `dealPaymentId` is unique so fee cannot share it):
  - `deal-payment:<paymentId>:inflow` — gross INFLOW (`dealPaymentId` set)
  - `deal-payment:<paymentId>:bank-fee` — fee OUTFLOW (`dealPaymentId` null)
- Replay / concurrent: no duplicate Deal, Payment, INFLOW, or fee OUTFLOW

Migration (local / additive only): `prisma/migrations/20260807120000_deal_register_idempotency_key/`

**Do not** run production migrate in 12A.

---

## 6. AIActionRun unique-key decision

**Do NOT** add `@@unique([tenantId, idempotencyKey])` on `AIActionRun`.

| Concern | Owner |
| --- | --- |
| Request-level idempotency | `AIRequest` (`@@unique([tenantId, idempotencyKey])`) |
| Business-write idempotency | `Deal.registerIdempotencyKey` |
| ActionRun `idempotencyKey` | Indexed only today; conversation planning artifact |

No proven invariant requires ActionRun uniqueness; existing data compatibility was not established. Keep concerns separate.

---

## 7. Manual path compatibility

`POST /deals/register-sale` response shape preserved (`salePrice`, `paidTotal`, `computedStatus`, `bankFee`, …). Additive fields: `registerIdempotencyKey`, `replayed`.

Legacy `paymentMethod` without `initialPaymentAmount` still means full payment.

---

## 8. AI preview truth (planner)

`REGISTER_SALE` estimated effects are payment-mode aware (`paymentMode` PAID / CREDIT / PARTIAL) and match canonical semantics. Previews must not promise Treasury movement for credit sales.

---

## 9. Correction / reversal limitations

Soft-deleting a Deal (`DealsService.remove`):

- Sets `Deal.deletedAt`
- Syncs CXC (cancels open deal receivables)
- **Does not revive Watch** from `SOLD` (V1: “Do not revive SOLD status”)

Therefore future AI receipt copy **“Corregir en Ventas”** is truthful only as a manual correction path — conversational reversal is **out of scope** for 12A / must not claim automatic inventory revive.

Before AI write execution: operators must understand correction is manual and inventory may stay SOLD until fixed in Ventas/inventory tools.

---

## 10. Remaining blocker before REGISTER_SALE AI execution

1. Production migration of `Deal.registerIdempotencyKey` (TYPE C — manual `prisma migrate deploy`)
2. Commit 12 write binding: confirmation → `SaleRegistrationService.register` with `registerIdempotencyKey = ai-action-run:<actionRunId>`
3. No AI-specific accounting forks

---

## 11. Quality / safety

- Implementation only — no production migrate, no production sales, no Wrist Caviar data writes
- TYPE C additive schema change
