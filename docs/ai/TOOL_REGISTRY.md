# WristOS AI Read-Only Tool Registry

## Philosophy

The registry exposes fixed business capabilities, never database primitives. It is deterministic infrastructure for a future planner: it does not choose, chain, or retry tools and contains no language-model integration. Every tool delegates to its owning WristOS domain service.

## Contract

Each `ToolDefinition` has a unique allowlisted name, semantic version, description, category, `READ` mode, confirmation tier `0`, permission, JSON input/output schemas, Zod validators, canonical service identifier, and typed executor. `ToolContext` carries authenticated tenant/user scope, optional runtime references, request trace, locale/timezone, and an injected clock. `ToolResult` contains validated data, plain-text summary, source metadata, warnings, timing, and trace ID; HTML is not allowed.

Unknown object fields are rejected. Limits are capped at 50. Money is serialized as fixed two-decimal strings. Sorting is explicit and ties use stable identifiers where the domain query supports them.

## Catalog and canonical mappings

| Tool | Canonical service | Permission |
| --- | --- | --- |
| `get_liquidity` | `AnalyticsService.getLiquidity` using Treasury and Crypto services | Authenticated tenant member |
| `get_inventory_summary` | `InventoryService.getSummary` | Authenticated tenant member |
| `search_inventory` | `InventoryService.searchInventory` | Authenticated tenant member |
| `search_clients` | `CrmService.searchClientsForTools` using AccountEntry relations | Authenticated tenant member |
| `get_client_accounts` | `CuentasService.getClientAccountsForTools` | Authenticated tenant member |
| `get_open_receivables` | `CuentasService.getOpenAccountsForTools` | Authenticated tenant member |
| `get_open_payables` | `CuentasService.getOpenAccountsForTools` | Authenticated tenant member |
| `get_monthly_profit` | `AnalyticsService.getMonthlyProfit` | Authenticated tenant member |
| `get_recent_sales` | `HistoryService.getRecentSalesForTools` | Authenticated tenant member |

The repository currently has authenticated roles but no granular capability-permission catalog for these existing UI reads. Therefore V1 definitions use `permission: null`; authentication and tenant membership are mandatory, and adapters pass only `ToolContext.tenantId` into canonical services. Future permissions must be additive and may only narrow access.

## Examples

```json
{"tool":"search_inventory","input":{"query":"Batman","status":"ALL","limit":20}}
```

```json
{"tool":"get_monthly_profit","input":{"year":2026,"month":7}}
```

## Audit and safety

Execution emits immutable started/completed events and typed failure, permission, input, or output validation events. Audit payloads contain tool/version, trace ID, duration, input fingerprint, and output hash/short summary. Raw inputs, customer PII, and full outputs are not stored or logged.

The registry is static at construction. There is no dynamic registration, arbitrary service lookup, SQL tool, Prisma tool, generic controller, or production execution endpoint. Testing calls `ToolExecutionService` directly; omitting `POST /ai/tools/:name/execute` avoids turning an internal verification seam into a generic production capability.

## Versioning and deprecation

Tool versions use semantic versioning. Compatible schema clarifications increment patch; additive optional fields increment minor; breaking input/output or semantic changes require a new major version. A deprecated version remains allowlisted until callers migrate, is marked in documentation, and is then removed in a dedicated commit. Names are never silently repointed to incompatible semantics.

## Read versus future write tools

All current tools are `READ` with confirmation tier `0`. A future write tool requires a separate architecture: explicit permission, deterministic proposed plan, fingerprint-bound confirmation, idempotency enforcement, action-run lifecycle integration, and audited execution. It must never be added by changing a read tool's mode or executor in place.
