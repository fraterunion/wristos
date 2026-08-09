# REGISTER_CAPITAL_DISTRIBUTION — AI Write Binding (Commit 24B)

Status: **AI WRITE EXECUTION READY**
Prerequisites: Commit 23A (canonical CapitalDistributionService) + 23B (economic immutability) + 24A (contribution write) deployed.

## Product goal

César can say:

- “Págale 100 mil de utilidad a César.”
- “Registra una distribución de 50 mil para Edgar.”
- “Retira 200 mil para César.”
- “Registra 100 mil de distribución para Edgar en Bancos.”

WristOS resolves one trusted Investor, amount, CapitalAccount metadata, and business date; shows deterministic Capital effects with **Tesorería: Sin cambio**; surfaces current/resulting pending when available; requires confirmation; executes `CapitalDistributionService.register()`; returns a canonical receipt.

**No confirmation → no InvestorDistribution.**  
**No TreasuryEntry ever from this capability.**

## Executable writes after 24B

Exactly **ten**:

1. REGISTER_SALE  
2. REGISTER_RECEIVABLE_PAYMENT  
3. REGISTER_EXPENSE  
4. REGISTER_PURCHASE  
5. CREATE_CLIENT  
6. UPDATE_CLIENT  
7. REGISTER_PAYABLE_PAYMENT  
8. REGISTER_TREASURY_TRANSFER  
9. REGISTER_CAPITAL_CONTRIBUTION  
10. REGISTER_CAPITAL_DISTRIBUTION  

Still unbound: settlement, crypto, client delete/restore/merge.

Composition V1 unchanged:

```
PURCHASE_SELLER → CREATE_CLIENT
SALE_CUSTOMER → CREATE_CLIENT
```

No Capital composition edges.

## V1 ledger-only semantics

- Writes `InvestorDistribution` only
- `CapitalAccount` (`CASH` | `BANK` | `CESAR_ACCOUNT`) is **reference metadata**, not a Treasury mutation
- ownershipPercent unchanged
- totalBusinessProfit / P&L / OpEx / revenue Δ0
- Treasury CASH/BANK/CESAR Δ0
- CESAR_ACCOUNT must not mutate Treasury CESAR

## Over-distribution policy

Over-distribution is **allowed** (matches production Capital UI).

- Do **not** require `amount <= pendingProfit`
- Preview must truthfully show negative resulting pending when known
- No silent amount cap

## Pending

Backend-derived from `CapitalService.getSummary()`:

```
currentPending = profitEntitlement − distributionsPaid
resultingPending = currentPending − amount
```

If summary cannot be fetched safely, omit projected pending rather than inventing.

## Investor resolution

Reuses `CapitalInvestorEntityResolver` (same as contribution):

- Tenant-scoped active Investor lookup by name
- Trusted `selectedInvestorId` / ordinal / last selected context
- Ambiguous → ENTITY_PICKER (`INVESTOR`)
- **No** provider `investorId`, no auto-create, no cross-tenant IDs

## Amount / currency / account / date

- amount > 0 via existing money normalization
- Implied MXN; USD / dólares / USDT / crypto → NEEDS_INPUT
- Account required (no silent default)
- `paidAt` defaults to current UTC day when omitted

## Intent boundaries

| Utterance | Intent |
|---|---|
| “Págale 100 mil de utilidad a César.” | REGISTER_CAPITAL_DISTRIBUTION |
| “Pasa 100 mil de Bancos a Cuenta César.” | REGISTER_TREASURY_TRANSFER |
| “Págale 100 mil a José que le debemos.” | REGISTER_PAYABLE_PAYMENT |
| “Paga 100 mil del vuelo de Edgar.” | REGISTER_EXPENSE |
| “César aportó 100 mil.” | REGISTER_CAPITAL_CONTRIBUTION |

## Confirmation / idempotency

```
READY_FOR_CONFIRMATION
→ Confirmar distribución
→ POST /api/ai/action-runs/:id/confirm
→ WritePlanRunner
→ RegisterCapitalDistributionWriteBinding
→ CapitalDistributionService.register()
```

Server-only marker: `registerIdempotencyKey = ai-action-run:<actionRunId>`

Double / triple confirm / network retry → one distribution row.

## Recovery

| Classification | Behavior |
|---|---|
| MATCH | recover COMPLETED |
| STALE_CAPITAL_DISTRIBUTION_REVERSED | no success, no recreate |
| CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT | no success, no overwrite |
| MISSING | IN_PROGRESS / not committed |

Notes-only edits are non-material (MATCH still holds).

## Receipt

Trusted fields include distributionId, investor, amount, account, paidAt, previousPending/remainingPending when known, `ownershipChanged=false`, `treasuryChanged=false`, `businessProfitChanged=false`.

UI: Ver Capital / Corregir en Capital. No conversational reversal.

## Privacy / telemetry

Safe audit: capability, binding version, investor/distribution hashes, amount, account, date bucket, overDistribution, recovered, failure classification.

Assistant Health observes write #10 passively. No prompt/secrets.

## Schema gate

**NO migration.** 23A schema + 23B immutability are sufficient.

## Rollout

TYPE B API + TYPE A Admin. Deploy after quality gates; controlled production QA on DEMO only.
