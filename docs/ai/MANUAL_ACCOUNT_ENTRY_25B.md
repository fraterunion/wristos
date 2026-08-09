# Canonical Manual CxC / CxP (Commit 25B)

**Status:** DOMAIN GATE — AI unbound  
**Production AI WRITE registry:** still exactly **TEN**  
**Not executable via Assistant:** `CREATE_RECEIVABLE`, `CREATE_PAYABLE`

## Canonical commands

| Command | Route | Service | Creates |
|---|---|---|---|
| Manual receivable | `POST /cuentas/receivables` | `ManualAccountEntryService.createReceivable` | `AccountEntry` type=`RECEIVABLE` source=`MANUAL` |
| Manual payable | `POST /cuentas/payables` | `ManualAccountEntryService.createPayable` | `AccountEntry` type=`PAYABLE` source=`MANUAL` |

Legacy `POST /cuentas/entries` delegates to the same canonical path for standalone MANUAL creates and **rejects** `DEAL_AUTO` / `PURCHASE_AUTO` / deal|watch|expense links.

## Economic effects

- Treasury: **Δ0**
- AccountPayment / Payment / Deal / Watch / OpEx / Capital: **none**
- Outstanding at create: `totalAmount` (paid = 0)
- P&L: **Δ0** (claim/liability only; Expense V1 remains PAID-only — unpaid OpEx is a known semantic gap, not faked via payable)

## Counterparty

Client is **optional**. Free-text `counterpartyName` is canonical.  
`clientId` (active tenant client) may coexist with a name snapshot.  
**Future composition to CREATE_CLIENT is optional, not required** for V1.

## Dates

- `issuedAt` — optional business/issue date (UTC day)
- `dueDate` — optional; past due → initial `OVERDUE`, else `OPEN`
- `createdAt` — system timestamp (not conflated with due/issue)

## Idempotency (TYPE C)

`AccountEntry.registerIdempotencyKey` + `@@unique([tenantId, registerIdempotencyKey])`.

Material payload (notes non-material): type, source=MANUAL, clientId, counterpartyName, concept, amount, currency, issuedAt, dueDate.

## Edit / cancel policy

MANUAL economic identity immutable after create: type, source, amount, currency, exchangeRate, clientId, deal/watch/expense links.  
Metadata allowed: notes, concept, reference, issuedAt, dueDate, category, counterparty display fields (Admin locks counterparty in UI; API blocks clientId change).  
Cancel/soft-delete unpaid MANUAL with **zero** payments/settlements; fail closed otherwise.

## Boundaries

| Utterance / workflow | Path |
|---|---|
| Sale with balance | `REGISTER_SALE` → `DEAL_AUTO` receivable |
| Purchase on credit | `REGISTER_PURCHASE` → `PURCHASE_AUTO` payable |
| Standalone debt/claim | Manual receivable/payable |
| Settlement | Existing APPLY_TO_PAYABLE / future `REGISTER_SETTLEMENT` — not create |

## Schema migration

`prisma/migrations/20260809200000_account_entry_register_idempotency/`  
**Do not migrate production until explicit approval.**

## AI next (not this commit)

Bind `CREATE_RECEIVABLE` / `CREATE_PAYABLE` to these services only after production migrate + DEMO QA.
