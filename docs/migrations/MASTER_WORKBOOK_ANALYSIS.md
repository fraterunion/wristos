# Wrist Caviar — Master Workbook Analysis

**Source file (local only):** `RELOJES CESAR ADMIN.xlsx` (~249 KB)  
**Analyzed:** 2026-07-28  
**Sheets:** 12 (all visible)  
**Defined names:** none  
**Status of this document:** specification for historical migration — **analysis only, no import implementation**

---

## 0. Executive interpretation

This workbook is not a “spreadsheet dump.” It is Wrist Caviar’s **legacy operating system**:

| Concern | Where it lives |
|---|---|
| Sold watches / P&L by month | `VENTAS` |
| Stock on hand (cost basis) | `INVENTARIO` |
| Customer receivables (card layout) | `CTAS X COBRAR` |
| Supplier / partner payables (card layout) | `CTAS X PAGAR` |
| Operating expenses by month | `GASTOS` |
| Cash MXN + cash USD (dual ledger) | `EFECTIVO` |
| Bank deposits / withdrawals + 1% commission | `CONTROL BANCOS` |
| Owner drawer / personal float (Cesar) | `CUENTA CESAR` |
| Crypto USD float (Cesar) | `CRIPTO CESAR` |
| Partner utility accrual & draws (Cesar 75% / Edgar 25%) | `COBRO UTILIDADES` |
| Side project / Oscar Aguilar truck + settlements | `OSCAR PAPA CAMI` |
| Consolidated balance sheet / equity check | `REPORTE` |

**Brand stamp:** most title merges say `CTW` (Cesar / Wrist Caviar operating mark).

**Business model encoded in formulas (not documentation):**

1. Buy watches (inventory / cash / bank / CXP).
2. Sell watches (`VENTAS`) with cost, sale price, extras → `UTILIDAD = PRECIO − COSTO − EXTRAS`.
3. Net monthly profit ≈ sum(utilidades) − gastos del mes − bank commissions (and ad-hoc adjustments).
4. Split net profit **75% Cesar / 25% Edgar** (`COBRO UTILIDADES` + side cells on `VENTAS`).
5. Track money across **banks, cash MXN, cash USD, CXC, CXP, inventory, crypto, Cesar drawer**.
6. `REPORTE` is the **single reconciliation dashboard** that must balance after any truthful migration.

**Critical migration implication:** PDF sales extraction is no longer the official path. This workbook is the **only** historical source of truth for migration into WristOS. After cutover, all new operations are entered in WristOS.

---

## 1. Complete workbook structure

| # | Sheet | Approx used rows | Cols | Formulas | Merged ranges | Hidden | Classification |
|---|---|---:|---:|---:|---:|---|---|
| 0 | `REPORTE` | 21 | 4 | 20 | 0 | — | **Reconciliation / report** |
| 1 | `CUENTA CESAR` | ~447 (1002 allocated) | 8 | 446 | 1 | — | **Operational** (owner cash drawer) |
| 2 | `GASTOS` | ~320 (1012 allocated) | 7 | 19 | 14 | — | **Operational** |
| 3 | `OSCAR PAPA CAMI` | 13 | 27 (mostly empty) | 12 | 0 | — | **Operational** (side ledger) |
| 4 | `CTAS X PAGAR` | 156 | 12 | 24 | 1 | — | **Operational** (payables cards) |
| 5 | `CRIPTO CESAR` | 19 | 5 | 18 | 1 | — | **Operational** |
| 6 | `CTAS X COBRAR` | ~474 (729 allocated) | 10 | 56 | 2 | — | **Operational** (receivables cards) |
| 7 | `INVENTARIO` | ~53 (828 allocated) | 12 | 53 | 1 | — | **Operational** |
| 8 | `EFECTIVO` | 1033 | 27 | **1768** | 18 | **728 rows**, col F | **Operational** (dual cash) |
| 9 | `VENTAS` | ~506 (1002 allocated) | 26 | 555 | 14 | — | **Operational** (+ embedded P&L) |
| 10 | `COBRO UTILIDADES` | 14 active (981 allocated) | 20 | 75 | 0 | — | **Derived / partner settlement** |
| 11 | `CONTROL BANCOS` | ~546 (1030 allocated) | 15 | **1250** | 16 | col B | **Operational** |

### Cross-sheet dependency graph (formula references observed)

