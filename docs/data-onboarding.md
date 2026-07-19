# WristOS — Onboarding de datos (Phase 1)

## Product goal

Allow tenant administrators to upload existing business files (PDF, XLSX, CSV, JSON) in bulk. WristOS analyzes them, stages normalized rows for review, and **never writes to operational tables** until a future confirmation phase.

## Phase 1 scope

**In scope**

- Tenant-scoped import sessions
- Upload CSV / XLSX / JSON / PDF
- Deterministic parsing for CSV, XLSX, JSON
- Conservative entity classification
- Staging records + raw preview UI
- Local filesystem storage for development

**Out of scope**

- AI / OpenAI / OCR
- PDF table extraction (PDF is stored only)
- Field-mapping UI
- Confirmed import into Watch, Client, Deal, Payment, Treasury, etc.
- S3 / R2 / cloud object storage
- Production deployment of this feature

## Architecture

```
Upload → Extract → Classify → Normalize → Validate → Preview → [Review] → [Confirm] → [Import]
                                                              ↑ Phase 1 stops here
```

### Components

| Layer | Location |
|-------|----------|
| Prisma staging models | `prisma/schema.prisma` |
| API module | `apps/api/src/modules/data-onboarding/` |
| Storage abstraction | `apps/api/src/modules/data-onboarding/storage/` |
| Local file uploads | `/storage/imports/<tenantId>/<sessionId>/` (gitignored) |
| Admin UI | `apps/admin/src/app/(protected)/data-onboarding/` |

### Session lifecycle

`CREATED` → `UPLOADING` → `PROCESSING` → `READY_FOR_REVIEW` → (future) `IMPORTING` → `COMPLETED`

Failure / cancel paths: `FAILED`, `CANCELLED`

Upload and process are rejected while `PROCESSING`, `IMPORTING`, `COMPLETED`, or `CANCELLED`. Delete is rejected while `PROCESSING`, `IMPORTING`, or `COMPLETED`.

### Staging tables (tenant-scoped)

- `data_import_sessions`
- `data_import_files`
- `data_import_records` — raw/normalized JSON per row
- `data_import_events` — audit trail

**Not written in Phase 1:** `watches`, `clients`, `deals`, `payments`, treasury, cuentas, investors, radar, expenses.

## Supported formats (Phase 1)

| Format | Upload | Deterministic parse |
|--------|--------|---------------------|
| CSV | ✅ | ✅ |
| XLSX | ✅ | ✅ (multi-sheet; hidden sheets skipped) |
| JSON | ✅ | ✅ (array / object-with-arrays / single object) |
| PDF | ✅ | ❌ — stored only; message: intelligent extraction in next phase |

## Local storage configuration

```env
IMPORT_STORAGE_PROVIDER=local
IMPORT_STORAGE_LOCAL_PATH=./storage/imports
IMPORT_MAX_FILE_SIZE_MB=25
```

- Unsupported `IMPORT_STORAGE_PROVIDER` values fail at startup/use with a clear error.
- Uploaded binaries live under `/storage/` (repo root), which is gitignored. Source code under `apps/**/storage/` is **not** ignored.

## Railway production limitation

Railway containers use **ephemeral filesystems**. The default `local` storage provider is suitable for **development only**. Production must use object storage (S3, R2, Supabase Storage) in a future phase. Uploaded files will not survive redeploys on Railway with local storage.

## Security and tenant isolation

- JWT auth required on all `/data-onboarding/*` routes
- `tenantId` from token only — never from client body or query
- Every session/file/record query is scoped by `{ tenantId, … }`
- Extension + size allowlists; PDF MIME mismatch rejected
- Safe storage keys (UUID filenames; original name is metadata only)
- Path traversal protection in local storage
- Checksum duplicate detection per session (tenant-scoped)
- `storageKey` is never returned to the client
- No raw financial payload logging

## Authorization (current WristOS limitation)

WristOS roles are free-string names on `Role` (seed default `OWNER`). JWT may include `role`, but **there is no `RolesGuard` / permission system in the API today**. Like inventory, CRM, and cuentas, Data Onboarding is available to any authenticated tenant member.

