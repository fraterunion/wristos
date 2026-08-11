# WristOS Command Coverage Audit (Commit 25A → updated 26D)

> **26D update:** Production executable AI WRITEs are now exactly **FOURTEEN**
> (`REVERSE_EXPENSE` + `REVERSE_TREASURY_TRANSFER`). Machine truth:
> [`command-coverage.json`](./command-coverage.json). Composition unchanged.
> Still **LEVEL 1** — not full Level 2.

**Status:** AUDIT / ROADMAP (historical body below may still say TEN/THIRTEEN)  
**Production executable AI WRITEs:** exactly **FOURTEEN** (see JSON)  
**Composition V1:** `PURCHASE_SELLER → CREATE_CLIENT`, `SALE_CUSTOMER → CREATE_CLIENT` only  
**Machine-readable summary:** [`command-coverage.json`](./command-coverage.json)

---

## 1. Executive coverage summary

César can **enter** the core daily financial loop through the Assistant (buy, sell, collect, pay, expense, transfer liquidity, create/update client, capital in/out). He cannot yet **correct/reverse** most of those writes conversationally, nor create **manual CxC/CxP**, maintain **inventory metadata**, process **Radar**, or manage **investors/ownership**.

| Metric | Value |
|---|---|
| Meaningful manual business actions audited | **62** |
| Fully covered (AI executable) | **10** |
| Partially covered | **8** |
| Uncovered (operational, candidate) | **28** |
| Intentionally excluded | **16** |
| **Overall WRITE command coverage** | **21.7%** = 10/(10+8+28) |
| Financial command coverage | **38.5%** |
| Inventory coverage | **12.5%** |
| CRM coverage | **40.0%** |
| Capital coverage | **25.0%** |

**Honest product claim today:** Assistant reaches **LEVEL 1 — Core transaction entry**.  
**Claim “César can operate WristOS through the Assistant”** requires at least **LEVEL 2 — Core corrections/reversals** (plus manual receivable/payable create).

---

## 2. Production AI surface (frozen at audit)

### Executable WRITEs (10)

1. `REGISTER_SALE`  
2. `REGISTER_RECEIVABLE_PAYMENT`  
3. `REGISTER_EXPENSE`  
4. `REGISTER_PURCHASE`  
5. `CREATE_CLIENT`  
6. `UPDATE_CLIENT`  
7. `REGISTER_PAYABLE_PAYMENT`  
8. `REGISTER_TREASURY_TRANSFER`  
9. `REGISTER_CAPITAL_CONTRIBUTION`  
10. `REGISTER_CAPITAL_DISTRIBUTION`

### Catalogued unbound WRITEs

- `REGISTER_SETTLEMENT`  
- `REGISTER_CRYPTO_POSITION`  
- `REGISTER_CRYPTO_PRICE`

### Composition V1

```
REGISTER_PURCHASE + PURCHASE_SELLER → CREATE_CLIENT
REGISTER_SALE + SALE_CUSTOMER → CREATE_CLIENT
```

No Capital, expense, settlement, or Radar composition.

### READ capabilities (14 bound)

Liquidity, monthly profit, search inventory/client, client accounts, inventory aging, top inventory capital, top debtors, receivable summary, sales margin, profit by brand, top sales, attention items, business summary.

Read gaps that block future writes: no dedicated “list investors / pending”, “list open payables”, “get last ActionRun”, “search Radar listings” as first-class READ capabilities (some are reachable via OI/tools but not as structured intents for every write resolver).

---

## 3. Existing TEN-write scorecard

