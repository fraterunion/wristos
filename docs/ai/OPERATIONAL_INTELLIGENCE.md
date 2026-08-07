# WristOS AI — Operational Intelligence (Commit 13)

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
| `GET_INVENTORY_AGING` | `get_inventory_aging` | Active inventory ranked by days in stock |
| `GET_TOP_INVENTORY_CAPITAL` | `get_top_inventory_capital` | Top active positions by cost capital |
| `GET_TOP_DEBTORS` | `get_top_debtors` | Largest outstanding CXC counterparties (per currency) |
| `GET_RECEIVABLE_SUMMARY` | `get_receivable_summary` | CXC totals from AccountEntry only |
| `GET_SALES_MARGIN_SUMMARY` | `get_sales_margin_summary` | Gross margin (revenue − COGS) |
| `GET_PROFIT_BY_BRAND` | `get_profit_by_brand` | Gross profit aggregated by brand |
| `GET_TOP_SALES` | `get_top_sales` | Top CLOSED_WON sales by profit/price/margin |
| `GET_ATTENTION_ITEMS` | `get_attention_items` | Deterministic attention rules |

Existing reads remain: liquidity, monthly **net** profit, inventory/client search, client accounts.

## Canonical metrics & formulas

### Inventory age

- Active only: `deletedAt = null` AND `status ≠ SOLD`
- **Age source:** `Watch.createdAt`
- **Why:** schema has no `acquisitionDate`. Documented fallback — never silent.
- Ordering: `ageDays DESC`, then cost DESC, then `watchId`

### Inventory capital

- Cost = `Watch.cost` (null → 0)
- `% of inventory` = cost / Σ active costs (Decimal)

### CXC

- **Source of truth:** `AccountEntry` + deal `Payment` / `AccountPayment` via `CuentasService` patterns
- **Never** legacy Prisma `Receivable`
- Currencies never mixed without FX policy (V1 returns MXN and USD separately)
- **No CXC aging buckets** in V1 (date policy not validated for aging)

### Gross margin vs net profit

| | Gross margin (`GET_SALES_*`) | Net profit (`GET_MONTHLY_PROFIT`) |
|---|---|---|
| Revenue | `Deal.agreedPrice` CLOSED_WON | same |
| COGS | watch.cost + WatchExpense, else historicalCost | same |
| Bank commissions | **excluded** | subtracted |
| OpEx | **excluded** | subtracted |

Margin ≠ utilidad neta.

### Sale dating

Uses `dealEffectiveSaleDateRangeWhere` / `effectiveSaleDate` (`soldAt` preferred).

## Attention rules (policy v1.0.0)

Central constants in `attention-policy.ts` (not user-configurable):

| Constant | Default | Rationale |
|---|---|---|
| `AGED_INVENTORY_DAYS` | 120 | Material dwell for luxury stock |
| `HIGH_VALUE_INVENTORY_MXN` | 200,000 | High-ticket aged piece |
| `LARGE_RECEIVABLE_MXN` | 100,000 | Material single debtor |
| `CONCENTRATION_PERCENT` | 15 | Single-item / debtor concentration |
| `LOW_MARGIN_PERCENT` | 8 | Unusual recent gross margin |
| `CRYPTO_STALE_HOURS` | 72 | Stale MTM risk |
| `MAX_ITEMS` | 8 | Conversation-sized |

Rules emit `INFO | WATCH | IMPORTANT` with evidence hashes — observational phrasing (“Vale la pena revisar…”), never “Debes vender…”.

## Fact vs insight vs recommendation

- **Fact:** outstanding / age / totals from canonical math
- **Insight:** ratios/concentration derived deterministically
- **Recommendation:** bounded observation only; no automatic writes

## LLM boundary

- No dynamic SQL / report builder
- No new write bindings
- `REGISTER_SALE` remains the only executable write
- Insights never skip confirmation for sales

## Response design

- Metrics → `METRIC_BREAKDOWN`
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

## Future extensions

- True acquisition date if product adds the field
- Liquidity composition / capital net as dedicated capabilities
- User-tunable thresholds (admin settings)
- AP (payables) twin of receivable summary