```
REPORTE
  ← CONTROL BANCOS
  ← EFECTIVO
  ← CTAS X COBRAR
  ← CTAS X PAGAR
  ← INVENTARIO
  ← COBRO UTILIDADES
  ← CUENTA CESAR
  ← CRIPTO CESAR
  ← (literal) DINERO OSCAR / INVERSION CESAR / INVERSION EDGAR

COBRO UTILIDADES ← VENTAS   (monthly net profit cells)

VENTAS ← GASTOS
VENTAS ← CONTROL BANCOS     (monthly expense & commission inputs to P&L)

GASTOS ← CONTROL BANCOS     (at least one cross check)

EFECTIVO ← OSCAR PAPA CAMI  (truck / settlement linkage)
```

`REPORTE` is a **sink** (nothing references it). It is the migration acceptance gate.

---

## 2. Sheet-by-sheet explanation

---

### 2.1 `REPORTE` — Consolidated balance / equity check

**1. Purpose**  
Single-page financial position of the operating business in MXN and USD, plus partner capital and “equity check” math.

**2. Organization**  
Small static grid. Column B = PESOS, column C = DOLARES. Rows are line items pulling live balances from other sheets.

**3. Logical tables**

| Block | Rows | Meaning |
|---|---|---|
| Assets / liabilities lines | 3–11 | Banks, cash, CXC, CXP, inventory, utilities owed, Oscar money, Cesar drawer, crypto |
| Currency totals | 12–13 | MXN total; USD total; USD×17.5 FX; combined MXN |
| Partner capital | 15–17 | Cesar / Edgar invested capital and residual |

**4. Detected columns**  
A: label · B: MXN · C: USD · D: combined / checks

**5. Primary key**  
None (singleton report).

**6. Relationships**  
Pulls from every major balance sheet sheet (see graph). Literal `DINERO OSCAR` = 230000 (matches `OSCAR PAPA CAMI` truck total).

**7. WristOS destination**  
Not imported as rows. Becomes **migration reconciliation report** (expected balances after dry-run).

**8. Confidence**  
**High** for role; **medium** for exact equity semantics (see risks: utilities pointer, FX 17.5 hardcoded).

**Observed equation (MXN, B12):**

```
BANCOS + EFECTIVO_MXN + CXC_MXN − CXP_MXN + INVENTARIO − UTILIDADES + DINERO_OSCAR + CUENTA_CESAR
≈ 7,911,335.71
```

USD side (C12): `EFECTIVO_USD + CXC_USD − CXP_USD + CRIPTO` ≈ 231,672.66; converted at **17.5** in C13.

---

### 2.2 `VENTAS` — Sales journal + monthly P&L

**1. Purpose**  
Canonical history of watch sales from Jul 2025 → Jul 2026, blocked by calendar month, with per-row profit and monthly net-profit machinery.

**2. Organization**

- Title `CTW` (row 1, merged).
- Month banner rows (merged A:K): `JULIO`, `AGOSTO`, … repeating into next year `JULIO`.
- After each banner: header row  
  `FECHA VENTA | CLIENTE | MARCA | MODELO | REFERENCIA | NUMERO DE SERIE | COSTO | PRECIO DE VENTA | EXTRAS | UTILIDAD | NUMERO DE PAGOS`
- Sale rows (Excel datetime in A).
- Right-side columns (K+) used as **monthly P&L scratchpad** (INGRESO / GASTO / net / partner split) — not payment counts despite header reuse.

**Month banner row map (observed):**  
2 JULIO · 6 AGOSTO · 48 SEPTIEMBRE · 88 OCTUBRE · 137 NOVIEMBRE · 181 DIC · 229 ENERO · 275 FEBRERO · 319 MARZO · 364 ABRIL · 407 MAYO · 433 JUNIO · 472 JULIO

**3. Logical tables**

1. **Sale lines** (main).  
2. **Monthly P&L cells** (side formulas referencing `GASTOS` month totals and `CONTROL BANCOS` commission/expense cells).  
3. **Partner split snippets** (`M9*0.25` / `M9*0.75` pattern early in August).

**4. Columns (sale table)**

