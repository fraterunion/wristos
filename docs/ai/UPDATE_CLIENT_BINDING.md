# UPDATE_CLIENT — AI Write Binding (Commit 19B)

Status: **AI WRITE BOUND** (sixth executable write)

Canonical domain: `ClientUpdateService.update()` (Commit 19A)

AI path:

```
intent UPDATE_CLIENT
→ UpdateClientEntityResolver (trusted client + materialize final state)
→ Planner preview (fingerprint includes expectedUpdatedAt + patch + hashes)
→ READY_FOR_CONFIRMATION
→ POST /api/ai/action-runs/:id/confirm
→ WritePlanRunner
→ UpdateClientWriteBinding
→ ClientUpdateService.update(..., { expectedUpdatedAt })
→ CLIENT_UPDATED receipt
```

Executable AI writes are exactly **six**:

1. `REGISTER_SALE`
2. `REGISTER_RECEIVABLE_PAYMENT`
3. `REGISTER_EXPENSE`
4. `REGISTER_PURCHASE`
5. `CREATE_CLIENT`
6. `UPDATE_CLIENT`

Still unbound: `DELETE_CLIENT`, `RESTORE_CLIENT`, `MERGE_CLIENT`, `REGISTER_SETTLEMENT`, `REGISTER_CRYPTO_POSITION`, `REGISTER_CRYPTO_PRICE`.

Schema gate: **NO MIGRATION**. CAS uses existing `Client.updatedAt`.

Claude / LLM never performs persistence. Frontend never PATCHes CRM from the Assistant.

---

## 1. Write-binding architecture

| Layer | Responsibility |
|---|---|
| Intent / FakeIntent / prompt | Detect UPDATE_CLIENT + imperative ops / values (no IDs) |
| `UpdateClientEntityResolver` | Trusted Client resolve + materialize FINAL patch |
| Planner | Preview + fingerprint (no `ClientUpdateService` import) |
| `UpdateClientWriteBinding` | Map materialized args → one atomic domain update |
| `WriteCapabilityBindingRegistry` | Static allowlist size === 6 |

No domain behavior inside the LLM layer. No Prisma update in the binding beyond membership/recovery reads.

---

## 2. Supported operations (intent → materialize)

| Operation | Domain effect after materialization |
|---|---|
| `SET_NAME` | patch.name |
| `SET_EMAIL` / `CLEAR_EMAIL` | patch.email (string \| null) |
| `SET_PHONE` / `CLEAR_PHONE` | patch.phone (string \| null) |
| `SET_NOTES` / `CLEAR_NOTES` | patch.notes |
| `APPEND_NOTES` | **final notes string** via `resolveNotesPatch({ append })` then SET |
| `REPLACE_TAGS` / `ADD_TAGS` / `REMOVE_TAGS` | **final tags array** then SET |
| `SET_BUDGET_RANGE` | patch.budgetRange |

Clear ops require explicit language (`clearEmail` / `clearPhone` / `clearNotes`). Omitted fields never clear.

---

## 3. Client resolution / context

Trusted sources only:

- selected Client from working context
- unique search (`clientQuery` / name)
- ENTITY_PICKER selection (`selectedClientId`)

Deleted / cross-tenant → unavailable. Ambiguous → picker. No provider-supplied raw Client ID.

Deictic: after SEARCH/CREATE selection, “Cámbiale el teléfono…” uses trusted selected Client.

---

## 4. Final-state materialization

`materializeClientUpdate(snapshot, entities)`:

1. Infer operations
2. Compute desired FINAL field values from trusted current Client
3. Diff vs current → `changes[]` + replace-style `patch`
4. Capture `expectedUpdatedAt = client.updatedAt.toISOString()`
5. Capture `preStateHashes` (name/email/phone/notes/tags/budgetRange)

**Why:** `APPEND_NOTES` / `ADD_TAGS` are not safely replayable as imperative ops after commit. Execution always applies SET of the planned FINAL values under one CAS token.

If all ops are no-ops → conversational “No hay cambios que guardar.” (no executable preview).

