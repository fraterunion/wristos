# WristOS AI — Operational Intelligence (Commit 13 + Final Polish)

## Philosophy

The Assistant becomes a **business operator / advisor** for read-only operational questions.

Claude may interpret analytical questions and extract filters.  
**Deterministic WristOS code** queries canonical data, ranks entities, aggregates money, and returns structured evidence.

Claude must **never** calculate margins, aging, CXC totals, inventory capital, rankings, or other financial formulas from raw records.

```
Natural language
  → analytical intent (allowlisted)
  → deterministic BI capability
  → OperationalIntelligenceService / canonical domain services
  → structured result
  → conversational presentation
```

## Capability catalog (V1)

| Capability | Tool | Meaning |
|---|---|---|
| `GET_INVENTORY_AGING` | `get_inventory_aging` | Active inventory ranked by **inventory record age** |
| `GET_TOP_INVENTORY_CAPITAL` | `get_top_inventory_capital` | Top active positions by cost + `% of active inventory capital` |
| `GET_TOP_DEBTORS` | `get_top_debtors` | Largest outstanding CXC counterparties (per currency) |
| `GET_RECEIVABLE_SUMMARY` | `get_receivable_summary` | CXC totals from AccountEntry only |
| `GET_SALES_MARGIN_SUMMARY` | `get_sales_margin_summary` | Gross margin (revenue − COGS) |
| `GET_PROFIT_BY_BRAND` | `get_profit_by_brand` | Gross profit by brand from **CLOSED_WON** only |
| `GET_TOP_SALES` | `get_top_sales` | Top CLOSED_WON sales by profit/price/margin |
| `GET_ATTENTION_ITEMS` | `get_attention_items` | Deterministic attention rules |
| `GET_BUSINESS_SUMMARY` | `get_business_summary` | Compact composition of existing canonical reads |

Existing reads remain: liquidity, monthly **net** profit, inventory/client search, client accounts.

## Canonical metrics & formulas

### Inventory age (record age — not acquisition age)

- **Metric name:** inventory record age (`ageMetric: inventory_record_age`)
- Active only: `deletedAt = null` AND `status ≠ SOLD`
- **Age source:** `Watch.createdAt`
- **Why:** schema has no canonical `acquisitionDate`. Documented fallback — never silent.
- **User-facing copy:** “días registrado en el inventario de WristOS” / “días en WristOS”
- **Do not say:** “días comprado” or any claim of guaranteed physical acquisition age
- Conversational phrases like “lleva más tiempo parado” are acceptable only when supporting detail still makes the approximation clear
- Ordering: `ageDays DESC`, then cost DESC, then `watchId`
- **TODO (future):** add canonical `acquisitionDate` (or purchase-date domain source). Requires schema + migration — **out of scope for this commit**.

### Inventory capital concentration

- Cost = `Watch.cost` (null → 0)
- `percentOfActiveInventoryCapital` = item cost / Σ active inventory costs (Decimal)
- UI example: `Rolex Batman · $520,000 MXN · 12.8% del capital activo en inventario`

### CXC

- **Source of truth:** `AccountEntry` + deal `Payment` / `AccountPayment` via `CuentasService` patterns
- **Never** legacy Prisma `Receivable`
- Currencies never mixed without FX policy (V1 returns MXN and USD separately)
- **No CXC aging buckets** in V1 (date policy not validated for aging)

### Gross margin vs net profit

| | Gross margin (`GET_SALES_*` / brand) | Net profit (`GET_MONTHLY_PROFIT`) |
|---|---|---|
| Source deals | `CLOSED_WON` only | same |
| Revenue | `Deal.agreedPrice` | same |
| COGS | watch.cost + WatchExpense, else historicalCost | same |
| Bank commissions | **excluded** | subtracted |
| OpEx | **excluded** | subtracted |

**`GET_PROFIT_BY_BRAND` must NOT use:** asking price, inventory market value, crypto/FX assumptions, estimated future sale value, or unsold inventory. Aggregation is deal-scoped `CLOSED_WON` only.

Margin ≠ utilidad neta.

### Sale dating

Uses `dealEffectiveSaleDateRangeWhere` / `effectiveSaleDate` (`soldAt` preferred).

### GET_BUSINESS_SUMMARY (composition)

Composes existing canonical services — **no new financial formula**:

1. `AnalyticsService.getLiquidity`
2. `InventoryService.getSummary`
3. `OperationalIntelligenceService.getReceivableSummary`
4. `AnalyticsService.getMonthlyProfit` (current UTC calendar month)
5. `OperationalIntelligenceService.getAttentionItems`

CXC stays MXN separate from USD. Facts + deterministic observations only — no generated recommendations.

## Attention rules (policy v1.0.0)

Central constants in `attention-policy.ts`.

These are **initial conservative operational thresholds** chosen from current Wrist Caviar operating patterns / data distribution.

They are **not** universal financial truths.
They are **not** user-configurable yet.

| Constant | Default | Meaning |
|---|---|---|
| `AGED_INVENTORY_DAYS` | 120 | Days of inventory *record age* before aged callout |
| `HIGH_VALUE_INVENTORY_MXN` | 200,000 | MXN cost floor for high-value aged inventory |
| `LARGE_RECEIVABLE_MXN` | 100,000 | MXN outstanding floor for large CXC callouts |
| `CONCENTRATION_PERCENT` | 15 | Share of active capital / CXC for concentration |
| `LOW_MARGIN_PERCENT` | 8 | Gross margin % floor for recent sale callouts |
| `CRYPTO_STALE_HOURS` | 72 | Crypto price age treated as stale |
| `MAX_ITEMS` | 8 | Conversation-sized |

Every attention item includes:

- `severity`: `INFO | WATCH | IMPORTANT`
- `category` (closed set): `INVENTORY | RECEIVABLES | LIQUIDITY | SALES | CAPITAL | CRYPTO`

Phrasing is **observational** only, e.g.:

- “Este reloj concentra 14% del capital activo y lleva 190 días registrado.”
- “Este cliente concentra 28% de las CXC en MXN.”

Avoid: “Debes venderlo.” / “Conviene cobrarle hoy.” / “Compra menos Rolex.” / “Vende esta posición.”

## Fact vs insight vs recommendation

- **Fact:** outstanding / age / totals from canonical math
- **Insight:** ratios/concentration derived deterministically
- **Recommendation:** bounded observation only; no automatic writes; no prescriptive financial advice

## LLM boundary

- No dynamic SQL / report builder
- No new write bindings
- `REGISTER_SALE` remains the only executable write
- Insights never skip confirmation for sales

## Response design

- Metrics / summary → `METRIC_BREAKDOWN`
- Ranked lists → `ENTITY_LIST`
- Frontend conversation blocks translate to mobile/desktop chat
- Working context V1.1: aging / capital / debtors feed ordinal follow-ups

## Performance

- Tenant-scoped queries
- Limits capped (≤50; attention ≤8)
- Prefer existing indexes (`tenantId+status`, `tenantId+soldAt`, accounts indexes)
- **No migration in V1** — in-memory ranking acceptable at current inventory scale

## Security / audit

Tool execution audit retains capability, filters, duration, result summary metadata.  
Attention evidence uses id prefixes/hashes — no raw PII dumps or provider prompts.
