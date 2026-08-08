# CREATE_CLIENT — AI Write Binding (Commit 18B)

Status: **AI WRITE BOUND — CONFIRMATION REQUIRED**
Canonical command: `ClientRegistrationService.register()`
HTTP (manual): `POST /api/crm/clients` → `CrmService.createClient` → registration service
AI binding: `CreateClientWriteBinding` → WRITE `1.0.0`
Idempotency: `Client.registerIdempotencyKey = ai-action-run:<actionRunId>`

Executable writes after 18B (exactly **five**):

1. `REGISTER_SALE`
2. `REGISTER_RECEIVABLE_PAYMENT`
3. `REGISTER_EXPENSE`
4. `REGISTER_PURCHASE`
5. `CREATE_CLIENT`

Still unbound: `UPDATE_CLIENT`, `REGISTER_SETTLEMENT`, `REGISTER_CRYPTO_POSITION`, `REGISTER_CRYPTO_PRICE`

---

## 1. Deployed 18A domain (prerequisite)

Production-verified:

- `ClientRegistrationService.register()`
- tenant-scoped Client identity
- name required; optional email / phone / notes / tags / budgetRange
- name / email / phone normalization
- `Client.registerIdempotencyKey`
- exact active normalized email uniqueness
- exact active normalized phone identity uniqueness
- `probableDuplicates[]`
- `CLIENT_EXACT_DUPLICATE` / `CLIENT_DELETED_MATCH`
- soft-delete behavior + update collision protection
- canonical CRM / Ventas / Storefront callers

Schema gate: **NO migration in 18B.** 18A production schema is sufficient.

---

## 2. AI argument contract

Trusted execution arguments (planner → binding `mapInput`):

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Trim + collapse whitespace; preserve accents/Unicode |
| `email` | optional | Trim + lowercase; reject malformed |
| `phone` | optional | Canonical MX 10-digit → `+52…`; reject unsupported |
| `notes` / `tags` / `budgetRange` | optional | Same as manual CRM |
| `allowProbableDuplicate` | optional | Explicit create-anyway after name probable match |
| `registerIdempotencyKey` | **server-only** | `ai-action-run:<actionRunId>` |

Never accepted from LLM / frontend / user / planner arguments: `registerIdempotencyKey`.

No company / RFC / address / firstName-lastName fields (not on Client).

---

## 3. Normalization

Same utilities as manual CRM (`client-identity.util.ts`):

- **Name:** trim, collapse whitespace, keep accents. Name-only create allowed.
- **Email:** trim + lowercase. Exact active match → hard block.
- **Phone:** MX 10-digit local → `+52XXXXXXXXXX`. Not universal international. Exact active identity → hard block.

---

## 4. Exact vs probable vs deleted

| Signal | Behavior | Override |
|---|---|---|
| Exact active email or phone | No create preview/execution. Copy: “Ya existe un cliente con esos datos.” | **None** |
| Exact identity only on soft-deleted | `CLIENT_DELETED_MATCH`. No recreate/restore. CTA: Abrir CRM | **None** |
| Probable name match | ENTITY_PICKER: use existing **or** “Crear cliente nuevo” | Explicit create-new → `allowProbableDuplicate: true` → normal preview |

Exact identity remains a durable hard constraint. Create-anyway applies **only** to name-probable duplicates.

---

## 5. Planner clarification / preview

Clarify groups: NAME, INVALID_EMAIL, INVALID_PHONE, PROBABLE_DUPLICATE_DECISION, DELETED_MATCH, EXACT_DUPLICATE.

Do not ask for phone/email when absent. Do not invent contact data.

Preview fields: Nombre / Correo / Teléfono (— when absent). Effects: CRM +1 cliente; Finanzas sin cambios.

Primary CTA: **Crear cliente**. Secondary: Editar / Cancelar.

---

## 6. Confirmation lifecycle

1. NL → intent → `CreateClientEntityResolver` → plan
2. `READY_FOR_CONFIRMATION` + `executable: true`
3. Primary CTA → `POST /api/ai/action-runs/:id/confirm`
4. `WritePlanRunner` → `CreateClientWriteBinding` → `ClientRegistrationService.register()`

No confirmation → **zero Client creation**.
Assistant frontend must **not** call `POST /crm/clients`.

