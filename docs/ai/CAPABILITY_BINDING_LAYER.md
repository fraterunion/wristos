# Read-Only Capability Binding Layer

## Architecture

The isolated binding layer connects an already-built `BusinessExecutionPlan` to approved read-only tools:

`StructuredIntent → Business Planner → BusinessExecutionPlan → Capability Binding Layer → ToolExecutionService → Canonical Domain Services`

The planner remains tool-agnostic. No binding definition, tool name, tool version, or adapter is serialized into a business plan, preview, action definition, or planner fingerprint. **Changing a binding does not change the business plan fingerprint.**

## Binding contract and registry

`CapabilityBindingDefinition` declares a business capability, binding version, `READ` mode, statically selected tool name/version, strict input mapper, and deterministic output mapper. `CapabilityBindingRegistry` is a construction-time allowlist: it has no registration API, accepts no user-supplied tool name, and validates each target against `ToolRegistry` during construction.

V1 contains exactly five bindings:

| Business capability | Approved tool |
|---|---|
| `GET_LIQUIDITY` | `get_liquidity@1.0.0` |
| `GET_MONTHLY_PROFIT` | `get_monthly_profit@1.0.0` |
| `SEARCH_INVENTORY` | `search_inventory@1.0.0` |
| `SEARCH_CLIENT` | `search_clients@1.0.0` |
| `GET_CLIENT_ACCOUNTS` | `get_client_accounts@1.0.0` |

All seven write-oriented capabilities remain explicitly unbound.

## Input and output mapping

Each mapper uses a strict schema. Missing required values and unknown arguments fail closed before tool execution. Values are passed without floating-point conversion or date reinterpretation. `CapabilityResult` represents one bound read execution and is distinct from the inert action-level `BusinessActionResult`.

## ReadPlanRunner

`ReadPlanRunner` accepts an existing business plan and:

1. requires `READY_FOR_CONFIRMATION` planner state and Tier 0 (`NONE`);
2. revalidates workspace version, entity versions, expected fingerprint, and plan integrity;
3. rejects any unbound or non-read capability before execution;
4. verifies dependencies reference earlier steps;
5. executes steps in declared order through `CapabilityBindingService`;
6. returns a bounded `ReadPlanResult`.

Commit 5 supports deterministic dependency ordering with already-resolved step arguments. It does not implement JSONPath, evaluation, implicit selection, or arbitrary output threading. A dependency that cannot be resolved from earlier declared steps fails before execution.

## Confirmation and security

Only Tier 0 plans may run. The layer never downgrades confirmation. Write, mixed, unbound, and forged capabilities fail closed. Before resolving a binding, the service verifies an active membership for the authenticated `tenantId` and `userId`. It preserves the caller's ToolContext, permissions, tenant scope, actor identity, and deterministic clock.

There is no public or generic capability-execution HTTP endpoint.

## Runtime lifecycle and audit

When supplied an `actionRunId`, the runner reuses the existing AIActionRun lifecycle. A no-confirmation read run may move `DRAFT → EXECUTING → COMPLETED` or `FAILED`. The runtime stores only a bounded completion receipt containing the plan fingerprint, final state, and step count; it never stores full tool output.

No new audit enum was required. Existing immutable events provide the audit trail:

- `TOOL_EXECUTION_STARTED`, `TOOL_EXECUTION_COMPLETED`, and existing tool failure/validation events come from `ToolExecutionService`;
- `EXECUTION_STARTED`, `EXECUTION_COMPLETED`, or `EXECUTION_FAILED` come from `RuntimeService` when an action run is used.

Audit metadata remains sanitized under the existing tool/runtime contracts. No raw customer search, PII, or full result payload is added by the binding layer.

Capability executions pass a typed, trusted audit context containing only `capability`, `bindingVersion`, `stepId`, and `planFingerprint`. `ToolExecutionService` combines those fields explicitly with its own trusted `toolName`, `toolVersion`, `traceId`, duration, fingerprints/hashes, bounded summary, and `failureType`. It never spreads plan arguments or caller-provided metadata into audit payloads. Direct non-binding tool calls may omit this context and retain their existing behavior.

## Failure, retries, and idempotency

Preflight failures throw before runtime or tool execution. After runtime execution begins, a step failure returns `FAILED` or `PARTIALLY_COMPLETED` and transitions the existing action run to `FAILED`. Retrying the same terminal action run fails closed under the existing state machine. Read calls without an action run are safe to repeat but create independent immutable tool audit events; orchestration requiring single-run semantics must supply the persisted action-run ID.

## Versioning and future write bindings

Binding versions describe binding behavior only and do not enter planner fingerprints. A future write-binding commit must add separate authorization, confirmation, idempotency, rollback, audit, and domain-mutation controls. It must not weaken the planner boundary or reuse this read-only allowlist implicitly.

## Deployment classification

TYPE B: API-only code, no Prisma schema change or migration, and no frontend deployment.
