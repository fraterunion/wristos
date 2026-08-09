# Controlled Action Composition V1

## Product goal

Preserve the operator’s original business task when a required Client dependency is missing, without autonomous multi-write execution.

Example:

> “Compré un Daytona a Pepe por 300 mil a crédito.”

If Pepe is not in CRM:

1. Pause `REGISTER_PURCHASE` draft (durable)
2. Offer explicit `CREATE_CLIENT` (or choose existing / cancel)
3. After Client is confirmed **or** an existing Client is chosen → rebuild purchase preview
4. Require a **second** explicit confirmation for `REGISTER_PURCHASE`

## Closed composition graph

Allowlisted edges only (hardcoded):

| Parent | Dependency reason | Child |
|--------|-------------------|-------|
| `REGISTER_PURCHASE` | `PURCHASE_SELLER` | `CREATE_CLIENT` |
| `REGISTER_SALE` | `SALE_CUSTOMER` | `CREATE_CLIENT` |

Max depth: **1** (one dependency write, then resume parent).

Not composed:

- `REGISTER_RECEIVABLE_PAYMENT` → creating a Client does not create a receivable; refuse
- `REGISTER_EXPENSE`, `UPDATE_CLIENT`, settlements, crypto, delete/restore
- Arbitrary `Action A → Action B`
- Recursive composition (`CREATE_CLIENT` cannot request another write dependency)

## State machine (conceptual)

```
PRIMARY_DRAFT
  → DEPENDENCY_REQUIRED
  → DEPENDENCY_PREVIEW          (CREATE_CLIENT ActionRun ready)
  → DEPENDENCY_EXECUTING
  → DEPENDENCY_COMPLETED        (trusted clientId bound)
  → PRIMARY_RESUMING
  → PRIMARY_NEEDS_INPUT | PRIMARY_READY_FOR_CONFIRMATION
  → PRIMARY_EXECUTING
  → PRIMARY_COMPLETED
```

Cancellation:

- Cancel before / during dependency preview → no Client created; composition cancelled
- Cancel parent after Client created → Client remains (no automatic undo)

## Separate confirmation invariant

**One confirmation → at most one business mutation capability.**

- “Crear cliente” executes only `CREATE_CLIENT`
- “Confirmar compra/venta” executes only the parent write

No user/provider instruction can authorize both in one confirm.

## Parent draft persistence

Stored in `AIWorkspace.resolvedContext.composition` (JSON, schemaVersion `1.0`):

- Bounded structured draft fields (watch identity, cost, payment mode, queries, …)
- **No** raw transcript as execution state
- **No** provider-claimed `clientId` / `sellerClientId` / `customerId` parked as trusted
- `parentDraftHash` for stale-draft fail-closed checks

## Dependency descriptor

```json
{
  "type": "CLIENT",
  "reason": "PURCHASE_SELLER | SALE_CUSTOMER",
  "query": "Pepe",
  "requiredByCapability": "REGISTER_PURCHASE | REGISTER_SALE"
}
```

## Child ActionRun

Normal `CREATE_CLIENT` path:

preview → confirmation → `WritePlanRunner` → `ClientRegistrationService`

No AI-specific bypass. Duplicate / deleted / probable-duplicate flows unchanged.

## Trusted Client handoff

After child success (or use-existing):

1. Re-verify Client is live in tenant
2. Persist `resolvedClientId` + label + kind (`CLIENT_CREATED` | `CLIENT_REUSED`)
3. Inject into parent draft (`sellerClientId` or `customerId`)
4. Re-plan parent → new parent ActionRun (capability never mutates mid-lifecycle)

Provider never chooses the resulting ID.

## REGISTER_RECEIVABLE_PAYMENT (negative)

If the user says “José me pagó 50 mil” and José does not exist:

**Do not** spawn `CREATE_CLIENT`. A new Client has no CXC. Composition is not allowlisted for payment.

## Persistence / activeActionRunId

- Prefer **no Prisma migration** — composition lives in workspace JSON
- While child is active: `activeActionRunId` = child ActionRun
- Parent draft paused in `resolvedContext.composition`
- After resume: `activeActionRunId` = new parent ActionRun; composition cleared
- Survives API restart, refresh, reconnect, replay

## Crash recovery

1. Child commit + runtime crash → existing CREATE_CLIENT recovery
2. Child COMPLETED, parent not resumed → next request recovers: bind trusted id, resume parent once
3. Parent preview crash → normal ActionRun replay

## Partial completion

Create Client succeeds, purchase later fails/cancels:

> “El cliente quedó creado, pero todavía no registré la compra.”

No cross-domain saga / compensation. Two separate business transactions.

## Security / threat model

Fail closed on:

- Prompt injection to skip second confirmation
- “créalo y compra todo sin preguntarme”
- Provider-fabricated dependency result / clientId
- Cross-tenant child/parent ActionRuns
- Stale parent draft hash mismatch
- Duplicate resume / circular dependency / arbitrary chaining

Each ActionRun independently re-checks tenant, membership, fingerprint, freshness, capability binding.

## Telemetry

Passive only (hashes / reasons / funnel). No PII. Runtime does not depend on telemetry.

## Future expansion gates

New edges require a new commit, allowlist update, confirmation-boundary tests, and product review. No generic tool graph.
