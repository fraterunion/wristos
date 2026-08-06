# WristOS AI — Interaction Model Specification

**Commit 1.5 of the WristOS AI architecture.**
Builds on the Constitution (brain, safety, planning, tools, permissions, memory, execution). This document defines the *face*: how WristOS AI talks, asks, renders, confirms, and recovers, across mobile and desktop.

This document contains no code, no schema, no persistence design. It is the canonical UX contract that any implementation (Cursor or otherwise) must satisfy.

---

## 1. Executive Summary

WristOS AI is a conversational operating surface for running a luxury watch dealership — not a chatbot bolted onto a dashboard. The person operating it should feel like they're talking to a capable operator who already knows the business: someone who asks only for what's actually missing, groups related questions into a single motion, shows exactly what will happen before it happens, and never quietly does something consequential.

The interaction model rests on one structural decision: **the LLM never generates UI.** It interprets intent and emits a typed interaction state from a closed catalog. The application renders that state with deterministic, pre-built components. This keeps every surface predictable, testable, accessible, and safe — the model can be wrong about *what* the user wants, but it can never be wrong about *how* that gets shown, because it doesn't control how anything is shown.

Every write action passes through the same funnel regardless of entry point (typed, voice-transcribed, or suggested): interpretation → structured plan → deterministic confirmation → execution → receipt. Nothing skips the confirmation step except explicitly-classified Tier 0/1 read and navigation actions.

The system is mobile-first because that's where an owner or salesperson actually reaches for it — between customers, at an event, standing at the safe. Desktop keeps the AI as a companion to the existing Dashboard, not a replacement for it.

---

## 2. Interaction Principles

1. **Ask once, not repeatedly.** Missing fields are collected into a single structured card, not a sequence of chat questions. Three sequential questions is a failure of design, not a feature of "conversation."
2. **The LLM emits state, the app renders UI.** No arbitrary HTML, no free-form component generation, no exceptions. A response the renderer doesn't recognize is a bug, not a fallback to raw text.
3. **Form follows function.** Text explains. Cards act. Tables compare. Selectors resolve ambiguity. Confirmation surfaces gate writes. Never use a text answer where a card is being requested, and never wrap a card in unnecessary prose.
4. **No execution from raw natural language.** Every write becomes a structured plan the user can see in full before it runs. "Vendí Batman" is an intent, never an executed sale.
5. **Mobile-first, thumb-reachable.** Primary actions sit in the bottom two-thirds of the screen. No control that matters is placed where a thumb can't reach it one-handed.
6. **Confidence shapes behavior, not vocabulary.** A low-confidence match becomes a disambiguation card or a suggestion with weaker visual commitment — never a number shown to the user.
7. **Minimize friction without trading away safety.** Fewer taps is a goal; skipping confirmation on a Tier 3+ action to save a tap is not an acceptable trade.
8. **Every state has an obvious next action.** No screen should leave the user wondering what to do next — including error and cancelled states.

---

## 3. State Machine

### 3.1 States

| State | Purpose |
|---|---|
| `IDLE` | No active turn. Home surface, awaiting input. |
| `INTERPRETING` | Input received, model is parsing intent. Sub-second in the common case. |
| `ANSWERING` | Read-only response being composed/streamed (Tier 0/1). |
| `NEEDS_INPUT` | Required fields are missing; a structured card is requesting them. |
| `NEEDS_DISAMBIGUATION` | Intent is clear but the target entity/value is not; a selector is shown. |
| `READY_FOR_CONFIRMATION` | Plan is fully resolved; confirmation surface is shown, nothing has executed. |
| `EXECUTING` | Confirmed plan is running against real systems. |
| `COMPLETED` | Plan executed fully; receipt is shown. |
| `PARTIALLY_COMPLETED` | Multi-action plan where some steps succeeded and at least one failed. |
| `FAILED` | Execution did not succeed; nothing (or only prior confirmed steps) was committed. |
| `CANCELLED` | User backed out before execution. Nothing was committed. |
| `STALE_PLAN` | A confirmed-but-unexecuted plan's underlying data changed (price moved, item sold elsewhere, balance changed). |
| `PERMISSION_BLOCKED` | The requested action is outside what this user/role may do. |

### 3.2 Transition Table

| From | To | Trigger |
|---|---|---|
| `IDLE` | `INTERPRETING` | User sends input (text or transcribed voice) |
| `INTERPRETING` | `ANSWERING` | Intent is a read-only query, fully resolved |
| `INTERPRETING` | `NEEDS_INPUT` | Intent is a write, required fields missing |
| `INTERPRETING` | `NEEDS_DISAMBIGUATION` | Intent is clear, referenced entity/value is ambiguous |
| `INTERPRETING` | `READY_FOR_CONFIRMATION` | Intent is a write, all fields resolved unambiguously |
| `INTERPRETING` | `PERMISSION_BLOCKED` | Action is outside the user's role/permission tier |
| `NEEDS_INPUT` | `NEEDS_DISAMBIGUATION` | Submitted field is itself ambiguous (e.g., customer name matches two people) |
| `NEEDS_INPUT` | `READY_FOR_CONFIRMATION` | All required fields now resolved |
| `NEEDS_INPUT` | `CANCELLED` | User dismisses the card |
| `NEEDS_DISAMBIGUATION` | `NEEDS_INPUT` | Selection made, other fields still missing |
| `NEEDS_DISAMBIGUATION` | `READY_FOR_CONFIRMATION` | Selection made, all fields resolved |
| `NEEDS_DISAMBIGUATION` | `CANCELLED` | User picks "none of these" / dismisses |
| `READY_FOR_CONFIRMATION` | `EXECUTING` | User confirms |
| `READY_FOR_CONFIRMATION` | `NEEDS_INPUT` | User taps "edit" on a field |
| `READY_FOR_CONFIRMATION` | `CANCELLED` | User cancels |
| `READY_FOR_CONFIRMATION` | `STALE_PLAN` | Underlying data changed while the card sat unconfirmed |
| `STALE_PLAN` | `READY_FOR_CONFIRMATION` | User accepts refreshed values |
| `STALE_PLAN` | `CANCELLED` | User abandons the plan |
| `EXECUTING` | `COMPLETED` | All steps succeed |
| `EXECUTING` | `PARTIALLY_COMPLETED` | Multi-step plan, mixed outcome |
| `EXECUTING` | `FAILED` | Single-step plan fails, or all steps fail |
| `COMPLETED` / `PARTIALLY_COMPLETED` / `FAILED` / `CANCELLED` | `IDLE` | User dismisses receipt or starts a new turn |
| `PERMISSION_BLOCKED` | `IDLE` | User dismisses, may retry as an authorized user |