---

## 5. Atomic multi-field behavior

One confirmation → one `ClientUpdateService.update()` call with the full materialized patch + single `expectedUpdatedAt`.

Examples that stay atomic: phone+email, phone+append notes, tag+email.

No sequential CAS loops in the binding. Partial apply from one confirmation is impossible at the domain command boundary.

---

## 6. Planner / preview

Preview is backend-derived from `changePreview` (masked before/after). Financial effects: “Sin cambios”.

Primary CTA: **Guardar cambios**. Secondary: Editar / Cancelar.

Before confirmation: zero Client mutation.

---

## 7. Confirmation lifecycle

`READY_FOR_CONFIRMATION` → confirm ActionRun → runner exclusive claim → binding → domain.

Double confirm of the same ActionRun: one execution owner; others IN_PROGRESS / replay of stored COMPLETED result.

---

## 8. Freshness / CAS

Plan stores `expectedUpdatedAt` at preview. Confirm passes it to domain.

If Client `updatedAt` moved → `CLIENT_STALE` (unless recovery reconstructs — below).

No automatic re-run. Copy:

> Este cliente cambió desde que preparé la actualización. Revisemos los datos actuales antes de continuar.

---

## 9. Identity collision

Active identity clash → `CLIENT_EXACT_DUPLICATE` (HTTP 409). Soft-deleted clash → `CLIENT_DELETED_MATCH`. No raw P2002.

Precedence (19A): **freshness first**, then identity.

---

## 10. No-op behavior

Normalized desired == current for all requested fields → no ActionRun execution path; TEXT_ANSWER “No hay cambios que guardar.”

Partial no-ops: preview only real changes.

---

## 11. Retry / idempotency

ActionRun CAS protects duplicate confirmation.

Domain execution uses materialized FINAL patch → retry after successful commit + runtime crash:

1. CAS may fail (`CLIENT_STALE`)
2. Binding checks `intendedFieldsMatch(current, patch)`
3. If all intended fields still equal desired → reconstruct success (`recovered=true`)
4. Never re-appends notes / re-adds tags

---

## 12. Post-commit recovery policy

No durable per-update mutation marker (TYPE C avoided).

| Scenario | Result |
|---|---|
| Commit succeeded; runtime failed; intended fields still match desired | Recovered success |
| Intended field later changed away from desired | `AMBIGUOUS_RECOVERY` / STALE_PLAN — no second mutation, no false success |
| Unrelated field changed; intended fields still match | Recovered success + `subsequentChangesDetected=true` |

---

## 13. Context refresh

After success: keep / refresh trusted selected Client (safe label only). Provider context never stores raw phone/email/notes.

---

## 14. BusinessActionResult / receipt

```
kind: CLIENT_UPDATED
clientId, name, changedFields[]
hasEmail, hasPhone, emailMasked, phoneMasked
recovered?, subsequentChangesDetected?, noop?
rollbackPossible: false
```

Correction: Corregir en CRM. Deep link: Ver cliente → `/crm/:id`.

---

## 15. Frontend UX

- Preview allowlist includes UPDATE_CLIENT
- Confirm CTA “Guardar cambios”
- SUCCESS_RECEIPT only when `kind === CLIENT_UPDATED` + `changedFields`
- Malformed completion fail-closed
- No Assistant CRM PATCH

---

## 16. Audit / privacy / telemetry

Telemetry / audit: clientId hash, changedFields enums, value hashes, hasEmail/hasPhone, stale/conflict codes, recovery flags. No raw PII.

Assistant Health observes UPDATE_CLIENT as sixth write funnel (passive).

---

## 17. Production rollout

Classification: **TYPE B** (API + Admin). No Prisma migrate.

Do not deploy until explicit approval. Controlled DEMO QA then Wrist Caviar.

---

## 18. Manual CRM (unchanged from 19A)

`PATCH /crm/clients/:id` still requires `expectedUpdatedAt` and changed-field-only patch via `ClientUpdateService`.
