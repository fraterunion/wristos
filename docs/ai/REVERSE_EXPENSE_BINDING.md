# REVERSE_EXPENSE Binding (Commit 26C — WRITE #13)

First conversational financial reversal.

## Capability

- **Id:** `REVERSE_EXPENSE`
- **Mode:** WRITE
- **Version:** `1.0.0`
- **Binding:** `ReverseExpenseWriteBinding`
- **Risk:** HIGH
- **Confirm:** `POST /api/ai/action-runs/:id/confirm` only

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

- **Canonical** (Treasury OUTFLOW present): restores liquidity; preview shows account `+$amount`
- **Legacy** (expense-only): Treasury Δ0 — never claims cash restore

## Causality (26B)

| Case | Result |
|------|--------|
| SAME_COMMAND | Recover COMPLETED, recovered=true |
| EXTERNAL | STALE / already reversed — no success |
| Fingerprint drift | STALE_PLAN |
| Missing target | Non-success |

## Still unbound

`REVERSE_TREASURY_TRANSFER` and all other reversals.

## Composition

Unchanged: only `PURCHASE_SELLER` / `SALE_CUSTOMER` → `CREATE_CLIENT`.

## Schema

No migration. Uses live `OperatingExpense.reversalIdempotencyKey`.
