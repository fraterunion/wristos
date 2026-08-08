# CREATE_CLIENT — Canonical Domain Gate (Commit 18A)

Status: **DOMAIN READY — AI UNBOUND**
Canonical command: `ClientRegistrationService.register()`
HTTP (manual): `POST /api/crm/clients` → `CrmService.createClient` → registration service
AI binding: **none** (must remain non-executable until Commit 18B+)

Executable AI writes remain exactly four:

1. `REGISTER_SALE`
2. `REGISTER_RECEIVABLE_PAYMENT`
3. `REGISTER_EXPENSE`
4. `REGISTER_PURCHASE`

`CREATE_CLIENT` must not appear in the write-capability registry until an explicit later commit.

---

## 1. Canonical Client model

Prisma `Client` (`clients`):

| Field | Required | Notes |
|---|---|---|
| `id` | system | cuid |
| `tenantId` | yes | JWT tenant |
| `name` | **yes** | single display name (no first/last split) |
| `email` | optional | stored lowercase-normalized |
| `phone` | optional | stored per phone policy |
| `notes` | optional | |
| `tags` | optional | `String[]`, default `[]` |
| `budgetRange` | optional | |
| `registerIdempotencyKey` | optional | durable request idempotency |
| `deletedAt` | soft delete | null = active |
| `createdAt` / `updatedAt` | system | |

**Not on Client:** company, RFC, address, WhatsApp IDs, external IDs, firstName/lastName, source column.

**Minimum valid Client:** `{ tenantId, name }` with non-empty trimmed `name`.

**Client vs others:** WristOS uses `Client` for both buyers (sales / CxC) and sellers (`Watch.sellerClientId` / payables). It is not `User` / `PlatformUser` / Investor. Storefront and CRM create the same entity. Suppliers are not a separate table — seller identity is also `Client` when linked.

---

## 2. Manual create flow (converged)

| Caller | Path | Uses canonical? |
|---|---|---|
| CRM Admin “Crear cliente” | `POST /crm/clients` | **Yes** |
| Ventas quick-create | `ventas-api.createClient` → same POST | **Yes** |
| Cuentas / Deals / Matching | list only | N/A |
| Stripe storefront reservation | `StripeService.findOrCreateClient` | **Yes** (via `ClientRegistrationService`, key `storefront-reservation:<id>`) |
| Sales historical import | transactional `tx.client.create` | **Exception** — name-cache inside import TX; documented debt |
| Seed / one-off migration scripts | direct Prisma | **Exception** — offline tools |

Frontend must not own duplicate safety. Duplicate/normalization gates live in `ClientRegistrationService`.

Guards: `@UseGuards(JwtAuthGuard)` on `CrmController`. Tenant from JWT (`user.tenantId`). No separate OWNER/ADMIN role gate beyond authenticated tenant membership — **do not broaden for AI**.

---

## 3. Normalization policy

### Name
- Trim + collapse internal whitespace
- Preserve Unicode/accents in stored `name`
- Do not parse/split surnames
- Probable-duplicate key: NFD accent-fold + lowercase (`clientNameMatchKey`)

### Email
- Trim + lowercase for storage and comparison
- Blank → `null`
- Exact duplicate: same tenant + case-insensitive email (active or soft-deleted)

### Phone
- Blank → `null`
- Digits only for match key
- 10-digit local → `+52XXXXXXXXXX` (MX convention, matching current business)
- 12-digit starting `52` → `+52...`
- Explicit `+` international preserved as `+digits`
- Otherwise store digit string if 7–15 digits
- Exact duplicate: same tenant + same digit match key

---

## 4. Exact duplicate policy

Deterministic conflicts (**409 Conflict** with structured body):

| Code | Condition | Behavior |
|---|---|---|
| `CLIENT_EXACT_DUPLICATE` | active client, same normalized email or phone | Do **not** create; return existing id/name |
| `CLIENT_DELETED_MATCH` | soft-deleted client, same email or phone | Do **not** create; do **not** auto-restore |

Future AI clarification: “Ya existe … ¿Quieres usar ese cliente?” / “Existe eliminado — restáuralo en CRM.”

Name-only never exact-merges.

---

## 5. Probable duplicate policy

Same accent-insensitive name, different/absent contact → `probableDuplicates[]` on result.

