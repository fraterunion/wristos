# Operational Intent Router

## Product principle

**If the user gives Jarvis everything required in one message, Jarvis should never ask for it again.**
**If Jarvis safely knows 5 out of 6 required facts, it asks only for fact #6.**

A phrase as obvious as "Vendí Bruce Wayne en 500k" must never fail with a generic "No entendí con suficiente claridad." The Operational Intent Router exists to make routine, high-confidence dealer language reach `REGISTER_SALE` (and the other nine write capabilities it covers) deterministically, without depending on the LLM to first decide the message is a sale.

## Root cause it fixes

`NaturalLanguageAssistantService.handleMessage()` calls `ClaudeIntentProvider` for any message that isn't already handled by an earlier deterministic short-circuit (clarification field lock, cancel/topic-change, reversal correction language). The system prompt built in `intent-adapter/prompt-policy.ts` has **zero grounding in the watch-nickname catalog** (`watch-intelligence/catalog.ts`) — that catalog is only consulted downstream, inside `WatchInventoryResolver`, after intent classification. So to Claude, "Bruce Wayne" is indistinguishable from a person's name. The model reasonably hedges with `confidence: 'LOW'` or an ambiguity, and `decideConfidencePolicy()` (`intent-adapter/safety.ts`) unconditionally rejects LOW confidence — producing the exact rejection message quoted in the original bug report, before `WatchInventoryResolver`, `SaleCustomerEntityResolver`, or `PlannerService` ever run. This was invisible against `FakeIntentProvider` (used throughout the test suite) because that provider is purely syntactic and has no notion of "is this a person or a watch."

## Architecture: minimal-blast-radius integration

`IntentAdapterService.interpret()` is already factored as `provider.interpret()` (the LLM call) → `buildIntentCandidate(rawOutput, currentDate)`, a **pure function** that validates raw output against `rawIntentCandidateSchema` then the per-intent `entitySchemas`, and is the only place a `StructuredIntentCandidate` is ever constructed.

**The router produces the same `rawOutput` shape a successful Claude tool-call would produce, and is fed through the exact same `buildIntentCandidate()` gate.**

- `IntentAdapterService.interpretDeterministic(rawOutput, currentDate, requestTraceId?)` — skips `provider.interpret()` entirely, calls `buildIntentCandidate()` directly, and wraps the result in the same `IntentAdapterOutcome` envelope with `provider: 'operational-intent-router'`, `model: 'deterministic-v1'`.
- In `NaturalLanguageAssistantService.handleMessage()`, the single call to `intentAdapter.interpret()` was replaced with: try `OperationalIntentRouterService.route(text)` first; if it returns a `HIGH_CONFIDENCE_OPERATION` verdict, call `interpretDeterministic()`; otherwise call `interpret()` exactly as before. Nothing else in the file changed.

**Why this is safe:** everything downstream of that one call — `decideConfidencePolicy`, `stripUntrustedEntityIds`, reference resolution, `StructuredAssistantService` → per-capability entity resolvers (`WatchInventoryResolver`, `SaleCustomerEntityResolver`, etc.) → `PlannerService` → composition → confirmation — is **100% unchanged code**, because the router's output is validated through the identical Zod gate the LLM's output goes through. The router never resolves a `watchId`/`clientId`/any `*Id` field itself — it only ever emits query strings (`watchQuery`, `customerQuery`, `sellerQuery`, `counterpartyQuery`, `investorQuery`) that flow into the same resolvers a Claude-produced candidate would use. This also means the confirmation state machine, the composition graph, the entity picker, and the "exactly 14 WRITE bindings" boot invariant are structurally untouched — the router can never introduce a 15th capability or a new execution path; it only ever picks among `entitySchemas`' existing keys.

## Routing precedence

Unchanged from today except for one new step, inserted at the one open slot:

1. Clarification Field Lock (`ClarificationFieldLockService`) — unchanged.
2. Cancel / topic-switch (`clarification-escape.ts`) — unchanged.
3. Reversal/deictic detectors (`expense-correction-language.ts`, `transfer-correction-language.ts`, pure ordinal/deictic) — unchanged, still run first.
4. **`OperationalIntentRouterService.route()`** — new.
5. Provider (Claude) — unchanged fallback when the router returns `AMBIGUOUS_OPERATION` or `NO_OPERATION_MATCH`.
6. `decideConfidencePolicy` → `StructuredAssistantService` → `PlannerService` — unchanged.
7. Clarification if required — unchanged (planner-driven, via each capability's `conditionalMissing` in `business-actions.ts`).

## Module layout (`apps/api/src/modules/ai/operational-router/`)

```
operational-intent-router.types.ts   RoutableCapability (10), LexiconMatchResult, RouterVerdict, RouterRawCandidateOutput
operational-intent-router.service.ts Orchestrator: tiered lexicon scan, guards, toRawCandidateOutput()
text-normalize.ts                    normalizeMessage() -> { raw, folded } (index-aligned; see below)
guards/
  negation-guard.ts                  "no vendí", "todavía no le pagué"
  tense-guard.ts                     "voy a", "si vendo", "quiero comprar"
  question-guard.ts                  "¿...?" / unpunctuated interrogative openers
lexicon/
  sale.lexicon.ts                    vendí/vendimos/se vendió/se fue/acabo de vender (completed); vendo (present-tense, capped — see Confidence model)
  purchase.lexicon.ts                compré/compramos/acabo de comprar
  expense.lexicon.ts                 gasté (strong) / pagué+category (weak, needs corroboration)
  receivable-payment.lexicon.ts      me pagó/me depositó/cobré/entró el pago
  payable-payment.lexicon.ts         le pagué a/liquidé la cuenta de/pagué la deuda con
  treasury-transfer.lexicon.ts       pasa/mueve/transfiere/manda, "de X a Y" (either order)
  capital-contribution.lexicon.ts    aportó/metió capital/hizo una aportación
  capital-distribution.lexicon.ts    le distribuí/distribución de utilidad/retiró utilidad
  create-receivable.lexicon.ts       nos debe/quedó debiendo/crea una cuenta por cobrar
  create-payable.lexicon.ts          le debemos/tenemos pendiente con/crea una cuenta por pagar
extraction/
  money-shorthand.ts                 "500k"/"500 mil"/"$500,000"/"1.5 millones" -> plain number
  currency-alias.ts                  pesos/mxn/mx/moneda nacional -> MXN; dólares/usd/dlls/dls -> USD
  account-alias.ts                   Bancos/Efectivo/Cuenta César -> CASH|BANK|CESAR, then per-capability remap
  phrase-segments.ts                 captureUntilMarker/captureAfterMarker, stripLeadingArticle
eval/
  router-eval-dataset.ts             128-case corpus, 100% outcome/capability accuracy, 0 false writes
  router-eval.spec.ts                runs the corpus, asserts the safety-critical metrics
tests/
  regression.spec.ts                 exact-field assertions for the task's named regressions
  guards.spec.ts, extraction.spec.ts, architecture.spec.ts, nl-assistant-integration.spec.ts
```

### `raw`/`folded` text alignment

`normalizeMessage(text)` returns two same-length, index-aligned strings: `raw` (trimmed/whitespace-collapsed, casing and accents preserved — used to slice out display spans with natural casing) and `folded` (lowercased + accent-folded — used for all regex matching). Because per-character diacritic folding and ASCII lowercasing never change string length, a regex match index found in `folded` can be used directly to slice `raw`. This is why every lexicon only needs to handle the unaccented form once ("vendí"/"vendi" both fold to "vendi") instead of accent-class regex noise throughout.

## Confidence model

```ts
type RouterVerdict =
  | { kind: 'HIGH_CONFIDENCE_OPERATION'; capability; entities; evidence }
  | { kind: 'AMBIGUOUS_OPERATION'; reason; candidateCapabilities }
  | { kind: 'NO_OPERATION_MATCH' };
```

**Tiered precedence, not stop-at-first-match.** Sale/purchase sentences routinely embed payment language as a sub-clause ("...y me pagó por Bancos"), which would otherwise also fire `REGISTER_RECEIVABLE_PAYMENT`'s "me pagó" pattern on the same message. Lexicons are grouped into three tiers — `[sale, purchase]`, `[expense, transfer, capital ×2, CxC/CxP ×2]`, `[receivable-payment, payable-payment]` — tried in order, but a tier only wins outright when it produces a genuine HIGH-confidence match. A tier that only produces an insufficient-evidence match (e.g. EXPENSE's weak "pagué" verb firing as a substring of PAYABLE_PAYMENT's "le pagué") does **not** block a later tier's clean HIGH match; every tier is scanned before falling back to `AMBIGUOUS_OPERATION`.

**Guards are conservative by construction.** Every verb lexicon only matches conjugated completed-event forms (vendí/vendo/vendimos/se vendió — never bare infinitives like "vender"/"comprar"), which already excludes most future/hypothetical phrasing without a guard needing to fire. `tense-guard.ts` catches the one genuinely ambiguous remainder: a conditional marker ("si") immediately preceding a present-tense verb like "vendo"/"compro". `negation-guard.ts` blocks a verb match preceded by a negation marker anywhere earlier in the message. `question-guard.ts` blocks the whole message on `¿`/`?` or an unpunctuated interrogative opener (cuánto/cuál/dónde/...) — deliberately **excluding** "ya me"/"ya le"/"ya nos", since without punctuation "Ya le pagué" (declarative) and "¿Ya le pagaste?" (question) share the same opening words and Spanish gives no other deterministic signal; blocking a genuine completed-payment statement is worse than occasionally letting an unpunctuated question reach the router (which then simply won't match any lexicon's evidence bar and falls through regardless).

**Capability confidence and field-completeness are separate.** "Pagué gasolina" (no amount stated) is still strong `REGISTER_EXPENSE` evidence — the planner asks for the missing amount, same as it would for a partial LLM extraction. Only genuinely ambiguous cases (bare "Pagué 50 mil." — no category word, no counterparty pattern) fall through to `AMBIGUOUS_OPERATION`, never silently picking a capability.

**Present-tense "vendo" is capped below HIGH confidence, deliberately.** `sale.lexicon.ts` splits its verb evidence into two tiers: `COMPLETED_VERB_RE` (vendí/vendimos/se vendió/se fue/acabo de vender — unambiguous completed-event language) and `PRESENT_TENSE_VERB_RE` (bare "vendo"). "Vendo un Batman en 300 mil" is genuinely ambiguous — it may be an offer/listing ("estoy vendiendo" sense), not a completed sale, unlike "Vendí" which only ever means the transaction already happened. `sufficientEvidence` for `REGISTER_SALE` is therefore `Boolean(completedExec) && watchQuery && price` — a present-tense-only match can never set it, regardless of how much else resolves, and always falls to `AMBIGUOUS_OPERATION` (provider fallback). Per product policy: **a false WRITE is more dangerous than a missed deterministic routing.** Other present/future/intent-to-sell phrasing ("Estoy vendiendo…", "Quiero vender…") is excluded by the same conjugated-completed-verb-only design the other lexicons already rely on, or caught by `tense-guard.ts`'s future-intent-prefix check.

## Slot extraction

Only after a lexicon's verb matches does slot extraction run:

- **Watch/customer/seller/counterparty/investor text** — `phrase-segments.ts` isolates a raw substring (never resolved to an id) using marker words (en/por/de/desde/a/al/para/y/con) as stop boundaries. `PERSON_STOP_MARKERS_RE` additionally stops at a digit (names never contain digits, unlike watch references); `WATCH_STOP_MARKERS_RE` only stops at a *whitespace-then-digit* boundary, so "116610LN" (digits embedded in a reference) survives while "bruce 500 bancos" still correctly isolates "bruce".
- **Money** — `money-shorthand.ts`'s `parseMoneyToken`/`findFirstMoneyMention` expand "500k"/"500 mil"/"$500,000"/"1.5 millones" to a plain number. This is genuinely new: no deterministic shorthand parser existed anywhere in the codebase before this — expanding "35 mil" → 35000 was previously an LLM-only responsibility per `prompt-policy.ts`'s own instructions. Downstream, the existing `normalizeMoney` (in `intent-adapter/normalization.ts`) still runs via `buildIntentCandidate` → `normalizeEntities` and handles final `.00`-format cleanup — the router only needs to get the magnitude right.
- **Currency — never invented, per capability.** The router's core rule: *extract everything safely available; never invent a missing material value merely to reach preview.* Currency is a `required` planner field (`business-actions.ts`) for `REGISTER_SALE`, `REGISTER_PURCHASE`, `REGISTER_EXPENSE`, `CREATE_RECEIVABLE`, and `CREATE_PAYABLE` — for these five, the router sets `currency` **only** when an explicit currency word is present (`detectCurrencyAlias`); otherwise it's left absent, exactly as an incomplete LLM extraction would leave it, so the planner asks its existing clarification question ("¿Los 500 fueron en pesos o en dólares?"). "Vendí Bruce Wayne en 500k." → `currency` absent; "Vendí Bruce Wayne en 500k MXN." → `currency: 'MXN'`. `REGISTER_RECEIVABLE_PAYMENT`/`REGISTER_PAYABLE_PAYMENT` never set `currency` at all — it isn't in either capability's planner-required list, and each capability's entity-resolver resolves it server-side from the matched open receivable/payable's own row (`row.currency ?? 'MXN'`); anything the router supplied there would be redundant at best. `REGISTER_TREASURY_TRANSFER`, `REGISTER_CAPITAL_CONTRIBUTION`, and `REGISTER_CAPITAL_DISTRIBUTION` are the three capabilities that keep an unconditional `currency: 'MXN'` — verified against each capability's own binding (`register-treasury-transfer.binding.ts`, `register-capital-contribution.binding.ts`, `register-capital-distribution.binding.ts`), all three hardcode `currency: 'MXN'` in their receipt construction *unconditionally* (not a `?? 'MXN'` fallback), so this is a pre-existing, intentional product default the router preserves and documents — not a policy the router invented. **The router never creates a new default policy; it only ever preserves or removes one that already exists in the domain layer.**
- **Accounts** — `account-alias.ts` detects a canonical `CASH|BANK|CESAR` triple, then remaps per capability's *actual* enum: `REGISTER_SALE`'s `destination` uses `BANCOS` (not `BANK`); `REGISTER_CAPITAL_CONTRIBUTION`/`DISTRIBUTION`'s `account` uses `CESAR_ACCOUNT` (not `CESAR`); everything else uses the canonical triple directly. Account detection is always scoped to text *after* the verb **and after any name span already captured earlier in the same message** (a customer/seller/counterparty/investor query, via `phrase-segments.ts`'s `afterSpan(floorIndex, span)` helper, which reads a `SpanCapture`'s `endIndex`) — so a person literally named César is never misread as the "Cuenta César" treasury account. See "The César collision" below.

### The César collision

`detectCanonicalAccount()` matches on the bare substring "cesar" appearing anywhere in whatever text it's given — by design, since "Pasa 100 mil a César" (an unambiguous treasury reference, no competing name capture in that lexicon) must keep working. The caller's job is to scope that substring correctly. Five lexicons capture a person's name (`customerQuery`/`sellerQuery`/`counterpartyQuery`/`investorQuery`) from free text *before* also scanning for an account word in the remaining message — `sale.lexicon.ts`, `purchase.lexicon.ts`, `receivable-payment.lexicon.ts`, `payable-payment.lexicon.ts`, and `capital-distribution.lexicon.ts` (the last two have a post-verbal name-capture branch specifically). Without scoping, "Me pagó César por Bancos." would let the account-alias scan start right after the verb, re-reading "César" — which is itself a valid account alias — before ever reaching "Bancos", silently misreading the counterparty's name as the destination account.

The fix: `phrase-segments.ts`'s `SpanCapture` carries an `endIndex` (the stop-marker position or end of string — distinct from `index + text.length` since trimming can shorten a captured span), and `afterSpan(floorIndex, span)` returns `Math.max(floorIndex, span?.endIndex ?? floorIndex)`. Every affected lexicon scopes its `detectCanonicalAccount()` call to start at `afterSpan(afterVerbIndex, capturedNameSpan)` instead of bare `afterVerbIndex`. `treasury-transfer.lexicon.ts` and `capital-contribution.lexicon.ts` were audited and found **not** to need this fix: treasury-transfer scans each account span's own isolated text (never a substring containing a name), and capital-contribution's investor is always pre-verbal (never re-scanned by the after-verb account search) — both confirmed via `tests/regression.spec.ts`'s explicit account-value assertions (not just capability-level checks, which would not have caught this class of bug).

Regressions (all in `tests/regression.spec.ts`, asserting the actual `entities.destination`/`sourceAccount`/`account` value, not just capability):
- "Vendí el Batman a César." / "...César en 300 mil, me pagó por Bancos." → `customerQuery: 'César'`, `destination: 'BANCOS'` (never `'CESAR'`).
- "Me pagó César por Bancos." → `customerQuery: 'César'`, `destination: 'BANK'`.
- "Le pagué a César por Bancos." → `counterpartyQuery: 'César'`, `sourceAccount: 'BANK'`.
- "Le distribuí a César 80 mil en bancos." → `investorQuery: 'César'`, `account: 'BANK'`.
- "Pasa 100 mil de Bancos a Cuenta César." → `destinationAccount: 'CESAR'` — still correct, since this is genuine Treasury account language with no competing name capture.
- **Dates** — capital contribution/distribution require `contributedAt`/`paidAt`; the router defaults to today's date when the message doesn't state one, matching how the rest of the system already treats an undated completed-event message.

### A structural boundary the router respects, not routes around

`entitySchemas.REGISTER_SALE` (the LLM/router validation boundary in `intent-schema.ts`) does **not** include `destination`/`bankChannel` as settable fields at all — only `business-actions.ts`'s planner layer knows them, reachable solely via the closed-choice clarification flow. So even a message stating "...y me pagó por Bancos" can't set `destination` in one turn through this router (or through a hypothetical perfect LLM extraction, which would hit the identical schema limit) — `buildIntentCandidate`'s `.strip()` silently drops it, and the planner asks one targeted follow-up. This is a pre-existing architectural boundary; extending it would be a schema change, out of scope for this router (see "No schema" in Non-negotiables).

## Non-negotiables (verified, not assumed)

- **No Prisma migration.** `apps/api/src/modules/ai/operational-router/` has zero Prisma import (enforced by `tests/architecture.spec.ts`).
- **Capability registry stays exactly 14.** The router only ever picks among 10 of the 14 (`ROUTABLE_CAPABILITIES` — reversals and client CRUD are handled earlier in precedence or have no operational verb lexicon by design); it never adds a binding. `bindings/tests/write-capability-binding.spec.ts` and `bindings/tests/command-coverage-audit.spec.ts` both still pass unmodified.
- **No new execution/confirm route.** The router feeds the existing intent → plan → confirm pipeline; `assistant/assistant-architecture.spec.ts`'s route-enumeration test is untouched and passing.
- **Confirmation state machine untouched.** Nothing reaches `EXECUTING` without `confirmedAt` — the router only ever produces a `DRAFT`/`NEEDS_CLARIFICATION`/`READY_FOR_CONFIRMATION` candidate, identically to a Claude-produced one.
- **Composition graph untouched.** `PURCHASE_SELLER`/`SALE_CUSTOMER` → `CREATE_CLIENT` still triggers exactly as before when a `sellerQuery`/`customerQuery` fails to resolve — the router never resolves these itself.
- **Payment reversals remain unbound beyond `REVERSE_EXPENSE`/`REVERSE_TREASURY_TRANSFER`.** Reversal precedence (checked before the router) is preserved, not modified.

## Known limitations (documented, not silently promised as solved)

- **Single-clause negation only.** `negation-guard.ts` blocks a verb match if a negation marker appears anywhere earlier in the *whole* message, not per-clause. A message that both negates and asserts in one sentence ("no vendí el Batman, vendí el Robin") is over-conservative today — it blocks the whole message rather than parsing per-clause. Always safe (falls through to the provider), never a false write.
- **"Agarré" excluded from the purchase lexicon.** The task's own caveat ("only if context strongly indicates a watch purchase") needs corroborating-evidence modeling this router doesn't attempt yet.
- **`initialPaymentAmount` not extracted for partial purchases.** "pagué 100 de Bancos y el resto quedó a crédito" correctly sets `paymentMode: 'PARTIAL'`, but the specific partial amount (100) isn't separately captured as `initialPaymentAmount` — the planner will ask for it.
- **`REGISTER_RECEIVABLE_PAYMENT` requires an actual named counterparty.** "Nos depositaron 80 mil por bancos." / "Me liquidó 200 mil por bancos." (pronoun-subject verb with no named debtor at all) correctly fall to `AMBIGUOUS_OPERATION` — `sufficientEvidence` requires a real `customerQuery`, not just a matched verb, since `customerId`/`accountId` can never resolve without one. This was tightened during the hardening pass (previously a bare verb match without a name could incorrectly claim sufficient evidence); the two eval-corpus cases affected were updated accordingly, with a documented rationale in `router-eval-dataset.ts`.

## Telemetry

No new telemetry channel. `interpretDeterministic()` populates the existing `provider`/`model` fields (`'operational-intent-router'` / `'deterministic-v1'`) via the same `telem()` hook and `funnelStage: 'intent'` event every provider call already emits — the Assistant Health dashboard can distinguish deterministic-router hits from LLM calls with zero dashboard changes.

## Maintenance rules

- Every new lexicon phrase must have at least one case in `eval/router-eval-dataset.ts` and, if it's one of the task's own named examples, an exact-field assertion in `tests/regression.spec.ts`.
- Never lower `sufficientEvidence`'s bar without adding a corresponding `AMBIGUOUS_OPERATION` regression test proving the previous conservative behavior for that phrase is preserved elsewhere.
- Run `tests/architecture.spec.ts` after any change — it will fail loudly if a lexicon starts emitting an `*Id` field or if the module gains a Prisma/HTTP surface.
- Run `eval/router-eval.spec.ts` after any change — `falseWrites` must stay `0`, `capabilityAccuracy` must stay `1`.
