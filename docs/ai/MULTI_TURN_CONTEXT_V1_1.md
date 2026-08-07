# Multi-Turn Conversational Context V1.1

This is **structured working memory**, not autonomous long-term AI memory.

## Memory philosophy

- `AIWorkspace` is the canonical structured working memory.
- The LLM is **not** the memory system.
- Do **not** send full raw conversation history to Claude.
- The provider receives only a small, sanitized, structured context derived deterministically from `AIWorkspace`.

Canonical flow:

```
Conversation state
→ deterministic workspace context (AssistantWorkingContext)
→ bounded LLM context (labels/ordinals only)
→ intent candidate
→ deterministic reference validation
→ existing orchestrator
```

## Schema gate

V1.1 uses existing `AIWorkspace` JSON fields — **no Prisma migration**:

| Field | Role |
| --- | --- |
| `resolvedContext.workingContext` | Typed `AssistantWorkingContext` (schemaVersion `1.1`) |
| `selectedEntities` | Mirror of last selection (audit-safe) |
| `pendingResponse` / `draftPayload` | Unchanged planner/orchestrator state |
| `version` / `expectedVersion` | Optimistic concurrency |

## Trusted vs untrusted

**Trusted sources** (may write entity IDs into working context):

- Validated tool / ENTITY_LIST results
- Validated orchestrator responses
- Explicit UI selection via structured assistant entities
- Planner-resolved / reference-resolved IDs already returned by domain services

**Untrusted** (never become entity IDs):

- Raw LLM output entity `*Id` fields
- Free-form user text claiming IDs (“use client id abc123”)
- Spoofed ordinal+id pairs in user text

`stripUntrustedEntityIds` removes all `*Id` keys from LLM entity bags before merge.
`ReferenceResolverService` is the only path that maps ordinals/deictics → trusted IDs.

## Candidate presentation

When SEARCH_CLIENT / SEARCH_INVENTORY returns `ENTITY_LIST`, the server stores:

```ts
lastPresentedCandidates = {
  type: 'CLIENT' | 'WATCH' | 'ACCOUNT_ENTRY',
  candidates: [{ ordinal, id, label }, ...],
  presentedAt: ISO
}
```

IDs stay server-side. The provider sees ordinals + labels only.

## Ordinal resolution

Spanish: primero/primera, segundo/segunda, tercero/tercera, último/última.

Rules:

1. Candidate list must exist in working context
2. Must be fresh (see expiry)
3. Ordinal must exist in the list
4. Optional entity-type compatibility

Invalid → clarification (“Necesito que elijas nuevamente.”). No guessing.

## Deictic resolution

ese / esa / él / ella / el mismo / la misma / ese cliente / ese reloj / esa cuenta

1. Prefer `lastSelectedEntity`
2. Else exactly one `lastPresentedCandidates` entry (`SINGLE_PRESENTED`)
3. Else clarification — never silently pick among many

## Selected entity behavior

- Pure “El primero.” updates `lastSelectedEntity` + `lastResolvedEntities` without calling the LLM.
- Chip taps (`GET_CLIENT_ACCOUNTS` with `clientId`) update selection through the structured orchestrator path.
- “Ahora sus cuentas.” short-circuits to `GET_CLIENT_ACCOUNTS` with trusted `clientId`.

## Context expiry

Conservative V1 policy:

| Context | Lifetime |
| --- | --- |
| `lastPresentedCandidates` | 30 minutes from `presentedAt`, or until replaced by a newer list |
| `lastSelectedEntity` / `lastResolvedEntities` | Survive within the active workspace until reset or overwritten |
| Workspace reset | Clears `resolvedContext` entirely (referential context gone) |

Same workspace/conversation only — no cross-workspace references.

## Concurrency

All workspace writes use optimistic locking (`version` / `expectedVersion`).

- Stale version → `409` / STALE_PLAN semantics
- `checkpointPlan` **merges** plan fingerprint into `resolvedContext` without wiping `workingContext`
- Replay of an identical `clientRequestId`+text does **not** re-mutate context (durable AIRequest claim)

## Provider context minimization

Provider receives only:

- `previousIntent` / `lastIntent`
- `selectedEntity: { type, label }`
- `presentedCandidates: [{ ordinal, type, label }]`
- `pendingMissingFields`
- `conversationLanguage`

Trusted IDs are **not** sent to Claude. Post-processing maps ordinal/reference → ID.

## Reference schema

```ts
reference?: {
  kind: 'ORDINAL' | 'LAST_SELECTED' | 'SINGLE_PRESENTED' | 'SAME_ENTITY'
  ordinal?: 1..10
  position?: 'LAST'
  entityType?: 'WATCH' | 'CLIENT' | 'ACCOUNT_ENTRY'
}
```

No arbitrary IDs inside `reference`.

## Write-preview support

Context may supply a trusted `watchId` / `customerId` so `REGISTER_SALE` can reach planner preview / clarification.

- No write capability binding
- No write execution
- Preview-only remains the hard gate

## Audit

Sanitized fields only:

- `contextSchemaVersion`, `referenceKind`, `entityType`, `ordinal`
- `contextVersion`, `resolutionResult`, `resolvedEntityHash`, `contextAgeMs`, `failureType`

Never audit: full candidate objects, PII, raw conversation, raw user text, raw IDs (hash only).

## Known limitations

- No long-term autonomous memory across workspaces
- No fuzzy name reconstruction of prior turns
- Candidate TTL is wall-clock (30m); activity versioning is separate via workspace `version`
- Inventory lists are not choice chips in the UI today; ordinal references still work server-side when candidates were stored
- Live Claude evaluation remains optional/gated

## Confirmation

V1.1 does **not** introduce:

- Long-term autonomous AI memory
- Write execution
- Tool / capability bypass
- Raw conversation history to the provider
- Business-table mutation via the assistant path
