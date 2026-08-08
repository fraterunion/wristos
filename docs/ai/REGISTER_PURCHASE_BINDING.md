# REGISTER_PURCHASE — Canonical Domain Gate (Commit 17A)

Status: **DOMAIN READY — AI UNBOUND**
Canonical command: `PurchaseRegistrationService.register()`
HTTP: `POST /api/inventory/purchases`
AI binding: **none** (must remain non-executable until 17B)
Idempotency: `Watch.registerIdempotencyKey` (future AI: `ai-action-run:<actionRunId>`)

---

## 1. Manual purchase / inventory audit (pre-17A)

| Question | Answer |
|---|---|
| Endpoint / button | `POST /api/inventory` via Inventory `WatchFormModal`; also Ventas quick-watch |
| Rows created | `Watch` only (+ optional later `WatchExpense` / images via separate POSTs) |
| Rows updated | None on create |
| Canonical purchase record? | **No** — Watch itself was the acquisition record |
| Cost | `Watch.cost` (MXN canonical); optional `costCurrency` / `costOriginalAmount` / `costExchangeRate` for USD |
| Seller / supplier | **Not on Watch**. Cuentas PAYABLE uses free-text `counterpartyName` (+ optional `clientId`) |
| Payment | **None** on inventory create |
| Unpaid balance | **None** auto-created |
| Treasury on create? | **No** |
| CXP on create? | **No** |
| Atomic economics? | N/A — inventory-only |
| Frontend multi-mutate? | Inventory UI only posts Watch; Cuentas PAYABLE is a separate manual flow |

Plain `POST /inventory` remains **inventory-only** for backward compatibility.

---

## 2. What REGISTER_PURCHASE means

Wrist Caviar acquires inventory with a canonical acquisition cost.

| Mode | Inventory | Treasury | CXP |
|---|---|---|---|
| **PAID** | +Watch | OUTFLOW full MXN cost | none |
| **CREDIT** | +Watch | none | PAYABLE full MXN cost |
| **PARTIAL** | +Watch | OUTFLOW paid MXN | PAYABLE remainder |

Not: OperatingExpense, transfer, capital contribution, receivable payment, crypto buy, partner distribution, inventory edit.

Purchase does **not** reduce monthly profit. COGS hits on sale via `Watch.cost` (+ `WatchExpense`).

---

## 3. Watch / acquisition data model decision

**No dedicated Purchase entity.** Watch + Treasury provenance + `AccountEntry` PAYABLE (`PURCHASE_AUTO`) is sufficient when Watch gains:

- `acquiredAt`
- `registerIdempotencyKey` (+ unique per tenant)
- `sellerClientId` (optional Client FK)

Minimum valid purchase input today (canonical command):

- brand, model, condition
- purchaseAmount (> 0), currency (MXN|USD)
- priceMin, priceMax
- acquisitionDate
- paymentMode
- PAID/PARTIAL → sourceAccount
- PARTIAL → initialPaymentAmount
- CREDIT/PARTIAL → sellerClientId **or** sellerCounterpartyName

Optional: reference, serial, year (not a field — omit), status (`AVAILABLE` default; `IN_TRANSIT` allowed), ownership, image, notes, idempotency key.

---

## 4. Seller model

- Preferred: existing `Client` via `sellerClientId` (no silent create).
- CXP counterparty: Client.name or free-text `sellerCounterpartyName`.
- Optional for PAID; required identity for CREDIT/PARTIAL (CXP needs counterparty).
- Future CREATE_CLIENT is a separate capability — not part of REGISTER_PURCHASE.

---

## 5. Cost / COGS source of truth

1. Purchase → `Watch.cost` (MXN)
2. Optional later → `WatchExpense.amount` adds to effectiveCost
3. Sale → Analytics / Capital / History COGS = `deal.watch.cost + watch.expenses` (or `deal.historicalCost` if no watch)

AI must not invent a second cost formula.

---

## 6. Currency / FX policy

- Canonical inventory cost is always **MXN** in `Watch.cost`.
- USD purchases use live FX (`FxService.getUsdMxn`) → store original + rate (same as manual Inventory create).
- Treasury OUTFLOW for purchase V1 is recorded in **MXN** (`amountMxn`).
- CXP `totalAmount` is **MXN** remainder/full.
- No invented FX beyond existing USD→MXN path.
- CRYPTO spend unsupported.

---

## 7–10. Payment / Treasury / CXP semantics