| Col | Header | Notes |
|---|---|---|
| A | FECHA VENTA | Excel datetime |
| B | CLIENTE | Free text; inconsistent spacing/accents |
| C | MARCA | ROLEX, AP, CARTIER, … typos (`ROLX`) |
| D | MODELO | Free text nicknames (`BATGIRL`, `ROYAL OKAK`) |
| E | REFERENCIA | Often empty; sometimes numeric junk |
| F | NUMERO DE SERIE | Sparse (~13% filled); sometimes polluted (`DOLARES`, large numbers) |
| G | COSTO | Number or FX formula e.g. `=85000*17.4` on inventory; zeros for “ghost” deals |
| H | PRECIO DE VENTA | |
| I | EXTRAS | Optional |
| J | UTILIDAD | Formula `=H-G` or `=H-G-I` |
| K | NUMERO DE PAGOS | Header misleading — often blank on sales; P&L uses K/L/M |

**5. Primary key candidates**

- Soft: `(saleDate, clientNorm, brand, model, salePrice)`  
- Serial when present and clean  
- **No stable ID exists in the sheet**

**6. Relationships**

- Feeds `COBRO UTILIDADES` (monthly net cells like `VENTAS!M91`).  
- Consumes `GASTOS!E*` month sums and `CONTROL BANCOS` cells for expense side of P&L.

**7. WristOS destination**

- `Deal` (+ sold `Watch` snapshot / link)  
- `Client` (deduped)  
- Optional `Receivable` if unpaid portion still open (usually mirrored in CXC cards)

**8. Confidence**  
**High** for sale-line meaning. **Medium** for P&L side columns (hand-maintained, month-specific formula edits).

**Measured data quality (sale lines):**

| Metric | Value |
|---|---:|
| Sale rows detected | **469** |
| Unique clients (raw) | 240 |
| Rows with serial | 63 |
| Unique clean-ish serials | ~60 |
| Missing/zero cost | ~20 / 18 zero |
| Missing price | 1 |
| Top brand | ROLEX 267 |
| Top client | Javier Calero 38 |

---

### 2.3 `INVENTARIO` — Stock at cost

**1. Purpose**  
Current watches (and a few strap/color lines) held in stock, valued mostly in MXN.

**2. Organization**

- Title `CTW` merged A1:L1.  
- Header row 3: `MARCA | MODELO | REF | SERIE | COSTO | DOLARES | EXTRA | COSTO TOTAL` + label `TOTAL DINERO EN STOCK` with `K3 = SUM(H4:H60)`.  
- Column H is almost always `=E` (total cost = MXN cost).  
- Some costs entered as FX formulas (`=85000*17.4`).  
- Many blank spacer rows that still carry `=E` formulas.

**3. Logical tables**  
One inventory list (≈40 real-ish SKUs with brand/model/cost). Sum window intentionally **H4:H60**.

**4. Columns**  
As header. `DOLARES` / `EXTRA` rarely used.

**5. PK candidates**  
`(brand, model, serial)` when serial present; otherwise weak.

**6. Relationships**  
`REPORTE!B7 = INVENTARIO!K3` (18261520) — inventory is a balance-sheet asset.

**7. WristOS destination**  
`Watch` with status AVAILABLE (or equivalent), cost fields, optional reference catalog link.

**8. Confidence**  
**High** for asset role. **Medium** for completeness (sold watches are not systematically removed by formula — inventory is a maintained list).

---

### 2.4 `CTAS X COBRAR` — Accounts receivable (card UI)

**1. Purpose**  
Open customer balances: loans, partial payments on watches, multi-payment plans.

**2. Organization — not a flat table**

Horizontal **cards** in two columns (left A–D, right F–I):

```
FECHA | CLIENTE: | <name> | RELOJ
<date>| MONTO:   | <amount>| <watch / concept>
      | PAGO 1:  | <amt>   | <method/note>
      | PAGO 2:  | ...
      | POR COBRAR | =MONTO − sum(PAGOS)
```

- Template/example card at top (`EJEMPLO` / `PEPE`).  
- Header totals: `F3` sums many left-card `POR COBRAR` cells (MXN); `G3` sums right-card USD balances.  
- ~46 left-column `CLIENTE:` labels; ~53 total client labels including right column.  
- Card height typically 8–21 rows.

**3. Logical tables**  
Logical entity = **Receivable account** with **payment lines**. Physical layout = cards.

**4. Columns (logical)**  
accountDate, customerName, watchOrConcept, principal, payments[], method notes, currency (inferred by card column / labels `pesos`/`dolares`).

