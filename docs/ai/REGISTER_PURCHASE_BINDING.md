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

## 19. Correction / reversal (final gate)

### Root cause (pre-fix)
`InventoryService.remove` soft-deleted Watch only. Treasury OUTFLOW and PURCHASE_AUTO CXP remained live → accounting divergence.

### Detection
Canonical purchase iff Treasury `inventory-purchase:<watchId>:outflow` **or** `AccountEntry` PAYABLE `source=PURCHASE_AUTO` exists (including soft-deleted markers for already-reversed recovery).

Legacy inventory-only Watch: neither marker → soft-delete Watch only; **never** invent Treasury/CXP reversal.

### V1 safe automatic reverse (`PurchaseRegistrationService.reverse`)
Allowed only when:
- tenant-scoped Watch exists
- canonical markers present
- Watch not SOLD
- no live Deal on watchId
- no AccountPayment on PURCHASE_AUTO payable
- no AccountSettlement on that payable
- at least one active economic leg present

Then atomic soft-delete: Watch + purchase Treasury OUTFLOW + PURCHASE_AUTO payable.

Idempotent: second reverse → `alreadyReversed: true`.

Blocked (manual correction required): SOLD, deal-linked, payable payments/settlements, incomplete legs.

`DELETE /inventory/:id` delegates to `reverse()` when canonical; legacy path unchanged.

Conversational AI reversal is **not** implemented.

---

## 20. Permissions

- `JwtAuthGuard` on inventory (same as today) — no role gate on create
- Future AI must inherit same or stricter (do not broaden)

---

## 21. Manual UI convergence (final gate)

| Caller | Classification | Endpoint |
|---|---|---|
| Inventario `WatchFormModal` create (“Registrar compra”) | **A. PURCHASE** | `POST /inventory/purchases` |
| Inventario edit | inventory update | `PATCH /inventory/:id` |
| Ventas `createQuickWatch` | **C. QUICK TEMPORARY** inventory-only stub before sale | `POST /inventory` |
| Data onboarding / imports | **B. MIGRATION / ADMIN** | importer paths (not this modal) |

Product rule: real acquisition uses canonical purchase. Quick-watch stays inventory-only (not a treasury purchase). Frontend never calls Treasury/Cuentas separately for purchase.

Delete dialog warns that canonical purchases reverse economics when safe.

---

## 22. Serial integrity (final gate)

Production read-only audit (2026-08-08):
- wrist-caviar: 40 active, 2 with serial, **0 duplicates** (incl. soft-deleted)
- wristos-demo: 60 active, 60 with serial, **0 duplicates**

Policy:
- Unique **per tenant** on non-null serial for **active** watches
- NULL/blank allowed (normalized blank → null)
- Case-sensitive after trim (no historical case folding)
- Partial unique index: `watches_tenantId_serialNumber_active_key` WHERE serial NOT NULL AND deletedAt IS NULL
- Idempotency ≠ serial integrity

---

## 23. Schema gate (TYPE C)

Migration: `prisma/migrations/20260809120000_watch_purchase_registration`

- `AccountEntrySource.PURCHASE_AUTO`
- `Watch.acquiredAt`, `sellerClientId`, `registerIdempotencyKey`
- Partial unique active serial index

**Do not migrate production until approved.**

---

## 24. Acquisition age truthfulness

- New canonical purchase: `acquiredAt` required
- Legacy: `acquiredAt` stays null
- OI: prefer `acquiredAt`; fallback `createdAt` = **días en WristOS** / inventory record age

---

## 25. Recovery invariant

Replay via `Watch.registerIdempotencyKey` succeeds only when complete:

| Mode | Required |
|---|---|
| PAID | Watch + Treasury; no CXP; paid + outstanding = cost |
| CREDIT | Watch + CXP; no Treasury |
| PARTIAL | Watch + Treasury + CXP; paid + outstanding = cost |

Missing leg → Conflict (not successful replay).

---

## 26. Blockers before Commit 17B

1. Production `prisma migrate deploy` for 17A migration
2. Align AI intent entity names with canonical input
3. Implement `RegisterPurchaseWriteBinding` + ActionRun idempotency key
4. Confirmation / preview surface
5. Optional: seller Client picker (today free-text counterparty for CXP)
6. Optionally tighten inventory create permissions

---

## 27. Regression invariants

- REGISTER_PURCHASE remains unbound (3 executable writes: SALE, RECEIVABLE_PAYMENT, EXPENSE)
- Purchase does not reduce monthly profit
- Inventory capital increases by Watch.cost
- Sale COGS uses Watch.cost
- Existing imported watches unchanged (`acquiredAt` null → OI uses createdAt)
