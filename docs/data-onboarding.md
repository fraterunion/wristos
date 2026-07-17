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

Migration exists at:

`prisma/migrations/20260717120000_data_onboarding_foundation/`

**Do not apply to production until ready.** Local/dev:

```bash
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

## API endpoints

```
POST   /data-onboarding/sessions
GET    /data-onboarding/sessions
GET    /data-onboarding/sessions/:sessionId
POST   /data-onboarding/sessions/:sessionId/files   (multipart field: file)
GET    /data-onboarding/sessions/:sessionId/files
GET    /data-onboarding/sessions/:sessionId/records?page=&limit=&fileId=&entityType=&valid=
POST   /data-onboarding/sessions/:sessionId/process
DELETE /data-onboarding/sessions/:sessionId
```

## Future phases

1. **Phase 2 — PDF / AI extraction:** OpenAI or OCR for unstructured documents
2. **Phase 3 — Field mapping UI:** Map columns → WristOS entities
3. **Phase 4 — Confirmed import:** Transactional write to operational tables + import report
4. **Storage:** S3 / R2 provider behind `ImportFileStorage`
5. **Auth:** OWNER (or equivalent) guard once WristOS RBAC is productized

## Empty database

Works with zero watches, clients, deals, investors, and treasury rows. No seed data required.