No state transitions directly into `EXECUTING` except from `READY_FOR_CONFIRMATION`. This is the one invariant the whole model exists to protect.

### 3.3 Per-State UI, Actions, Timeout, Recovery

**IDLE** — Visible UI: home surface (see §11). User actions: type, speak, tap a suggested action. Timeout: n/a. Recovery: n/a.

**INTERPRETING** — Visible UI: a lightweight typing/thinking indicator, never a spinner-only screen; the user's own input remains visible above it. User actions: none required; user may cancel the turn. Timeout: if interpretation exceeds ~4s, show "still working" without blocking input. If it exceeds ~15s, transition to `FAILED` with a retry action. Recovery: retry re-sends the same input.

**ANSWERING** — Visible UI: `TextAnswer`, `MetricCard`, `TableResult`, etc., streamed in. User actions: ask a follow-up, tap a suggested next action. Timeout: none — this is terminal for the turn. Recovery: n/a.

**NEEDS_INPUT** — Visible UI: `MissingFieldsCard` merged into the relevant Action Card. User actions: fill fields, use defaults where offered, cancel. Timeout: none (persists as a draft — see §14 for drafts on the mobile home). Recovery: card remains editable indefinitely; reopening the conversation restores it.

**NEEDS_DISAMBIGUATION** — Visible UI: `EntityPicker`. User actions: select one, search for another, "none of these." Timeout: none. Recovery: re-search narrows the candidate list.

**READY_FOR_CONFIRMATION** — Visible UI: `ConfirmationCard` or `DestructiveConfirmationCard`. User actions: confirm, edit a field (returns to `NEEDS_INPUT` for that field only), cancel. Timeout: soft — if unconfirmed and underlying data changes, transitions to `STALE_PLAN`; if simply idle, it just waits (see drafts). Recovery: edit-in-place, no need to restart the whole intent.

**EXECUTING** — Visible UI: `ExecutionProgressCard`. User actions: none (writes are not interruptible mid-flight once started, to avoid half-applied state); user can back out of the *view* but the action still completes. Timeout: if a single step exceeds the tool's expected latency, show "taking longer than usual," continue waiting — do not silently retry a write. Recovery: on timeout without response, the next `IDLE` turn will surface a reconciliation check ("¿la venta de Batman se registró? Voy a revisar.").

**COMPLETED** — Visible UI: `SuccessReceipt`. User actions: dismiss, undo (if reversible and within window), next suggested action. Timeout: none, persists in activity history. Recovery: n/a.

**PARTIALLY_COMPLETED** — Visible UI: `PartialFailureReceipt`, listing succeeded and failed steps separately. User actions: retry the failed step(s) only, dismiss, get details. Timeout: none. Recovery: retry re-enters `READY_FOR_CONFIRMATION` for the failed steps only — succeeded steps are never re-run.

**FAILED** — Visible UI: `ErrorRecoveryCard`. User actions: retry, edit and retry, cancel, contact/escalate for systemic errors. Timeout: none. Recovery: retry restores the original plan pre-filled.

**CANCELLED** — Visible UI: brief inline acknowledgment, then return to `IDLE`. User actions: none needed; can immediately start a new intent. Timeout: n/a. Recovery: n/a — nothing to recover, nothing was committed.

**STALE_PLAN** — Visible UI: `ConfirmationCard` re-rendered with changed fields highlighted and a one-line explanation of what changed. User actions: accept new values and confirm, cancel. Timeout: none. Recovery: re-confirmation re-validates against current data before executing.

**PERMISSION_BLOCKED** — Visible UI: `PermissionBlockedCard`. User actions: dismiss, request access (if a request flow exists), fall back to read-only view of the same data if permitted. Timeout: none. Recovery: n/a — blocked, not failed.

---

## 4. Typed Response Catalog

The LLM's output is always one of the following typed payloads. Below, "editable" means the payload can carry user-adjustable values before any execution; "leads to execution" means confirming it can trigger a write.

**1. TextAnswer** — Free-text explanation for genuinely conversational content (clarifying a term, explaining why something happened). Required: `text`. Optional: `citedEntities[]` (linked chips), `suggestedFollowUps[]`. Primary action: none. Secondary: follow-up chips. Mobile: full width, generous line height. Desktop: constrained reading width inside the panel. Accessibility: standard text semantics, no special handling. Editable: no. Executes: no.

**2. MetricCard** — A single business number ("¿cuánto tengo en César?"). Required: `label`, `value`, `currency/unit`, `asOf`. Optional: `delta`, `trend`, `sparkline`. Primary: "ver detalle." Secondary: "ver histórico." Mobile: large numeral, thumb-tap opens `MetricBreakdown`. Desktop: same, plus hover for exact timestamp. Accessibility: value read as full sentence by screen reader ("Efectivo en César: 480,000 pesos, al 6 de agosto"). Editable: no. Executes: no.

**3. MetricBreakdown** — Decomposition of a metric (cash by account, receivables by customer). Required: `total`, `segments[]`. Optional: `comparisonPeriod`. Primary: tap a segment to drill in. Secondary: export/share (desktop only). Mobile: stacked list, largest first. Desktop: list + optional chart. Accessibility: segments are a real list, not canvas-only. Editable: no. Executes: no.

**4. EntityList** — Multiple records shown for browsing, not choosing (e.g., "inventario disponible"). Required: `items[]`, `itemType`. Optional: `filters`, `sort`. Primary: tap item → entity detail. Secondary: filter, "ver todos" (desktop table). Mobile: card list, 3–5 visible, scrollable. Desktop: table-like list inline, full `TableResult` on request. Accessibility: each item is a focusable row with full label. Editable: no. Executes: no (browsing only — selecting an item for action re-enters interpretation).

**5. EntityPicker** — Disambiguation selector (see §6). Required: `prompt`, `candidates[]` (each with distinguishing context), `allowNoneOfThese`. Optional: `searchEnabled`. Primary: tap/select a candidate. Secondary: search, "ninguno de estos." Mobile: full-width option list, max 4 visible without scroll. Desktop: same list, wider context columns. Accessibility: radio-group semantics, arrow-key navigation. Editable: no (selection only). Executes: no directly — resolves a field that feeds a card.

