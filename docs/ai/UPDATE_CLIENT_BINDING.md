# UPDATE_CLIENT — Canonical Domain Gate (Commit 19A)

Status: **DOMAIN READY — AI UNBOUND** (concurrency gate closed)

Canonical command: `ClientUpdateService.update()`

HTTP (manual): `PATCH /api/crm/clients/:id` → `CrmService.updateClient` → update service (**requires** `expectedUpdatedAt`)

AI binding: **none** (must remain non-executable until Commit 19B+)

Executable AI writes remain exactly **five**:

1. `REGISTER_SALE`
2. `REGISTER_RECEIVABLE_PAYMENT`
3. `REGISTER_EXPENSE`
4. `REGISTER_PURCHASE`
5. `CREATE_CLIENT`

`UPDATE_CLIENT` must not appear in the write-capability registry until an explicit later commit.

Schema gate: **NO MIGRATION**. Optimistic concurrency uses existing `Client.updatedAt` CAS (`expectedUpdatedAt`).

---

## 1. Manual update audit

| Path | Behavior |
|---|---|
| `PATCH /crm/clients/:id` | Delegates → `ClientUpdateService.update()` with **required** `expectedUpdatedAt` |
| CRM Admin edit modal | Captures `updatedAt` baseline; sends **changed fields only** + `expectedUpdatedAt` |
| Ventas / storefront | Create/register only — no client edit |
| Soft-delete | Separate `deleteClient` |
| Preferences / interactions | Separate endpoints — out of scope |
| Imports / seeds | Direct Prisma exceptions (offline tools) |

Callers of PATCH: **CRM Admin UI only** (no other app integrations). Domain `ClientUpdateService.update()` still allows omitting `expectedUpdatedAt` for controlled server helpers (`appendNotes` / `addTags` / `removeTags` always supply CAS themselves).

---

## 2. What UPDATE_CLIENT is / is not

**Is:** mutate supported CRM fields on one active tenant Client.

**Is not:** merge, delete, restore, create, transfer financial history, change tenant, edit User/Investor, mutate deals/payments/watches.

---

## 3. Editable / immutable fields (V1)

| Field | Clearable | Notes |
|---|---|---|
| `name` | no (required) | trim + collapse whitespace; accents preserved |
| `email` | yes → `null` | trim + lowercase |
| `phone` | yes → `null` | MX canonical normalizer |
| `notes` | yes → `null` | single string; replace or append helpers |
| `tags` | yes → `[]` | full-array replace; add/remove helpers |
| `budgetRange` | yes → `null` | free string trimmed |

Immutable: `id`, `tenantId`, `registerIdempotencyKey`, `createdAt`, `deletedAt`, relations.

---

## 4. Patch / clear / changed-fields policy

| Input | Effect |
|---|---|
| field omitted / `undefined` | unchanged |
| optional field `null` or `''` | clear to `null` (tags → `[]` if provided empty array) |
| provided non-empty | normalize + set if different |

**Manual CRM:** builds a deterministic diff vs edit baseline; sends only changed fields + `expectedUpdatedAt`. No-op form → no PATCH.

**Interactive HTTP:** `expectedUpdatedAt` is required (DTO + service guard). Missing → `400 BadRequest`.

---

## 5. Notes policy

- `update({ notes })` → **replace**
- `appendNotes(addition)` → append `\n` + trimmed line with `updatedAt` CAS
- Future AI “agrégale una nota” → `appendNotes`

Stale form after concurrent append → `CLIENT_STALE` (does not restore old notes).

---

## 6. Tags policy

- `update({ tags })` → full-array replace (manual UI + CAS)
- `addTags` / `removeTags` → RMW + CAS

Stale full-array replacement after concurrent add → `CLIENT_STALE`.

---

## 7. Identity collision

1. Active clash → `CLIENT_EXACT_DUPLICATE`
2. Soft-deleted clash → `CLIENT_DELETED_MATCH`
3. DB indexes authoritative under concurrency → typed conflict (no raw P2002)

Error payloads: typed `code` / `matchField` / `existingClientId` only — **no** raw competing email/phone/notes/name.

---

## 8. Soft-deleted Client

`deletedAt: null` only → soft-deleted target is **NotFound**. No hidden restore.

---

## 9. Manual UI CAS architecture

Proven pre-fix gap (domain without `expectedUpdatedAt`):

