# REGISTER_EXPENSE — Write Binding (Commit 15B)

Status: **WRITE BOUND — confirmed execution enabled**
Canonical command: `ExpenseRegistrationService.register()`
AI binding: `RegisterExpenseWriteBinding` @ `1.0.0`
Idempotency: `OperatingExpense.registerIdempotencyKey = ai-action-run:<actionRunId>`

---

## Deployed 15A domain (prerequisite)

Atomic paid operating expense:

| Record | Role |
|---|---|
| `OperatingExpense` | P&L operating spend |
| `TreasuryEntry` OUTFLOW | Liquidity leave from CASH / BANK / CESAR |

Provenance: `operating-expense:<expenseId>:outflow`
MXN only. `BANK_FEES` rejected. Soft-delete reverse via Gastos.

Schema for idempotency / source / soft-delete is already live — **no Prisma migration in 15B**.

---

## Safety model

Claude interprets NL only. Expense writes require:

```
NL → REGISTER_EXPENSE → normalize/enrich → Planner
→ missing-field clarify if needed → READY_FOR_CONFIRMATION
→ authenticated Confirmar gasto → freshness/permission
→ WritePlanRunner → ExpenseRegistrationService.register()
→ BusinessActionResult → receipt → audit
```

No confirmation → **no expense**.
Duplicate confirm → **one** economic expense (durable idempotency).
Post-commit runtime failure → recover from `OperatingExpense.registerIdempotencyKey`.

---

## Category semantics (V1 allowlist)

| Enum | Language examples |
|---|---|
| `GASOLINE` | gasolina |
| `TOLLS` | casetas |
| `WATCHMAKER` | relojero |
| `PARKING` | estacionamiento |
| `MEALS` | comida / restaurante (business context) |
| `FLIGHTS` | vuelo / boleto de avión |
| `TRAVEL` | viaje / hotel de viaje / viáticos |
| `MARKETING` | marketing / publicidad |
| `COMMISSIONS` | comisión de ventas / agente — **not** bank fees |
| `OTHER` | catch-all with visible concept |

**No `RENT` enum.** “Renta” → `OTHER` + concept `Renta` (preview shows Categoría: Otro, Concepto: Renta).

Bank-fee phrases → **unsupported** (do not map to `COMMISSIONS` / OpEx).

Deterministic resolver: `expense-category-resolver.ts` (not LLM confidence).

---

## Source / date / currency

| Field | Policy |
|---|---|
| Source | `CASH` \| `BANK` \| `CESAR` — **no default**; ask “¿Desde dónde lo pagaste?” |
| Date | Defaults to today (manual Gastos policy); preview **must** show fecha |
| Currency | **MXN only** — USD/crypto clarify / reject; no FX |

Inflows (“me depositaron”, “me pagaron”, “recibí”) are **not** expenses.

---

## Non-expense boundaries

| Utterance | Intent |
|---|---|
| Compré Rolex… | `REGISTER_PURCHASE` |
| José me pagó… | `REGISTER_RECEIVABLE_PAYMENT` |
| Le pagué a Pepe… | payment / APPLY_TO_PAYABLE |
| Compré USDT… | `REGISTER_CRYPTO_POSITION` |
| Transferí bancos↔efectivo | transfer — not expense |
| Retiré utilidad para César | capital — not expense |
| Comisión bancaria | unsupported bank fee |

No generic `CASH_OUT` intent.

---

## Confirmation lifecycle

1. Preview with deterministic effects (Gastos +, Treasury −, utilidad neta −, Capital unchanged)
2. Primary CTA: **Confirmar gasto** → `POST /api/ai/action-runs/:id/confirm` only
3. Never `POST /expenses` from Assistant
4. Double-tap disabled while pending; network retry = same ActionRun

---

## Idempotency + recovery

Marker: `ai-action-run:<actionRunId>` on `OperatingExpense` (server-derived only).

Post-commit crash (`EXECUTING` + domain committed):

1. Lookup expense by tenant + key
2. Replay via `ExpenseRegistrationService.register()` (compatible payload)
3. Verify Treasury provenance `operating-expense:<id>:outflow`
4. Missing OUTFLOW → **invariant failure** (no silent success, no second movement)
5. Finalize ActionRun `COMPLETED` + true success receipt

---

## BusinessActionResult / receipt

```
executionState: EXECUTED
affectedEntities: OPERATING_EXPENSE CREATED + TREASURY_ENTRY OUTFLOW
receipt: expenseId, amount, currency, category, concept, sourceAccount, expenseDate
rollbackPossible: false  // conversational reverse not implemented; correct in Gastos
```

---

## Capital semantics (unchanged)

| Surface | Profit definition |
|---|---|
| Dashboard / Analytics / OI | **Net** of Gastos |
| Capital | Historical **gross** trading profit (no OpEx) |

Expense preview/receipt must not describe Capital as net business profit.

---

## Correction

Manual: Gastos soft-delete reverse (canonical 15A).
Receipt links: Ver gastos / Corregir en Gastos.

---

## Permission

Same V1 as manual Gastos: JWT + tenant membership.
Future granular expense permission = separate hardening.

---

## Executable writes after 15B

| Capability | Status |
|---|---|
| `REGISTER_SALE` | WRITE bound |
| `REGISTER_RECEIVABLE_PAYMENT` | WRITE bound |
| `REGISTER_EXPENSE` | **WRITE bound** |
| `REGISTER_PURCHASE` | unbound |
| `REGISTER_SETTLEMENT` | unbound |
| `REGISTER_CRYPTO_*` | unbound |

---

## Rollout

1. Merge 15B after quality gates (no schema migrate)
2. DEMO QA: CASH/BANK/CESAR expense, rent/OTHER, missing source, USD reject, bank fee unsupported, double confirm, recovery
3. WC smoke: one small DEMO-like expense path; Capital formula unchanged
4. Monitor ActionRun COMPLETED + OperatingExpense idempotency uniqueness

Future: `CAPITAL_OPEX_RECONCILIATION` backlog if partners want OpEx in Capital.