**6. MissingFieldsCard** — Grouped request for required data (see §7). Required: `fields[]` (each typed: text/number/select/date/entity-search), `context` (what this belongs to). Optional: `optionalFields[]`, `suggestedDefaults`. Primary: "continuar" (enabled once required fields are valid). Secondary: cancel. Mobile: one field per row, numeric keypad for money fields, native pickers for date/select. Desktop: same layout, denser spacing, tab order = field order. Accessibility: labels bound to inputs, inline validation announced. Editable: yes, by definition. Executes: no — feeds into `ActionPreviewCard`/`ConfirmationCard`.

**7. ActionPreviewCard** — Pre-confirmation preview of a fully-or-mostly resolved action, before the formal confirmation gate (used when there's value in showing a draft before the final tier-appropriate confirmation, e.g. letting the user glance and correct before the heavier confirmation surface appears). Required: `title`, `entitySummary`, `resolvedFields[]`. Optional: `unresolvedFields[]`, `warnings[]`. Primary: "revisar" → advances to `ConfirmationCard`. Secondary: edit a field, cancel. Mobile: compact card, tap-to-expand. Desktop: inline, can sit beside the entity detail panel. Accessibility: same as MissingFieldsCard. Editable: yes. Executes: no — this is a preview, not a gate.

**8. ConfirmationCard** — The write gate for Tier 2–3 actions (see §9). Required: `action`, `before/after`, `financialEffects[]`, `operationalEffects[]`, `actor`, `effectiveDate`. Optional: `warnings[]`. Primary: "confirmar." Secondary: "editar," "cancelar." Mobile: bottom-anchored sheet, primary action within thumb reach. Desktop: modal or inline panel depending on entry point. Accessibility: focus trapped in the card, confirm is never the accidental default on Enter without visible focus. Editable: yes (routes back to `NEEDS_INPUT` per field). Executes: yes.

**9. DestructiveConfirmationCard** — The reinforced gate for Tier 4 actions (see §9). Required: everything `ConfirmationCard` has, plus `reversibility` statement and explicit typed/tapped acknowledgment of consequence. Optional: `requiresReasonText` (for reversals/deletions, capture *why*). Primary: "sí, eliminar/revertir" (never the visually default button). Secondary: cancel (visually primary by default). Mobile: full-screen takeover, cannot be dismissed by outside tap. Desktop: modal, cannot be dismissed by outside click. Accessibility: destructive action label is never color-only (icon + text), confirm button requires explicit focus+activate, not Enter-through. Editable: no inline edit — cancel and restart if something's wrong. Executes: yes.

**10. ExecutionProgressCard** — Shown during `EXECUTING`. Required: `steps[]` with per-step status. Optional: `estimatedTime`. Primary: none (not interactive on writes in flight). Secondary: none. Mobile: compact stepper. Desktop: same, can stay docked in panel while user continues elsewhere. Accessibility: live-region announcement per step completion. Editable: no. Executes: n/a (this *is* execution).

**11. SuccessReceipt** — Terminal state for `COMPLETED` (see §14). Required: all receipt fields from §14. Optional: `undoAvailableUntil`. Primary: next suggested action. Secondary: "deshacer" (if applicable), "ver detalle," dismiss. Mobile: card in activity feed + toast on completion. Desktop: same + optionally opens affected entity. Accessibility: announced via live region once, not repeated. Editable: no. Executes: no (undo is a new, separately-confirmed reversal action, not a re-open).

**12. PartialFailureReceipt** — Terminal for `PARTIALLY_COMPLETED`. Required: `succeededSteps[]`, `failedSteps[]` with reasons. Primary: "reintentar fallidos." Secondary: "ver detalle," dismiss. Mobile: two clearly separated lists (green/succeeded, red/failed) — never merged. Desktop: same. Accessibility: counts announced ("2 de 3 acciones completadas"). Editable: no. Executes: yes (retry only).

**13. ErrorRecoveryCard** — Terminal for `FAILED` (see §15). Required: `whatHappened`, `whatDidNotChange`, `nextActions[]`. Optional: `technicalDetail` (collapsed by default). Primary: the most likely fix (retry, or edit-and-retry). Secondary: cancel, "ver detalle técnico." Mobile: compact, technical detail behind a disclosure. Desktop: same. Accessibility: error announced with role="alert" once. Editable: depends on cause (yes if a bad field caused it). Executes: yes (retry).

**14. PermissionBlockedCard** — Terminal for `PERMISSION_BLOCKED`. Required: `action`, `requiredRole/permission`. Optional: `requestAccessAvailable`. Primary: dismiss, or "solicitar acceso" if wired up. Secondary: "ver en modo lectura" if a read view exists. Mobile: compact, non-alarming tone. Desktop: same. Accessibility: not styled as an error (it isn't one) — neutral, informative tone and color. Editable: no. Executes: no.

**15. ActivityCard** — Single item in the recent-activity feed (mobile home / desktop panel). Required: `summary`, `timestamp`, `actor`, `entityLink`. Optional: `financialDelta`. Primary: tap → full receipt or entity. Secondary: none. Mobile: compact single line + delta chip. Desktop: same, denser list. Accessibility: full sentence on focus. Editable: no. Executes: no.

**16. TableResult** — Dense tabular comparison (desktop-favored). Required: `columns[]`, `rows[]`. Optional: `sortable`, `exportable`. Primary: row tap → detail. Secondary: sort, filter, export (desktop). Mobile: collapses to `EntityList`-style cards below a column threshold — never a horizontally-scrolling data table as the default. Desktop: full table. Accessibility: real `<table>` semantics, sortable headers keyboard-operable. Editable: no. Executes: no.

**17. QuickActions** — Contextual shortcut chips (home screen, post-receipt). Required: `actions[]` (label + intent). Optional: `icon`. Primary: tap → starts that intent's turn. Secondary: none. Mobile: horizontal scroll chip row. Desktop: chip row or sidebar shortcuts. Accessibility: each chip is a labeled button, not a bare icon. Editable: no. Executes: no directly (starts a new interpretation).

**18. NavigationSuggestion** — Offer to jump to a manual UI view ("mejor mira el módulo de inventario"). Required: `label`, `route`. Optional: `reason`. Primary: "ir." Secondary: dismiss, stay in chat. Mobile: inline chip within the answer. Desktop: same, or opens the module beside the panel (see §12). Accessibility: standard link semantics. Editable: no. Executes: no (navigation only).

**19. ConversationSummary** — Compact recap of a long or multi-action exchange, used when reopening a conversation or after a plan spans many turns. Required: `intentsCovered[]`, `outcomes[]`. Optional: `pendingItems[]`. Primary: tap a pending item to resume it. Secondary: dismiss. Mobile: collapsed card at top of resumed thread. Desktop: same. Accessibility: heading-level summary, expandable. Editable: no. Executes: no directly (resuming a pending item re-enters its own state).

---

## 5. Action Card System

Canonical Action Cards are `ConfirmationCard`/`ActionPreviewCard` specializations bound to a specific business intent. Every one below shares the same 13-dimension shape.

### REGISTER_SALE_CARD
- **Title**: "Registrar venta"
- **Entity summary**: watch (ref, brand/model, identifying detail)
- **Required**: price, currency, customer, payment terms (cash/credit/partial)
- **Optional**: notes, sale date (defaults to now), discount reason
- **Resolved**: whatever the utterance already supplied (e.g., item, if unambiguous)
- **Unresolved**: rendered inline as blanks inside the same card, not a separate step
- **Validation**: price must be > 0; if item's cost basis is known and price is below it, a warning (not a block) fires
- **Warnings**: below-cost price, customer has open receivables already, currency mismatch with customer's usual
- **Financial effects**: +Cash/Bank/César (if cash/full) or +CXC (if credit/partial), +Profit, −Inventory (item leaves stock)
- **Operational effects**: inventory item status → sold, customer sale history updated
- **Confirmation tier**: 3
- **Editable fields**: all
- **Cancel/modify**: cancel discards the draft entirely; modify returns the specific field to `NEEDS_INPUT` without losing the rest

### RECEIVE_PAYMENT_CARD
- **Title**: "Registrar pago recibido"
- **Entity summary**: customer + originating receivable(s)
- **Required**: amount, currency, destination account (Cash/Bank/César/Crypto), applies-to (which CXC, if multiple)
- **Optional**: notes, payment date
- **Resolved/Unresolved**: as supplied vs. inferred vs. blank
- **Validation**: amount cannot exceed outstanding balance without an explicit "overpayment/advance" acknowledgment
- **Warnings**: multiple open receivables exist for this customer (routes to disambiguation, §6), amount doesn't match any single open balance
- **Financial effects**: +Cash/Bank/César/Crypto, −CXC
- **Operational effects**: receivable balance reduced or closed
- **Confirmation tier**: 3
- **Editable fields**: all
- **Cancel/modify**: same pattern as above

### REGISTER_PURCHASE_CARD
- **Title**: "Registrar compra"
- **Entity summary**: watch (or "nuevo ítem" if not yet catalogued)
- **Required**: price, currency, supplier, payment terms (cash/credit/partial)
- **Optional**: notes, purchase date, condition/notes for cataloguing
- **Validation**: price > 0; if the same reference was purchased recently at a materially different price, a warning fires
- **Warnings**: large deviation from typical acquisition cost, new/unrecognized supplier
- **Financial effects**: −Cash/Bank/César (if paid) or +CXP (if credit/partial), +Inventory
- **Operational effects**: new inventory item created or existing item's cost basis updated
- **Confirmation tier**: 3
- **Editable fields**: all
- **Cancel/modify**: standard

### REGISTER_EXPENSE_CARD
- **Title**: "Registrar gasto"
- **Entity summary**: expense category + description
- **Required**: amount, currency, category, source account
- **Optional**: notes, date, vendor
- **Validation**: amount > 0; category required (never silently defaulted to "otros" without showing it)
- **Warnings**: unusually large for the category, source account balance would go negative
- **Financial effects**: −Cash/Bank/César, −Profit
- **Operational effects**: none beyond ledger entry
- **Confirmation tier**: 2 (3 if amount crosses a large-value threshold — see §8)
- **Editable fields**: all
- **Cancel/modify**: standard

### ACCOUNT_SETTLEMENT_CARD
- **Title**: "Registrar liquidación entre cuentas"
- **Entity summary**: source account/party → destination account/party
- **Required**: amount, currency, source, destination
- **Optional**: notes, date
- **Validation**: source must have sufficient balance/outstanding to settle against
- **Warnings**: cross-currency settlement (FX rate must be shown), settles a receivable against a payable for different parties (unusual, needs explicit confirmation)
- **Financial effects**: moves between any of Cash/Banks/César/Crypto/CXC/CXP as applicable — every affected bucket is listed explicitly, never summarized as "cuentas actualizadas"
- **Operational effects**: linked records (receivable/payable) marked settled/partially settled
- **Confirmation tier**: 3
- **Editable fields**: all
- **Cancel/modify**: standard

### ADD_INVENTORY_CARD
- **Title**: "Agregar al inventario"
- **Entity summary**: watch being catalogued (no financial movement — consignment/transfer-in, not a purchase)
- **Required**: brand, model/reference, identifying detail (serial if available)
- **Optional**: cost basis, condition notes, photos, source
- **Validation**: duplicate-reference check (possible existing match triggers disambiguation instead of silent duplicate)
- **Warnings**: no cost basis provided (profit on future sale can't be computed until it is)
- **Financial effects**: none unless a cost basis is entered (then +Inventory value)
- **Operational effects**: new catalog entry, available for sale
- **Confirmation tier**: 2
- **Editable fields**: all
- **Cancel/modify**: standard

### QUERY_RESULT_CARD
- **Title**: contextual to the query ("Disponibles," "Cuentas por cobrar," etc.)
- **Entity summary**: query scope (filters applied)
- **Required**: the data itself
- **Optional**: none — this card has no unresolved fields by construction
- **Validation/Warnings**: none (read-only)
- **Financial/Operational effects**: none
- **Confirmation tier**: 0
- **Editable fields**: none
- **Cancel/modify**: n/a — dismiss only

**Worked example** — "Vendí Batman" never produces three sequential chat questions. It produces one `REGISTER_SALE_CARD` with the watch resolved (if unambiguous) and price/customer/payment/currency shown as the remaining blanks in a single structured request.

---

## 6. Disambiguation Patterns

Ambiguity is never resolved silently below a high-confidence threshold. The system either auto-selects (high confidence, single plausible candidate), suggests (medium confidence, one likely candidate shown with an explicit "¿es este?" and an easy alternative), or requires explicit selection (multiple plausible candidates, or the field is financially/operationally consequential regardless of confidence).

**Rule of thumb**: identity of a *financial counterparty* (customer, supplier) or a *specific inventory item* being sold/settled is never auto-selected past one clearly-dominant match — when in doubt, show the picker.

| Ambiguity | Behavior |
|---|---|
| Multiple watches called "Batman" | `EntityPicker`, each option shows ref/serial + status (available/sold) + acquisition date |
| Multiple customers named "José" | `EntityPicker`, each option shows last interaction date + outstanding balance if any |
| Multiple open receivables for one customer | `EntityPicker`, each option shows original amount, date, remaining balance |
| Multiple payables for the same supplier | Same pattern, oldest-first by default |
| Multiple currencies plausible (amount with no symbol, business trades in MXN/USD) | Explicit currency toggle inline, defaults to the customer's/supplier's historical currency if one exists, otherwise asks |
| Ambiguous date ("el jueves" said on a Tuesday) | Inline date confirmation showing the resolved calendar date, editable, not a blocking question |
| Ambiguous magnitude ("35" vs "35 mil") | Never silently assumed. Shown back as a resolved value inline ("$35,000") with a one-tap correction to "$35" before it reaches confirmation |

**Selection volume**: show up to 4 candidates without scrolling on mobile; beyond 4, show the top 4 plus a search field rather than a long list. Order by relevance (recency + interaction frequency), not alphabetically.

**Search fallback**: every `EntityPicker` has a search input beneath the candidates, always visible, never one tap away.

**"None of these"**: always present as the last option, distinct from the candidate list. Selecting it returns to `NEEDS_INPUT` for that field as free entry, or offers to create a new record if the field type supports it (e.g., new customer).

**Conversational references**: "la segunda" or "esa" refer to the immediately-preceding `EntityPicker` or `EntityList` shown in the conversation, resolved by position/most-recent-reference, never by re-running a fresh ambiguous match. If no picker/list is in the recent context, the reference itself becomes a disambiguation ("¿a cuál te refieres?").

---

## 7. Clarification Strategy

**Categories**: identity (who/what), financial (how much, what currency, what terms), operational (which account, which warehouse/location if relevant), date (when), source/destination (moving between what and what), permission (is this allowed for this user).

**Grouping rule**: all missing fields for a single intent are collected in one `MissingFieldsCard`, in priority order top-to-bottom: identity → financial → date → operational. There is no fixed maximum field count — the constraint is *one card*, not *N questions*, so a card with five blanks is preferred over two cards with fewer each.

**When to ask one blocking question first instead of a full card**: only when a field is a true precondition for knowing what the *rest* of the card even looks like — e.g., whether this is a sale or a return changes the entire card shape. That single branching question precedes card assembly; it is not a workaround for laziness in field-grouping.

**Defaults**: used only for fields where a wrong default is cheap to notice and cheap to correct, and is shown, never hidden — sale date defaults to today (visible and editable), currency defaults to the counterparty's historical currency (visible and editable). Never defaulted: price, amount, payment terms, identity of the customer/supplier, which account is debited/credited.

**Worked examples**:

- **"Vendí Batman."** → one unambiguous watch: `REGISTER_SALE_CARD` with item resolved, price/customer/payment/currency blank. Multiple watches named Batman: `EntityPicker` first, then the same card.
- **"José me pagó 35 mil."** → if one "José" with one open balance: `RECEIVE_PAYMENT_CARD` pre-filled with amount $35,000 MXN (or the customer's known currency, shown and editable), destination account blank. If multiple Josés or multiple open balances: `EntityPicker` first.
- **"Compré Yacht Master en 45 mil dólares."** → `REGISTER_PURCHASE_CARD`, amount and currency resolved (USD explicit), supplier and payment terms blank.
- **"Pagué a Pepe."** → identity may resolve to a supplier or a payable; amount is missing entirely. `MissingFieldsCard` requests amount, currency, and terms together — not "¿cuánto?" then "¿en qué moneda?" as separate turns.
- **"Registra un gasto de gasolina."** → category resolved (gasolina), amount and source account blank. One card, two blanks.
- **"Haz lo mismo que ayer."** → not resolved as a default. The system retrieves yesterday's matching action(s) and presents it as an `ActionPreviewCard` referencing the specific prior transaction ("¿registrar otro gasto de gasolina por $800, igual que ayer?") — reusing a value always shows the value it's reusing, never executes on an unstated inference.

---

## 8. Progressive Autonomy

| Tier | Description | Confirmation |
|---|---|---|
| 0 | Read-only query | None |
| 1 | Navigation / non-mutating preparation | None |
| 2 | Low-risk operational write (no direct money movement) | Standard `ConfirmationCard` |
| 3 | Financial or multi-record write | Detailed `ConfirmationCard` with full effects |
| 4 | Destructive, reversal, deletion, large-value, or irreversible | `DestructiveConfirmationCard`, reinforced |

**Tier 2 → 3 escalation**: a Tier 2 action escalates to Tier 3 confirmation weight when its amount crosses a configurable large-value threshold, even though the action type is normally low-risk (e.g., a "gasto" is normally Tier 2, but a $200,000 gasto gets Tier 3 treatment).

**Examples** (as specified):
- "¿Cuánto dinero tengo?" → Tier 0
- "Muéstrame los CXP disponibles" → Tier 0/1
- "Agrega una nota al cliente" → Tier 2
- "José me pagó 100 mil" → Tier 3
- "Vendí Batman" → Tier 3
- "Elimina la venta" → Tier 4
- "Revierte el pago" → Tier 4

**Per-tier interaction requirements**:
- **Tier 0/1**: answer or navigate immediately, no gate, no receipt beyond the answer itself.
- **Tier 2**: `ConfirmationCard` showing what changes; single tap to confirm; no reinforced friction.
- **Tier 3**: `ConfirmationCard` must enumerate every affected bucket from §9's list (Cash/Banks/César/Crypto/CXC/CXP/Inventory/Profit/Capital) explicitly, even the ones unaffected are implicitly not listed — never "otros efectos" as a catch-all.
- **Tier 4**: `DestructiveConfirmationCard`; cancel is the visually-default button; the destructive action requires deliberate activation of a non-default control; a reason may be required for the audit trail; no accidental double-tap can trigger it (the control is disabled for a brief beat after the card renders).

---

## 9. Confirmation UX

Every confirmation, Tier 2 and above, states:

- **What is changing** — the action in plain language
- **Before/after values** — for every field being written, not just the headline one
- **Records affected** — which specific entities (item, customer, supplier, receivable/payable)
- **Money movement** — explicit, directional (+/− and which bucket)
- **Inventory movement** — item entering/leaving stock, if applicable
- **Account effects** — enumerated against the fixed bucket list: **Cash, Banks, César, Crypto, CXC, CXP, Inventory, Profit, Capital**. Every Tier 3 card states which of these move and by how much; it does not merely say "esto afecta tus cuentas."
- **Warnings** — anything unusual flagged before commit, never discovered after
- **Reversibility** — one line stating whether this can be undone, and how (e.g., "se puede revertir desde Actividad" vs. "esta acción no se puede deshacer")
- **Actor** — who is performing it (relevant on shared/multi-user tenants)
- **Effective date** — when it's dated, if different from "now"

**Controls**:
- **Confirm** — primary, tier-appropriate weight (single tap for Tier 2/3, deliberate for Tier 4)
- **Edit** — returns the specific field to `NEEDS_INPUT` without discarding the rest of the draft
- **Cancel** — always available, always safe, never requires a reason (reasons are only requested for destructive *confirmations*, not cancellations)
- **"Confirmar todo"** — for multi-action plans (§10), commits every ready step in one action
- **Per-step confirmation** — always available as an alternative to "confirmar todo," never hidden behind it
- **Stale-plan behavior** — see §3.3: re-renders with diffs highlighted, requires re-confirmation, never silently executes against refreshed values
- **Biometric/re-auth** — not implemented yet; the model reserves a `requiresReauth: boolean` behavioral hook on `DestructiveConfirmationCard` and high-value Tier 3 actions for future biometric/step-up auth, with no UX defined until it ships

---

## 10. Multi-Action UX

**Example**: "Vendí Batman, compré un Daytona y José me pagó 200 mil."

1. **Separate intents** — the system decomposes the utterance into three distinct intents before touching any card: a sale, a purchase, a payment received.
2. **Detect dependencies** — most business actions are independent (as here); when one action's output feeds another (e.g., "vende Batman y usa eso para pagarle a mi proveedor"), the dependent step is visibly sequenced and cannot be confirmed before its dependency.
3. **Order actions** — independent actions are ordered by how much is already resolved (fewest blanks first) so the user clears easy cards quickly; dependent chains are ordered by dependency.
4. **Group clarifications** — each intent gets its own card; the three cards are presented as one **plan** (a numbered stack), not three unrelated pop-ups — the user sees "3 acciones" as a single unit from the first render.
5. **Combined plan render** — a `ConversationSummary`-style header ("3 acciones detectadas") sits above the stack, each card individually collapsible/expandable.
6. **Confirm all or individually** — "Confirmar todo" is available once every card in the stack is itself `READY_FOR_CONFIRMATION`; any card still in `NEEDS_INPUT`/`NEEDS_DISAMBIGUATION` blocks only itself, not the others — the resolved ones can be confirmed independently while the blocked one is still being filled in.
7. **One failure doesn't hide the others** — if the purchase fails during execution while sale and payment succeed, the result is `PARTIALLY_COMPLETED`: two `SuccessReceipt`-equivalent entries plus one failed entry with its own retry action, all in the same combined receipt view.
8. **Final receipt** — a single combined receipt lists all three outcomes with their individual financial effects, plus a total net effect line ("efecto neto: +$155,000 en Cash, −1 en inventario, +1 en inventario").

---

## 11. Mobile Home Specification

The first screen an owner sees prioritizes the assistant, not a metrics dashboard. Top-to-bottom: greeting, input, business brief, drafts/pending confirmations, recent activity, suggested actions, bottom nav.

```
┌───────────────────────────────┐
│  Buenas tardes, Regina         │  greeting
│                                 │
│  ┌───────────────────────────┐ │
│  │ Escribe o habla...     🎙 │ │  input + mic affordance
│  └───────────────────────────┘ │
│                                 │
│  Hoy                            │  business brief
│  Cash: $480,000  César: $120k  │
│  CXC: $95,000    CXP: $40,000  │
│                                 │
│  ⚡ Sugerencias                 │  suggested actions (chips)
│  [Registrar venta] [Ver CXC]   │
│                                 │
│  Actividad reciente             │
│  · Venta Submariner  +$85,000  │
│  · Pago de José      +$35,000  │
│                                 │
│  [ Ir al Dashboard ]            │
├───────────────────────────────┤
│  🏠   💬   📊   ⚙️              │  bottom nav
└───────────────────────────────┘
```

**Empty home** (no drafts, no unread activity): greeting, input, business brief, suggestions, minimal/no activity section.

**Active conversation**:
```
┌───────────────────────────────┐
│  ← Conversación                │
│                                 │
│  Tú: Vendí Batman               │
│                                 │
│  ┌───────────────────────────┐ │
│  │ Registrar venta            │ │
│  │ Rolex GMT Batman            │ │
│  │ Precio: [________]         │ │
│  │ Cliente: [buscar...]       │ │
│  │ Pago: (Cash)(Crédito)(Parc)│ │
│  │ Moneda: (MXN)(USD)         │ │
│  │        [ Revisar venta ]   │ │
│  └───────────────────────────┘ │
│                                 │
│  ┌───────────────────────────┐ │
│  │ Escribe o habla...     🎙 │ │
│  └───────────────────────────┘ │
└───────────────────────────────┘
```

**Missing-fields card**: as above — the card itself *is* the missing-fields prompt merged with the preview; there is no separate intermediate screen.

**Confirmation card**:
```
┌───────────────────────────────┐
│  Confirmar venta                │
│  Rolex GMT Batman → Ana Torres  │
│                                 │
│  Precio: $185,000 MXN          │
│  Pago: Contado                  │
│                                 │
│  Cash        +$185,000          │
│  Inventario  −1 (Batman)        │
│  Profit      +$62,000           │
│                                 │
│  Se puede revertir desde         │
│  Actividad.                     │
│                                 │
│  [   Confirmar venta   ]        │
│  [  Editar  ]   [ Cancelar ]    │
└───────────────────────────────┘
```

**Execution result**:
```
┌───────────────────────────────┐
│  ✓ Venta registrada             │
│  Rolex GMT Batman → Ana Torres  │
│  $185,000 MXN · Contado         │
│                                 │
│  Cash +$185,000  Profit +$62,000│
│                                 │
│  [ Ver recibo ]  [ Deshacer ]   │
│  Siguiente: ¿registrar el pago  │
│  de comisión?                   │
└───────────────────────────────┘
```

**Error recovery**:
```
┌───────────────────────────────┐
│  ⚠ No se pudo registrar         │
│                                 │
│  El inventario no respondió a   │
│  tiempo. No se hizo ningún      │
│  cambio.                        │
│                                 │
│  [ Reintentar ]  [ Cancelar ]   │
└───────────────────────────────┘
```

**Multi-action plan**:
```
┌───────────────────────────────┐
│  3 acciones detectadas          │
│                                 │
│  ① Venta — Batman        ✓ listo│
│  ② Compra — Daytona   ⚠ falta   │
│     precio                      │
│  ③ Pago de José          ✓ listo│
│                                 │
│  [ Confirmar todo lo listo ]    │
│  (② se confirma por separado)   │
└───────────────────────────────┘
```

Mobile is designed for one-handed use: primary actions anchored to the bottom third, cards scroll but their confirm/cancel row stays reachable without a stretch, and no required control sits in the top third of a full-height card.

---

## 12. Desktop Experience

The Dashboard is not replaced. The AI shows up as a **persistent side panel** with a **floating launcher** to summon it from anywhere, plus a dedicated **`/ai`** route for a full command-center view when the conversation itself is the primary task (e.g., working through a backlog of drafts).

**Recommended pattern**: side panel by default, docked right, resizable, collapsible to the floating launcher. This lets the user keep the module they're already looking at (inventory, deals, CRM) in view while operating the AI beside it — critical for tasks like "aquí está el Daytona que compré, regístralo" where pointing at a visible record is faster than re-describing it in words.

- **Operating while viewing a module**: the side panel never covers the module underneath; opening it narrows the module view rather than overlaying it.
- **Opening entity context beside conversation**: tapping an entity chip inside a card (customer, watch, receivable) opens that entity's detail in the main pane without closing or losing the conversation in the side panel.
- **Referencing visible records**: an entity currently open in the main pane is available as an implicit reference ("registra la venta de este" resolves to the open record) — shown back to the user as a resolved field, never assumed silently.
- **Switching without losing context**: collapsing the panel to the floating launcher preserves the full conversation and any in-flight draft; reopening restores exactly where it left off.

The `/ai` route is for focused sessions — clearing a backlog of pending confirmations, reviewing the day's activity — and renders the same components at a wider, denser layout (more like `TableResult`-heavy views, multiple cards visible at once) rather than a different component set.

---

## 13. Conversation Personality

**Traits**: concise, confident without arrogance, operational, calm, business-aware, never verbose without reason, no AI jargon, natural Spanish for Wrist Caviar, mirrors the user's vocabulary without turning informal or sloppy, doesn't celebrate routine actions.

**Good — answering a query**
> "Tienes $480,000 en Cash y $120,000 en César. Total disponible: $600,000."

**Bad — same query**
> "¡Claro! Como asistente de IA, permíteme calcular eso por ti. Basado en los datos disponibles, parece que el efectivo total podría estimarse en aproximadamente $600,000, ¡espero que esto ayude!"

**Good — clarification**
> "Falta el precio y quién compró el Batman. Complétalo aquí:"

**Bad — clarification**
> "No tengo suficiente información para procesar tu solicitud. ¿Podrías proporcionar más detalles sobre la transacción?"

**Good — warning**
> "El precio está por debajo de lo que costó este reloj. ¿Confirmas de todas formas?"

**Bad — warning**
> "⚠️ ADVERTENCIA: Se ha detectado una anomalía potencial en el precio ingresado."

**Good — success**
> "Venta registrada. Batman → Ana Torres, $185,000."

**Bad — success**
> "¡Excelente trabajo! 🎉 La venta se ha registrado exitosamente en el sistema."

**Good — failure**
> "No se pudo registrar el pago — el inventario no respondió. No se hizo ningún cambio."

**Bad — failure**
> "Ocurrió un error inesperado (Error 500). Por favor intenta de nuevo más tarde."

**Good — destructive action**
> "Esto elimina la venta de Batman y regresa el reloj a inventario. No se puede deshacer. ¿Eliminar?"

**Bad — destructive action**
> "¿Estás completamente seguro de que deseas eliminar este registro? Esta acción es irreversible y no se puede recuperar de ninguna manera una vez confirmada."

Routine actions get a flat, factual receipt — no exclamation points, no "¡genial!," no emoji beyond the fixed status glyphs (✓, ⚠, ✗) used consistently as status markers, never as decoration.

---

## 14. Activity and Receipts

Every completed action produces a structured receipt with:

- **Action** — canonical type (e.g., `REGISTER_SALE`)
- **Timestamp** — effective date and time-of-execution, shown separately if they differ
- **Actor** — who confirmed it
- **Affected entities** — item, customer/supplier, receivable/payable, linked to their detail views
- **Before/after** — the state of every changed field
- **Financial movement** — every bucket touched (Cash/Banks/César/Crypto/CXC/CXP/Inventory/Profit/Capital) with signed deltas
- **Execution ID** — stable identifier for audit and for undo/reversal linkage
- **Reversibility** — whether and how it can be undone
- **Next suggested action** — one contextual suggestion, never a list

**On the mobile home**, recent activity shows the 3–5 most recent `ActivityCard`s, most recent first, each a single line plus a signed financial chip; tapping opens the full receipt. Pending/unconfirmed drafts appear in a distinct section above recent activity (never intermixed with completed items), since a draft represents no committed state and must never be visually confusable with something that already happened.

---

## 15. Errors and Recovery

Every error state answers three things: what happened, what did *not* change, what the user can do next. Never just an error code.

| Condition | What's shown |
|---|---|
| Validation failure | The specific invalid field, inline, with the rule it violated; card stays open and editable |
| Permission denied | `PermissionBlockedCard` — neutral tone, states the required role, no retry (retry won't help) |
| Stale plan | Diffed `ConfirmationCard`, changed fields highlighted, explicit "esto cambió desde que empezaste" |
| Entity deleted meanwhile | `ErrorRecoveryCard` stating the record no longer exists; offers to search for a replacement rather than retry the same reference |
| Insufficient outstanding balance | Inline validation on the amount field before confirmation is even reachable, not a post-hoc failure |
| Network timeout | `ErrorRecoveryCard`: "no se pudo confirmar si esto se completó, voy a revisar" — never assumes success or failure, reconciles on next load |
| Partial multi-step failure | `PartialFailureReceipt`, succeeded/failed kept visually separate, retry scoped to failed steps only |
| Tool unavailable | `ErrorRecoveryCard` naming the affected capability in business terms ("no puedo consultar inventario ahora mismo"), never the internal tool/service name |
| Ambiguous input | `EntityPicker` or `MissingFieldsCard`, never a guess presented as fact |
| Malformed voice transcription | Editable transcript shown before interpretation proceeds (see §16) — the user corrects text, not intent |
| Session expired | Clear re-auth prompt; any in-flight draft is preserved and restored after re-auth, never silently discarded |

---

## 16. Voice Preparation

Voice input is not implemented yet; these are the interaction contracts it must satisfy when it is:

- **Speech becomes editable text.** The transcription is shown as plain text the user can edit before anything is interpreted — voice is an input method for the text box, not a parallel execution path.
- **Never execute directly from audio.** The same funnel applies: transcript → interpretation → card → confirmation. No "voice fast-path" that skips confirmation.
- **Show the transcription.** Always visible, even if brief, so the user can catch a mis-hearing before it becomes a wrong card.
- **Noisy/uncertain words**: low-confidence transcribed spans are visually marked (e.g., underlined) as uncertain and are the first candidates for the user to correct; they never silently pass through as if clearly heard.
- **Read-back confirmation for high-risk actions**: for Tier 3/4 actions originating from voice, the confirmation surface's key values are also rendered as short read-back text ("vas a registrar una venta de $185,000 a Ana Torres") so a misheard number is caught by re-reading, not just by re-looking at a form field the user may skim.

**Example**: user says "vendí el batman en ciento ochenta y cinco mil pesos" → transcript shown: "vendí el batman en 185,000 pesos" (editable) → user confirms transcript is correct → normal `REGISTER_SALE_CARD` flow proceeds from there, price pre-filled and editable like any other resolved field.

---

## 17. Accessibility

- **Keyboard**: every action reachable via keyboard alone — tab order follows visual/priority order (identity → financial → date → operational fields; confirm before cancel in tab order but cancel is never a keyboard trap-free hidden option).
- **Screen-reader labels**: every card announces its type and purpose on focus ("Tarjeta de confirmación: registrar venta"), every field has a bound label, every status glyph has a text equivalent.
- **Focus management**: opening a card moves focus into it; confirming or cancelling returns focus to the conversation input, never leaving focus stranded.
- **Color-independent status**: success/warning/error are always paired with icon + text label, never color alone.
- **Reduced motion**: card transitions and the `ExecutionProgressCard` stepper respect `prefers-reduced-motion` — cross-fades instead of slides/bounces, no motion-only status indication.
- **Touch targets**: minimum 44×44pt for any tappable control, including chips and secondary actions.
- **Modal/card navigation**: `DestructiveConfirmationCard` traps focus properly (loops within it, Escape triggers cancel not confirm); non-destructive cards are dismissible by an accessible close control, not swipe-only.
- **Voice alternatives**: every voice-initiated flow has a full text-only equivalent with identical states — voice is additive, never a separate capability tier.

---

## 18. UX Analytics

Metrics that define whether the interaction model is working:

- **Time to completed action** — from first input to `COMPLETED`, by intent type
- **Clarification turns** — number of `NEEDS_INPUT`/`NEEDS_DISAMBIGUATION` round-trips before `READY_FOR_CONFIRMATION`; target trending toward 1
- **Abandonment rate** — drafts that hit `CANCELLED` or simply go stale without resolution
- **Edit-before-confirm rate** — how often a resolved field is edited before confirming (high rate signals bad resolution/defaults, not user indecision)
- **Wrong-entity correction rate** — how often an auto-selected or suggested entity is corrected via "none of these" (directly measures disambiguation threshold calibration)
- **Confirmation cancellation rate** — plans that reach `READY_FOR_CONFIRMATION` but are cancelled rather than confirmed
- **Tool failure rate** — `FAILED`/`PARTIALLY_COMPLETED` outcomes attributable to tool/system errors vs. user cancellation
- **Repeat usage** — return rate to the AI surface vs. falling back to manual UI for the same task type
- **Mobile vs. desktop completion** — completion rate by surface, to catch surface-specific friction

**Definition of a successful interaction**: the fewest necessary turns to a correctly-resolved, correctly-confirmed action, with zero silent assumptions the user later has to discover and correct after the fact.

---

## 19. Canonical Examples

**Simple, unambiguous write**
> User: "Vendí el Batman en 185 mil."
> → `REGISTER_SALE_CARD`, item + price + currency resolved, customer + payment terms blank → user fills → `ConfirmationCard` (Tier 3) → confirm → `SuccessReceipt`.

**Ambiguous entity**
> User: "José me pagó 100 mil."
> → two open Josés → `EntityPicker` → selection → `RECEIVE_PAYMENT_CARD` with amount resolved, destination account blank → confirm → `SuccessReceipt`.

**Read-only, no gate**
> User: "¿Cuánto tengo en CXC?"
> → `MetricCard`, Tier 0, answered immediately.

**Destructive**
> User: "Elimina la venta del Daytona."
> → `DestructiveConfirmationCard`: states the sale reverses, item returns to inventory, financial buckets that unwind, "no se puede deshacer" → deliberate confirm → `SuccessReceipt` (of the reversal itself, linked to the original).

**Multi-action**
> User: "Vendí Batman, compré un Daytona y José me pagó 200 mil."
> → 3-card plan (§10) → one card blocked on a missing purchase price → other two confirmed independently → blocked one completed and confirmed separately → combined receipt.

**Stale plan**
> User confirms a sale card 10 minutes after opening it; meanwhile the item was marked sold by someone else.
> → `STALE_PLAN`: re-rendered card states "este reloj ya se vendió" with a link to that sale, offers to cancel this draft — cannot proceed.

---

## 20. Final Implementation Guidance for Cursor

- Treat §3's state machine as the single source of truth for control flow. Every screen the implementation builds must map to exactly one state; if a screen doesn't fit a state, the state list needs to change here first — don't invent an ad hoc state in code.
- Treat §4's catalog as a closed union type. The renderer should exhaustively switch over it; an unhandled type is a build error, not a runtime fallback to raw text.
- The LLM's output contract is: pick one type from §4, fill its required fields, leave optional fields absent when unresolved — never invent a 20th type, never emit markup.
- Action Cards (§5) are configuration over the generic `ConfirmationCard`/`MissingFieldsCard` machinery, not seven bespoke components — the 13-dimension shape is a schema, implement it as one.
- Confirmation tiers (§8) gate which confirmation *component* is used and how many affected-bucket lines are mandatory (§9) — tier is a property of the resolved plan, computed server-side, never trusted from client input.
- Build the mobile wireframes (§11) as the default responsive layout; desktop (§12) is the side-panel wrapper around the same components, not a parallel UI.
- Voice (§16) needs no UI work yet beyond ensuring the text input path it will feed into already exists and is solid — build for text now, voice slots into the same funnel later without new states.
- Every write path must be traceable end-to-end from §3's `READY_FOR_CONFIRMATION → EXECUTING → COMPLETED/PARTIALLY_COMPLETED/FAILED`, with the receipt fields of §14 populated from real execution results, not assembled from the pre-execution plan.

WRISTOS AI INTERACTION MODEL SPECIFICATION COMPLETE
