# Structured Assistant Orchestrator

## Purpose

The Structured Assistant Orchestrator is the authenticated, tenant-scoped entry point for deterministic assistant interactions. It accepts structured business intent and entities, coordinates existing AI runtime components, and returns a fixed typed response. It does not parse natural language, call an AI provider, select tools, or mutate business data.

The flow is:

`StructuredAssistantRequest → AIRequest claim → conversation/workspace checkpoint → PlannerService → clarification, read execution, or write preview → response persistence`

The orchestrator depends on `PlannerService`, `ReadPlanRunner`, `AIRequestService`, and a persistence boundary. It does not import Prisma, the Tool Registry, capability bindings, or canonical domain services.

## Request contract

`POST /api/ai/assistant/structured` accepts a JWT-authenticated `StructuredAssistantRequest` with:

- optional `conversationId` and `workspaceId`;
- one of the twelve allowlisted `intent` values;
- structured `entities` and optional `entityVersions`;
- optional `expectedWorkspaceVersion`;
- `surface`, optional `locale` and `timezone`;
- required `clientRequestId`;
- optional `userDisplayText`, used only as message display content and never parsed.

There is no prompt, raw capability name, tool name, or provider field. DTO limits bound identifiers and display text. The platform JSON body limit remains an additional request-size boundary.

## Response contract

Every response contains request, conversation, workspace, optional action-run, trace, and creation identifiers plus one interaction state and one response type. Approved response types are:

- `TEXT_ANSWER`
- `METRIC_CARD`
- `METRIC_BREAKDOWN`
- `ENTITY_LIST`
- `ENTITY_PICKER`
- `MISSING_FIELDS_CARD`
- `ACTION_PREVIEW_CARD`
- `SUCCESS_RECEIPT`
- `ERROR_RECOVERY_CARD`

Payloads are JSON only. HTML, arbitrary component names, and model-generated UI are prohibited.

## Lifecycle and transaction boundaries

The request lifecycle is deterministic: `RECEIVED → VALIDATING → PLANNING`, followed by one of `NEEDS_CLARIFICATION`, `READY_FOR_CONFIRMATION`, `EXECUTING → COMPLETED`, or `FAILED`.

Transactions are deliberately checkpointed:

1. Claim `AIRequest` and emit the received audit event.
2. Resolve/create conversation and workspace, append the user message, and mark planning.
3. Persist `AIActionRun` and workspace planning state.
4. Execute a Tier 0 read outside a long database transaction.
5. Persist the exact response, assistant message, workspace state, response hash, and terminal audit event atomically.

Messages and audit events remain append-only. No transaction is held open around canonical read services.

## Clarification path

Missing required entities produce a grouped `MISSING_FIELDS_CARD`. The action run becomes `NEEDS_CLARIFICATION`; the workspace keeps the active run, draft entities, selected/resolved context, and pending typed response. No read plan executes. Replaying the same request returns the stored clarification exactly.

## Tier 0 read execution

Only five actions execute:

- `GET_LIQUIDITY`
- `GET_MONTHLY_PROFIT`
- `SEARCH_INVENTORY`
- `SEARCH_CLIENT`
- `GET_CLIENT_ACCOUNTS`

The planner emits capability plans. `ReadPlanRunner` validates fingerprint and version snapshots, and the existing static Capability Binding Layer invokes the corresponding read-only tool through canonical services. Liquidity and monthly profit map to `METRIC_BREAKDOWN`; inventory, clients, and accounts map to `ENTITY_LIST`. A single search result is never auto-selected. Decimal values remain serialized strings from the existing tool contract. `ToolContext.now` is the durable request receipt time.

## Write-action behavior

The seven write-oriented actions may be planned and clarified but are never executed. A complete write plan returns `ACTION_PREVIEW_CARD` with the explicit notice:

> Esta acción todavía no está habilitada para ejecución desde el asistente.

The orchestrator never asks the binding registry to resolve these capabilities and contains no write binding or business mutation path.

## Durable AIRequest idempotency

`AIActionRun` is insufficient for request idempotency because requests can clarify, fail validation, or terminate before an action run exists. `AIRequest` therefore owns one full assistant submission.

The database uniqueness boundary is `(tenantId, actorUserId, clientRequestId)`. Creation is the atomic claim. A unique-key collision loads the existing record and compares its canonical request fingerprint:

