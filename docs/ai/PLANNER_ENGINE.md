# Deterministic Business Planner

## Architecture

The planner accepts only a `StructuredIntent` containing a business-action identifier and structured entities. It is completely tool-agnostic: it never receives raw language, parses natural language, references implementation registries or adapters, executes capabilities, or writes business data.

The lifecycle is:

`StructuredIntent → BusinessActionCatalog → entity validation → clarification or warnings → confirmation preview → BusinessExecutionPlan → future Capability Binding Layer`

## Business actions

`BusinessActionDefinition` is the stable boundary between intent and implementation. Each definition declares its identity, category, confirmation tier, required and optional entities, deterministic warning rules, preview builder, business planning strategy, required capabilities, and result schema.

The V1 catalog contains twelve statically constructed actions:

- Read actions: `GET_LIQUIDITY`, `GET_MONTHLY_PROFIT`, `SEARCH_INVENTORY`, `SEARCH_CLIENT`, `GET_CLIENT_ACCOUNTS`.
- Proposed write actions: `REGISTER_SALE`, `REGISTER_RECEIVABLE_PAYMENT`, `REGISTER_PURCHASE`, `REGISTER_EXPENSE`, `REGISTER_SETTLEMENT`, `REGISTER_CRYPTO_POSITION`, `REGISTER_CRYPTO_PRICE`.

Read and proposed write capabilities use the same business planning contract. Proposed write actions are definitions only and have no implementation in this commit.

## Business capability catalog

The planner-owned static capability catalog describes the business meaning and category of the twelve V1 capabilities. It deliberately contains no implementation mapping, version, adapter, or service reference. A future Capability Binding Layer will map these capabilities to separately approved implementations.

## Validation and clarification

Required entities are checked in catalog order. Undefined, null, and empty-string values are missing. The planner never supplies defaults for missing business facts and never chooses among candidates. Missing entities produce `NEEDS_CLARIFICATION`, an ordered `MissingEntity` list, deterministic questions, no preview, and no execution steps.

Entity search and disambiguation happen outside this planner. A caller must submit a selected identifier before the plan can become ready.

## Warnings

Warning rules inspect structured facts supplied by the caller. V1 rules cover reserved sale inventory, receivable overpayment, and duplicate purchase serials. Warnings are deterministic and visible in the preview, but do not block readiness.

## Confirmation preview

`ConfirmationPreview` is structured data, not HTML. It contains the action title, category, supplied fields, warnings, confirmation tier, and estimated effects. Effects describe the expected result of a future execution; they do not perform or guarantee a mutation.

## Business execution plan

A `BusinessExecutionPlan` is a business plan, not an invocation plan. It records:

- business action and planner state;
- missing entities and clarification questions;
- warnings and confirmation tier;
- zero or more capability steps with canonical arguments, dependencies, estimated effects, and reversibility;
- structured preview;
- workspace and entity version snapshots;
- a canonical SHA-256 fingerprint.

Definitions may produce multiple future steps. Every planned capability must exist in the business capability catalog and be declared by the action. Dependencies must point to earlier steps. The planner does not import implementation registries and does not execute any step.

`BusinessActionResult` is also inert in this commit. The only factory produces `NOT_EXECUTED`, `success: false`, empty affected entities and generated events, a null receipt, and `rollbackPossible: false`.

## Invalidation

`validatePlanStillCurrent()` returns stale reasons when:

- the workspace version changed;
- any captured entity version changed or disappeared;
- the expected fingerprint differs;
- the plan contents no longer reproduce the stored fingerprint.

Fingerprinting uses canonical JSON over the business action, capability steps, canonical arguments, dependencies, effects, preview, workspace version, and entity versions. Object key insertion order does not alter the result. Implementation-binding changes cannot invalidate an otherwise identical business plan because bindings are outside the plan.

## Future integration

A future Capability Binding Layer may translate a confirmed plan's capability IDs into Tool Registry calls. That layer—not the planner—owns capability-to-tool binding and must revalidate the workspace, entity versions, fingerprint, actor permissions, tenant scope, confirmation, and idempotency before execution.

A future LLM integration may translate user language into `StructuredIntent`, but it must remain outside this deterministic planner boundary. This commit contains no provider, prompt, language parser, frontend, tool invocation, or business mutation.