**5. PK candidates**  
`(customerNorm, watchNorm, openDate)` — fragile.

**6. Relationships**  
Balances roll into `REPORTE`. Concepts often mention watches also present in `VENTAS` / `EFECTIVO` / banks (narrative link only).

**7. WristOS destination**  
`Receivable` + `ReceivablePayment` (+ `Client`).

**8. Confidence**  
**High** for business meaning. **Lower** for automated parsing (card geometry, template rows, negative “payments”, typos `banocs`).

---

### 2.5 `CTAS X PAGAR` — Accounts payable (card UI)

**1. Purpose**  
Money owed to suppliers / partners / capital providers (notably Edgar Trejo, Jean Paul, package deals).

**2. Organization**  
Same **card metaphor** as CXC, with label typo **`AACREDOR`**. Dual columns PESOS / DLS. Header aggregates in row 6 (`F6`, `G6`, etc.).

**3. Logical tables**  
Payable accounts + payment/credit lines. Includes negative `MONTO` lines used as package adjustments.

**4. Columns (logical)**  
creditor, date, amounts, watch/package refs (`PAQ 126`), payment lines, `POR COBRAR` residual (naming reused from AR!).

**5. PK candidates**  
`(creditorNorm, openDate, concept)`.

**6. Relationships**  
`REPORTE` CXP lines. Narrative overlap with capital abonos in `EFECTIVO`.

**7. WristOS destination**  
Payable model if/when WristOS has AP; otherwise staged liability + manual map. Today schema emphasis is AR (`Receivable*`) — **AP may need a migration-specific staging entity** or reuse of a future AP module.

**8. Confidence**  
**High** for meaning. **Low** for formula health:

- `C156 = C151-C654847` (broken / nonsense row refs)  
- `H24 = H17-H654726` (broken)

Parser must prefer **cached values** and flag broken formulas.

---

### 2.6 `GASTOS` — Operating expenses

**1. Purpose**  
Month-blocked operating spend (travel, gas, chauffeurs, salary Regina, guides, packaging, commissions…).

**2. Organization**

- Title `CTW` + note in E2 (`SE DEEBEN A CESAR 700 DLS PONCE RELOJ` — debt note / typo).  
- Month merges (`AGOSTO`, `SEPTIEMBRE`, …).  
- Per month: header `FECHA | CONCEPTO | CUENTA | SALIDA` and `E{header} = SUM(D range)`.  
- ~287 dated expense rows.

**3. Logical tables**  
Expense lines + monthly totals.

**4. Columns**  
date, concept, account (mostly blank), amount (sometimes FX formula `=3000*17.4`).

**5. PK**  
None strong; `(date, concept, amount)`.

**6. Relationships**  
Monthly totals consumed by `VENTAS` P&L. One link from `GASTOS` into `CONTROL BANCOS`.

**7. WristOS destination**  
Expenses module / `WatchExpense` only when clearly watch-linked; else general expense records.

**8. Confidence**  
**High**.

---

### 2.7 `EFECTIVO` — Dual cash ledger (MXN | USD)

**1. Purpose**  
Physical cash movements in pesos (left) and dollars (right), with running balances and FX (`TC`).

**2. Organization**

- Left block A–E: `FECHA | CONCEPTO | ENTRADAS | SALIDAS | SALDO` under month banners.  
- Right block G–L: `FECHA | CONCEPTO | ENTRADAS | TC | SALIDAS | SALDO` titled `DOLARES`.  
- Column F hidden (spacer).  
- **728 hidden rows** (approx rows 53–780) — historical MXN lines still in file but collapsed.  
- Running balance formulas: `E_n = E_{n-1}+C_n-D_n` (and USD analogue).  
- Top balances: `D3 = E930` (MXN), `L3` / `L794` referenced by `REPORTE`.  
- Concepts include capital abonos (`ABONO CAPITAL CESAR` / `EDGAR TREJO`), CXC payments, purchases, utility draws.

**3. Logical tables**  
Two cashbooks (MXN, USD), month-segmented.

**4. Columns**  
As above + TC on USD side.

**5. PK**  
`(book, date, concept, in, out)` soft key.

**6. Relationships**  
`REPORTE` cash lines; formulas to `OSCAR PAPA CAMI`; narrative links to sales/CXC.

