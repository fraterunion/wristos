# REGISTER_EXPENSE — Domain + Future Binding (Commit 15A)

Status: **DOMAIN ONLY — AI write execution NOT implemented**
Canonical command: `ExpenseRegistrationService.register()`
AI binding: **unbound** (must stay unbound until Commit 15B)

---

## Product goal (future 15B)

Conversational examples:

- “Gasté 2,500 en gasolina.” → amount + concept; **source clarify** if missing
- “Pagué 18 mil de renta a bancos.” → amount + BANK + category map / clarify
- “Compré material de oficina por 3,200 en efectivo.” → amount + CASH + OTHER/clarify

Flow (future):

```
NL → REGISTER_EXPENSE intent
→ allowlisted category map / clarify
→ source required (CASH|BANK|CESAR)
→ deterministic preview
→ Confirmar gasto
→ ExpenseRegistrationService.register()
→ receipt + audit
```

No confirmation → zero mutation.
One ActionRun → one economic expense (durable idempotency).

---

## Canonical expense semantics (15A)

A **paid operating expense** writes atomically:

| Record | Role |
|---|---|
| `OperatingExpense` | P&L operating spend |
| `TreasuryEntry` OUTFLOW | Liquidity leave from exactly one of CASH / BANK / CESAR |

`commission` on the Treasury row stays **null**.
Ordinary BANK-paid rent is **not** a bank commission event.

Gastos V1 means **paid expenses only**. No accrued / unpaid / CXP auto-open from this command.

---

## What counts as expense

Allowlisted `OperatingExpenseCategory` for **new** registration:

| Enum | Typical language |
|---|---|
| `GASOLINE` | gasolina |
| `TOLLS` | casetas |
| `WATCHMAKER` | relojero / servicio |
| `PARKING` | estacionamiento |
| `MEALS` | comidas |
| `FLIGHTS` | vuelos |
| `TRAVEL` | viáticos / hotel |
| `MARKETING` | marketing / ads |
| `COMMISSIONS` | comisión de ventas / agente (OpEx, not Control Bancos) |
| `OTHER` | catch-all when mapped with confidence |

`description` / concept lives in `notes` (free text). Category is **required enum** — no free-text categories; AI must not invent enums.

There is **no** `RENT` enum. “Renta” → map to `OTHER` only when planner confidently treats it as OpEx, or clarify.

---

## What does NOT count as expense

| Utterance / event | Correct domain |
|---|---|
| “Compré un Rolex por 500 mil” | `REGISTER_PURCHASE` / inventory — **not** expense |
| “José me pagó 35 mil” | `REGISTER_RECEIVABLE_PAYMENT` |
| “Le pagué 100 mil a Pepe” (CXP) | payable settlement — **not** generic expense |
| “Retiré dinero para César” | capital / transfer — not OpEx unless product later defines it |
| “Compré USDT” | crypto position — not expense |
| Sale BANCOS fee | Treasury bank-fee OUTFLOW + `commission` — **not** OpEx `BANK_FEES` |
| Partner distribution | `InvestorDistribution` |
| Account transfer CASH↔BANK | not modeled as expense |

`REGISTER_EXPENSE` must stay a **narrow** operating-spend command.

---

## BANK_FEES policy

| Question | Answer |
|---|---|
| A. Manual standalone BANK_FEES today? | UI hides it; API enum existed historically |
| B. Canonical registration? | **Rejected** by `ExpenseRegistrationService` |
| C. Analytics double-count? | Control Bancos KPI = `TreasuryEntry.commission`; residual OpEx BANK_FEES (legacy) folds into operativos, never into bank KPI |

Sale path already: Treasury fee OUTFLOW with commission, **no** OpEx BANK_FEES.

---

## Money source policy

Frozen sources for cash-linked registration:

- `CASH`
- `BANK`
- `CESAR`

Not supported:

- `CRYPTO`
- transfers
- multi-source splits

Stored on `OperatingExpense.sourceAccount` (`TreasuryAccount?`).
Legacy / import rows may have `sourceAccount = null` and no Treasury OUTFLOW (read-only compatibility).

---

## Currency / date policy

| Topic | Policy |
|---|---|
| Currency V1 | **MXN only** |
| USD | rejected until a canonical FX policy exists |
| Canonical amount | `OperatingExpense.amount` (+ `currency`) |
| Treasury | `amount` + `amountMxn` (MXN: equal); `commission = null` |
| Date omitted (manual) | UI defaults to today; API requires `expenseDate` |
| Date omitted (future AI) | may default to today **only if preview shows the date** |
| Relative phrases | use existing deterministic timezone normalization (future planner) |

