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
| Monthly net profit | −18k once (OpEx sum) |
| Dashboard liquidity BANK | −18k once |
| Bank commission P&L | **unchanged** (`commission` null) |
| Capital partner formula | still does not subtract OpEx (unchanged product rule) |

---

## Historical compatibility

- No rewrite of imported expenses
- New fields nullable / defaulted
- No backfill of Treasury for legacy OpEx-only rows
- Legacy rows remain readable in Gastos lists

---

## Schema gate (blocker before 15B)

Migration file (local only — **do not deploy migrate** until approved):

`prisma/migrations/20260808060000_operating_expense_register_idempotency/migration.sql`

Before AI execution:

1. Apply migration to production manually
2. Verify `registerIdempotencyKey` unique constraint live
3. Implement WRITE binding only after domain green on DEMO

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
2. WRITE binding + confirmation freshness + recovery wired to `ExpenseRegistrationService.register()`  
3. Planner category allowlist + source clarification  
4. DEMO QA matrix + Wrist Caviar hash proof  

Do **not** bind AI until (1) is live and domain QA is green.
