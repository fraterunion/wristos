# REGISTER_SALE Write Binding — Domain Audit & Schema Gate

**Status: SCHEMA GATE — STOPPED (no write execution implemented)**

Date: 2026-08-07  
Branch intent: `feature/ai-register-sale-write-binding`  
Commit 12 scope: enable exactly one write capability (`REGISTER_SALE`) behind confirmation.

This document records the canonical sale-domain audit and the **blocking** durable-idempotency gap. Per Commit 12 Part 11 / Part 25: write execution must not ship without a durable database uniqueness boundary.

---

## 1. Canonical sale source of truth

**Reuse:** `DealsService.registerSale(tenantId, dto: RegisterSaleDto)`

| Layer | Path |
| --- | --- |
| Service | `apps/api/src/modules/deals/deals.service.ts` → `registerSale` |
| HTTP | `POST /deals/register-sale` (`DealsController`) |
| Admin | `apps/admin/src/lib/ventas-api.ts` → Ventas `RegisterSaleModal` |

Do **not** invent AI-only accounting. Do **not** use pipeline `create()`, storefront checkout, or receivables-only writers.

---

## 2. Exact records / effects today

### Inside `prisma.$transaction`

| Record | When |
| --- | --- |
| **Deal** (`CLOSED_WON`) | Always |
| **Payment** (`PAID`) | If legacy full `paymentMethod` **or** `initialPaymentAmount > 0` |
| **OperatingExpense** (`BANK_FEES`) | If payment method `BANCOS` + `bankChannel` JOSE/MAYTE |
| **Watch** → `SOLD` | Always |

### After commit (not rolled back with the sale)

| Effect | Method |
| --- | --- |
| **AccountEntry** RECEIVABLE (`DEAL_AUTO` / `SALE_BALANCE`) | `syncReceivableSafe` → `CuentasService.syncDealReceivable` |
| **TreasuryEntry** | **Not written** by `registerSale` |

Planner preview copy that claims Treasury liquidity movement is **aspirational** relative to current domain behavior. AI receipts must not claim Treasury effects the domain does not perform.

---

## 3. Payment-mode support (domain reality)

There is **no** domain enum `PAID | CREDIT | PARTIAL` on sales. Behavior is amount-driven (`computedStatus`):

| Intent | Domain payload | Result |
| --- | --- | --- |
| CREDIT / pendiente | Omit payment / amount 0 | Deal + Watch SOLD; no Payment → PENDIENTE; CXC via AR sync |
| PARTIAL | `initialPaymentAmount` &lt; sale MXN + method | Payment + PARCIAL; remaining CXC |
| PAID | Full amount (or legacy `paymentMethod` alone) | Payment + PAGADO; no remaining CXC |

Destination is **`PaymentMethod`**: `CASH` | `BANCOS` | `CESAR` (not a separate DTO “destination” field).  
`BANCOS` requires `bankChannel`: `JOSE` | `MAYTE`.

AI `paymentMode` in intent-schema is detection-only today and is **not** wired into `RegisterSaleDto`.

### Safely supportable for AI v1 (after schema)

1. **CREDIT** — safest (no payment / no bank fee path)
2. **PARTIAL / PAID** — only after mapping to `initialPaymentAmount` + method (+ bankChannel when BANCOS)
3. Do **not** promise Treasury updates until domain writes them

---

## 4. Permission model

| Layer | Gate |
| --- | --- |
| Manual deals API | `JwtAuthGuard` only — **no** role decorator |
| Admin Ventas | Authenticated app membership |
| AI bindings (reads) | Active `tenantUser` membership |

AI write must enforce **at least** JWT + active tenant membership (same as manual). No finer `sales.write` permission exists today.

---

## 5. Atomicity assessment

| Boundary | Atomic? |
| --- | --- |
| Deal + Payment + OpEx + Watch SOLD | **Yes** (`$transaction`) |
| AccountEntry AR sync | **No** — post-commit best-effort; failure logged, sale not rolled back |
| Concurrent double-submit | **Race** — app-level “already sold / other won deal” checks, not a unique DB constraint on `(tenantId, watchId)` for won deals |

AI must not introduce a worse partial path. Reuse `registerSale`. Document AR sync as post-commit (same as UI).

---

## 6. Confirmation / freshness flow (target architecture — not implemented)

```
NL / structured REGISTER_SALE
→ Planner (HIGH tier) → READY_FOR_CONFIRMATION preview
→ POST /ai/action-runs/:id/confirm (fingerprint)
→ server-owned WritePlanRunner
→ revalidate fingerprint + workspace/entity versions + sellable watch + customer + auth
→ WRITE binding REGISTER_SALE only
→ DealsService.registerSale
→ COMPLETED + receipt
```

Today: `RuntimeService.confirm` **only marks confirmed** — it does **not** execute domain writes. `CapabilityBindingDefinition.mode` is `'READ'` only. All write capabilities remain unbound.

---

## 7. Durable business-write idempotency — SCHEMA GATE

### Existing fields

