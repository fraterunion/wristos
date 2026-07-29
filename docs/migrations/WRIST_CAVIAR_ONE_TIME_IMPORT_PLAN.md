# Wrist Caviar One-Time Import — Destination Audit & Plan

Status: planning complete before operational writes  
Migration source: `wrist-caviar-master-workbook-v1`  
Parser: `wrist-caviar-master-xlsx-v1`  
Strategy: internal CLI only (not a reusable Platform product)

## PR #8 disposition

PR #8 (`feature/wrist-caviar-workbook-migration-phase2`) is **closed without merge**.  
Reusable dry-run UI / public dry-run APIs are no longer required. Selective matching ideas may be reused inside the CLI.

## Side-effect audit

| Surface | Risk | Migration approach |
|---|---|---|
| `DealsService.registerSale` | Requires watch; marks watch SOLD; may create payments | **Do not use**. Direct `Deal` create with `watchId: null`, historical fields, `importFingerprint` |
| `CuentasService.createPayment` | Always writes `TreasuryEntry` | **Do not use**. Direct `AccountPayment` create without treasury (cash/bank sheets are the ledger of record) |
| `TreasuryService` | Linked to payments/capital | Direct `TreasuryEntry` creates for cash/bank/cesar rows only |
| `CapitalService.createContribution/Distribution` | No email/Stripe | Safe if used; prefer direct Prisma in same transaction |
| `CrmService.create` | No email | Safe; or direct `Client` create |
| `ExpensesService.create` | No side effects | Safe; or direct Prisma |
| Stripe / storefront / webhooks | External | Never call |
| Notifications / email | None found on create paths above | None |

## Source → destination mapping

| Workbook group | Source sheet(s) | Destination model(s) | Notes |
|---|---|---|---|
| Customers | VENTAS, CXC (derived) | `Client` | Exact normalized name LINK only; fuzzy never |
| Current inventory | INVENTARIO | `Watch` status AVAILABLE | Serial strongest; no reference-only LINK |
| Historical sales | VENTAS | `Deal` CLOSED_WON, `watchId` null | Snapshot in `notes` + historical* fields; `importFingerprint` unique |
| Accounts receivable | CTAS X COBRAR | `AccountEntry` RECEIVABLE + `AccountPayment` | Free-form counterparty; no deal link; no treasury side-write |
| Accounts payable | CTAS X PAGAR | `AccountEntry` PAYABLE + `AccountPayment` | Creditor as `counterpartyName`; formula overrides via resolutions |
| Expenses | GASTOS | `OperatingExpense` | Category only via deterministic keyword map |
| Cash MXN/USD | EFECTIVO | `TreasuryEntry` account CASH | Separate currency; running balance validation only |
| Bank | CONTROL BANCOS | `TreasuryEntry` account BANK | Commission as separate OUT row or notes |
| Partner César | CUENTA CESAR | `TreasuryEntry` account CESAR **or** CONFLICT | Unclassified → CONFLICT/DEFER |
| Profit distributions | COBRO UTILIDADES | `InvestorDistribution` (+ ensure Investors 75/25) | No per-watch ownership |
| Crypto | CRIPTO CESAR | — | DEFERRED |
| Oscar float | OSCAR PAPA CAMI | — | DEFERRED |
| REPORTE | REPORTE | reconciliation only | Not imported as operational rows |

## Dependency order (FK-aware)

1. Clients  
2. Watches (current stock only)  
3. Deals (historical; client FK; no watch)  
4. AccountEntry RECEIVABLE (optional client FK)  
5. AccountPayment (receivable)  
6. AccountEntry PAYABLE  
7. AccountPayment (payable)  
8. OperatingExpense  
9. TreasuryEntry CASH  
10. TreasuryEntry BANK  
11. TreasuryEntry CESAR / contributions  
12. Investor + InvestorDistribution  
13. `WristCaviarOneTimeImportMap` rows  

## Idempotency

`WristCaviarOneTimeImportMap` unique on  
`(tenantId, migrationSource, packageFingerprint, destinationEntityType, sourceCandidateId)`.

Deal also uses `@@unique([tenantId, importFingerprint])`.

## Transaction

Single `prisma.$transaction` for the full operational import when package size permits.  
If Neon/Railway statement timeout is hit: document and use ordered checkpoints with the same mapping uniqueness (must not partial-commit without explicit approval).

## Pre-write gate

No operational writes until:

1. This mapping is reviewed  
2. Resolutions file covers blockers  
3. Local dry-run completes  
4. Backup verification documented for production  