Manual CRM **still creates** (name collisions are common; product allows multiple “José”).

Future AI: present candidates; never silent merge. Optional `allowProbableDuplicate` for explicit override (not exposed as required CRM UX in 18A).

---

## 6. Deleted Client collision

Canonical: **reject + ask to restore in CRM**. No silent resurrection. No automatic new row when contact matches a deleted identity (avoids fragmentation and PII shadow duplicates).

---

## 7. Idempotency

| Mechanism | Sufficient alone? |
|---|---|
| Unique email/phone | **No** — name-only clients are valid |
| `registerIdempotencyKey` + `@@unique([tenantId, registerIdempotencyKey])` | **Yes** for request replay |

Future AI: `registerIdempotencyKey = ai-action-run:<actionRunId>`.

Replay: same key + compatible payload → `{ replayed: true, client }`.  
Same key + changed payload → `409` conflict.  
Concurrent same key → one row (P2002 recovery).

---

## 8. Side effects / atomicity

`register()` creates **exactly one** `Client` row (or returns existing on idempotent replay).  
No Deal, AccountEntry, Payment, Treasury, or Watch mutation.  
Atomicity: single Prisma `create` (+ unique constraint for races).

---

## 9. Permissions

Same as manual CRM create: JWT tenant membership. Future CREATE_CLIENT inherits same or stricter — never broader.

---

## 10. Privacy / audit (future AI)

Store PII in `Client` as business data. Telemetry/audit must use:

- hashed `clientId`
- capability / bindingVersion
- result hash
- field-presence flags (`hasPhone`, `hasEmail`, …)

Avoid raw name/phone/email/notes/address in AI telemetry.

---

## 11. Correction / delete

- Soft delete via `deletedAt` (`DELETE /crm/clients/:id`)
- Name/email/phone editable via `PATCH` with same normalization + active contact uniqueness
- Historical Deals / AccountEntries / `Watch.sellerClientId` keep FK to Client id — edits do not rewrite financial snapshots
- Receipt guidance for future AI: “Corregir en CRM” — no conversational reverse in 18A

---

## 12. Future AI intent / preview (design only)

Examples:

- “Crea a José Hernández.” → name-only preview if policy allows (it does today).
- “… teléfono 55 …” → normalize + exact duplicate gate.
- “… ana@email.com” → email normalize + gate.
- “Crea a José.” → run probable-duplicate search; do not assume unique.

Preview (happy path):

```
Voy a crear este cliente:
Nombre / Teléfono / Correo / Empresa(—)
Efectos: CRM +1 cliente · No financial movement
[Crear cliente] [Editar] [Cancelar]
```

If exact/probable candidates: **do not** show normal create preview — show use-existing / (optional) create-anyway.

---

## 13. Composition limitation

Do **not** hide CREATE_CLIENT inside REGISTER_PURCHASE / REGISTER_SALE.  
Future multi-action orchestration (“No encuentro a Pepe — ¿lo creo?”) is out of 18A.

---

## 14. Schema gate (TYPE C)

Additive migration (authored locally, **not** applied to production in 18A):

```
Client.registerIdempotencyKey String?
@@unique([tenantId, registerIdempotencyKey])
@@index([tenantId, phone])
```

**No** unique email/phone DB constraints — production may contain legacy duplicates; service-layer enforcement only until data cleaned.

File: `prisma/migrations/20260809180000_client_register_idempotency/migration.sql`

---

## 15. Blockers before Commit 18B (AI CREATE_CLIENT)

1. Apply migration to production (`prisma migrate deploy`) after explicit approval
2. Implement `CreateClientWriteBinding` + registry entry (only then fifth write)
3. Planner / enricher / confirmation preview UI
4. Probable-duplicate UX for conversational override
5. Telemetry privacy contract for CREATE_CLIENT
6. Decide whether CRM UI surfaces probable-duplicate warning (optional)
7. Sales-import convergence (optional debt)
8. Prod duplicate-data cleanup if unique contact indexes desired later

---

## 16. Return shape

```ts
{
  client: Client;
  replayed: boolean;
  probableDuplicates: ClientDuplicateCandidate[];
}
```

HTTP create still returns serialized Client (CRM compatibility). Conflicts → 409.
