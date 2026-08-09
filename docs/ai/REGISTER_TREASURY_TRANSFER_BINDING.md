# REGISTER_TREASURY_TRANSFER — Domain Binding (Commit 22A)

Status: **DOMAIN ONLY — AI unbound**  
Prerequisite for Commit 22B (AI write binding).

## Product goal

Internal liquidity movement between Treasury accounts. Conversational examples (future 22B):

- “Pasa 200 mil de Bancos a Efectivo.” → `BANK → CASH`
- “Manda 100 mil de Efectivo a Cuenta César.” → `CASH → CESAR`
- “Transfiere 50 mil de César a Bancos.” → `CESAR → BANK`

Hard invariant: **total liquidity Δ0**. Not income. Not OpEx. Not Capital distribution.

## Current Treasury audit (pre-22A / still true)

| # | Finding |
|---|---|
| 1 | Endpoints were `GET /treasury/balances`, `POST /treasury/cash/physical-balance` only. **22A adds** `POST /treasury/transfers`, `GET /treasury/transfers/:id`, `POST /treasury/transfers/:id/reverse`. |
| 2 | Admin had **no** Treasury page; dashboard/analytics consume balances. **22A adds** `/treasury` with one-call transfer form. |
| 3 | **No transfer concept** existed (no API, model, or UI orchestration). |
| 4 | Source/destination = `TreasuryAccount` enum on `TreasuryEntry` (`CASH` \| `BANK` \| `CESAR`) + `INFLOW` / `OUTFLOW`. |
| 5 | Manual “transfers” were not supported; other domains create single legs (sale inflow, expense outflow, payable payment outflow, etc.). |
| 6 | Prior multi-leg patterns (sale + bank fee) are atomic in their domain services; no transfer pair existed. |
| 7 | Ordinary Treasury legs do **not** affect P&L (except `commission` on bank-fee OUTFLOWs). Transfer legs set `commission: null`. |
| 8 | Capital profit uses revenue − COGS − bank commissions; distributions are `InvestorDistribution` / Capital module — **not** Treasury CESAR movements. |
| 9 | Balances: BANK/CESAR = Σ INFLOW − Σ OUTFLOW (`amountMxn`); CASH = latest physical adjustment + subsequent MXN CASH movements. |
| 10 | Correction pattern = **soft-delete** (`deletedAt`), not compensating entries. |
| 11 | No frontend created two legs for transfers (none existed). |
| 12 | `TreasuryEntry.provenanceKey` is `@@unique([tenantId, provenanceKey])` — sufficient for paired idempotent legs. |
| 13 | Direct Prisma treasury writes exist inside domain services; AI bindings must not call Prisma for treasury. |

## Canonical definition

`TreasuryTransferService.register()` moves MXN liquidity:

```
sourceAccount ≠ destinationAccount
amount > 0
currency = MXN (V1)
```

Creates **exactly two** `TreasuryEntry` rows in one Serializable transaction:

| Leg | direction | account | provenance |
|---|---|---|---|
| A | OUTFLOW | source | `treasury-transfer:<logicalKey>:outflow` |
| B | INFLOW | destination | `treasury-transfer:<logicalKey>:inflow` |

`logicalKey` = `registerIdempotencyKey` when provided, else generated `tt_<uuid>`.

Return: `{ transferId, outflowEntry, inflowEntry, replayed }`.

## Account matrix (V1)

| From / To | CASH | BANK | CESAR |
|---|---|---|---|
| **CASH** | no | yes | yes |
| **BANK** | yes | no | yes |
| **CESAR** | yes | yes | no |

No CRYPTO. No arbitrary strings.

## Cuenta César semantics (frozen)

`TreasuryAccount.CESAR` / “Cuenta César” is an **internal liquidity bucket**.

- `BANK → CESAR` via transfer = internal liquidity move.
- Partner / owner payout economics live in **Capital** (`InvestorDistribution`, account `CESAR_ACCOUNT` in Capital UI) and must **not** be disguised as treasury transfer.
- Transfer must never create `InvestorDistribution` / `CapitalDistribution`.
- Capital must never treat Treasury CESAR balance as a distribution event.

## Currency / date

- V1: **MXN only** (`amount` = `amountMxn`, `exchangeRate` null).
- Optional `transferDate` (defaults to now). Material date is part of idempotency conflict when explicitly supplied.
- Optional `notes` → `description` (or default “Transferencia X → Y”).

## Source balance policy (frozen)

