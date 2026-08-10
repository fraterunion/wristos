# Financial Reversal Safety Framework (Commits 26A + 26B)

Status: **26B CAUSALITY READY** — durable keys + domain classification; **no AI write bindings**.

`REVERSE_EXPENSE` and `REVERSE_TREASURY_TRANSFER` remain **AI-unbound**.

Executable AI WRITE registry remains exactly **TWELVE**.

Controlled Action Composition V1 remains unchanged
(`PURCHASE_SELLER → CREATE_CLIENT`, `SALE_CUSTOMER → CREATE_CLIENT` only).

---

## 0. Commit 26B — Durable reversal causality

26B solves only the causality gap left after 26A: `deletedAt` alone cannot distinguish
AI reverse+crash from human/other reverse before retry.

### Schema fields (additive, nullable, no backfill)

| Model | Field | Tenant-safe uniqueness |
|---|---|---|
| `OperatingExpense` | `reversalIdempotencyKey String?` | `@@unique([tenantId, reversalIdempotencyKey])` |
| `TreasuryEntry` | `reversalIdempotencyKey String?` | `@@unique([tenantId, reversalIdempotencyKey, direction])` |

**Transfer paired-key rule:** one logical transfer has OUTFLOW + INFLOW. Both legs stamp the
**same** command key. Uniqueness includes `direction` so the pair is legal; a blind
`@@unique([tenantId, reversalIdempotencyKey])` would incorrectly reject the second leg.

Migration: `20260810120000_financial_reversal_idempotency` (existing rows stay NULL).

### Canonical key format (future AI)

`ai-action-run:<actionRunId>` — domain accepts generic `reversalIdempotencyKey?: string`.
Manual HTTP callers omit it. Public DTOs do **not** accept a client-spoofable key.

### Causality classification

| Value | Meaning |
|---|---|
| `APPLIED` | This call performed the economic reverse now |
| `SAME_COMMAND` | Already reversed with this exact key (crash recovery) |
| `EXTERNAL` | Already reversed by a different key or manual (null key) |

Transfer pair invariant: both legs deleted with matching keys, or fail closed
(`STALE_TREASURY_TRANSFER_INVARIANT`). No silent repair of one-leg / mismatched keys.

### Crash recovery proof

1. Canonical reverse with key `K` commits.
2. Caller crashes before ActionRun completion.
3. Retry reverse with `K` → `SAME_COMMAND` (no second economic mutation).

### Manual-before-retry

Manual reverse (null key) then keyed retry with `K` → `EXTERNAL` (not recovery success).

### Public key safety / privacy

- HTTP expense DELETE and transfer reverse omit the key.
- Field is internal operational metadata; prefer not to surface raw ActionRun IDs in Admin cards.
- Hash if used in telemetry later.

### Economics

Unchanged from pre-26B: canonical expense restores source liquidity once; legacy expense
Treasury Δ0; transfer total liquidity Δ0.

### No AI execution yet

Planner, Intent Provider, FakeIntent, NL/Structured Assistant, WritePlanRunner, confirmation,
Admin Assistant UI, telemetry funnels, composition, and write registry: **zero behavior change**.

### Rollout (TYPE C + TYPE B domain)

1. Backup + read-only OpEx/Treasury pre-audit.
2. Inspect migration SQL → `prisma migrate deploy` **before** relying on keys in prod.
3. Verify all existing keys NULL + indexes.
4. Merge domain code; Railway SHA health.
5. DEMO keyed reverse / same-key / different-key / manual-before-key for Expense + Transfer.
6. Confirm exactly 12 WRITEs; reversals still unbound; composition unchanged.

**Do not bind REVERSE_* until 26C+ after migrate.**

---

## 1. Why reversals are different

Creation describes a **new** desired state.

Reversal refers to an **existing** economic event that must be identified correctly.

Wrong resolution can reverse legitimate history.

Therefore a reversal target may **never** be selected using:

- provider-supplied database IDs
- arbitrary “most recent” fallback
- fuzzy single-result guessing
- amount-only matching
- silent oldest/newest selection