| Model | Relevant fields | Sufficient for AI sale idempotency? |
| --- | --- | --- |
| **Deal** | `sourceTag`, `importFingerprint` (+ unique with tenant) | **No** — import-only; unused by `registerSale` |
| **Payment** | soft-delete only | **No** |
| **AIActionRun** | `idempotencyKey` **indexed, not unique** | **Insufficient alone** — concurrent confirm can still double-call `registerSale` |
| **AIRequest** | `clientRequestId` unique per actor | Protects NL claim, **not** domain sale rows |
| **AccountSettlement** | optional `idempotencyKey` + `@@unique([tenantId, idempotencyKey])` | Pattern to copy |

### Gap (blocking)

`DealsService.registerSale` is **not idempotent**.  
Commit 12 requires: one confirmed ActionRun → at most one Deal / Payment / Watch transition.

**In-memory locks are forbidden.**

### Proposed additive schema (TYPE C — not applied)

```prisma
// Deal — durable AI / client sale idempotency
model Deal {
  // ...existing fields...
  /// Opaque key for register-sale retries (e.g. "ai-action-run:<actionRunId>")
  registerIdempotencyKey String?
  @@unique([tenantId, registerIdempotencyKey])
}

// Optional hardening
model AIActionRun {
  idempotencyKey String
  @@unique([tenantId, idempotencyKey])  // upgrade from @@index
}
```

**Semantics:**

1. Write binding sets `registerIdempotencyKey = \`ai-action-run:${actionRunId}\`` (or fingerprint-stable variant).
2. Unique constraint makes concurrent/duplicate confirms converge on one Deal.
3. On unique conflict: load existing Deal, return same receipt (idempotent replay).
4. Extend `RegisterSaleDto` / `registerSale` to accept optional key and persist it.

**Rollback implications:** additive nullable unique column — safe forward; backfill not required for historical deals (nulls allowed; Postgres unique allows multiple nulls).

**Audit enums:** Prefer existing `EXECUTION_STARTED` / `EXECUTION_COMPLETED` / `EXECUTION_FAILED` (+ ActionRun replay audits) before adding `WRITE_EXECUTION_*` (enum additions are also TYPE C).

---

## 8. Execution result / receipt model (target)

After schema + implementation:

```ts
{
  actionId: string
  executionState: 'EXECUTED'
  success: true
  affectedEntities: [
    { type: 'WATCH'; idHash: string; effect: 'SOLD' },
    { type: 'DEAL'; idHash: string; effect: 'CREATED' },
    // Payment / AccountEntry hashes when created
  ]
  receipt: {
    dealId?: string  // frontend navigation if permitted
    amount: string
    currency: 'MXN' | 'USD'
    paymentMode: 'PAID' | 'CREDIT' | 'PARTIAL'
    effectiveDate: string
  }
  warnings: string[]
  rollbackPossible: false  // conversational rollback not implemented
}
```

Success copy (“Listo / Registrado”) **only** after server-confirmed execution.

---

## 9. Reversal / correction model (current domain)

| Operation | Behavior |
| --- | --- |
| Soft-delete deal | Cancels unpaid DEAL_AUTO AR; **does not revive Watch from SOLD** |
| Stage → CLOSED_LOST | Does not revive SOLD (V1) |
| addPayment / remove payment | Balance corrections |
| Conversational reverse | **Not implemented** |

Receipt CTA after execution: **“Corregir en Ventas”** — do not promise rollback.

---

## 10. Other write capabilities

Remain **UNBOUND / non-executable**:

- REGISTER_RECEIVABLE_PAYMENT  
- REGISTER_PURCHASE  
- REGISTER_EXPENSE  
- REGISTER_SETTLEMENT  
- REGISTER_CRYPTO_POSITION  
- REGISTER_CRYPTO_PRICE  

---

## 11. Deployment classification (when unblocked)

| Phase | Classification |
| --- | --- |
| Additive Deal idempotency (+ optional AIActionRun unique) | **TYPE C** — manual `prisma migrate deploy` |
| Write binding + confirm→execute orchestration + Admin CTA | **TYPE B** + small **TYPE A** |
| Combined release | TYPE C first on production DB, then code |

---

## 12. Next steps (after explicit schema approval)

1. Approve and author Prisma migration for `Deal.registerIdempotencyKey` (+ optional ActionRun unique).
2. Extend `RegisterSaleDto` / `registerSale` to honor the key (idempotent create-or-return).
3. Introduce WRITE capability binding mode + single `REGISTER_SALE` binding → `DealsService.registerSale`.
4. Wire confirm → freshness checks → WritePlanRunner → execution → receipt.
5. Frontend: “Confirmar venta” only for executable REGISTER_SALE plans.
6. Full test matrix (architecture, idempotency, PAID/CREDIT, stale, permission, audit).
7. Production smoke **only** on disposable test fixture — never a real Rolex.

---

## Confirmation

This commit work **stopped at the schema gate**.

- No write binding was enabled.
- No REGISTER_SALE execution path was added.
- No Prisma migration was applied.
- All write capabilities remain non-executable in production.