**Allow negative Treasury account balances.**

Matches existing Treasury OUTFLOW behavior (expenses, payable payments, purchases): no insufficient-funds rejection.

Concurrency overspend of a source account is therefore **not** a correctness violation for V1. Documented explicitly; do not invent a balance gate in 22A/22B without product change.

## Atomicity

One `$transaction` (Serializable): create outflow then inflow. Failure after first leg rolls back. Never leave a single live leg.

## Total-liquidity invariant

For every allowed pair and amount X:

- source `amountMxn` −X (OUTFLOW)
- destination `amountMxn` +X (INFLOW)
- `CASH + BANK + CESAR` Δ0 (crypto portfolio excluded / unchanged)

## P&L / Capital proof

| Metric | Effect |
|---|---|
| Revenue / COGS | Δ0 |
| Treasury commissions | Δ0 (`commission` null) |
| OperatingExpense | Δ0 (no row) |
| netProfit | Δ0 |
| Capital totalBusinessProfit / ROI / distributions | Δ0 |
| AccountEntry / AccountPayment / Payment / Deal / Watch | Δ0 |

Cash-flow chart: `getCashFlow` **excludes** `provenanceKey startsWith 'treasury-transfer:'` so period inflows/outflows are not inflated by internal moves. Net liquidity KPIs still use balances (which include transfer legs correctly).

## Durable idempotency (no schema migration)

Schema gate: **NO migration** — `@@unique([tenantId, provenanceKey])` is enough.

Future AI key:

```
registerIdempotencyKey = ai-action-run:<actionRunId>
```

Legs:

```
treasury-transfer:ai-action-run:<actionRunId>:outflow
treasury-transfer:ai-action-run:<actionRunId>:inflow
```

Replay: same key + same source/destination/amount/(explicit date) → return existing pair `replayed: true`.  
Conflict: same key + different material payload.  
Reversed: same key → `STALE_TREASURY_TRANSFER_REVERSED` (no re-apply).  
Concurrent same key: P2002 / Serializable → converge to exactly two live legs.

## Recovery design (for 22B)

After EXECUTING crash, inspect both provenance keys:

| Case | Outcome |
|---|---|
| Both active legs | recover COMPLETED |
| Neither | still running / not executed |
| Only one | invariant failure (must not auto-heal by creating the missing leg blindly) |
| Both soft-deleted | reversed — do not re-apply |

## Reversal

`TreasuryTransferService.reverse(transferId)` soft-deletes **both** legs atomically. Second reverse is idempotent (`alreadyReversed`). No partial reverse in V1. Correct by reverse + new transfer. No independent single-leg delete/edit API for transfer provenance.

## History / read models

- History (sold watches / P&L summary) does not treat treasury legs as revenue/expense.
- Dashboard liquidity = sum of account balances (transfer-neutral).
- Admin Tesorería shows one logical transfer form (one API call).

## Permissions

Same as existing Treasury mutations: **`JwtAuthGuard` + tenant membership** (no extra role gate today). Future AI must inherit same or stricter.

## API

```
POST   /treasury/transfers
GET    /treasury/transfers/:transferId
POST   /treasury/transfers/:transferId/reverse
```

Manual UI: `apps/admin` → `/treasury` → `registerTreasuryTransfer()`.

## Future AI contract (22B — not implemented)

Capability: `REGISTER_TREASURY_TRANSFER` (still **unbound** after 22A).

Args: `sourceAccount`, `destinationAccount`, `amount`, optional `transferDate` / `notes`.  
Server-only: `registerIdempotencyKey = ai-action-run:<actionRunId>`.

Preview language must say transferencia / liquidez — never ingreso/gasto. Optional balances from `GET /treasury/balances` (server), no frontend math for authoritative after-balance.

## Executable writes after 22A

Still exactly **seven**:

1. REGISTER_SALE  
2. REGISTER_RECEIVABLE_PAYMENT  
3. REGISTER_EXPENSE  
4. REGISTER_PURCHASE  
5. CREATE_CLIENT  
6. UPDATE_CLIENT  
7. REGISTER_PAYABLE_PAYMENT  

Controlled Action Composition V1 graph **unchanged**.

## Schema gate

**No TYPE C migration required** for 22A.

## Production rollout

- Domain + Admin UI: TYPE A+B (backend + frontend).  
- Railway auto-deploy on merge (backend).  
- No Prisma migrate.  
- AI execution deferred to 22B.