Target resolution must be deterministic and server-trusted.

A reversal is **not** “DELETE arbitrary record”.

It means: apply the **canonical inverse** already defined by that domain.

---

## 2. Shared framework boundary

**Allowed shared framework**

- trusted target representation
- fingerprints
- read-only resolvers
- preview contracts
- recovery classifiers
- last-action policy
- risk-tier metadata
- error taxonomy (non-destructive rename layer)

**Forbidden**

- `GenericReversalService.reverse(anyEntity)`
- AI binding Prisma soft-delete
- registering REVERSE_* as WRITE in 26A
- auto-chain reverse + recreate composition

Each domain owns economics:

| Future binding | Canonical method |
|---|---|
| `ReverseExpenseWriteBinding` | `ExpenseRegistrationService.reverse()` |
| `ReverseTreasuryTransferWriteBinding` | `TreasuryTransferService.reverse()` |

---

## 3. Domain audit summary

| Domain | Method | Soft-delete | alreadyReversed | Retry-as-success | Reverse causality (pre-26A) |
|---|---|---|---|---|---|
| Expense | `ExpenseRegistrationService.reverse` | OpEx + Treasury OUTFLOW (if any) | Yes | Yes | **No** |
| Transfer | `TreasuryTransferService.reverse` | both legs | Yes | Yes (pair) | **No** |
| CXC payment | `CuentasService.removePayment` | payment (+ treasury/settlement) | No (NotFound) | Weak | No |
| CXP payment | `PayablePaymentService.reverse` | payment + treasury | Yes | Yes | No |
| Purchase | `PurchaseRegistrationService.reverse` | watch + legs | Yes | Yes | No |
| Capital contrib/dist | `*.reverse` | soft-delete | Yes | Yes | No |
| Sale | no canonical reverse | partial | No | No | No |
| Manual account | `cancelUnpaidManual` | CANCELLED + deletedAt | `alreadyCancelled` | Yes | No |
| Settlement | `reverseSettlement` | settlement + legs | No (NotFound) | No | No |

### Expense reverse (exact)

- Canonical: soft-delete `OperatingExpense` + soft-delete Treasury OUTFLOW `operating-expense:<id>:outflow` atomically.
- Legacy (no provenance): soft-delete OpEx only — **never invents Treasury**.
- Second call: `alreadyReversed=true`.
- HTTP: `DELETE /api/expenses/:id` (ordinary tenant JWT — same auth as today).

### Transfer reverse (exact)

- Soft-delete OUTFLOW + INFLOW pair under Serializable isolation.
- Both already deleted → `alreadyReversed`.
- Unpaired / half-reversed → `STALE_TREASURY_TRANSFER_INVARIANT` (fail closed).
- Effects: source +X, destination −X, **total liquidity Δ0**, P&L Δ0, Capital Δ0.
- No funds-availability gate (negative balances allowed).
- HTTP: `POST /api/treasury/transfers/:transferId/reverse`.

### Sale / purchase separation

- **CANCEL_SALE** is not a generic financial reversal (Watch/Deal/CxC/COGS/commissions). Out of 26A.
- Purchase reverse exists but is blocked by SOLD / Deal / payable payments / settlements. Rank later; do not bind in 26A.

---

## 4. SCHEMA GATE (highest priority result)

### Question

Can we distinguish:

A. AI ActionRun reversed the target, then crashed before ActionRun completion  
B. A human independently reversed the target before AI retry  

from **current schema alone**?

### Answer

**NO.**

`deletedAt` proves the row is reversed, **not who** reversed it.

Create-time `registerIdempotencyKey` / `provenanceKey` prove creation causality, **not reverse causality**.

`AIAuditEvent.actionRunId` is not written by domain reverse methods.

### Decision

**TYPE C migration required before AI reversal execution bindings.**

Authored locally in 26A (not applied to production in this commit):

`prisma/migrations/20260810120000_financial_reversal_idempotency`

Adds nullable:

- `OperatingExpense.reversalIdempotencyKey` — unique `(tenantId, key)`
- `TreasuryEntry.reversalIdempotencyKey` — unique `(tenantId, key, direction)`

Domain `reverse(..., { reversalIdempotencyKey })` stamps the key **atomically** with `deletedAt`.

Causality classification:

| Situation | `causality` | Future AI recovery |
|---|---|---|
| This call soft-deleted | `APPLIED` | success |
| Already reversed, same key | `SAME_COMMAND` | MATCH / `recovered=true` |
| Already reversed, null/other key | `EXTERNAL` | stale / already reversed externally — **no success** |

HTTP reverse paths remain backward compatible (no key → still soft-deletes; later AI sees EXTERNAL).

---

## 5. Trusted target model

```ts
TrustedReversalTarget {
  capability,
  targetType,
  targetId,          // server-injected only
  tenantId,
  targetFingerprint,
  targetSnapshot,    // safe UI fields
  observedAt
}
```

Provider `targetId` / raw DB IDs are stripped/rejected.

---

## 6. Fingerprints

### Expense

Material: `expenseId | amount | category | sourceAccount | expenseDate(UTC day) | currency | hasCanonicalTreasuryOutflow | active`

**Notes excluded** (mutable / non-material for plan freshness).

### Transfer

Material: `transferId | source | destination | amount | transferDate(UTC day) | pairComplete | active`

A transfer is the **logical pair**, never one leg alone.

---

## 7. Target resolution

Allowed sources:

A. trusted selected target from working context (revalidated)  
B. exact target from recent Assistant receipt (revalidated)  
C. unique deterministic DB search  
D. ENTITY_PICKER from server candidates  
E. ordinal selection over server-presented candidates  

Never: provider ID, raw user DB ID, silent first result, fuzzy guess.

### ENTITY_PICKER copy (safe)

Expense: amount · category/concept · source · date  
Transfer: amount · source → destination · date  

No raw IDs in user-facing labels.

### No match

Non-executable: “No encontré un gasto activo que coincida con esos datos.”  
No foreign-tenant existence leak.

### Already reversed

Non-executable typed state (`ALREADY_REVERSED` / domain `EXTERNAL`).  
No second economic inverse.

---

## 8. Last-action policy (“Deshaz eso”)

Safe **only** when working context contains a bounded `LastReversibleActionContext` with:

- same conversation **and** workspace
- allowlisted capability (`REVERSE_EXPENSE` / `REVERSE_TREASURY_TRANSFER`)
- targetId + fingerprint + actionRunId
- completedAt within bounded age (default 2h)

Then still:

- re-load target from DB
- revalidate fingerprint
- confirm with HIGH-risk preview

**Never** use global latest DB row or cross-conversation inference.

---

## 9. Freshness

At confirm, re-read target and require:

- tenant membership
- active state (unless SAME_COMMAND recovery)
- fingerprint match
- canonical dependent legs present/valid
- no new blockers

Mismatch → `REVERSAL_TARGET_STALE` / `STALE_PLAN`.

Identical-looking independent obligations are separate targets (no semantic dedupe across different ids).

---

## 10. HIGH-risk confirmation

Risk tier: **HIGH**

One explicit confirmation is acceptable for Expense + Transfer when:

- target resolution is deterministic
- preview is backend-derived and exact

Reserve two-step / stronger policy for sale cancellation, merges, ownership changes.

User language “borra / elimina” maps to **Revertir**, not pretending history never existed.

---

## 11. Previews

### Canonical expense

- Gasto activo −X  
- Source account +X  
- P&L operativo +X  
- Capital Sin cambio  
- CTA: **Revertir gasto**

### Legacy expense (no Treasury provenance)

- Gasto activo −X  
- **Tesorería Sin cambio** (must not claim liquidity restore)  
- P&L removes active expense only  

### Transfer

- Source +X  
- Destination −X  
- Liquidez total Sin cambio  
- P&L / Capital Sin cambio  
- CTA: **Revertir transferencia**

