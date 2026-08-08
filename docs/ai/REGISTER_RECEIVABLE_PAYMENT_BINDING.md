# REGISTER_RECEIVABLE_PAYMENT — Domain Binding (Commit 14A)

Status: **canonical domain + idempotency gate ready**  
AI write execution: **not implemented** (Commit 14B)

## Product goal

Conversational examples (future):

- “José me pagó 35 mil.” → received money (needs destination)
- “José me pagó 35 mil a bancos.” → `BANK`
- “José le pagó 100 mil a Pepe.” → `APPLY_TO_PAYABLE`

Two **distinct** economic flows:

| Case | Meaning | Liquidity |
|---|---|---|
| **A. Received money** | CXC ↓ + CASH/BANK/CESAR ↑ | changes |
| **B. Account-to-account settlement** | CXC ↓ + CXP ↓ | **unchanged** |

Do not conflate them.

## Non-negotiable safety

Manual Cuentas UI and future AI must share the same canonical command:

`ReceivablePaymentService.register()`

No AI-specific accounting formulas.

---

## Current domain audit (pre-14A → post-14A)

### Endpoint

`POST /cuentas/entries/:id/payments` → `CuentasService.createPayment`

Auth: `JwtAuthGuard` only (any authenticated tenant member). No role ACL today.

### Records written

#### CASH / BANK / CESAR (received money on RECEIVABLE)

1. `AccountPayment` (`cashAccount` set, method CASH/BANCOS/CESAR)
2. `TreasuryEntry` INFLOW on matching account (`accountPaymentId` 1:1, provenance `account-payment:<id>`)
3. `AccountEntry.status` refreshed OPEN → PARTIAL → PAID

**Atomic** (14A): single Serializable `$transaction`.

#### APPLY_TO_PAYABLE

1. `AccountPayment` on receivable (`method=SETTLEMENT`, `cashAccount=null`)
2. `AccountPayment` on payable (`method=SETTLEMENT`, `cashAccount=null`)
3. `AccountSettlement` linking both + optional `idempotencyKey`
4. Status refresh both sides

**No Treasury.** Already atomic; 14A routes through `ReceivablePaymentService`.

#### PAYABLE treasury outflow (supplier pay)

Still via `CuentasService.createPayment` (not AI scope). Made atomic in 14A.

### Frontend

Cuentas modal (“Destino del pago” / “¿De dónde salió el dinero?”) calls **one** `createAccountPayment` request. No separate Treasury API. Settlement sends `idempotencyKey` (UUID).

### Bank fees on CXC receipt

**Not modeled.** Unlike deal BANCOS sales (gross inflow + fee OUTFLOW with `commission`), CXC `createFromAccountPayment` does **not** create fee legs. Do not invent fees in AI.

### Deal-linked AR blocker

`assertManualEntry` rejects `DEAL_AUTO` / `dealId != null`.

Outstanding for deal-linked UI uses **Deal.Payment**, not `AccountPayment`.

**14B blocker:** conversational “José me pagó…” against deal-synced CXC cannot use this path until product decides how deal-linked AR payments work (likely Ventas payment, not Cuentas AccountPayment).

---

## Outstanding / status source of truth

For **manual** entries:

```
outstanding = totalAmount − Σ AccountPayment.amount (deletedAt null)
```

Status:

- paid ≥ total → `PAID` (+ `closedAt`)
- 0 < paid < total → `PARTIAL`
- paid = 0 and past due → `OVERDUE`
- else → `OPEN`

Never use legacy Prisma `Receivable` model.

---

## Canonical command

```ts
ReceivablePaymentService.register(tenantId, {
  receivableEntryId,
  amount,
  destination: 'CASH' | 'BANK' | 'CESAR' | 'APPLY_TO_PAYABLE',
  payableEntryId?,          // settlement only
  paymentDate?,
  notes?,
  currency?,
  exchangeRateUsed?,        // required if USD
  registerIdempotencyKey?,  // durable
  actorUserId?,
})
```

Result:

```ts
{
  destination,
  receivablePayment,
  receivableEntry,
  treasuryEntry?,      // null for settlement
  settlement?,         // { id, idempotencyKey } | null
  payablePayment?,
  payableEntry?,
  replayed: boolean,
}
```

