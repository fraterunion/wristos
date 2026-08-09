# REGISTER_TREASURY_TRANSFER — AI Write Binding (Commit 22B)

Status: **AI WRITE EXECUTION READY**
Prerequisite: Commit 22A domain (`TreasuryTransferService`) deployed and production-verified.

## Product goal

César can say:

- “Pasa 200 mil de Bancos a Efectivo.”
- “Mueve 50 mil de Cuenta César a Bancos.”
- “Transfiere 100 mil de Efectivo a Cuenta César.”

WristOS deterministically interprets source/destination/amount, shows liquidity-neutral preview, requires explicit confirmation, then executes `TreasuryTransferService.register()` and returns a truthful receipt.

**No confirmation → no transfer.** Claude does not calculate balances or accounting.

## Deployed 22A domain (frozen)

- `TreasuryTransferService.register()` / `reverse()`
- Accounts: `CASH` | `BANK` | `CESAR` — all six directional pairs; `source ≠ destination`
- MXN only; negative balances intentionally allowed
- Two atomic `TreasuryEntry` legs with provenance:
  - `treasury-transfer:<logicalKey>:outflow`
  - `treasury-transfer:<logicalKey>:inflow`
- Total liquidity Δ0; P&L Δ0; Capital Δ0; no commission / OpEx / AccountEntry / Payment / Watch / Deal
- Soft-delete both legs on reverse; cashflow excludes transfer provenance
- CESAR is internal Treasury — **not** InvestorDistribution / Capital

## Executable writes after 22B

Exactly **eight**:

1. REGISTER_SALE
2. REGISTER_RECEIVABLE_PAYMENT
3. REGISTER_EXPENSE
4. REGISTER_PURCHASE
5. CREATE_CLIENT
6. UPDATE_CLIENT
7. REGISTER_PAYABLE_PAYMENT
8. REGISTER_TREASURY_TRANSFER

Still unbound: settlement, crypto position/price, client delete/restore/merge, Capital contribution/distribution, all future writes.

Controlled Action Composition V1 graph **unchanged**:

```
PURCHASE_SELLER → CREATE_CLIENT
SALE_CUSTOMER → CREATE_CLIENT
```

Transfers have no composition dependency.

## Write binding

`RegisterTreasuryTransferWriteBinding`

| Field | Value |
|---|---|
| Capability | `REGISTER_TREASURY_TRANSFER` |
| Mode | WRITE |
| Version | `1.0.0` |
| Binding | `register_treasury_transfer_canonical@1.0.0` |

Maps trusted plan args → `TreasuryTransferService.register()`. No Prisma treasury writes, no accounting math in the binding.

### Canonical args

```json
{
  "sourceAccount": "CASH|BANK|CESAR",
  "destinationAccount": "CASH|BANK|CESAR",
  "amount": 200000,
  "transferDate?": "ISO date",
  "notes?": "optional"
}
```

Server-only idempotency:

```
registerIdempotencyKey = ai-action-run:<actionRunId>
```

Never accepted from Claude, user, frontend, or planner args.

## Intent aliases / account normalization

Closed enum only — no fuzzy arbitrary names, no CRYPTO, no DB IDs.

| Canonical | Aliases |
|---|---|
| CASH | efectivo, caja, cash |
| BANK | banco, bancos, cuenta bancaria |
| CESAR | César, Cuenta César, cuenta de César |

## Source / destination direction

Spanish word order is material:

| Phrase | Source → Dest |
|---|---|
| “Pasa 100 mil de Bancos a Efectivo.” | BANK → CASH |
| “Pasa 100 mil a Bancos desde Efectivo.” | CASH → BANK |
| “De César manda 50 mil a Efectivo.” | CESAR → CASH |

Never silently swap direction. Same account → clarify/reject (“No puedo registrar una transferencia entre la misma cuenta.”) with zero mutation.

## Semantic boundaries

| Phrase | Intent |
|---|---|
| “Pasa 50 mil de Bancos a Efectivo.” | `REGISTER_TREASURY_TRANSFER` |
| “Gasté 50 mil de Bancos en marketing.” | `REGISTER_EXPENSE` |
| “Págale 50 mil a Pepe desde Bancos.” | `REGISTER_PAYABLE_PAYMENT` |
| “José me depositó 50 mil a bancos.” | `REGISTER_RECEIVABLE_PAYMENT` |
| “Pasa 100 mil de Bancos a Cuenta César.” | `REGISTER_TREASURY_TRANSFER` (internal) |
| “Retírale 100 mil de utilidad a César.” | **NOT** transfer — Capital distribution |
| “Págale la utilidad a César.” | **NOT** transfer — Capital distribution |
| “César aportó 100 mil al negocio.” | **NOT** transfer — Capital contribution |
| “Compra 200 mil de USDT.” | crypto / unbound write |