| Capability | Domain | Safety | Idempotency | Recovery | Correction completeness | NL readiness | Overall |
|---|---|---|---|---|---|---|---|
| REGISTER_SALE | GREEN | GREEN | GREEN | GREEN | **YELLOW** — create only; cancel/edit manual | YELLOW — often clarifies | **YELLOW** |
| REGISTER_RECEIVABLE_PAYMENT | GREEN | GREEN | GREEN | GREEN | **YELLOW** — reverse/edit manual | YELLOW | **YELLOW** |
| REGISTER_EXPENSE | GREEN | GREEN | GREEN | GREEN | **YELLOW** — reverse/edit manual | YELLOW | **YELLOW** |
| REGISTER_PURCHASE | GREEN | GREEN | GREEN | GREEN | **YELLOW** — edit/delete/watch expense manual | YELLOW | **YELLOW** |
| CREATE_CLIENT | GREEN | GREEN | GREEN | GREEN | **YELLOW** — delete/interactions/prefs manual | GREEN | **YELLOW** |
| UPDATE_CLIENT | GREEN | GREEN | GREEN | GREEN | GREEN for field patch; interactions separate | YELLOW | **GREEN** |
| REGISTER_PAYABLE_PAYMENT | GREEN | GREEN | GREEN | GREEN | **YELLOW** — reverse/create payable manual | YELLOW | **YELLOW** |
| REGISTER_TREASURY_TRANSFER | GREEN | GREEN | GREEN | GREEN | **YELLOW** — reverse exists in UI, not AI | GREEN | **YELLOW** |
| REGISTER_CAPITAL_CONTRIBUTION | GREEN | GREEN | GREEN | GREEN | **YELLOW** — reverse/notes UI | GREEN | **YELLOW** |
| REGISTER_CAPITAL_DISTRIBUTION | GREEN | GREEN | GREEN | GREEN | **YELLOW** — reverse/notes UI | GREEN | **YELLOW** |

No RED among the ten. YELLOW is almost always **correction/reversal gap**, not domain incorrectness.

---

## 4. Correction / reversal gap (critical)

Every deployed write says some form of **“Corregir en X”** after success. Creation is conversational; correction is manual.

| Write | Create | Update | Reverse/cancel | Conversational correction |
|---|---|---|---|---|
| REGISTER_SALE | YES | NO | NO (`DELETE /deals/:id`) | NO |
| REGISTER_RECEIVABLE_PAYMENT | YES | NO | NO (payment reverse APIs exist) | NO |
| REGISTER_EXPENSE | YES | NO | NO (`DELETE /expenses/:id`) | NO |
| REGISTER_PURCHASE | YES | NO | NO (watch delete / edit) | NO |
| CREATE_CLIENT | YES | via UPDATE | NO (soft delete) | PARTIAL via UPDATE |
| UPDATE_CLIENT | YES | YES | N/A | YES |
| REGISTER_PAYABLE_PAYMENT | YES | NO | NO | NO |
| REGISTER_TREASURY_TRANSFER | YES | N/A | NO (UI: `POST …/reverse`) | NO |
| REGISTER_CAPITAL_CONTRIBUTION | YES | notes-only UI | NO (`DELETE` → reverse) | NO |
| REGISTER_CAPITAL_DISTRIBUTION | YES | notes-only UI | NO (`DELETE` → reverse) | NO |

**Largest remaining product gap:** LEVEL 2 conversational correction/reversal with HIGH confirmation — not more create entry points alone.

### Reversal policy options (do not implement)

| Option | Recommendation |
|---|---|
| A. Manual-only forever | Rejected for OpEx/payments/transfers César routinely mistypes |
| B. Explicit HIGH-risk confirm | **Default for financial reversals** |
| C. Two-step confirm | For sale cancel / ownership / merge |
| D. Last-action undo | Only if bounded to same ActionRun + short TTL; not generic undo |

Per domain (policy only):

- Expense / treasury transfer / capital ledger: **B** when domain reverse is safe  
- Sale cancel: **C** (inventory + payments coupling)  
- Client merge/delete: **C** or stay manual  
- Ownership change: **never ordinary one-click**; prefer manual Capital UI  

---

## 5. Module-by-module matrix