**7. WristOS destination**  
Treasury / cash movement entities (if present) or migration staging for cashbooks. Must import **hidden rows too** if history matters — confirm with owners whether hidden = archived-but-valid.

**8. Confidence**  
**High** for structure. **Medium** for which hidden rows are still authoritative.

**Counts:** ~134 visible MXN dated movements + ~621 hidden; ~54 USD dated movements (visible).

---

### 2.8 `CONTROL BANCOS` — Bank ledger

**1. Purpose**  
Bank account journal with **1% commission** on deposits and running saldo.

**2. Organization**

- Title merge; month banners.  
- Headers: `FECHA | REF | CONCEPTO | DEPOSITO | COMISIÓN | RETIRO | SALDOS | COMENTARIO`.  
- `COMISIÓN = DEPOSITO * 0.01`.  
- `SALDOS` running: `G_n = G_{n-1} + D_n - F_n - E_n`.  
- Column B hidden.  
- Side cell `TOTAL SIN COMISION` / `=G252` (hand pointer; REPORTE uses `CONTROL BANCOS!G631` for banks — **pointer drift risk**).  
- ~520 dated movements; REPORTE bank balance matches last observed saldo ~4,720,789.44.

**3. Logical tables**  
Bank movements + monthly commission totals used by `VENTAS` P&L.

**4. Columns**  
As headers.

**5. PK**  
Soft `(date, concept, deposit, withdrawal)`.

**6. Relationships**  
`REPORTE`, `VENTAS` P&L, `GASTOS`.

**7. WristOS destination**  
Bank transaction / treasury ledger.

**8. Confidence**  
**High** for mechanics; **medium** for which cell is the “official” bank total (G631 vs G252 vs last row).

---

### 2.9 `CUENTA CESAR` — Cesar personal/operating float

**1. Purpose**  
Running drawer for Cesar: entradas/salidas with saldo. Mix of business CXC collections, personal-ish spends, watch-related payments.

**2. Organization**  
Classic ledger from 2025-10-13: `FECHA | CONCEPTO | ENTRADAS | SALIDAS | SALDO`.  
`F3 = E347` exposes current balance to `REPORTE` (~80,869.26).  
~210 dated movements; many trailing empty balance-formula rows.

**3–8.** Operational ledger → owner account / internal transfer category in WristOS. Confidence **high** for structure, **medium** for classifying personal vs company.

---

### 2.10 `CRIPTO CESAR` — Crypto / USD float

**1. Purpose**  
Small USD-denominated ledger (entries/exits/saldo), including FX conversion entries (`=1524000/17.9`).

**2. Organization**  
Header + few live rows; many pre-seeded empty balance formulas down to row 19.  
`REPORTE!C11 = CRIPTO CESAR!E19`.

**7. WristOS destination**  
Treasury account (crypto/USD). Confidence **high**.

---

### 2.11 `COBRO UTILIDADES` — Partner profit waterfalls

**1. Purpose**  
Accrue monthly utilities for **CESAR (75%)** and **EDGAR (25%)**, record amounts already drawn (`COBRADO`), and compute `POR COBRAR`.

**2. Organization**  
Three stacked matrices with months AGOSTO…JULIO as columns:

1. Accrued utility (from `VENTAS!M*` / `K*` nets, or hardcoded early months).  
2. Collected amounts (manual sums).  
3. Outstanding = accrued − collected.  
`Q13 = N13+N14` = total outstanding utilities → `REPORTE!B8`.

**6. Relationships**  
Tight to `VENTAS` monthly nets. This is how partner equity is tracked outside formal capital accounts.

**7. WristOS destination**  
Partner distributions / equity notes — likely **staging + manual approval**, not blind import into Deals.

**8. Confidence**  
**High** for 75/25 rule. **Medium** for month-cell pointers (hand maintained).

---

### 2.12 `OSCAR PAPA CAMI` — Side settlement ledger

**1. Purpose**  
Track “compra de camioneta con Oscar Aguilar” contributions (running up to 230,000) and a second chain settling CXC/CXP involving Sebas Mendoza, Villegas, Regina Trejo, etc., down to zero.

**2. Organization**  
Two short vertical running-balance blocks; wide empty columns.

**6. Relationships**  
`REPORTE` literal DINERO OSCAR = 230000; `EFECTIVO` formulas reference this sheet.

**7. WristOS destination**  
One-off liability/asset + journal, or exclude from core watch migration with explicit manual handling.

