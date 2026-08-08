# Assistant Telemetry (Commit 16)

Passive observability for the WristOS Assistant.

## Guarantees

- Telemetry is **append-only** and **best-effort**.
- Production Assistant behavior does **not** read telemetry.
- If telemetry is disabled (`ASSISTANT_TELEMETRY_DISABLED=true`) or the module is removed, the Assistant behaves identically.
- No Prisma schema / migrations. Storage is in-memory (per API replica) with optional JSONL via `ASSISTANT_TELEMETRY_PATH`.
- Never stores prompts, provider payloads, secrets, JWTs, or business payloads.

## Module

`apps/api/src/modules/ai/telemetry`

Emitters only: Structured Assistant, NL Assistant, Intent Adapter, WritePlanRunner, AI cancel route.

## Dashboard

Admin: `/platform/assistant-health` → `GET /api/ai/telemetry/health`

## Evaluation

```bash
pnpm assistant:evaluate
ASSISTANT_EVAL_PROVIDER=claude pnpm assistant:evaluate
```

Reports accuracy, clarification rate, unknown rate, latency, and optional regression deltas vs a baseline.