---

## 7. Freshness

Before execute: actor membership, workspace `activeActionRunId`, fingerprint, canonical payload unchanged, exact-duplicate status revalidated by domain (unique constraint / service).

Race: preview free → another process creates same email/phone → confirm fails typed `CLIENT_EXACT_DUPLICATE` → no second Client → no success receipt.

---

## 8. Idempotency

`Client.registerIdempotencyKey = ai-action-run:<actionRunId>`

- Double confirm / 3 concurrent confirms / network retry → one Client, same receipt
- Same ActionRun → replay
- Different ActionRuns + same email/phone → identity conflict (not replay)

---

## 9. Identity concurrency

Two different CREATE_CLIENT ActionRuns, same normalized phone/email, confirmed concurrently:

- Winner: COMPLETED
- Loser: typed duplicate conflict (no generic 500, no success receipt)

---

## 10. Post-commit recovery

WritePlanRunner:

`EXECUTING` → register commits → runtime completion fails → retry finds Client by `tenantId` + `registerIdempotencyKey` → reconstruct result → COMPLETED. No second Client.

Pending marker label: `CANONICAL_CLIENT_COMMITTED_RUNTIME_PENDING`.

---

## 11. BusinessActionResult / receipt

```
executionState: EXECUTED
success: true
affectedEntities: [{ type: CLIENT, idHash, effect: CREATED|REPLAYED }]
receipt: {
  kind: CLIENT_CREATED,
  clientId, name,
  hasEmail, hasPhone,
  emailMasked?, phoneMasked?,
  replayed?, probableDuplicateCount?
}
rollbackPossible: false
```

Audit metadata: actionRunId, capability, bindingVersion, planFingerprint, clientId hash, identity hash, hasPhone/hasEmail, idempotency-key hash, recovered, duration, duplicateField/failure type.
**Never** store raw name/phone/email/notes/full payload in audit telemetry.

---

## 12. Frontend UX

- Intro: “Voy a crear este cliente:”
- CTA: Crear cliente (`CONFIRM_CLIENT`)
- Success only after COMPLETED: “Listo. El cliente quedó creado.”
- Links: Ver cliente (`/crm/:id`) · Corregir en CRM
- Success allowlist: SALE, PAYMENT, EXPENSE, PURCHASE, **CREATE_CLIENT**
- Malformed CREATE_CLIENT SUCCESS_RECEIPT → fail closed
- Unbound writes still blocked

---

## 13. Context behavior

After successful create (or explicit “use existing”), trusted `selectedEntity` CLIENT may be stored in AssistantWorkingContext for deictic multi-turn (“úsalo para la compra”).

No autonomous chained purchase/sale execution in this commit.

---

## 14. Composition limitation

**Not in 18B:**

- Purchase asks for seller → auto CREATE_CLIENT → resume purchase
- Sale asks for buyer → auto CREATE_CLIENT → resume sale

CREATE_CLIENT is an explicit independent ActionRun. Future composition may reuse selected trusted Client.

---

## 15. Permissions / privacy / telemetry

- Same or stricter than manual CRM create (JWT tenant membership). Cross-tenant fail closed.
- Probable-duplicate picker: safe display labels (name; avoid dumping full PII).
- Telemetry passive: attempts, probable-duplicate rate, exact-duplicate conflict rate, confirmation rate, success/failure/recovery. No PII.
- Assistant Health observes CREATE_CLIENT as fifth write capability.

---

## 16. AI / domain boundary

Only `CreateClientWriteBinding` → `ClientRegistrationService.register()` may execute canonical create.

Architecture tests: planner and intent-adapter do not import `ClientRegistrationService`. Frontend Assistant does not call CRM create.

---

## 17. Rollout

1. Merge 18B after quality gates (no schema migrate).
2. Backend Railway deploy (TYPE B risk).
3. Frontend Vercel.
4. Smoke: “Crea a …”, confirm, receipt; exact duplicate; probable duplicate create-new; double confirm.

---

## 18. Create-anyway policy (summary)

| Case | User may create anyway? |
|---|---|
| Name-only / name-probable | Yes — after explicit “Crear cliente nuevo” / “Crear de todos modos” |
| Exact email/phone active | **No** |
| Deleted exact identity | **No** (reactivation is a future capability) |