**8. Confidence**  
**High** that it is a side ledger; **medium** on how much belongs in core WristOS.

---

## 3. Relationships (business objects)

```
Client ──< Deal(sale) >── Watch
  │            │
  │            ├─ cost / price / extras / profit
  │            └─ may spawn Receivable (CXC card)
  │
  └── Receivable ──< ReceivablePayment

Creditor ── PayableAccount ──< PayablePayment   (CXP cards)

Watch (stock) <── INVENTARIO (AVAILABLE)
Watch (sold)  <── VENTAS (+ inventory removal is manual in legacy)

CashBook MXN / CashBook USD <── EFECTIVO
BankAccount <── CONTROL BANCOS (deposit, 1% fee, withdrawal)
OwnerFloat Cesar <── CUENTA CESAR
CryptoFloat <── CRIPTO CESAR

MonthlyP&L <── VENTAS side formulas ← GASTOS totals + bank fees
PartnerAccrual <── COBRO UTILIDADES ← MonthlyP&L
BalanceSheet <── REPORTE ← all stocks of money + inventory − utilities owed
```

### Implied partners / actors

| Actor | Role in workbook |
|---|---|
| Cesar | Operator; 75% utilities; `CUENTA CESAR`; capital abonos |
| Edgar Trejo | Partner; 25% utilities; capital abonos; large CXP |
| Regina Trejo | Salary / CXP settlement mentions |
| Oscar Aguilar | Truck deal / `DINERO OSCAR` |
| CTW | Brand/title mark on sheets |

---

## 4. Potential import order (dependency-safe)

1. **Reference / config** — FX policy (do **not** invent; capture observed rates 17.4–18.65 and report FX 17.5).  
2. **Clients + creditors** — extracted from `VENTAS`, CXC, CXP, cash concepts (deduped).  
3. **INVENTARIO** → Watches AVAILABLE.  
4. **VENTAS** → Deals + sold watches (without destroying inventory rows until reconciled).  
5. **GASTOS** → expenses.  
6. **CONTROL BANCOS** → bank movements.  
7. **EFECTIVO** (include hidden-row decision) → cash movements.  
8. **CUENTA CESAR** / **CRIPTO CESAR** → float accounts.  
9. **CTAS X COBRAR** → receivables + payments.  
10. **CTAS X PAGAR** → payables + payments.  
11. **COBRO UTILIDADES** → partner accruals/draws (review-heavy).  
12. **OSCAR PAPA CAMI** → side case.  
13. **REPORTE dry-run reconciliation** — must match within agreed tolerances.

---

## 5. Potential risks

| Risk | Evidence | Migration impact |
|---|---|---|
| No stable primary keys | Free-text clients, sparse serials | Conservative dedupe; manual review queues |
| Serial column pollution | Values `DOLARES`, numeric garbage | Cleanse; don’t unique-index blindly |
| Brand/model nicknames | `BATGIRL`, `ROYAL OKAK`, `ROLX` | Mapping dictionary + review |
| Inventory not formula-linked to sales | Separate maintained list | Reconcile sold-vs-stock manually |
| CXC/CXP card layout | Non-tabular | Dedicated card parser, not generic XLSX |
| Broken AP formulas | `C654847`, `H654726` | Use cached values; flag formulas |
| Hidden EFECTIVO history | 728 hidden rows | Product decision: import or archive |
| Bank total cell drift | `G631` vs `G252` | Resolve official balance cell with owners |
| Utilities REPORTE pointer | `Q13 = N13+N14` | OK now; brittle if columns shift |
| Double counting money | Same payment in bank + cash + CXC narrative | Import ledgers carefully; don’t infer transfers |
| Partner split embeds | 75/25 in multiple places | Single rule engine; don’t re-derive from noisy cells |
| Zero-cost sales | “ghost” / commission-like deals | Allow with warning |
| PDF path divergence | PDF extract also produced 469 sales | Treat PDF as obsolete parallel experiment |

---

## 6. Validation rules (for later phases)

### Hard blocks (should fail dry-run)

1. `REPORTE` reconstructed balances vs post-import aggregates exceed tolerance (propose ±1 MXN for ledger math; larger band only if owners approve).  
2. Duplicate exact serials on two AVAILABLE watches.  
3. Deal with missing sale date or missing sale price.  
4. CXC/CXP card with unparsable `POR COBRAR` and no cached value.  
5. Bank running balance discontinuity > tolerance after sorted import.