**Do not invent GymOS-style roles.** Future-safe approach: add a small reusable Nest guard (e.g. require tenant role `OWNER`) once product decides which WristOS roles may manage imports — apply it consistently across admin-sensitive modules.

Sidebar: all authenticated admin users see **Importar datos** (matches current WristOS session model — no per-route permission flags).

## Migration (manual — TYPE C)

Migrations:

- `prisma/migrations/20260717120000_data_onboarding_foundation/`
- `prisma/migrations/20260718120000_inventory_import_v1/` (additive: `warning_rows`, `dry_run_version`, `import_started_at`, `field_mapping`, `mapping_version`, new `DataImportEventType` values)

Production workflow (after merge, run manually):

```bash
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

Do **not** execute the SQL manually and do **not** use `migrate resolve --applied` unless recovering from an actually partially applied migration.

## API endpoints

```
POST   /data-onboarding/sessions
GET    /data-onboarding/sessions
GET    /data-onboarding/sessions/:sessionId
POST   /data-onboarding/sessions/:sessionId/files   (multipart field: file)
GET    /data-onboarding/sessions/:sessionId/files
GET    /data-onboarding/sessions/:sessionId/records?page=&limit=&fileId=&entityType=&valid=&rowStatus=
POST   /data-onboarding/sessions/:sessionId/process
DELETE /data-onboarding/sessions/:sessionId

