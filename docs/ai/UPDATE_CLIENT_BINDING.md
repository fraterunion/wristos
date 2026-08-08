# UPDATE_CLIENT — Canonical Domain Gate (Commit 19A)

Status: **DOMAIN READY — AI UNBOUND**  
Canonical command: `ClientUpdateService.update()`  
HTTP (manual): `PATCH /api/crm/clients/:id` → `CrmService.updateClient` → update service  
AI binding: **none** (must remain non-executable until Commit 19B+)

Executable AI writes remain exactly **five**:

1. `REGISTER_SALE`
2. `REGISTER_RECEIVABLE_PAYMENT`
3. `REGISTER_EXPENSE`
4. `REGISTER_PURCHASE`
5. `CREATE_CLIENT`

`UPDATE_CLIENT` must not appear in the write-capability registry until an explicit later commit.

Schema gate: **NO MIGRATION** for 19A. Optimistic concurrency uses existing `Client.updatedAt` CAS (`expectedUpdatedAt`). No Client-level update idempotency column required — ActionRun lifecycle + naturally idempotent patches + optional `updatedAt` fingerprint cover future AI recovery.

---

## 1. Manual update audit (pre-19A → 19A)

| Path | Before | After 19A |
|---|---|---|
| `PATCH /crm/clients/:id` | `CrmService.updateClient` + direct Prisma | **Delegates** → `ClientUpdateService.update()` |
| CRM Admin edit modal | `apiPatch(/crm/clients/:id)` full form payload | Unchanged caller; canonical server path |
| Ventas / storefront | create-only (registration); no client edit | N/A |
| Soft-delete | `CrmService.deleteClient` sets `deletedAt` | Separate command (not UPDATE_CLIENT) |
| Preferences / interactions | Separate endpoints | Out of UPDATE_CLIENT scope |
| Imports / seeds | Direct Prisma exceptions | Documented offline tools |

No other `prisma.client.update` in API application code except soft-delete.

---

## 2. What UPDATE_CLIENT is / is not

**Is:** mutate supported CRM fields on one active tenant Client.

**Is not:** merge, delete, restore, create, transfer financial history, change tenant, edit User/Investor, mutate deals/payments/watches.

---

## 3. Editable / immutable fields (V1)

Editable:

| Field | Clearable | Notes |
|---|---|---|
| `name` | no (required) | trim + collapse whitespace; accents preserved |
| `email` | yes → `null` | trim + lowercase |
| `phone` | yes → `null` | MX canonical normalizer |
| `notes` | yes → `null` | single string; replace or append helpers |
| `tags` | yes → `[]` | full-array replace; add/remove helpers |
| `budgetRange` | yes → `null` | free string trimmed (no separate enum column) |

Immutable via this command:

- `id`, `tenantId`, `registerIdempotencyKey`, `createdAt`, `deletedAt`
- all relations (deals, account entries, watches as seller, etc.)

---

## 4. Patch / clear semantics

| Input | Effect |
|---|---|
| field omitted / `undefined` | unchanged |
| optional field `null` or `''` | clear to `null` (tags → `[]` if provided empty array) |
| provided non-empty | normalize + set if different |

Partial patches must not erase omitted fields. CRM UI currently sends full form (clears blank optional fields intentionally).

---

## 5. Notes policy

Storage: single `Client.notes` string (no history table).

Domain API:

- `update({ notes })` → **replace**
- `appendNotes(addition)` → append `\n` + trimmed line (uses `updatedAt` CAS)
- Future AI “agrégale una nota” → `appendNotes`, not blind replace

---

## 6. Tags policy

Storage: `String[]` full replace under the hood.

Domain API:

- `update({ tags })` → replace
- `addTags` / `removeTags` → read-modify-write with `updatedAt` CAS
- Future AI “quita el tag VIP” → `removeTags`

---

## 7. Identity collision

When changing email/phone to a new non-null identity:

1. Pre-check active clash → `CLIENT_EXACT_DUPLICATE`
2. Pre-check soft-deleted clash → `CLIENT_DELETED_MATCH` (no reassignment)
3. DB partial unique indexes remain authoritative under concurrency → typed conflict, not raw P2002

No merge / overwrite of the other Client’s identity.

Formatting-equivalent phones/emails collide (same normalizers as CREATE).

---

## 8. Soft-deleted Client

`update()` loads `deletedAt: null` only → **NotFound**.

No hidden restore. Restore is a future `RESTORE_CLIENT` capability.

---

## 9. Concurrency / lost updates

| Scenario | Behavior |
|---|---|
| Concurrent updates of **different** fields | PostgreSQL row updates compose; both columns typically persist |
| Concurrent / stale updates of **same** field | last-write-wins unless `expectedUpdatedAt` set |
| Stale preview (AI/manual) | pass `expectedUpdatedAt` → `CLIENT_STALE` if changed |

No `version` integer column required for V1. `updatedAt` CAS is sufficient for future AI freshness.

---

## 10. Recovery / idempotency (future AI)

CREATE’s `registerIdempotencyKey` does **not** apply to UPDATE.

19A assessment:

- WritePlanRunner ActionRun CAS already prevents double execution for the same ActionRun
- Identical patch re-apply is naturally idempotent (`noop` when values already match)
- Crash after Client commit + failed runtime completion: retry can re-read Client, verify expected field values / `updatedAt`, reconstruct receipt — **no second durable marker required**

If 19B discovers a gap that needs a Client mutation marker: TYPE C schema gate then.

---

## 11. Permissions

Same as manual CRM: JWT tenant membership (`JwtAuthGuard`). Cross-tenant id → NotFound. Do not broaden for AI.

---

## 12. Privacy / audit (future AI)

Allowed metadata: `clientId` hash, `changedFields[]`, old/new value hashes, `hasEmail`/`hasPhone`, capability, result hash, recovered, duration.

Do **not** put raw name/phone/email/notes/tags in telemetry/audit. CRM row remains the PII store.

---

## 13. Future AI contract (design only — not implemented)

Flow:

NL → resolve trusted `clientId` → plan patch → preview (masked old → new) → confirm → `ClientUpdateService.update(..., { expectedUpdatedAt })`.

Preview sketch:

```
Voy a actualizar este cliente:
José Hernández

Cambios:
Teléfono  •••• 1234 → •••• 5678
Correo    sin cambio

Movimientos financieros  Sin cambios

Primary: Guardar cambios
```

Examples (19B+):

- “Cámbiale el teléfono a José…” → phone patch + CAS
- “Ponle ana@nueva.com” → email collision gate
- “Agrégale una nota…” → `appendNotes`
- “Quita el tag VIP” → `removeTags`

---

## 14. Out of scope

- DELETE_CLIENT / RESTORE_CLIENT / MERGE_CLIENT AI
- Automatic composition with sale/purchase
- Fuzzy Client resolution inside the domain command
- Notes history table
- Schema migration

---

## 15. Rollout / blockers before 19B

19A merge: TYPE B (API) (+ docs). No migrate.

Blockers before AI UPDATE_CLIENT:

1. Bind `UPDATE_CLIENT` once in write registry (sixth write)
2. Entity resolver + probable/unique Client picker
3. Preview masking + confirmation CTA “Guardar cambios”
4. Persist `expectedUpdatedAt` in plan fingerprint
5. Frontend success allowlist + fail-closed
6. Telemetry funnel for sixth write
7. Confirm still exactly five writes until 19B ships

---

## 16. Create-anyway / delete policy reminder

Exact identity conflicts: **no override**.  
Deleted identity: **no update reassignment**.  
Soft-deleted target: **not editable** via UPDATE_CLIENT.
