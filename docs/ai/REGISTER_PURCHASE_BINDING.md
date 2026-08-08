# REGISTER_PURCHASE — AI Write Binding (Commit 17B)

Status: **AI WRITE BOUND — CONFIRMATION REQUIRED**
Canonical command: `PurchaseRegistrationService.register()`
HTTP (manual): `POST /api/inventory/purchases`
AI binding: `RegisterPurchaseWriteBinding` → WRITE `1.0.0`
Idempotency: `Watch.registerIdempotencyKey = ai-action-run:<actionRunId>`

Executable writes after 17B (exactly four):

1. `REGISTER_SALE`
2. `REGISTER_RECEIVABLE_PAYMENT`
3. `REGISTER_EXPENSE`
4. `REGISTER_PURCHASE`

Still unbound: `REGISTER_SETTLEMENT`, `REGISTER_CRYPTO_POSITION`, `REGISTER_CRYPTO_PRICE`

---

## 1. Deployed 17A domain (prerequisite)

See historical sections below / production merge for:

- `PurchaseRegistrationService.register()` / `.reverse()`
- PAID / CREDIT / PARTIAL
- CASH / BANK / CESAR
- `PURCHASE_AUTO` AccountEntry PAYABLE
- `Watch.acquiredAt`, `sellerClientId`, `registerIdempotencyKey`
- Treasury provenance `inventory-purchase:<watchId>:outflow`
- Active per-tenant non-null serial uniqueness
- No purchase-time P&L impact; later sale uses `Watch.cost` as COGS

Schema gate: **NO migration in 17B.** 17A production schema is sufficient.

---

## 2. AI argument contract

Planner / enricher produce trusted arguments. Binding maps to:

| Field | Required | Notes |
|---|---|---|
| brand, model | yes | Narrow aliases (Batman → Rolex GMT-Master II Batman); never invent |
| condition | yes | Defaults to `Bueno` (disclosed in preview) |
| purchaseAmount / cost | yes | Positive |
| currency | yes | MXN (default) or USD (canonical FX at execution) |
| acquiredAt | yes | Defaults to today (disclosed); hoy / ayer / ISO |
| paymentMode | yes | PAID \| CREDIT \| PARTIAL — **no silent default** |
| sourceAccount | PAID/PARTIAL | CASH \| BANK \| CESAR |
| initialPaymentAmount | PARTIAL | `0 < amount < cost` |
| sellerClientId \| sellerCounterpartyName | CREDIT/PARTIAL | No auto CREATE_CLIENT |
| status | optional | AVAILABLE (default) \| IN_TRANSIT |
| serial / reference | optional | Never invented |
| registerIdempotencyKey | server-only | `ai-action-run:<actionRunId>` |

LLM/frontend must never supply the idempotency key.

---

## 3. Watch identity policy

- Minimum safe: brand + model (or allowlisted commercial alias).
- Ambiguous single token (“AP”, “reloj”) → clarify.
- Never invent serial, reference, year, location, box/papers.
- Optional fields left absent.

---

## 4. Seller resolution policy

1. If `sellerClientId` claimed → verify live in-tenant Client; else strip.
2. Name query → CRM search:
   - 1 match → bind `sellerClientId` + name
   - many → ENTITY_PICKER
   - zero → free-text `sellerCounterpartyName` (canonical fallback) + warning; **no Client create**
3. CREDIT/PARTIAL require seller or counterparty name for CXP.
4. PAID seller optional.

---

## 5. Payment-mode / funding policy

| Phrase | Mode |
|---|---|
| pagado / contado / completo | PAID |
| a crédito / pendiente / no le pagué | CREDIT |
| le di X y quedaron Y | PARTIAL |

Cost alone (“en 280 mil”) does **not** imply PAID — clarify payment mode.

Funding: CASH / BANK / CESAR only. CRYPTO rejected.

---

## 6. Currency / FX policy

- MXN → straight canonical cost.
- USD → `PurchaseRegistrationService` uses existing `FxService` path (same as Inventario).
- No invented FX in the planner. No crypto denomination.

---

## 7. Date / status policy

- `acquiredAt` defaults to business today; preview shows resolved date.
- Status: AVAILABLE default; IN_TRANSIT when “todavía no llega” / explicit.
- Do not invent other statuses. Post-registration “ya llegó” is a future capability.

---

## 8. Planner clarification policy

Missing groups (deterministic):

- WATCH_IDENTITY (brand/model)
- PURCHASE_COST
- PAYMENT_MODE
- SOURCE_ACCOUNT (PAID/PARTIAL)
- INITIAL_PAYMENT_AMOUNT (PARTIAL)
- SELLER (CREDIT/PARTIAL without counterparty)
- SERIAL conflict when duplicate active serial

