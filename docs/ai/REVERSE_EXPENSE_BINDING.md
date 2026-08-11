# REVERSE_EXPENSE Binding (Commit 26C — WRITE #13)

First conversational financial reversal.

## Capability

- **Id:** `REVERSE_EXPENSE`
- **Mode:** WRITE
- **Version:** `1.0.0`
- **Binding:** `ReverseExpenseWriteBinding`
- **Risk:** HIGH
- **Confirm:** `POST /api/ai/action-runs/:id/confirm` only

## 26C.1 Hardening

### Last-action NL (deterministic)

Server-side `detectExpenseCorrectionLanguage` runs in `NaturalLanguageAssistantService`
**before** pure deictic `"eso"` selection and before Anthropic.

High-confidence phrases such as `Deshaz eso.` / `Reviértelo` force:

`REVERSE_EXPENSE` + `{ useLastAction: true }`

Provider `useLastAction` remains assistive, not required.

Transfer/client/watch cancel language is blocked from becoming REVERSE_EXPENSE.

### Economic classification

| Class | Evidence | Behavior |
|-------|----------|----------|
| `LEGACY_VALID` | No `operating-expense:<id>:outflow` provenance row ever | OpEx-only reverse; Tesorería Sin cambios |
| `CANONICAL_VALID` | Active coherent OUTFLOW provenance | Restore source liquidity |
| `CANONICAL_INVARIANT` | Provenance exists but soft-deleted/malformed while expense active | Fail closed — no preview, no mutation |

Never: “no active outflow ⇒ legacy”.

## Domain

Calls only:

```ts
ExpenseRegistrationService.reverse(tenantId, trustedExpenseId, {
  reversalIdempotencyKey: `ai-action-run:${actionRunId}`,
})
```

No Prisma mutation in the binding. No direct Treasury mutation. No generic reversal service.

## Target resolution (trusted only)

| Source | Behavior |
|--------|----------|
| Last reversible action | Same conversation + workspace, ≤2h, Expense target |
| Selected / picker | Working-context ordinal → trusted expense id |
| Deterministic search | amount / category / date / source / conceptContains |

Never trusts provider `expenseId`, raw DB ids from the prompt, amount-only silent match, or global latest expense.

## Preview semantics

- **Canonical valid**: restores liquidity; preview shows account `+$amount`
- **Legacy valid**: Treasury Δ0 — never claims cash restore
- **Canonical invariant**: non-executable; natural incomplete-state copy

## Causality (26B)

| Case | Result |
|------|--------|
| SAME_COMMAND | Recover COMPLETED, recovered=true |
| EXTERNAL | STALE / already reversed — no success |
| Fingerprint drift | STALE_PLAN |
| Missing target | Non-success |
| Canonical invariant | REVERSAL_INVARIANT |

## Still unbound

`REVERSE_TREASURY_TRANSFER` and all other reversals.

## Composition

Unchanged: only `PURCHASE_SELLER` / `SALE_CUSTOMER` → `CREATE_CLIENT`.

## Schema

No migration. Uses live `OperatingExpense.reversalIdempotencyKey` and Treasury provenance history (including soft-deleted legs) for positive canonical identity.