`CuentasService.createPayment` delegates RECEIVABLE + APPLY_TO_PAYABLE here.

---

## Idempotency

| Flow | Durable key | Unique |
|---|---|---|
| CASH/BANK/CESAR | `AccountPayment.registerIdempotencyKey` | `@@unique([tenantId, registerIdempotencyKey])` |
| APPLY_TO_PAYABLE | `AccountSettlement.idempotencyKey` | `@@unique([tenantId, idempotencyKey])` |

Semantics:

- same key + compatible payload → replay (`replayed: true`), no duplicate money
- same key + conflict → `ConflictException`
- same key after soft-delete/reverse → conflict; use new key
- concurrent same key → Serializable + P2002 recovery → one economic effect

**Do not** rely on UI disable, in-memory locks, or ActionRun state alone.

### Schema gate (14A)

Migration (local / not production-applied in this commit):

`prisma/migrations/20260808010000_account_payment_register_idempotency_key`

```sql
ALTER TABLE account_payments ADD COLUMN "registerIdempotencyKey" TEXT;
CREATE UNIQUE INDEX ... ON account_payments("tenantId", "registerIdempotencyKey");
```

Treasury: `provenanceKey = account-payment:<paymentId>` set on create (optional recovery aid). Unique `accountPaymentId` remains primary 1:1 link.

---

## Recovery marker (for 14B)

Future AI ActionRun EXECUTING → domain commits → crash before COMPLETED:

| Flow | Marker |
|---|---|
| Received money | `AccountPayment.registerIdempotencyKey = ai-action-run:<actionRunId>` |
| Settlement | `AccountSettlement.idempotencyKey = ai-action-run:<actionRunId>` |

Retry must: find by key → validate payload → rebuild receipt → COMPLETED. Never report “no change” if balances moved.

---

## Correction / reversal

| Flow | Reverse | Treasury |
|---|---|---|
| Received money | soft-delete `AccountPayment` + soft-delete linked `TreasuryEntry` (atomic in 14A) | reversed |
| Settlement | `reverseSettlement` soft-deletes settlement + both legs | n/a |

No conversational reversal in V1. Receipt CTA: “Corregir en Cuentas”.

---

## Permissions

Today: any JWT user in tenant.  
AI `REGISTER_RECEIVABLE_PAYMENT` must inherit **same or stricter** policy. Document role tightening before enabling writes if product requires OWNER-only.

---

## Future AI contract (design only)

Required trusted entities:

- `receivableEntryId`
- `amount`
- `destination`

Conditional:

- `APPLY_TO_PAYABLE` → `payableEntryId`

Disambiguate (no silent pick):

- multiple open CXC for customer
- ambiguous client name
- multiple Pepe payables
- omitted destination for received money
- amount > outstanding
- currency mismatch

### Preview examples

**BANK:**

```
Voy a registrar este pago:
Cliente … / Cuenta … / Pago $35,000 MXN / Destino Bancos
Effects: CxC $100k→$65k · Bancos +$35k
[Confirmar pago]
```

**Settlement:**

```
José pagará directamente una cuenta por pagar:
CxC José $500k→$400k · CxP Pepe $300k→$200k · Liquidez sin cambio
[Confirmar pago]
```

---

## Atomicity assessment

| Path | Pre-14A | Post-14A |
|---|---|---|
| RECEIVABLE CASH/BANK/CESAR | ❌ payment then treasury (orphan risk) | ✅ one transaction |
| Settlement | ✅ | ✅ (via ReceivablePaymentService) |
| removePayment (treasury) | ❌ sequential | ✅ one transaction |

---

## Blockers before Commit 14B

1. **Production migrate** `registerIdempotencyKey` (TYPE C) — not done in 14A.
2. **Deal-linked AR** cannot use this command today.
3. Intent adapter destination enum still lists `CRYPTO` in places — must align to CASH/BANK/CESAR/APPLY_TO_PAYABLE before binding.
4. No AI write binding yet (correct).

---

## Test coverage (14A)

- `receivable-payment.service.spec.ts` — CASH/BANK/CESAR, status, overpay, idempotent replay/conflict, deal-link block
- Existing settlement suite — still covers APPLY_TO_PAYABLE idempotency / reverse / no treasury