Never invent values.

---

## 9. Preview semantics

Backend planner builds fields + estimatedEffects. Claude/frontend must not calculate accounting.

Effects always include: inventory +cost, treasury/CXP per mode, **Utilidad: Sin cambio**.

Do not call acquisition cost “gasto”.

---

## 10. Confirmation lifecycle

1. NL → intent → enrich → resolve seller/serial → plan
2. READY_FOR_CONFIRMATION + `executable: true`
3. Primary CTA: **Confirmar compra**
4. `POST /api/ai/action-runs/:id/confirm` only (never `POST /inventory/purchases` from Assistant)
5. Double-tap protected; retry same ActionRun
6. No confirmation → NO PURCHASE

Tier: HIGH (same class as SALE).

---

## 11. Freshness

Before execute: membership, activeActionRunId, plan fingerprint, seller still valid, serial still free (or same ActionRun replay), payment semantics valid.

Serial taken after preview → conflict / STALE → NO PURCHASE.

---

## 12. Idempotency

`Watch.registerIdempotencyKey = ai-action-run:<actionRunId>`

Double confirm / concurrent / network retry → one Watch, one economic purchase, same receipt.

Different ActionRuns + same serial → physical duplicate conflict (no merge).

---

## 13. Serial concurrency

Same ActionRun + same serial → replay.
Different ActionRuns + same serial → conflict.

---

## 14. Post-commit recovery

Reuse WritePlanRunner:

EXECUTING + Watch marker present → re-run binding (domain replay) → COMPLETED.

Complete-state gates:

| Mode | Required |
|---|---|
| PAID | Watch + Treasury; no CXP |
| CREDIT | Watch + CXP; no Treasury |
| PARTIAL | Watch + Treasury + CXP |

Missing leg → `CANONICAL_PURCHASE_INVARIANT` / INVARIANT_FAILURE — never success.

---

## 15. BusinessActionResult / receipt

```
executionState: EXECUTED
success: true
affectedEntities: [WATCH, TREASURY_ENTRY?, ACCOUNT_ENTRY?]
receipt: {
  watchId, watchLabel, costMxn, currency, acquiredAt,
  paymentMode, initialPaymentAmount?, sourceAccount?,
  outstandingPayable?, seller?, status,
  capitalUnchanged: true, pnlUnchanged: true, replayed?
}
rollbackPossible: false
```

Correction UX: **Corregir en Inventario** (not conversational reverse).

---

## 16. Frontend UX

- Preview intro: “Voy a registrar esta compra:”
- CTA: Confirmar compra
- Success only after COMPLETED: “Listo. La compra quedó registrada.”
- Links: Ver reloj · Corregir en Inventario
- Malformed purchase SUCCESS_RECEIPT → fail closed
- Allowlist: SALE, PAYMENT, EXPENSE, PURCHASE only

---

## 17. Audit / telemetry

Immutable ActionRun audit reused. Safe metadata: actionRunId, capability, bindingVersion, planFingerprint, paymentMode, sourceAccount, status, amount hashes, recovered, duration, failure type.

Do not log raw serial / free-text seller / full payload / secrets when avoidable.

Assistant Health observes REGISTER_PURCHASE as a fourth dangerous write. Execution does not depend on telemetry.

---

## 18. Permissions

Same as manual `POST /inventory/purchases` (JwtAuthGuard / tenant membership). AI does not broaden inventory mutation access. Binding re-checks tenant membership at execute.

---

## 19. Production rollout

1. Merge 17B to main (backend Railway + frontend Vercel)
2. No Prisma migrate
3. Smoke: confirm PAID/CREDIT/PARTIAL via Assistant on DEMO first
4. Verify double-confirm idempotency
5. Verify serial conflict + seller picker

---

## Historical — 17A domain notes

(Preserved for audit)

### Payment modes

| | PAID | CREDIT | PARTIAL |
|---|---|---|---|
| Treasury | full OUTFLOW | none | initial OUTFLOW |
| CXP | none | full PAYABLE | remainder PAYABLE |

### Manual UI

| Caller | Endpoint |
|---|---|
| Inventario “Registrar compra” | `POST /inventory/purchases` |
| Ventas quick-watch | `POST /inventory` (inventory-only — not REGISTER_PURCHASE) |

### Regression invariants

- Exactly four executable AI writes
- Purchase does not reduce monthly profit
- Inventory capital increases by Watch.cost
- Sale COGS uses Watch.cost
- Quick-watch remains inventory-only
- Capital methodology unchanged
