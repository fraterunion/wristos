# REGISTER_CAPITAL_CONTRIBUTION — AI Write Binding (Commit 24A)

Status: **AI WRITE EXECUTION READY**
Prerequisites: Commit 23A (canonical CapitalContributionService) + 23B (economic immutability) deployed.

## Product goal

César can say:

- “César aportó 300 mil.”
- “Registra una aportación de 200 mil de Edgar.”
- “Metí 500 mil al negocio.”
- “César puso 300 mil, márcalos como Bancos.”

WristOS resolves one trusted Investor, amount, CapitalAccount metadata, and business date; shows deterministic Capital effects with **Tesorería: Sin cambio**; requires confirmation; executes `CapitalContributionService.register()`; returns a canonical receipt.

**No confirmation → no InvestorContribution.**  
**No TreasuryEntry ever from this capability.**

## Executable writes after 24A

Exactly **nine**:

1. REGISTER_SALE  
2. REGISTER_RECEIVABLE_PAYMENT  
3. REGISTER_EXPENSE  
4. REGISTER_PURCHASE  
5. CREATE_CLIENT  
6. UPDATE_CLIENT  
7. REGISTER_PAYABLE_PAYMENT  
8. REGISTER_TREASURY_TRANSFER  
9. REGISTER_CAPITAL_CONTRIBUTION  

Still unbound after 24A: `REGISTER_CAPITAL_DISTRIBUTION` (bound in 24B), settlement, crypto, client delete/restore/merge.

Composition V1 unchanged:

```
PURCHASE_SELLER → CREATE_CLIENT
SALE_CUSTOMER → CREATE_CLIENT
```

## V1 ledger-only semantics

- Writes `InvestorContribution` only
- `CapitalAccount` (`CASH` | `BANK` | `CESAR_ACCOUNT`) is **reference metadata**, not a Treasury mutation
- ownershipPercent unchanged
- totalBusinessProfit / P&L / OpEx / revenue Δ0
- Treasury CASH/BANK/CESAR Δ0

## Investor resolution

`CapitalInvestorEntityResolver`:

- Tenant-scoped active Investor lookup by name (deterministic match key)
- Trusted `selectedInvestorId` / ordinal / last selected context
- Ambiguous → ENTITY_PICKER (`INVESTOR`)
- Missing → NEEDS_INPUT / picker
- **No** provider `investorId`, no auto-create Investor, no cross-tenant IDs

## Amount / currency

- amount > 0 via existing money normalization (“300 mil” → 300000)
- Implied MXN; USD / dólares / USDT / crypto → NEEDS_INPUT
- No FX invention; no silent absolute-value conversion

## CapitalAccount

| Canonical | Aliases |
|---|---|
| CASH | efectivo, caja, cash |
| BANK | banco, bancos, cuenta bancaria |
| CESAR_ACCOUNT | Cuenta César, cuenta de César |

Required by canonical DTO — AI does **not** invent a default account.

Preview label: **Cuenta de referencia** (never “Entrará a Bancos”).

## Intent boundaries

| Phrase | Intent |
|---|---|
| César aportó 300 mil | REGISTER_CAPITAL_CONTRIBUTION |
| Pasa 300 mil de Cuenta César a Bancos | REGISTER_TREASURY_TRANSFER |
| Págale 100 mil de utilidad a César | REGISTER_CAPITAL_DISTRIBUTION (bound in 24B) |
| Compramos un Rolex… | REGISTER_PURCHASE |
| Gasté 20 mil que puso César | expense / clarify — not auto contribution |

## Confirmation lifecycle

READY_FOR_CONFIRMATION → Confirmar aportación → `POST /api/ai/action-runs/:id/confirm` → WritePlanRunner → `RegisterCapitalContributionWriteBinding` → `CapitalContributionService.register()` → receipt.

Before confirm: InvestorContribution Δ0, Treasury Δ0.

## Idempotency

```
registerIdempotencyKey = ai-action-run:<actionRunId>
```

Server-owned only. Same ActionRun / double / triple confirm → one contribution. Notes are non-material for replay.

## Recovery

| classifyRecovery | Runner behavior |
|---|---|
| MATCH (active marker) | Recover COMPLETED |
| notes changed after commit | MATCH (notes non-material) |
| STALE_*_REVERSED | No success, no recreation |
| CANONICAL_*_INVARIANT | No success, no overwrite |
| MISSING | IN_PROGRESS / not committed |

User-safe reversed copy:

> La aportación se registró anteriormente, pero después fue revertida en Capital. No voy a volver a aplicarla automáticamente.

## Receipt

```json
{
  "executionState": "EXECUTED",
  "success": true,
  "receipt": {
    "kind": "CAPITAL_CONTRIBUTION",
    "contributionId": "...",
    "investorId": "...",
    "investorLabel": "CESAR",
    "amount": "300000.00",
    "currency": "MXN",
    "account": "BANK",
    "ownershipChanged": false,
    "treasuryChanged": false
  },
  "rollbackPossible": false
}
```

Frontend CTAs: **Ver Capital** / **Corregir en Capital**.

## Privacy / telemetry

Safe audit hashes for investor/contribution; amount; account; date bucket; recovered; failure type.  
Contribution is the ninth dangerous-write funnel (passive).

## Schema gate

**No migration.** Uses 23A `registerIdempotencyKey` + 23B material identity.