### Soft warnings (review queue)

1. Client name near-duplicates (`Víctor Mendoza` vs `Victor Mendoza`).  
2. Sale without serial.  
3. Sale cost = 0.  
4. Inventory row without serial.  
5. Brand not in known catalog.  
6. FX formula present — capture rate used.  
7. Concept text suggests transfer between books (possible double count).  
8. Hidden EFECTIVO row included/excluded against policy.  
9. `COBRO UTILIDADES` month pointer ≠ recomputed VENTAS net.

### Reconciliation checks against `REPORTE`

| Line | Source cells (as of analysis) | Approx value |
|---|---|---:|
| BANCOS MXN | `CONTROL BANCOS!G631` | 4,720,789.44 |
| EFECTIVO MXN | `EFECTIVO!D3` | 464,200 |
| EFECTIVO USD | `EFECTIVO!L794` | 5,700 |
| CXC MXN/USD | `CTAS X COBRAR!F3/G3` | 11,114,211.83 / 55,023 |
| CXP MXN/USD | `CTAS X PAGAR!F6/G6` | 9,785,215 / 0 |
| INVENTARIO | `INVENTARIO!K3` | 18,261,520 |
| UTILIDADES | `COBRO UTILIDADES!Q13` | 17,175,039.82 |
| CUENTA CESAR | `CUENTA CESAR!F3` | 80,869.26 |
| CRIPTO USD | `CRIPTO CESAR!E19` | 170,949.66 |
| DINERO OSCAR | literal | 230,000 |

---

## 7. Unknown fields / open questions for owners

1. Confirm **hidden EFECTIVO rows**: still true history or obsolete?  
2. Official **bank balance cell** for REPORTE (`G631` vs last movement vs `G252`).  
3. Should **OSCAR PAPA CAMI** enter WristOS or stay outside?  
4. Is **CUENTA CESAR** company petty cash or personal?  
5. AP (`CTAS X PAGAR`): target module in WristOS or staging-only for v1?  
6. Inventory straps/colors (`AZUL`/`VERDE`…): product or ignore?  
7. Zero-cost VENTAS rows: consignments, fees, or data errors?  
8. Which FX rate is canonical for reporting (17.5 on REPORTE vs deal-time rates)?  
9. After migration, is `COBRO UTILIDADES` replaced by WristOS partner accounting?  
10. Confirm Cesar/Edgar split remains 75/25 going forward.

---

## 8. Things that require manual review

- Every CXC/CXP card with residual ≠ 0 after payment parse.  
- All partner utility months (accrual vs cobrado).  
- Inventory ↔ sales overlap (same serial/model sold but still listed).  
- Top customers with many deals (Javier Calero, Raúl Gustavo, Bruno Díaz, …) for client merge.  
- Broken CXP formulas’ cached zeros — verify real balances with Cesar.  
- Capital abonos vs sales vs loans classification in cash/bank concepts.  
- Any row where `NUMERO DE SERIE` contains currency words.

---

## 9. Possible parser strategy (design only — do not implement yet)

### Principle

**One workbook family → sheet-specific parsers.** No generic “detect table” for CXC/CXP/VENTAS month blocks.

### Suggested parser modules

| Parser | Input sheet | Output dataset |
|---|---|---|
| `parse_reporte` | REPORTE | ExpectedBalanceSnapshot |
| `parse_ventas` | VENTAS | SaleLine[], MonthBanner[], MonthlyPnlCell[] |
| `parse_inventario` | INVENTARIO | StockLine[] |
| `parse_gastos` | GASTOS | ExpenseLine[], MonthTotal[] |
| `parse_efectivo` | EFECTIVO | CashMovement[] (book=MXN\|USD, hidden flag) |
| `parse_control_bancos` | CONTROL BANCOS | BankMovement[] |
| `parse_cuenta_cesar` | CUENTA CESAR | OwnerMovement[] |
| `parse_cripto` | CRIPTO CESAR | CryptoMovement[] |
| `parse_cxc_cards` | CTAS X COBRAR | ReceivableAccount[] |
| `parse_cxp_cards` | CTAS X PAGAR | PayableAccount[] |
| `parse_utilidades` | COBRO UTILIDADES | PartnerAccrualMatrix |
| `parse_oscar` | OSCAR PAPA CAMI | SideLedger[] |