---

## 12. Idempotency / concurrency

- Same ActionRun × N with same `reversalIdempotencyKey` → one soft-delete; recovery MATCH.
- Two different ActionRuns same target → one wins; loser EXTERNAL / already reversed.
- Liquidity / pair legs restored or soft-deleted **once**.

Domain reverse remains the economic source of truth; the key provides **command causality**.

---

## 13. Error taxonomy

Shared codes (when useful):

- `REVERSAL_TARGET_NOT_FOUND`
- `REVERSAL_TARGET_AMBIGUOUS`
- `REVERSAL_TARGET_STALE`
- `REVERSAL_ALREADY_APPLIED`
- `REVERSAL_ALREADY_REVERSED_EXTERNALLY`
- `REVERSAL_INVARIANT`
- `REVERSAL_BLOCKED`

Preserve domain codes such as `STALE_TREASURY_TRANSFER_INVARIANT`.

---

## 14. Permissions

Future AI reversal inherits the same (or stricter) guards as today’s reverse endpoints.

Ordinary tenant JWT can reverse expense/transfer today — product confirmation is **not** a substitute for authorization.

---

## 15. Privacy / telemetry

Safe: capability, bindingVersion, target hash, amount, currency, account aliases, date bucket, causality, recovered, failure type.

Avoid: raw notes/concepts in telemetry (hash/omit), prompts, secrets, raw counterparty PII.

Passive funnel (future): intent → search → zero/picker/selected → preview → confirm → success / already reversed / stale / blocked / recovery / invariant.

---

## 16. Future receipt (not executed in 26A)

```ts
{
  reversedTargetId,
  reversedCapability,
  reversedAt,
  restoredLiquidity?,
  pnlChanged?,
  capitalChanged?,
  legacyMode?,
  recovered?,
  causality,
  rollbackPossible: false
}
```

---

## 17. Correction flow (future)

“Me equivoqué, eran 3,000 no 2,500.”

1. resolve original  
2. preview reverse  
3. confirm reverse  
4. optional **separate** ActionRun to register corrected operation  

No auto-chain in 26A.

---

## 18. Next reversal priority (bind later)

1. **REVERSE_EXPENSE** (after prod migrate + binding)  
2. **REVERSE_TREASURY_TRANSFER**  
3. REGISTER_PAYABLE_PAYMENT reverse (already has `alreadyReversed`)  
4. REGISTER_RECEIVABLE_PAYMENT reverse (needs cleaner alreadyReversed semantics)  
5. CAPITAL_CONTRIBUTION / DISTRIBUTION reverse  
6. MANUAL account cancel (narrow blockers)  
7. PURCHASE reverse (many downstream blockers)  
8. SETTLEMENT reverse (make idempotent-as-success first)  
9. SALE cancellation (separate program — highest complexity)

---

## 19. Blockers before AI bindings

1. **Production migrate** `20260810120000_financial_reversal_idempotency`  
2. Implement `ReverseExpenseWriteBinding` / `Transfer` binding calling only domain reverse with server key  
3. Planner catalog + FakeIntent + Admin allowlist + WritePlanRunner recovery  
4. Wire last-action context persistence after successful reversible writes  
5. Keep registry transition **12 → 14** as an explicit later commit (not 26A)

Until then: **exactly twelve WRITEs**, reversals AI-unbound.

---

## 20. Code map

| Area | Path |
|---|---|
| Types / contracts | `apps/api/src/modules/ai/reversals/` |
| Expense fingerprint / recovery / resolver | `expense-reversal-*.ts` |
| Transfer fingerprint / recovery / resolver | `transfer-reversal-*.ts` |
| Previews | `reversal-preview.ts` |
| Last-action policy | `last-reversible-action.policy.ts` |
| Domain causality | `expense-registration.service.ts`, `treasury-transfer.service.ts` |
| Migration | `prisma/migrations/20260810120000_financial_reversal_idempotency/` |
| Architecture tests | `financial-reversal.architecture.spec.ts` |