Coverage: `FULL` | `PARTIAL` | `NONE` | `NOT_NEEDED`  
Risk: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`

### Inventory / Watches (`/inventory`, `InventoryController`)

| Manual action | UI | API | Domain | AI | Coverage | Risk | Domain ready | Schema | Next |
|---|---|---|---|---|---|---|---|---|---|
| Register purchase | Inventory modal | `POST /inventory/purchases` | `PurchaseRegistrationService.register` | REGISTER_PURCHASE | FULL | HIGH | YES | NO | — |
| Create inventory-only watch | Ventas quick-watch / inventory | `POST /inventory` | `InventoryService.create` | — | NONE | MEDIUM | YES | NO | P1 CREATE_WATCH |
| Update watch metadata | Watch form | `PATCH /inventory/:id` | `InventoryService.update` | — | NONE | MEDIUM | YES | NO | P1 UPDATE_WATCH |
| Delete/remove watch | Inventory | `DELETE /inventory/:id` | `InventoryService.remove` | — | NONE | HIGH | YES | NO | P2 / careful |
| Add watch expense | Watch form | `POST …/expenses` | `addExpense` | — | NONE | MEDIUM | YES | NO | P1 ADD_WATCH_EXPENSE |
| Remove watch expense | Watch form | `DELETE …/expenses/:id` | `removeExpense` | — | NONE | MEDIUM | YES | NO | P2 |
| Image upload/reorder | Gallery | image endpoints | image services | — | NOT_NEEDED | LOW | YES | NO | P3 manual |
| Import inventory | Data onboarding | commit import | WatchImportService | — | NOT_NEEDED | HIGH | YES | NO | P3 admin |

**Inventory coverage:** 1 FULL / (1+0+7) ≈ **12.5%** among operational inventory commands (images/import excluded as NOT_NEEDED).

### Sales / Deals (`/ventas`, `/deals`)

| Manual action | UI | API | Domain | AI | Coverage | Risk | Next |
|---|---|---|---|---|---|---|---|
| Register sale | Ventas | `POST /deals/register-sale` | `DealsService.registerSale` | REGISTER_SALE | FULL | HIGH | — |
| Add sale/receivable payment | Ventas / Cuentas | deals/cuentas payments | payment services | REGISTER_RECEIVABLE_PAYMENT | PARTIAL | HIGH | clarify scope |
| Create pipeline deal | Deals | `POST /deals` | `DealsService.create` | — | NONE | MEDIUM | P2 |
| Update deal fields | Deals | `PATCH /deals/:id` | `update` | — | NONE | HIGH | P1 UPDATE_SALE |
| Change stage | Deals | `PATCH …/stage` | `updateStage` | — | NONE | MEDIUM | P2 |
| Cancel/remove deal | Deals | `DELETE /deals/:id` | `remove` | — | NONE | CRITICAL | P1 CANCEL_SALE (policy C) |
| Payments CRUD | Deals/Payments | `/payments` | PaymentsService | — | NONE | HIGH | P1 with reverse |

### Cuentas / Receivables / Payables

| Manual action | UI | API | Domain | AI | Coverage | Risk | Next |
|---|---|---|---|---|---|---|---|
| Create manual receivable | Cuentas | `POST /cuentas/entries` | `CuentasService.createEntry` | — | NONE | HIGH | **P0 CREATE_RECEIVABLE** |
| Create manual payable | Cuentas | `POST /cuentas/entries` | `createEntry` | — | NONE | HIGH | **P0 CREATE_PAYABLE** |
| Edit entry | Cuentas | `PATCH …/entries/:id` | `updateEntry` | — | NONE | HIGH | P1 |
| Cancel/delete entry | Cuentas | `DELETE …/entries/:id` | `removeEntry` | — | NONE | HIGH | P1 |
| Register receivable payment | Cuentas | payment create | createPayment | REGISTER_RECEIVABLE_PAYMENT | FULL | HIGH | — |
| Register payable payment | Cuentas | payment create | createPayment | REGISTER_PAYABLE_PAYMENT | FULL | HIGH | — |
| Settlement via APPLY_TO_PAYABLE | Cuentas payment dest | payment create | settlement path | PARTIAL via receivable | PARTIAL | HIGH | P1 standalone optional |
| Reverse settlement | API | `DELETE /cuentas/settlements/:id` | `reverseSettlement` | — | NONE | HIGH | P1 |
| Reverse payment | Receivables API / delete payment | reverse/delete | services | — | NONE | HIGH | P1 |
| Write-off | Receivables API | `POST …/write-off` | writeOff | — | NONE | CRITICAL | P2 |

**Financial coverage** (sales+cuentas+expense+treasury+capital create/pay/transfer subset): see §1.

### Expenses

| Manual action | AI | Coverage | Risk | Next |
|---|---|---|---|---|
| Register expense | REGISTER_EXPENSE | FULL | MEDIUM | — |
| Edit expense | — | NONE | MEDIUM | P1 notes-only or reverse+recreate |
| Reverse/delete expense | — | NONE | HIGH | **P0 REVERSE_EXPENSE** |

### CRM

| Manual action | AI | Coverage | Risk | Next |
|---|---|---|---|---|
| Create client | CREATE_CLIENT | FULL | MEDIUM | — |
| Update client | UPDATE_CLIENT | FULL | MEDIUM | — |
| Delete/archive client | — | NONE | HIGH | P2 ARCHIVE_CLIENT |
| Interaction log | — | NONE | LOW | P2 |
| Preference upsert | — | NONE | LOW | P2 |
| Restore / merge | **No API today** | NOT_NEEDED until domain exists | CRITICAL (merge) | Domain first |

**CRM coverage:** 2 FULL / (2+0+3) = **40%** (excl. missing restore/merge APIs).

### Treasury

| Manual action | AI | Coverage | Risk | Next |
|---|---|---|---|---|
| Internal transfer | REGISTER_TREASURY_TRANSFER | FULL | HIGH | — |
| Reverse transfer | UI yes / AI no | NONE | HIGH | **P0 REVERSE_TREASURY_TRANSFER** |
| Physical cash balance adj. | API only | NONE | HIGH | P1 ADJUST_PHYSICAL_CASH |
| Generic manual inflow/outflow | Not primary UI | NOT_NEEDED | HIGH | keep manual if introduced |

### Capital

| Manual action | AI | Coverage | Risk | Next |
|---|---|---|---|---|
| Contribution | REGISTER_CAPITAL_CONTRIBUTION | FULL | HIGH | — |
| Distribution | REGISTER_CAPITAL_DISTRIBUTION | FULL | HIGH | — |
| Notes edit | UI PATCH notes-only | NONE | LOW | P2 or keep manual |
| Reverse contribution/distribution | UI DELETE→reverse | NONE | HIGH | P1 REVERSE_* (policy B) |
| Create investor | UI | NONE | MEDIUM | P2 CREATE_INVESTOR |
| Update ownership % | UI | NONE | **CRITICAL** | **P3 manual forever** unless two-step |

**Capital coverage:** 2 FULL / (2+0+6) = **25%**.

### Matching

| Manual action | AI | Coverage | Next |
|---|---|---|---|
| Recalculate | NONE | NONE | P3 |
| Dismiss suggestion | NONE | NONE | P2 |
| Convert match → deal | **Not a single API** | NONE | P1 if product adds convert |

Matching is mostly dismiss/recalc — not a full CRM/sales engine.

### Radar

| Manual action | AI | Coverage | Risk | Next |
|---|---|---|---|---|
| Upload import | NONE | NONE | MEDIUM | P1 PROCESS_RADAR_IMPORT |
| Classify | NONE | NONE | MEDIUM | P1 |
| Confirm listing → ops | NONE | NONE | HIGH | **P1 PROCESS_RADAR_ITEM** |
| Dismiss / edit listing | NONE | NONE | LOW–MED | P2 |

Radar is a real mutation surface — not read-only.

### Automations

Create/update/run rules: **NOT_NEEDED** for César operating agent (platform/admin). Keep manual.

### History

**Read-only.** NO COMMAND REQUIRED.

### Imports / Data onboarding / Platform migrations

Bulk commit, mapping, freeze: **NOT_NEEDED** conversationally. Admin/offline migration.

### Crypto

| Manual action | AI catalog | Executable | Coverage | Recommendation |
|---|---|---|---|---|
| Create holding | REGISTER_CRYPTO_POSITION | NO | NONE | P2 — only if César regularly marks USDT; HIGH risk (pricing) |
| Price snapshot | REGISTER_CRYPTO_PRICE | NO | NONE | P2 — needs trusted price source |
| Update/delete holding | — | NO | NONE | with position write |

**Crypto recommendation:** keep unbound for Command Coverage V1/V2. Not required to claim LEVEL 2 operate-from-Assistant. Domain exists; product priority is low vs corrections + CxC/CxP.

### Storefront

Convert reservation: NONE / P2 (niche).

### Dashboard / Platform Assistant Health

Read-only. NOT_NEEDED as writes.

---

## 6. Critical user workflows

| # | Workflow | Assistant-only today? | Gap |
|---|---|---|---|
| 1 | Buy watch | YES (purchase + seller composition) | Corrections manual |
| 2 | Sell watch | YES (sale + customer composition) | Cancel/edit manual |
| 3 | Collect customer | YES | Reverse payment manual |
| 4 | Pay supplier | YES | Reverse / create payable manual |
| 5 | Record expense | YES | Reverse manual |
| 6 | Move liquidity | YES | Reverse transfer manual |
| 7 | Add customer | YES | — |
| 8 | Correct customer | YES (UPDATE_CLIENT) | Interactions/prefs |
| 9 | Add capital | YES | Reverse/notes UI |
| 10 | Distribute profit | YES | Reverse/notes UI |
| 11 | Create manual receivable | **NO** | CREATE_RECEIVABLE |
| 12 | Create manual payable | **NO** | CREATE_PAYABLE |
| 13 | Correct a sale | **NO** | UPDATE/CANCEL_SALE |
| 14 | Correct a purchase | **NO** | UPDATE_WATCH / reverse purchase |
| 15 | Reverse/cancel transactions | **NO** | REVERSE_* family |
| 16 | Update inventory info | **NO** | UPDATE_WATCH |
| 17 | Add watch expense | **NO** | ADD_WATCH_EXPENSE |
| 18 | Reconcile physical cash | **NO** | ADJUST_PHYSICAL_CASH |
| 19 | Settlement CXC↔CXP | **PARTIAL** (via receivable dest) | standalone SETTLEMENT |
| 20 | Manage investor ownership | **NO** | keep manual CRITICAL |
| 21 | Process Radar lead | **NO** | PROCESS_RADAR_ITEM |
| 22 | Convert match to sale | **NO** | product+AI |
| 23 | Archive/merge client | **NO** | domain+AI; merge CRITICAL |

---

## 7. Standalone settlement recommendation

**Today:** Settlement can execute as destination `APPLY_TO_PAYABLE` inside `REGISTER_RECEIVABLE_PAYMENT` (bound). Standalone `REGISTER_SETTLEMENT` is catalogued but unbound. Admin has no dedicated “reverse settlement” button wired (API exists).

**Recommendation:** **P1 bind `REGISTER_SETTLEMENT`** for utterances like “Compensa 100 mil de lo que José nos debe contra lo que le debemos” when both accounts are known — meaningful coverage, domain ready, HIGH risk, no schema. Not P0 ahead of CREATE_RECEIVABLE/PAYABLE and REVERSE_EXPENSE.

---

## 8. Composition-gap recommendations (closed edges only)

Do **not** open a generic graph. Only real closed edges:

| Parent | Reason | Child | Priority |
|---|---|---|---|
| CREATE_RECEIVABLE | RECEIVABLE_COUNTERPARTY | CREATE_CLIENT | P0 with CREATE_RECEIVABLE |
| CREATE_PAYABLE | PAYABLE_COUNTERPARTY | CREATE_CLIENT | P0 with CREATE_PAYABLE |
| (existing) REGISTER_PURCHASE | PURCHASE_SELLER | CREATE_CLIENT | live |
| (existing) REGISTER_SALE | SALE_CUSTOMER | CREATE_CLIENT | live |

**Do not** compose Capital, Expense, Transfer, or Radar into multi-write graphs.

---

## 9. Dangerous actions (not ordinary one-click)

- Investor **ownership %** change  
- Client **merge** (no API yet) / delete with relationships  
- **Sale cancellation** (inventory + payments)  
- Financial **reversals** (sale/payment/expense/transfer/capital)  
- Destructive inventory correction / delete sold watch  
- Historical Capital remediation / 1970-style date fixes  
- Bulk import commit / rollback  
- Platform migration freeze  

Policy: HIGH/CRITICAL confirmation, typed stale failures, no conversational “undo everything”.

---

## 10. Definition: “Assistant can operate WristOS”

| Level | Meaning | Status |
|---|---|---|
| **LEVEL 1** | Core transaction **entry** for daily ops | **CURRENT** (10 writes) |
| **LEVEL 2** | Core **corrections/reversals** + manual CxC/CxP create | Required for truthful operate claim |
| **LEVEL 3** | Inventory maintenance, Radar, watch expenses, physical cash | Completeness |
| **LEVEL 4** | Automations, imports, ownership, platform | Intentionally mostly manual |

**Precise claim after LEVEL 2:**  
“César can enter and correct the core operating ledger (inventory purchase/sale, CxC/CxP, expenses, treasury, capital, clients) through the Assistant with confirmation — without using module UIs for those paths.”

---

## 11. Roadmap

### P0 — blocks “operate from Assistant”

| Capability | Replaces | Domain ready | Schema | Risk | Composition | Size |
|---|---|---|---|---|---|---|
| CREATE_RECEIVABLE | Manual CxC create | YES `CuentasService.createEntry` | NO | HIGH | + CREATE_CLIENT | MEDIUM |
| CREATE_PAYABLE | Manual CxP create | YES | NO | HIGH | + CREATE_CLIENT | MEDIUM |
| REVERSE_EXPENSE | Delete expense UI | YES `ExpensesService.remove` | NO | HIGH | no | SMALL |
| REVERSE_TREASURY_TRANSFER | Transfer reverse UI | YES `TreasuryTransferService.reverse` | NO | HIGH | no | SMALL |

### P1 — high-value coverage

| Capability | Notes | Size |
|---|---|---|
| REGISTER_SETTLEMENT (bind) | Standalone offset | MEDIUM |
| REVERSE_RECEIVABLE_PAYMENT / REVERSE_PAYABLE_PAYMENT | Domain reverse paths | MEDIUM |
| REVERSE_CAPITAL_CONTRIBUTION / REVERSE_CAPITAL_DISTRIBUTION | Existing reverse() | SMALL–MED |
| CANCEL_SALE / UPDATE_SALE | Careful inventory coupling | LARGE |
| UPDATE_WATCH | Metadata/serial/cost | MEDIUM |
| ADD_WATCH_EXPENSE | Watch-linked OpEx-ish | MEDIUM |
| ADJUST_PHYSICAL_CASH | API exists, no UI | MEDIUM |
| PROCESS_RADAR_ITEM | Confirm/dismiss/classify | LARGE |

### P2 — convenience

CREATE_WATCH (inventory-only), ARCHIVE_CLIENT, client interactions/prefs, matching dismiss, storefront convert, crypto bind (if product needs), capital notes via AI, automation run-now.

### P3 — intentionally manual/admin

Ownership changes, merge client, bulk imports, platform migrations, automations CRUD, image management, historical remediation, Radar bulk import pipeline as admin.

---

## 12. NL vs domain blockers

| Capability | Primary blocker if pain |
|---|---|
| Current TEN | Mostly **NL extraction / clarification rate**, not missing domain |
| Manual CxC/CxP | **Missing command** |
| Reversals | **Missing command** (+ policy) |
| Settlement standalone | **Unbound catalog** |
| Crypto | **Product priority** + pricing trust |
| Radar | **Missing command** + resolver |
| Ownership | **Intentionally excluded** |

Do not treat clarification-heavy Claude behavior as missing domain coverage.

---

## 13. Telemetry KPIs (future validation)

From Assistant Health architecture (passive):

- Intent attempts / confirmations / successes per capability  
- Clarification + ENTITY_PICKER rates  
- Recovery / reversed / invariant failures  
- Over-distribution frequency (capital)  
- Adoption share of TEN writes  
- Manual fallback: not directly measured unless UI emits “opened module after fail-closed”

Do not invent production numbers in this audit.

---

## 14. Recommended next commit

**25B — `CREATE_RECEIVABLE` + `CREATE_PAYABLE`** (TYPE B, likely no migration)

Rationale: highest-frequency uncovered financial entry after the TEN writes; `CuentasService` ready; natural composition to `CREATE_CLIENT`; unlocks workflows 11–12 without touching CRITICAL ownership/sale-cancel yet.

Parallel track (can be 25C): **REVERSE_EXPENSE** + **REVERSE_TREASURY_TRANSFER** (SMALL, domain reverse already exists).

---

## 15. Confirmation

- Production registry remains **exactly TEN** executable WRITEs  
- This commit adds **no** runtime binding, schema, or deploy  
- Audit artifacts only: this doc, `command-coverage.json`, architecture test  

---

## Appendix A — Coverage math (operational set)

Denominator excludes `NOT_NEEDED` / intentionally excluded admin-bulk-platform actions.

- Overall: 10 / (10 + 8 + 28) = **21.7%**  
- Financial (sale/cxc/cxp/expense/treasury/capital ops subset ≈ 26 actions): ~10 full / ~16 in denom ≈ **38.5%**  
- Inventory operational (8): 1/8 = **12.5%**  
- CRM operational (5): 2/5 = **40%**  
- Capital operational (8): 2/8 = **25%**

Exact row-level enumeration is maintained conceptually in this audit; `command-coverage.json` stores the rolled-up metrics for drift tests.