---

## Atomicity

`ExpenseRegistrationService.register()` uses one Prisma `$transaction`:

1. create `OperatingExpense`
2. create Treasury OUTFLOW via `TreasuryService.createFromOperatingExpense`

Forbidden states:

- expense without OUTFLOW
- OUTFLOW without expense

`loadResult` refuses incomplete replay.

---

## Durable idempotency

Schema (additive, **not migrated in prod by this commit**):

```
OperatingExpense.registerIdempotencyKey String?
@@unique([tenantId, registerIdempotencyKey])
```

Also:

- `currency` default `MXN`
- `sourceAccount` nullable
- `deletedAt` soft-delete

Future AI marker:

```
registerIdempotencyKey = ai-action-run:<actionRunId>
```

Replay: compatible payload → same expense + same Treasury; conflicting payload → `ConflictException`.

---

## Treasury provenance

No new Treasury FK. Use existing `TreasuryEntry.provenanceKey`:

```
operating-expense:<expenseId>:outflow
```

Unique per tenant. Soft-delete on reverse. Replay must not create a second OUTFLOW.

---

## Post-commit recovery (design for 15B)

If ActionRun reaches EXECUTING after domain commit but runtime completion fails:

1. Lookup `OperatingExpense` by `tenantId` + `registerIdempotencyKey = ai-action-run:<actionRunId>`
2. Verify payload compatibility
3. Verify Treasury by provenance key
4. Reconstruct receipt
5. Finalize ActionRun `COMPLETED`

Do **not** use Treasury presence alone as proof without the expense marker.

---

## Correction / reversal

| Question | 15A behavior |
|---|---|
| Edit in place? | Notes only for cash-linked rows |
| Soft-delete? | Yes (`deletedAt`) |
| Reverse Treasury? | Yes, atomic with expense soft-delete |
| Conversational reversal? | Not promised — “Corregir en Gastos” |
| Analytics | Soft-deleted expenses excluded (`deletedAt: null`) |

---

## Permissions

Manual mutations: `JwtAuthGuard` only (any authenticated tenant user).
Future AI must inherit the **same or stricter** policy. No role elevation via Assistant.

---

## Future AI intent / preview contract

Entities (planned):

```
{
  amount,          // required
  currency,        // MXN V1
  category,        // allowlisted enum or clarify
  description,     // → notes
  source,          // CASH|BANK|CESAR or clarify
  expenseDate      // optional → today if policy + preview show it
}
```

Preview (Spanish):

```
Voy a registrar este gasto:
Concepto / Categoría / Monto / Pagado desde / Fecha
Efectos: Gastos +X · <Fuente> −X
[Confirmar gasto] [Editar] [Cancelar]
```

---

## Profit / liquidity

For an 18k BANK expense:

| Surface | Effect |
|---|---|
| OperatingExpense | +18k |
| Treasury BANK | −18k OUTFLOW once |
| Dashboard / Analytics monthly net profit | −18k once (includes OpEx) |
| OI `GET_MONTHLY_PROFIT` | same Analytics path (−18k) |
| Dashboard liquidity BANK | −18k once |
| Bank commission P&L | **unchanged** (`commission` null) |
| Capital `totalBusinessProfit` | **unchanged** (excludes OpEx — see gate below) |

---

## Capital / OpEx financial gate (OPTION C)

### Exact Capital formulas (current code)

```
totalBusinessProfit = Σ CLOSED_WON revenue − Σ COGS − Σ Treasury BANK commission > 0
capitalNeto         = totalCapitalContributed + totalBusinessProfit − totalDistributionsPaid
profitEntitlement   = totalBusinessProfit × ownershipPercent / 100
pendingProfit       = profitEntitlement − distributionsPaid
ROI                 = (capitalNeto − contributed) / contributed   (UI; requires contributions)
```

Annual month `businessProfit` uses the same definition (revenue − COGS − bank fees; **no OpEx**).

Analytics / Dashboard / OI monthly net profit:

```
netProfit = sales − COGS − bank commissions − OperatingExpense(deletedAt null)
```

### Does a normal OpEx reduce…?

| Metric | Reduces? |
|---|---|
| 1. monthly net profit (Analytics/Dashboard/OI) | **Yes** |
| 2. Capital `totalBusinessProfit` | **No** |
| 3. `capitalNeto` | **No** (via profit) |
| 4. investor profit entitlement | **No** |
| 5. pending partner profit | **No** |
| 6. ROI (derived from capitalNeto) | **No** |
| 7. annual/monthly partner Capital table | **No** |

### Intended business semantics

