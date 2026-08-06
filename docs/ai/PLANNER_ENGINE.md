# Deterministic Business Planner

## Architecture

The planner accepts only a `StructuredIntent` containing a business-action identifier and structured entities. It never receives raw language, parses natural language, references `ToolDefinition`, executes tools, or writes business data.

The lifecycle is:

`StructuredIntent → BusinessActionCatalog → entity validation → clarification or warnings → confirmation preview → execution plan → future execution layer`

## Business actions

`BusinessActionDefinition` is the stable boundary between intent and future tools. Each definition declares its identity, category, confirmation tier, required and optional entities, deterministic warning rules, preview and plan builders, allowlisted future tool names, and result schema.

The V1 catalog contains twelve statically constructed actions:

- Read actions: `GET_LIQUIDITY`, `GET_MONTHLY_PROFIT`, `SEARCH_INVENTORY`, `SEARCH_CLIENT`, `GET_CLIENT_ACCOUNTS`.
- Proposed write actions: `REGISTER_SALE`, `REGISTER_RECEIVABLE_PAYMENT`, `REGISTER_PURCHASE`, `REGISTER_EXPENSE`, `REGISTER_SETTLEMENT`, `REGISTER_CRYPTO_POSITION`, `REGISTER_CRYPTO_PRICE`.

The proposed write actions are definitions only. Their tool names are inert plan data and no write tools exist in this commit.

## Validation and clarification

Required entities are checked in catalog order. Undefined, null, and empty-string values are missing. The planner never supplies defaults for missing business facts and never chooses among candidates. Missing entities produce `NEEDS_CLARIFICATION`, an ordered `MissingEntity` list, deterministic questions, no preview, and no execution steps.

Entity search and disambiguation happen outside this planner. A caller must submit a selected identifier before the plan can become ready.

## Warnings

Warning rules inspect structured facts supplied by the caller. V1 rules cover reserved sale inventory, receivable overpayment, and duplicate purchase serials. Warnings are deterministic and visible in the preview, but do not block readiness.

## Confirmation preview

`ConfirmationPreview` is structured data, not HTML. It contains the action title, category, supplied fields, warnings, confirmation tier, and estimated effects. Effects describe the expected result of a future execution; they do not perform or guarantee a mutation.

## Execution plan

An `ExecutionPlan` records:

- business action and planner state;
- missing entities and clarification questions;
- warnings and confirmation tier;
- zero or more inert future execution steps;
- structured preview;
- workspace and entity version snapshots;
- a canonical SHA-256 fingerprint.

Definitions may produce multiple future steps. Every planned tool name must be included in the action definition's `allowedToolNames`. The planner does not import the tool registry and does not execute any step.

## Invalidation

`validatePlanStillCurrent()` returns stale reasons when:

- the workspace version changed;
- any captured entity version changed or disappeared;
- the expected fingerprint differs;
- the plan contents no longer reproduce the stored fingerprint.

Fingerprinting uses canonical JSON, so object key insertion order does not alter the result.

## Future integration

A future execution layer may translate a confirmed plan's allowlisted step names into Tool Registry calls. That layer must revalidate the workspace, entity versions, fingerprint, actor permissions, tenant scope, confirmation, and idempotency before execution.

A future LLM integration may translate user language into `StructuredIntent`, but it must remain outside this deterministic planner boundary. This commit contains no provider, prompt, language parser, frontend, tool invocation, or business mutation.
