# REGISTER_SALE Write Binding — Confirmed Execution (Commit 12B)

**Status: WRISTOS AI REGISTER_SALE WRITE EXECUTION READY (local — not pushed)**

Date: 2026-08-07
Branch: `feature/ai-register-sale-write-execution`

This document describes the **WRITE capability binding** that connects authenticated confirmation to the deployed 12A canonical sale command. The LLM never executes sales.

---

## 1. Deployed 12A domain contract (prerequisite)

| Layer | Path |
| --- | --- |
| Domain | `SaleRegistrationService.register()` |
| Manual HTTP | `POST /deals/register-sale` |
| Idempotency | `Deal.registerIdempotencyKey` unique per tenant |
| Treasury | `TreasuryEntry.provenanceKey` unique per tenant |

PAID / CREDIT / PARTIAL are amount-driven. Bank fee = Treasury OUTFLOW + `commission` (no OpEx `BANK_FEES` on new sales).

---

## 2. Write binding architecture

```
Natural language
→ intent adapter (labels only)
→ planner (BusinessExecutionPlan)
→ READY_FOR_CONFIRMATION + ACTION_PREVIEW_CARD
→ POST /api/ai/action-runs/:id/confirm  (authenticated)
→ WritePlanRunner.confirmAndExecute
→ WriteCapabilityBindingRegistry (REGISTER_SALE only)
→ RegisterSaleWriteBinding.mapInput / execute
→ SaleRegistrationService.register()
→ BusinessActionResult + SUCCESS_RECEIPT
→ immutable AI audit events
```

### Contract

```ts
WriteCapabilityBindingDefinition {
  capability, version, mode: "WRITE", bindingName,
  mapInput(step, context): CanonicalWriteInput,
  inputSchema, execute(input, context): Promise<BusinessActionResult>
}
```

Exactly **one** WRITE binding is registered at module init:

`REGISTER_SALE` → `RegisterSaleWriteBinding` → `SaleRegistrationService.register()`

### Explicitly UNBOUND

- REGISTER_RECEIVABLE_PAYMENT
- REGISTER_PURCHASE
- REGISTER_EXPENSE
- REGISTER_SETTLEMENT
- REGISTER_CRYPTO_POSITION
- REGISTER_CRYPTO_PRICE

Confirming an unbound write intent → `403 Forbidden` (fail closed).

Planner and intent-adapter have **zero** write-binding / sale-execution imports.

---

## 3. Confirmation lifecycle

| Step | Owner |
| --- | --- |
| DRAFT → READY_FOR_CONFIRMATION | Assistant orchestration |
| Confirm stamp + EXECUTING | WritePlanRunner CAS (`updateMany` where READY + `confirmedAt=null`) |
| COMPLETED / FAILED | RuntimeService after binding execute |
| Client never sets | EXECUTING, COMPLETED, FAILED |

Confirm requires:

- authenticated actor + tenant scope
- status `READY_FOR_CONFIRMATION`
- matching `planFingerprint`
- no prior confirmation (CAS)
- WRITE binding for intent

Replay of COMPLETED → same `BusinessActionResult` / receipt (`replayed: true`).

---

## 4. Freshness policy

Immediately before `register()`:

| Check | Failure |
| --- | --- |
| Tenant membership (active user + tenant) | PERMISSION_DENIED |
| Watch exists, same tenant, not deleted | STALE_WATCH_MISSING |
| Watch AVAILABLE/RESERVED (or SOLD only if same idempotency Deal) | STALE_WATCH_SOLD / NOT_SELLABLE |
| Customer exists, same tenant, not deleted | STALE_CUSTOMER_MISSING |
| Plan fingerprint intact | STALE / CONFLICT |
| Workspace `activeActionRunId` still this run (when present) | STALE_WORKSPACE |

No sale on any failure.

---

## 5. Permission policy

**AI REGISTER_SALE currently inherits the same sale authorization model as the canonical manual sale path.**

That is: authenticated tenant membership — no extra granular role gate in 12B. Future hardening may be separate. Do not silently broaden beyond manual behavior.

---

## 6. Durable idempotency

```
registerIdempotencyKey = "ai-action-run:<actionRunId>"
```

- Derived **only** on the server inside the WRITE binding
- Never accepted from LLM, frontend, raw request, or user input
- Unique per tenant via deployed `Deal.registerIdempotencyKey`
- Double tap / concurrent confirm / network retry → **one Deal**

In-memory locks are not the safety boundary.

---

## 7. Concurrency behavior

1. CAS: only one confirm transitions READY → EXECUTING
2. Losers: if COMPLETED → replay receipt; if still EXECUTING → conflict (safe retry later)
3. Domain uniqueness still prevents a second Deal even if execution were duplicated

---

## 8. PAID / CREDIT / PARTIAL mapping

| Mode | Binding maps to |
| --- | --- |
| CREDIT | `payment: null` — no Treasury, full CXC |
| PAID | `amountReceived = agreedPrice`, destination required (CASH\|BANCOS\|CESAR), bankChannel if BANCOS |
| PARTIAL | `0 < amountReceived < agreedPrice`, destination required, remaining CXC |

No AI-specific accounting formulas — binding only maps into `SaleRegistrationService`.

---

## 9. BusinessActionResult / receipt

Successful confirm returns:

- `interactionState: COMPLETED`
- `responseType: SUCCESS_RECEIPT`
- `executableWrite: true`
- `capability: REGISTER_SALE`
- hashed affected entities (WATCH SOLD, DEAL CREATED/REPLAYED)
- receipt: dealId, watchLabel, amount, currency, paymentMode, amountReceived, destination, remainingReceivable, effectiveDate, `rollbackPossible: false`
- correctionPolicy: corrections only via Ventas

---

## 10. Frontend confirmation UX

Executable REGISTER_SALE preview:

- Primary: **Confirmar venta** → `POST /ai/action-runs/:id/confirm` only
- Secondary: Editar / Cancelar
- Never calls `POST /deals/register-sale`
- Never submits tool name, binding name, or idempotency key

Other writes: manual-module CTAs unchanged.

Success copy only after COMPLETED + canonical receipt validation. Malformed success → fail closed.

---

## 11. Audit behavior

Existing enums (no migration):

- `PLAN_CONFIRMED`
- `EXECUTION_STARTED`
- `EXECUTION_COMPLETED` / `EXECUTION_FAILED`

Payload includes hashes / capability / bindingVersion / planFingerprint / failureType / replayed — not raw Claude output, prompts, PII, or full business payloads.

---

## 12. Failure semantics (user-facing)

| Case | Message |
| --- | --- |
| Stale watch/customer/workspace | “El reloj o el cliente cambió… No se realizó ningún cambio.” |
| Permission | “Ya no tienes permiso… No se realizó ningún cambio.” |
| Domain / other | “No pude registrar la venta. La operación se revirtió…” |
| Idempotent replay | Same successful receipt |

---

## 13. Schema gate

**NO Prisma migration for 12B.**
12A already deployed `Deal.registerIdempotencyKey` uniqueness.

---

## 14. Rollout / rollback

- **TYPE B** (API + Admin) — Railway + Vercel on merge to `main`
- Rollback: redeploy previous API/admin; unfinished READY runs remain non-executable if WRITE registry is removed
- Production QA: DEMO tenant only — never sell Wrist Caviar inventory for testing

### Controlled QA checklist (DEMO)

1. CREDIT sale
2. PAID CASH
3. PAID BANK + fee
4. PARTIAL
5. Double confirm → one Deal
6. Stale preview (sell watch elsewhere) → reject

Then soft-delete DEMO fixtures per existing QA conventions.