| | PAID | CREDIT | PARTIAL |
|---|---|---|---|
| purchase cost | Watch.cost | Watch.cost | Watch.cost |
| amount paid | = cost | 0 | initialPaymentAmount (MXN after FX) |
| outstanding | 0 | = cost | cost − paid |
| source | CASH\|BANK\|CESAR | forbidden | CASH\|BANK\|CESAR |
| Treasury | `inventory-purchase:<watchId>:outflow` | none | same provenance |
| CXP | none | `PURCHASE_AUTO` + category PURCHASE + watchId | same |

Later CXP payments use Cuentas payable-payment flow — **not** REGISTER_PURCHASE replay.

Funding V1 freeze: **CASH, BANK, CESAR** only.

---

## 11. Acquisition date

- New field: `Watch.acquiredAt` (required on purchase registration).
- OI aging: prefer `acquiredAt`, fallback `createdAt`.
- Do not treat `createdAt` as purchase date for new canonical purchases.

---

## 12. Initial inventory status

- Default: `AVAILABLE`
- Allowed: `IN_TRANSIT` when physical receipt is pending (“compré… todavía no llega”)
- Physical receipt as a separate future command if needed (“ya llegó…”)

---

## 13. Location

- No location field on Watch today. OI already returns `location: null`.
- Do not invent locations in V1.

---

## 14. Duplicate serial

- No DB unique on serial (nullable legacy + possible historical dups).
- API rejects exact serial match within tenant when serial provided.
- Null/empty serial: no duplicate guard.

---

## 15–18. Canonical command / atomicity / idempotency / recovery

```
PurchaseRegistrationService.register(tenantId, input)
  → prisma.$transaction {
      Watch.create (acquiredAt, cost, sellerClientId, registerIdempotencyKey)
      Treasury OUTFLOW if paid > 0
      AccountEntry PAYABLE if outstanding > 0
    }
```

Durable marker: **`Watch.registerIdempotencyKey`**

Recovery after ActionRun crash (17B):

1. Lookup Watch by `registerIdempotencyKey = ai-action-run:<id>`
2. Load Treasury by `inventory-purchase:<watchId>:outflow`
3. Load PAYABLE by watchId + `PURCHASE_AUTO`
4. Mark ActionRun COMPLETED

Same key + same payload → replay. Same key + different → Conflict.

---

## 19. Correction / reversal

Today:

- Watch can be edited / soft-deleted
- Soft-delete does **not** reverse Treasury or CXP
- Sold watches block inventory delete semantics via status
- Cost edits after sale affect historical COGS (dangerous)

17A does not implement conversational reversal. Document limitation: economic unwind is not atomic with Watch soft-delete. Future correction UX: Inventario / Cuentas / Treasury separately until a dedicated reverse command exists.

---

## 20. Permissions

- `JwtAuthGuard` on inventory (same as today) — no role gate on create
- Future AI must inherit same or stricter (do not broaden)

---

## 21. Manual frontend compatibility

- Economic purchase → `POST /inventory/purchases` (backend owns transaction)
- Inventory-only create → `POST /inventory` (unchanged)
- Do not orchestrate Watch + Treasury + CXP from the browser

---

## 22. Future AI intent / preview (design only)

Intent remains planner HIGH-tier placeholder. Entities to freeze in 17B (align planner vs intent schema):

- watch identity (brand/model/reference/serial)
- purchaseAmount, currency
- acquisitionDate
- paymentMode, sourceAccount, initialPaymentAmount
- sellerClientId / seller resolution

Preview examples: see product Part 32. Must not claim executable until write-bound.

---

## 23. Schema gate (TYPE C)

Migration: `prisma/migrations/20260809120000_watch_purchase_registration`

- `AccountEntrySource.PURCHASE_AUTO`
- `Watch.acquiredAt`
- `Watch.sellerClientId` → Client
- `Watch.registerIdempotencyKey` + unique `(tenantId, registerIdempotencyKey)`

**Do not migrate production until approved.**

---

## 24. Blockers before Commit 17B

1. Production `prisma migrate deploy` for 17A migration
2. Wire Inventory UI (or Ventas) to `POST /inventory/purchases` when payment terms known
3. Align AI intent entity names with canonical input
4. Implement `RegisterPurchaseWriteBinding` + ActionRun idempotency key
5. Confirmation / preview surface
6. Optionally tighten inventory create permissions if product requires OWNER/ADMIN only

---

## 25. Regression invariants

- REGISTER_PURCHASE remains unbound in WriteCapabilityBindingRegistry (3 writes: SALE, RECEIVABLE_PAYMENT, EXPENSE)
- Purchase does not reduce monthly profit
- Inventory capital increases by Watch.cost
- Sale COGS uses Watch.cost
- Existing imported watches unchanged (`acquiredAt` null → OI uses createdAt)