### Techniques

- Prefer **formula cells’ cached values** (`data_only`) but retain formula text for audit.  
- Detect month banners via merged cells + known Spanish month tokens.  
- Re-emit headers after each banner (VENTAS/GASTOS/EFECTIVO/BANCOS).  
- Card parser: scan for `CLIENTE:` / `AACREDOR` / `MONTO` / `PAGO` / `POR COBRAR` anchors.  
- Normalize clients with Unicode NFKC, collapse whitespace, casefold — but keep original display name.  
- Never invent FX; store rate when formula pattern `=amount*rate` or `=mxn/usd` matches.

### Explicit non-goals for parser v1

- No Claude/OCR.  
- No PDF.  
- No writing to operational tables until Phase 6 approval.

---

## 10. Proposed migration architecture (phases)

> Analysis only — phases below are the recommended build sequence after this document is accepted.

### Phase 1 — Workbook parser

- Read `RELOJES CESAR ADMIN.xlsx` from controlled storage (not public).  
- Run sheet-specific parsers → immutable **ParseManifest** (JSON) + raw cell citations `(sheet, row, col)`.  
- Capture workbook file hash + parse version `cesar-maestro-v1`.

### Phase 2 — Normalization

- Map to WristOS-oriented DTOs: Client, Watch, Deal, Expense, BankTx, CashTx, Receivable, Payable, PartnerAccrual.  
- Apply cleansing rules (serial pollution, brand aliases).  
- Attach provenance to every record.

### Phase 3 — Validation

- Hard/soft rules from §6.  
- Produce ValidationReport with counts, samples, and blocking errors.

### Phase 4 — Preview

- Admin wizard UI: sheet coverage, record counts, sample rows, REPORTE expected vs computed.  
- Filter by entity type; show provenance.

### Phase 5 — Dry run

- Transactionless simulation against production-like DB (or transaction rollback).  
- Emit would-be inserts/updates; **zero durable writes**.  
- Compare aggregates to `REPORTE`.

### Phase 6 — Transactional import

- Explicit approval by OWNER.  
- Single DB transaction per entity batch or one mega-transaction with savepoints.  
- Idempotent on `(tenantId, sourceWorkbookHash, entityFingerprint)`.  
- Post-import REPORTE reconciliation attestation stored in audit log.  
- Cutover flag: workbook migration complete → new ops only in WristOS.

---

## 11. Mapping to current WristOS (approximate)

| Legacy | Likely WristOS | Notes |
|---|---|---|
| VENTAS lines | `Deal` + `Client` + `Watch` | Core |
| INVENTARIO | `Watch` AVAILABLE | Core |
| CTAS X COBRAR | `Receivable` + `ReceivablePayment` | Core |
| GASTOS | Expenses / `WatchExpense` | Partial |
| CONTROL BANCOS / EFECTIVO / CRIPTO / CUENTA CESAR | Treasury (confirm module coverage) | May need staging |
| CTAS X PAGAR | AP (gap?) | Confirm product |
| COBRO UTILIDADES | Partner equity | Review-heavy |
| REPORTE | Migration acceptance report | Not a table |
| OSCAR PAPA CAMI | Manual / side case | Out of core path optional |

---

## 12. Appendix — Quick counts snapshot

| Dataset | Count (approx) |
|---|---:|
| Sales lines | 469 |
| Unique sale clients | 240 |
| Inventory real-ish lines | ~40 |
| Expense lines | 287 |
| Bank movements | 520 |
| EFECTIVO MXN dated (visible/hidden) | 134 / 621 |
| EFECTIVO USD dated | 54 |
| CUENTA CESAR movements | 210 |
| CXC client cards (labels) | ~53 |
| CXP acreedor labels | ~17 |
| Partner utility months | 12 columns |

---

## 13. Document control

| Field | Value |
|---|---|
| Workbook filename | `RELOJES CESAR ADMIN.xlsx` |
| Analysis method | Direct openpyxl inspection (formulas + cached values) |
| Official migration source | **This workbook only** |
| PDF historical import | Deprecated as official path (code may remain unused) |
| Next step after acceptance | Implement Phase 1 parser only after explicit go-ahead |

---

*End of analysis. No migration code, no database writes, no production behavior changes are authorized by this document alone.*
