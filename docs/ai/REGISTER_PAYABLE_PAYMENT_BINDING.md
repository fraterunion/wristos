# REGISTER_PAYABLE_PAYMENT — Write Binding (Commit 21B)

Status: **AI write execution production + Commit 21C hardening (resolver trust + reversed recovery)**
Domain prerequisite: **Commit 21A deployed** (`PayablePaymentService.register()` / `reverse()`)

## Product goal

Conversational examples:

- “Págale 100 mil a Pepe desde bancos.” → `BANK` + preview → **Confirmar pago**
- “Abona 50 mil a la cuenta pendiente de José desde efectivo.” → partial + `CASH`
- “Liquida esa cuenta desde Cuenta César.” → amount = outstanding + `CESAR`
- “Compensa lo que José nos debe contra lo que le debemos.” → `REGISTER_SETTLEMENT` (**unbound**)

Hard boundary:

| Flow | Meaning | Liquidity |
|---|---|---|
| **REGISTER_PAYABLE_PAYMENT** | CXP ↓ + CASH/BANK/CESAR ↓ | decreases |
| **REGISTER_SETTLEMENT / APPLY_TO_PAYABLE** | CXC ↓ + CXP ↓ | unchanged |
| **REGISTER_RECEIVABLE_PAYMENT** | CXC ↓ + Treasury INFLOW (or settlement) | depends |
| **REGISTER_EXPENSE** | New OpEx | outflow |

## Safety model

```
Natural language
→ REGISTER_PAYABLE_PAYMENT intent
→ trusted payable resolution (picker / ordinal / unique)
→ deterministic Planner preview
→ READY_FOR_CONFIRMATION
→ explicit authenticated confirmation
→ freshness validation
→ WritePlanRunner
→ REGISTER_PAYABLE_PAYMENT binding
→ PayablePaymentService.register({ registerIdempotencyKey: ai-action-run:<id> })
→ receipt + recovery from durable marker
```

No confirmation → no AccountPayment / no Treasury OUTFLOW.
Frontend must not call Cuentas payment endpoints from Assistant.

## Executable writes after 21B

Exactly **seven** WRITE bindings:

1. REGISTER_SALE
2. REGISTER_RECEIVABLE_PAYMENT
3. REGISTER_EXPENSE
4. REGISTER_PURCHASE
5. CREATE_CLIENT
6. UPDATE_CLIENT
7. REGISTER_PAYABLE_PAYMENT

Still unbound: `REGISTER_SETTLEMENT`, crypto writes, DELETE/RESTORE/MERGE_CLIENT.

Controlled Action Composition V1 graph **unchanged** — payable payment is **not** a composition parent/child.

## Binding

| Field | Value |
|---|---|
| Capability | `REGISTER_PAYABLE_PAYMENT` |
| Mode | `WRITE` |
| Version | `1.0.0` |
| Binding | `register_payable_payment_canonical@1.0.0` |
| Domain | `PayablePaymentService.register()` |

Trusted args: `payableEntryId`, `amount`, `sourceAccount`, optional `exchangeRateUsed` / `paymentDate` / `notes`.
Server-only: `registerIdempotencyKey = ai-action-run:<actionRunId>`.

## Resolver / picker

`PayablePaymentEntityResolver` (Commit 21C trust hardening):

- Provider/user `payableEntryId` / `accountId` / aliases are stripped unless they re-validate as an eligible open MANUAL/PURCHASE_AUTO PAYABLE in the actor tenant
- Trusted sources only: server revalidation, unique open resolution, picker/ordinal after re-check
- Unique → bind + surface selection (`payableTrustSource`)
- Multiple → ENTITY_PICKER (no silent oldest/largest/first; no untrusted IDs carried)
- Stale presented candidates (paid/deleted) → strip → clarify / non-executable
- Full-payment language (`liquídalo`) → `amount = outstanding` (backend math)
- Overpay → clarify; no silent cap
- No CREATE_CLIENT composition
- Confirm-time freshness remains defense in depth

## Preview / confirmation

Backend-derived previous/remaining outstanding, source, P&L “Sin cambio”.
CTA: **Confirmar pago** → `POST /api/ai/action-runs/:id/confirm`.

## Freshness / concurrency / idempotency

Revalidate membership, payable open, outstanding ≥ amount, currency/FX.
Domain Serializable protects concurrent overpay.
Same ActionRun double/triple confirm → one payment + one OUTFLOW via `AccountPayment.registerIdempotencyKey`.

## Recovery

Marker: `AccountPayment.registerIdempotencyKey = ai-action-run:<actionRunId>`.

Before `IN_PROGRESS`, classify durable marker (Commit 21C):

1. Active payment + Treasury OUTFLOW → recover COMPLETED
2. Marker exists but payment reversed/deleted → `STALE_PAYABLE_PAYMENT_REVERSED` (ActionRun FAILED/STALE; no re-apply)
3. Active payment missing Treasury → invariant failure / needs review
4. No marker → `IN_PROGRESS` only

Copy on reverse: “El pago se registró anteriormente, pero después fue revertido en Cuentas…”

## Receipt / correction

Receipt includes `payableEntryId`, `paymentId`, `sourceAccount`, previous/remaining outstanding, status.
Correction: **Corregir en Cuentas**.

## Schema gate

**No migration.** 21A production schema is sufficient.

## Production rollout

DEMO QA first. Never create/pay Wrist Caviar liabilities for QA.
Merge only after TYPE A+B review.