## Amount / currency

- Amount > 0; reuse existing money normalization (“200 mil” → 200000)
- V1 MXN only; explicit USD/USDT/crypto → clarify/reject
- No FX

## Negative-balance policy (intentional V1)

AI planner must **not** invent insufficient-funds rejection, blocking balance warnings, or auto-adjusted amounts. Source balance changes do **not** stale the plan. Freshness revalidates membership, tenant, ActionRun, fingerprint, closed enums, `source ≠ destination`, amount, and material date — never balance-based stale.

## Preview

Example:

```
Voy a registrar esta transferencia:

Desde: Bancos
Hacia: Efectivo
Monto: $200,000 MXN

Efectos:
Bancos −$200,000
Efectivo +$200,000
Liquidez total: Sin cambio
Utilidad: Sin cambio
Capital: Sin cambio

Primary: Confirmar transferencia
Secondary: Editar / Cancelar
```

Do **not** use Ingreso / Gasto / Ganancia / Pérdida for the paired transfer itself. Optional balance display only if backend-derived; omit if it complicates V1.

## Confirmation lifecycle

```
READY_FOR_CONFIRMATION
  → Confirmar transferencia
  → POST /api/ai/action-runs/:id/confirm
  → WritePlanRunner
  → RegisterTreasuryTransferWriteBinding
  → TreasuryTransferService.register()
  → BusinessActionResult
```

Before confirmation: **0** new transfer legs.
Frontend must **not** call `POST /treasury/transfers` from Assistant.

## Idempotency / concurrency

- Same ActionRun → one logical transfer → exactly two legs
- Double / 3× confirm / network retry → same pair
- Different ActionRuns = independent transfers (even if source goes negative)

## Recovery

Inspect both provenance legs for `ai-action-run:<actionRunId>`:

| Case | Outcome |
|---|---|
| Both active | recover COMPLETED |
| Neither | IN_PROGRESS / not committed |
| Only one | `CANONICAL_TREASURY_TRANSFER_INVARIANT` — no auto-heal |
| Both soft-deleted | `STALE_TREASURY_TRANSFER_REVERSED` — no success, no re-create |

Never infer transfer from amount/date alone. Reversed-before-recovery must not recreate.

## Receipt / success UX

```json
{
  "executionState": "EXECUTED",
  "success": true,
  "receipt": {
    "kind": "TREASURY_TRANSFER",
    "transferId": "...",
    "sourceAccount": "BANK",
    "destinationAccount": "CASH",
    "amount": "200000.00",
    "currency": "MXN",
    "totalLiquidity": "Sin cambio",
    "profit": "Sin cambio",
    "capital": "Sin cambio"
  },
  "rollbackPossible": false
}
```

UI after COMPLETED:

```
Listo. La transferencia quedó registrada.
Bancos −$200,000
Efectivo +$200,000
Liquidez total: Sin cambio
[Ver Tesorería] [Corregir en Tesorería]
```

Correction path: Tesorería only — no conversational reverse.

## Context / follow-ups

After success, a new explicit transfer (“Ahora pasa 50 mil de Efectivo a César.”) is planned independently. No hidden chained transfer; do not reuse prior amount unless context policy safely supports an explicit reference.

## Audit / privacy / telemetry

Safe audit fields: capability, bindingVersion, actionRun hash, transfer logical hash, source/destination, amount, currency, recovered, result hash, failure type, duration. No provider prompt/secrets. No normal counterparty PII.

Telemetry (passive): Assistant Health eighth write funnel — attempts, source/destination distribution, confirmation rate, validation/same-account failures, success, recovery, reversed recovery, invariant failures.

## Schema gate

**NO migration.** 22A provenance semantics are sufficient. If durable ambiguity appears that cannot be solved with paired provenance keys: STOP — do not add in-memory tracking or schema without approval.

## Rollout

- TYPE A+B (API + Admin); no TYPE C
- Local commit → PR → merge deploys Railway (backend) + Vercel (admin)
- No `prisma migrate deploy`
- Do not push/deploy until explicitly approved