- matching fingerprint plus terminal response returns the exact stored payload after verifying its SHA-256 hash;
- a different fingerprint returns HTTP 409 with a deterministic Spanish conflict message;
- matching in-progress work returns a typed `REQUEST_IN_PROGRESS` response and never starts duplicate orchestration.

The fingerprint uses canonical JSON and SHA-256 over tenant, actor, intent, canonical entities, entity versions, expected workspace version, surface, locale, timezone, conversation ID, and workspace ID. Server timestamps, trace IDs, client request ID, display formatting, bindings, and tool versions are excluded. Sensitive search/name/contact-like entity values are represented by stable hashes in the durable canonical payload.

`responsePayload` stores the exact response and `responseHash` stores its canonical SHA-256. Replay never regenerates a response, appends a message, creates a run, updates a workspace, or invokes a tool.

## Concurrency and crash recovery

The unique constraint elects exactly one owner under concurrent requests. Non-owning requests do not poll or execute; they receive the same request ID and an in-progress response.

V1 uses the request row's `updatedAt` as a lightweight processing lease with a five-minute stale threshold. A duplicate observation after that threshold atomically changes the unchanged checkpoint to `FAILED`, stores a replayable recovery response, and emits one sanitized failure event. It does not resume execution or create duplicate records. The client must send a new `clientRequestId` after reviewing current workspace state. This keeps interrupted work observable without a background worker.

## Conversation, workspace, and messages

Existing conversation/workspace references must belong to the authenticated tenant and actor and must not be soft-deleted. Missing records are created. Workspace changes use version-checked updates. A stale expected version fails safely. The user message is appended once using `userDisplayText` or a deterministic intent summary. The assistant message contains the exact typed response. Conversation history is never reset or overwritten when workspace state changes.

## Error mapping

- missing, inaccessible, cross-tenant, or soft-deleted conversation/workspace → HTTP 404 with the same `FAILED / NOT_FOUND` recovery card;
- stale workspace or fingerprint state → HTTP 409 with `STALE_PLAN / ERROR_RECOVERY_CARD`;
- permission denial → HTTP 403 with `PERMISSION_BLOCKED`;
- missing entities → `NEEDS_INPUT` / `MISSING_FIELDS_CARD`;
- read or unexpected internal failure → HTTP 500 with `FAILED / ERROR_RECOVERY_CARD`;
- unsupported write execution → `READY_FOR_CONFIRMATION` / `ACTION_PREVIEW_CARD`;
- request-ID reuse with different content → HTTP 409.

Every typed failure states what happened, confirms that no business data changed, and identifies the next safe action.

The endpoint retains Nest's current HTTP 201 contract for successful new reads, exact successful replays, clarification cards, and non-executing write previews. DTO validation remains HTTP 400 and unauthenticated requests remain HTTP 401. HTTP status is derived at the controller boundary from stable typed failure codes or interaction states; message text is never parsed. Missing and inaccessible resources deliberately share the same external 404 response and reveal no ownership or tenant information.

## Audit and security

Immutable request events contain bounded trusted identifiers: AI request ID, hashed client request ID where applicable, request fingerprint, response hash, status, intent, conversation/workspace/action IDs, trace ID, and failure type. They do not contain raw request/response payloads, user display text, search strings, phone numbers, emails, customer/account payloads, complete tool results, or raw failure messages.

JWT authentication supplies tenant and actor identity. Conversation and workspace resolution additionally enforces actor ownership. Tenant membership and canonical read permissions remain enforced by the existing binding/tool/domain layers; orchestration cannot broaden them.

## Future boundaries

The future LLM will only produce `StructuredAssistantRequest`-compatible intent/entity output. The LLM will not bypass the orchestrator.

A future mobile assistant UI may render the approved response types. It will not receive arbitrary components, tools, or direct business-service access.

## Deployment and rollback

This is a TYPE C, API-only deployment. Apply migration `20260806210000_ai_structured_assistant_orchestrator` before deploying the API, then generate Prisma Client through the normal Railway build. No frontend deployment is required.

The migration is additive and has no business-data backfill. Rollback requires first rolling back the API, then dropping `ai_requests`, its indexes and foreign keys, and finally removing the new enum values/types through a controlled PostgreSQL enum-replacement migration. Existing AI runtime and business rows are not transformed.