1. Editors A & B load Client at `updatedAt=T1` (`notes=OLD`, `phone=A`)
2. B sets `notes=NEW`
3. A submits full form `{ phone: B, notes: OLD }` without CAS
4. **Result:** notes return to `OLD` (lost update)

**Closed for interactive path:**

1. Modal open captures baseline including `updatedAt`
2. Save sends changed fields + `expectedUpdatedAt`
3. Backend: `UPDATE ... WHERE tenantId AND id AND deletedAt IS NULL AND updatedAt = expected`
4. Zero rows → `CLIENT_STALE` (no silent retry / merge)

| Scenario | Interactive (CAS required) |
|---|---|
| Same-field stale edit | `CLIENT_STALE` |
| Different-field stale form | `CLIENT_STALE` |
| Fresh edit with matching token | succeeds |
| Two fresh reads, first wins | second → `CLIENT_STALE` or identity conflict |

### CLIENT_STALE UX (Admin)

Message: *“Este cliente cambió mientras lo estabas editando. Recarga la información y vuelve a intentarlo.”*

UI refetches Client and refreshes the edit form baseline — does **not** auto-overwrite.

---

## 10. Conflict precedence

When a save could be both stale and identity-conflicting:

1. **Freshness first** (`expectedUpdatedAt` vs current `updatedAt`) → `CLIENT_STALE`
2. Then identity pre-check / DB unique → `CLIENT_EXACT_DUPLICATE` / `CLIENT_DELETED_MATCH`

Documented outcome for tests: stale token never proceeds to identity mutation.

---

## 11. No-op semantics

If the normalized patch equals current values → `{ noop: true, changedFields: [] }` without bumping `updatedAt`.

---

## 12. Future AI freshness contract (19B design)

Plan must capture:

- trusted `clientId`
- `expectedUpdatedAt` at planning/preview time
- canonical old-state hashes
- canonical patch

Confirm path: `ClientUpdateService.update(..., { expectedUpdatedAt })` — **always**.

---

## 13. Post-commit recovery limitation (critical for 19B)

CREATE’s `registerIdempotencyKey` does **not** apply to UPDATE.

**Safe V1 recovery (no schema):**

| Situation | Policy |
|---|---|
| ActionRun EXECUTING → Client commit → runtime fails; **intended fields still equal desired values** | May reconstruct success (A) |
| Same, but a **later third-party mutation** changed an intended field (e.g. phone B→C) | **Must not** claim AI success from final entity state (B — ambiguous / re-preview) |
| Durable per-mutation marker | Not in 19A; would be **TYPE C** if required later (C) |

Proven: after AI commits phone→B then operator sets phone→C, retry with original plan fingerprint is `CLIENT_STALE` and current phone ≠ intended — recovery must not invent success.

No Client update idempotency column in 19A.

---

## 14. Permissions

JWT tenant membership. Cross-tenant → NotFound.

---

## 15. Privacy / audit

Allowed: `clientId` hash, `changedFields[]`, old/new value hashes, `hasEmail`/`hasPhone`, capability, result hash, recovered, duration, typed error codes.

Do **not** put raw name/phone/email/notes/tags (or competing Client names) in telemetry or conflict payloads.

---

## 16. Future AI preview (design only)

```
Voy a actualizar este cliente:
José Hernández

Cambios:
Teléfono  •••• 1234 → •••• 5678
Correo    sin cambio

Movimientos financieros  Sin cambios

Primary: Guardar cambios
```

---

## 17. Out of scope

- DELETE_CLIENT / RESTORE_CLIENT / MERGE_CLIENT AI
- Automatic composition with sale/purchase
- Fuzzy Client resolution inside the domain command
- Notes history table
- Schema migration

---

## 18. Rollout / blockers before 19B

19A merge: **TYPE B** (API + Admin) + docs. No migrate.

Blockers before AI UPDATE_CLIENT:

1. Bind `UPDATE_CLIENT` as sixth write
2. Entity resolver + Client picker
3. Preview masking + confirmation CTA
4. Persist `expectedUpdatedAt` + old-state hashes in plan fingerprint
5. Recovery policy: success only if intended fields still match; else ambiguous / re-preview
6. Frontend success allowlist + fail-closed
7. Telemetry for sixth write
8. Keep five writes until 19B ships
