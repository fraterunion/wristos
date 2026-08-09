# Canonical Capital Operations (Commits 23A / 23B / 24A)

Domain: partner-ledger-only Capital contribution + distribution.

AI WRITE status:

- `REGISTER_CAPITAL_CONTRIBUTION` — **bound** (Commit 24A) as WRITE #9
  See `docs/ai/REGISTER_CAPITAL_CONTRIBUTION_BINDING.md`
- `REGISTER_CAPITAL_DISTRIBUTION` — still **unbound**

Exactly nine executable AI WRITE bindings after 24A (sale, receivable payment,
expense, purchase, create/update client, payable payment, treasury transfer,
capital contribution).

## Frozen V1 product semantics (audit-proven)

### What Capital writes today

Manual `/capital` aporte / retiro create:

- `InvestorContribution` or `InvestorDistribution` only
- **No** `TreasuryEntry`
- Production Wrist Caviar has **zero** `contributionId` / `distributionId` Treasury links

`CapitalAccount` (`CASH` | `BANK` | `CESAR_ACCOUNT`) is a **declared funding/source label**,
not an automatic Treasury mutation. `CESAR_ACCOUNT` ≠ `TreasuryAccount.CESAR` transfer.

Opening balances (`InvestorOpeningBalance`) also do **not** write Treasury.

### Why Capital does not write Treasury in 23A

1. Live CapitalService create paths never wrote Treasury.
2. WC distributions (incl. Edgar) are tagged `CESAR_ACCOUNT` with no Treasury link —
   account label is not a cash ledger.
3. Treasury `CESAR` is counted in total business liquidity. `BANK → CESAR` transfer
   does **not** mean money left the business, and must not be confused with
   `InvestorDistribution`.
4. Historical CESAR partner ledger inflows already exist as Treasury; inventing
   linked Capital+Treasury contribution would risk double-count vs liquidity.

Cash-linked Capital (contribution inflow / distribution outflow) is a **future
product decision**, not enabled here.

### Option C business profit (unchanged)

```
totalBusinessProfit =
  Σ CLOSED_WON agreedPrice
  − Σ COGS (watch.cost + watch expenses, or historicalCost)
  − Σ Treasury BANK commission (> 0)
```

OperatingExpense is intentionally **not** deducted.

### Partner formulas

```
capitalContributed_i = openingBalances_i + contributions_i
profitEntitlement_i  = totalBusinessProfit × ownershipPercent_i / 100
distributionsPaid_i  = Σ distributions_i
pendingProfit_i      = profitEntitlement_i − distributionsPaid_i

totalCapitalContributed = Σ capitalContributed_i
totalDistributionsPaid  = Σ distributionsPaid_i
totalPendingToPartners  = Σ pendingProfit_i
capitalNeto =
  totalCapitalContributed + totalBusinessProfit − totalDistributionsPaid
```

Dashboard ROI (actual Admin code):

```
ROI% = ((capitalNeto − totalCapitalContributed) / totalCapitalContributed) × 100
     = ((totalBusinessProfit − totalDistributionsPaid) / totalCapitalContributed) × 100
```

Ownership is **explicit** (`Investor.ownershipPercent`). Contributions do not
recalculate ownership.

Over-distribution: Admin warns only; API allows `amount > pendingProfit`.
WC currently has no negative pending.

### Hypothetical effects (+300k contribution, +100k distribution)

Contribution +300k (ledger-only):

- laterContributions / totalCapitalContributed +300k
- capitalNeto +300k
- ROI denominator rises (ROI % changes even if profit fixed)
- ownership Δ0, businessProfit Δ0, P&L Δ0, Treasury Δ0

Distribution +100k (ledger-only):

- distributionsPaid +100k, pending −100k, capitalNeto −100k
- ROI numerator falls by 100k (because capitalNeto − contributed = profit − distributions)
- businessProfit Δ0, P&L Δ0, Treasury Δ0

## Canonical services

- `CapitalContributionService.register()` / `reverse()`
- `CapitalDistributionService.register()` / `reverse()`

Manual Capital UI create/delete delegates through `CapitalService` → these services.

Idempotency: nullable `registerIdempotencyKey` (TYPE C migration
`20260809190000_capital_register_idempotency`). Replay / conflict / concurrent
safe. Soft-delete already existed.

Provenance: none in V1 (no Treasury leg). If cash-linked Capital is approved later,
use durable keys such as:

- `capital-contribution:<id>:inflow`
- `capital-distribution:<id>:outflow`

## Permissions

`CapitalController` is `@UseGuards(JwtAuthGuard)` only (any authenticated tenant user).
Do not broaden for future AI.

## Future AI previews (ledger-only V1)

Contribution:

```
Voy a registrar esta aportación:
Socio / Monto / Cuenta (etiqueta) / Fecha
Efectos: Capital aportado +N · Ownership sin cambio · Utilidad sin cambio · Tesorería sin cambio
```

Distribution:

```
Voy a registrar esta distribución:
Socio / Monto / Cuenta (etiqueta) / Fecha
Efectos: Distribuciones +N · Pendiente −N · Utilidad negocio sin cambio · Tesorería sin cambio
```

Do not claim BANK/CASH liquidity movement until cash-linked Capital is explicitly approved.

## Commit 23B — Economic immutability

After creation, Capital financial identity is **immutable** for **all** active rows
(legacy and keyed alike).

### Allowed in-place

- `notes` only via `updateNotes()` / PATCH (optional `expectedUpdatedAt` CAS)

### Rejected in-place (typed conflict)

Contribution → `CAPITAL_CONTRIBUTION_IMMUTABLE`
Distribution → `CAPITAL_DISTRIBUTION_IMMUTABLE`

Rejected fields: `investorId`, `amount`, `account`, `contributedAt`/`paidAt`,
`registerIdempotencyKey`, `tenantId`, `deletedAt`.

Spanish message:

> Este movimiento financiero no se puede modificar. Revierte el registro y crea uno nuevo con los datos correctos.

### Correction flow

1. Reverse (soft-delete) original row
2. Register a new corrected Capital event

No automatic reverse+recreate. No conversational reversal.

### Material payload (idempotency + future AI recovery)

Contribution: `investorId`, `amount`, `account`, `contributedAt`
Distribution: `investorId`, `amount`, `account`, `paidAt`

**Notes are non-material** after creation — notes-only edits must not break replay.

`registerIdempotencyKey` is identity metadata and immutable.

### Future AI recovery (unbound)

| State | Classification |
|--|--|
| Key + material match + active | recover success |
| Soft-deleted | `STALE_CAPITAL_*_REVERSED` |
| Key exists but material diverges | `CANONICAL_CAPITAL_*_INVARIANT` |

Never re-apply automatically.

Helpers: `classifyRecovery()` on both services (domain only; not AI-bound).

### Historical 1970 dates

Ordinary PATCH cannot fix them. Dedicated backlog:

`CAPITAL_HISTORICAL_DATE_REMEDIATION`

### Admin UX

Edit modal: economic fields read-only; notes editable; correction copy shown.

### AI readiness

With durable keys + immutable economics + soft-delete reverse, AI Capital WRITE
bindings are unblocked for a later commit. **Still unbound in 23B.**