Workbook model (`docs/migrations/MASTER_WORKBOOK_ANALYSIS.md`):

> Net monthly profit ≈ sum(utilidades) − **gastos del mes** − bank commissions
> Split net profit 75% Cesar / 25% Edgar

So **true business profit should include OpEx** before partner entitlement.

Capital today is therefore a **financial inconsistency** relative to workbook + Analytics labels — not an intentionally documented “gross trading profit” product (until labeled).

### Historical impact (Wrist Caviar production, read-only audit)

| Item | Value |
|---|---|
| OperatingExpense rows | 287 |
| OpEx sum | **MXN 3,083,674.74** (2025: 703,467 · 2026: 2,380,207.74) |
| Residual OpEx BANK_FEES | 0 |
| Distributions already paid | **MXN 2,732,961.16** (13 rows) |
| Ownership | CESAR 75% / EDGAR 25% |

If Capital started subtracting OpEx without reconciliation:

- `totalBusinessProfit` ↓ 3,083,674.74
- CESAR entitlement ↓ ~2,312,756
- EDGAR entitlement ↓ ~770,919
- Prior distributions would no longer reconcile to the new entitlement base

**Decision: OPTION C — do not change Capital formulas in 15A.**

UI clarification (no formula change): Capital now labels the figure **“Utilidad bruta acumulada”** and footnotes that Dashboard net profit does subtract Gastos.

**Business decision still required before treating Capital as partner-net-profit:** either reconcile/backfill Capital to include OpEx, or permanently define Capital as gross trading profit and keep labels distinct.

---

## Historical / legacy compatibility

- No rewrite of imported expenses
- `currency` DEFAULT `MXN` — valid for Wrist Caviar (business books are MXN; prior UI “USD” label was incorrect display, not stored FX)
- `sourceAccount` nullable — legacy rows have **no** invented CASH/BANK/CESAR source
- `registerIdempotencyKey` nullable — no backfill
- `deletedAt` nullable — soft-delete only going forward
- No Treasury backfill for legacy OpEx-only rows
- Legacy delete: soft-delete OpEx only; **never invents** a Treasury reversal

---

## Reversal semantics

Canonical paid expense:

1. Soft-delete `OperatingExpense` (`deletedAt`)
2. Soft-delete Treasury OUTFLOW by provenance `operating-expense:<id>:outflow`

Not a compensating INFLOW. Retry is idempotent (`alreadyReversed`).

Liquidity and Analytics restore once OpEx + OUTFLOW are soft-deleted.

---

## Category / Rent policy (V1)

No `RENT` enum. Future AI must **not** silently invent enums.

Preferred V1:

- clarify category when uncertain, **or**
- map to `OTHER` only when preview surfaces **Categoría: Otro** + **Concepto: Renta oficina**

Do not hide “renta” inside free-text without showing OTHER.

---

## Schema gate (blocker before 15B)

Migration file (local only — **do not deploy migrate** until approved):

`prisma/migrations/20260808060000_operating_expense_register_idempotency/migration.sql`

Additions:

| Column | Nullability | Default |
|---|---|---|
| `currency` | NOT NULL | `'MXN'` |
| `sourceAccount` | NULL | — |
| `registerIdempotencyKey` | NULL | — |
| `deletedAt` | NULL | — |

Indexes: unique `(tenantId, registerIdempotencyKey)`; index `(tenantId, deletedAt)`.

Additive only. No destructive SQL. No historical amount/source rewrite.

Before AI execution:

1. Apply migration to production manually
2. Verify unique constraint live
3. Capital/OpEx reconciliation decision (or accept labeled divergence)
4. WRITE binding + DEMO QA + WC hash proof

---

## Executable writes after 15A

| Capability | Status |
|---|---|
| `REGISTER_SALE` | WRITE bound |
| `REGISTER_RECEIVABLE_PAYMENT` | WRITE bound |
| `REGISTER_EXPENSE` | **unbound** |
| `REGISTER_PURCHASE` | unbound |
| `REGISTER_SETTLEMENT` | unbound |
| `REGISTER_CRYPTO_*` | unbound |

---

## Exact blocker before Commit 15B

1. Production migrate of OperatingExpense idempotency / source / soft-delete columns
2. **Capital vs OpEx business decision** (reconcile historical partner profit **or** permanently accept “utilidad bruta” definition)
3. WRITE binding + confirmation freshness + recovery → `ExpenseRegistrationService.register()`
4. Planner category allowlist + source clarification
5. DEMO QA matrix + Wrist Caviar hash proof

Do **not** bind AI until (1) is live and domain QA is green.
