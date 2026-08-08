# Assistant Telemetry (Commit 16 — Durable)

Passive observability for the WristOS Assistant.

## Production source of truth

**Durable shared tables (Neon/Postgres via Prisma):**

- `AIRequest` — request funnel unit (terminal exactly once)
- `AIActionRun` — action-run / capability-attempt funnel (terminal exactly once)
- `AIAuditEvent` — immutable timeline for derivation

**NOT production durable stores:**

- In-memory ring buffer — tests / short-lived debug only
- Local JSONL — **OFF by default**; requires `ASSISTANT_TELEMETRY_JSONL=true` and `NODE_ENV!==production`. Never assume durable on Railway.

## Guarantees

- Telemetry is observational. Persistence failure never fails a user request.
- Production Assistant behavior does **not** read telemetry for decisions.
- Planner / bindings / providers never read telemetry.
- No Prisma migration required for V1 (reuses existing Json payloads + audit types).
- Conversations are resumable and are **not** forced to a single final outcome.

## Signal classification

| Signal | Class | Source |
|---|---|---|
| Request received/completed/failed/replayed | A durable | AIRequest + ASSISTANT_REQUEST_* |
| PreviewShown | B derived | PLAN_READY_FOR_CONFIRMATION / READY_FOR_CONFIRMATION |
| PreviewConfirmed | B derived | PLAN_CONFIRMED / confirmedAt |
| Execution* | B derived | EXECUTION_* + ActionRun timestamps |
| ClarificationShown | B derived | PLAN_NEEDS_CLARIFICATION / NEEDS_CLARIFICATION |
| ClarificationAbandoned | B derived (query-time) | awaiting clarification ≥ 24h observation window |
| Explicit cancel | A durable | ActionRun CANCELLED / EXECUTION_CANCELLED |
| Provider latency/model/tokens | C via existing Json | `AIRequest.requestPayload.providerMetrics` |
| Planner latency | C via existing Json | `PLAN_CREATED.payload.plannerLatencyMs` |
| Binding / SQL latency | omitted V1 | not instrumented (no fake precision) |
| PreviewEdited | missing | no edit API yet |
| ConversationFinished | N/A | conversations stay open/resumable |

## Funnel denominators

Capability / ActionRun attempt:

intent → preview → confirmation → execution → receipt → completed

Denominators are **requests** or **action runs**, never “conversations”.

## Abandonment

- **Explicit cancel** = ActionRun `CANCELLED`
- **Inferred abandonment** = clarification awaiting + no terminal progress for ≥ 24h (analytics only, query-time)

Never write permanent ABANDONED when a response merely awaits input.

## Intent quality stages

1. Provider candidate intent (from adapter)
2. Policy decision (`PROCEED` / clarify / reject)
3. Final BusinessAction on structured plan (`AIRequest` / `AIActionRun.intent`)

`normalizedIntent` is format cleanup of provider entities — not a separate semantic intent stage.

## Access

`GET /api/ai/telemetry/health` — **PLATFORM_ADMIN** only (`PlatformAdminGuard`).

Default scope: **platform global**. Optional `?tenantId=` filter. Response exposes `tenantFilterHash` only (no raw tenant ids in leaderboards).

Admin UI: `/platform/assistant-health` (same gate via API 403 for non-admins).

## Windows

`?window=today|7d|30d` (default `7d`) — queried from durable shared data.

## Retention

No dedicated retention job. Reuses AI audit/request retention assumptions (currently unbounded). Future: `TELEMETRY_RETENTION_POLICY`.

## Evaluation (offline, separate from production telemetry)

```bash
pnpm assistant:evaluate
ASSISTANT_EVAL_PROVIDER=claude pnpm assistant:evaluate
```

Prompt regression deltas are available when a baseline file/object is passed to the runner.
**CI does not automatically enforce** prompt regression on every prompt change in V1 — run the command manually (or wire CI later).

Never silently exports production conversation text into eval datasets.

## Env

| Var | Meaning |
|---|---|
| `ASSISTANT_TELEMETRY_DISABLED=true` | Disable ephemeral emit sink |
| `ASSISTANT_TELEMETRY_JSONL=true` | Allow local JSONL (non-production only) |
| `ASSISTANT_TELEMETRY_PATH` | JSONL path when JSONL allowed |
| `PLATFORM_ADMIN_EMAILS` / `PLATFORM_ADMIN_USER_IDS` | Health dashboard access |