# Inventory Import V1
GET    /data-onboarding/sessions/:sessionId/files/:fileId/mapping
PUT    /data-onboarding/sessions/:sessionId/files/:fileId/mapping
POST   /data-onboarding/sessions/:sessionId/dry-run
POST   /data-onboarding/sessions/:sessionId/commit          { duplicatePolicy }
GET    /data-onboarding/sessions/:sessionId/error-report.csv
```

`rowStatus` (`VALID` | `WARNING` | `INVALID`) is filtered **server-side**; pagination and totals reflect the filter.

---

# Inventory Import V1 (Sprint 2)

Imports staged INVENTORY rows into the `watches` table after mapping, dry-run validation, and explicit confirmation.

## Limits

| Limit | Default | Env var |
|-------|---------|---------|
| Max file size | 25 MB | `IMPORT_MAX_FILE_SIZE_MB` |
| Max rows per file | 5,000 | `IMPORT_MAX_ROWS` |
| Error report rows | 1,000 (then truncation notice) | `IMPORT_ERROR_REPORT_MAX_ROWS` |
| Stale import timeout | 15 min | `IMPORT_STALE_TIMEOUT_MINUTES` |
| Files per session | 1 (enforced at upload) | — |

- **CSV** is parsed fully in memory (bounded by file size + row cap), then rejected before staging if it exceeds the row cap.
- **XLSX** is loaded fully in memory by `exceljs` (no streaming); memory is bounded by the 25 MB file cap and the row cap. Hidden sheets are skipped.
- Dry-run record updates are written in bounded batches (200 per transaction); commit creates watches in chunks of 50, one transaction per row (watch + record marker are atomic).

## Duplicate semantics (V1, authoritative in backend)

Serial number is a strong unique business identifier. Serials are normalized by trimming before comparison (exact, case-sensitive).

| Case | Dry-run result | Commit behavior |
|------|----------------|-----------------|
| Serial duplicated **inside the file** (2nd+ occurrence) | `INVALID` / `SERIAL_DUPLICATE_IN_FILE` | Never eligible |
| First occurrence of an in-file duplicated serial | `WARNING` / `POSSIBLE_DUPLICATE` | `SKIP_DUPLICATES`: skipped · `IMPORT_AS_NEW`: imported |
| Serial already exists **in the tenant's inventory** | `WARNING` / `CONFIRMED_DUPLICATE` | **Always skipped, under both policies** |
| No conflict | `VALID` | Imported |

- `IMPORT_AS_NEW` can never create a second watch with the same non-empty serial. The UI copy states this explicitly.
- **Commit-time serial recheck:** immediately before creating watches, all candidate serials are re-queried against live inventory (tenant-scoped, `deletedAt: null`) and serials created earlier in the same run are tracked, so serials added between dry-run and commit are also skipped.
- **Remaining limitation:** there is **no DB unique constraint** on `(tenantId, serialNumber)`. Adding one requires auditing existing production data for duplicates first; deliberately deferred. A race between two commits in *different sessions* inside the recheck window could theoretically still duplicate a serial. The recheck is covered by tests.

## Dry-run versioning (exact match)

- `dryRunVersion = sha256(sessionId + fileIds + mappingVersions + rowCounts)[:16] + ':' + timestamp`.
- Commit recomputes the base from current file state and requires **exact equality** (no `startsWith`); empty/malformed versions are rejected.
- Remapping (`PUT …/mapping`) and reprocessing (`POST …/process`) both clear `dryRunVersion`, and either also changes the recomputed base.
- The commit claim is an atomic compare-and-set on `(status, dryRunVersion)`.

## Stale import recovery

- Commit sets `importStartedAt` when it claims the session (`READY_FOR_REVIEW`/`FAILED` → `IMPORTING`).
- If a session is found `IMPORTING` for longer than `IMPORT_STALE_TIMEOUT_MINUTES` (default 15), the next commit attempt atomically transitions it to `FAILED`, writes an `IMPORT_FAILED` audit event with `reason: STALE_IMPORT_TIMEOUT`, and proceeds with a fresh claim.
- `FAILED` is a retryable state. Retries only process records **without `targetRecordId`** — rows already imported are never recreated, so repeated commits after partial success are idempotent. `importedRows` is cumulative across retries.
- A session with any failed rows ends `FAILED` (retryable) with a clear `errorMessage`; it only reaches `COMPLETED` when no row fails.

## Monetary parsing (V1: US format only)

Accepted: `15000`, `1234.56`, `1,234,567`, `$1,234.56`, `MXN 1,234.56`, `USD 1,234`, and negative variants (negatives are then rejected by validation).

Rejected with structured error codes (never silently reinterpreted):

- `AMBIGUOUS_NUMBER_FORMAT` — European format (`1.234,56`, `1,23`) and EU-thousands lookalikes (`1.234`, `15.000`)
- `CONFLICTING_CURRENCY` — more than one currency code in a cell (`MXN 100 USD`) or non-MXN/USD symbols (`€`, `£`, `¥`)
- `INVALID_NUMBER_FORMAT` — non-numeric content

USD rows are converted to MXN with the FX rate fetched once per dry-run; the applied rate is persisted per watch (`costOriginalAmount`, `costExchangeRate`) and disclosed as a row warning.

## Error report

- `GET …/error-report.csv` requires the standard `Authorization: Bearer` header. The frontend downloads it via authenticated `fetch` → `Blob` → `URL.createObjectURL` (revoked after use). **Access tokens never appear in URLs.**
- Every user-controlled cell is CSV-quoted and formula-injection-neutralized (`=`, `+`, `-`, `@` prefixes get a leading `'`).
- Bounded to `IMPORT_ERROR_REPORT_MAX_ROWS`; a truncation notice row is appended when more invalid rows exist.

## Business-invariant note (bypass of `InventoryService.create`)

Commit writes `tx.watch.create` directly (bulk, transactional per row) instead of calling `InventoryService.create`, which is DTO-coupled, serializes responses, and runs interactive-creation side effects (publish/slug resolution, slug-conflict mapping) that are unsafe/unneeded for bulk import. The invariants it enforces are explicitly reproduced and tested:

- consignment fields are `null` unless `ownershipType = CONSIGNMENT`
- `costCurrency` defaults to MXN; USD costs store original amount + exchange rate, `cost` is canonical MXN
- `status` defaults to `AVAILABLE`
- imported watches are **never published** (`isPublished: false`, no public slug)

If a third writer of `Watch` ever appears, extract a shared watch-creation domain function.

## Future phases

1. **Phase 2 — PDF / AI extraction:** OpenAI or OCR for unstructured documents
2. **Phase 3 — Field mapping UI:** Map columns → WristOS entities
3. **Phase 4 — Confirmed import:** Transactional write to operational tables + import report
4. **Storage:** S3 / R2 provider behind `ImportFileStorage`
5. **Auth:** OWNER (or equivalent) guard once WristOS RBAC is productized

## Empty database

Works with zero watches, clients, deals, investors, and treasury rows. No seed data required.
