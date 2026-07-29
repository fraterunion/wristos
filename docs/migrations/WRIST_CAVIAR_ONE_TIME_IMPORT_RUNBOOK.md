# Wrist Caviar One-Time Import — Runbook

Internal CLI only. Never commit the workbook or `.local/migrations/` packages.

## Prerequisites

- Node ≥ 20
- `DATABASE_URL` pointing at the intended Postgres
- Workbook at a local path (gitignored)
- Prisma migration `20260729040000_wrist_caviar_one_time_import` applied

```bash
export DATABASE_URL='postgresql://…'
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

## 1. Analyze

```bash
npm run migrate:wrist-caviar:analyze -- \
  --tenant-id=<TENANT_ID> \
  --workbook="/absolute/path/RELOJES CESAR ADMIN.xlsx"
```

Writes safe summary + resolution template under  
`.local/migrations/wrist-caviar/<workbookFingerprintPrefix>/`

## 2. Resolutions

Edit:

`.local/migrations/wrist-caviar/resolutions.json`

Do not invent financial values. Fill only explicit human decisions.

## 3. Build package

```bash
npm run migrate:wrist-caviar:build -- \
  --tenant-id=<TENANT_ID> \
  --workbook="/absolute/path/RELOJES CESAR ADMIN.xlsx" \
  --resolutions=".local/migrations/wrist-caviar/resolutions.json"
```

## 4. Dry-run (no operational writes)

```bash
npm run migrate:wrist-caviar:dry-run -- \
  --tenant-id=<TENANT_ID> \
  --package=".local/migrations/wrist-caviar/<fingerprint>"
```

Review:

- `dry-run-report.md`
- CREATE/LINK/SKIP/CONFLICT/DEFERRED/EXCLUDED counts
- REPORTE reconciliation

## 5. Local execute

```bash
export WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT=true

npm run migrate:wrist-caviar:execute -- \
  --execute \
  --environment=local \
  --tenant-id=<TENANT_ID> \
  --package-fingerprint=<FULL_PACKAGE_SHA256> \
  --package=".local/migrations/wrist-caviar/<fingerprint>" \
  --database-host-confirmation=localhost \
  --confirmation="IMPORT WRIST CAVIAR <fingerprintPrefix12>" \
  --backup-verified \
  --backup-note="local-dev-no-prod-backup-required"
```

## 6. Reconcile

```bash
npm run migrate:wrist-caviar:reconcile -- \
  --tenant-id=<TENANT_ID> \
  --package=".local/migrations/wrist-caviar/<fingerprint>"
```

## 7. Second run (idempotency)

Re-run execute with the same package. Expect SKIP for previously imported candidates; zero new operational duplicates.

## Production preflight (do not run until approved)

1. Apply migration on Railway production DB  
2. Verify restorable backup (Railway Postgres backup ID + time)  
3. Dry-run against production with read planning  
4. Human review of unresolved CONFLICT counts (must be 0 blockers)  
5. Explicit written approval  

```bash
export WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT=true
export DATABASE_URL='postgresql://…production…'

npm run migrate:wrist-caviar:execute -- \
  --execute \
  --environment=production \
  --tenant-id=<WRIST_CAVIAR_TENANT_ID> \
  --package-fingerprint=<FULL_PACKAGE_SHA256> \
  --package=".local/migrations/wrist-caviar/<fingerprint>" \
  --database-host-confirmation=<EXPECTED_HOST_SUBSTRING> \
  --confirmation="IMPORT WRIST CAVIAR <fingerprintPrefix12>" \
  --backup-verified \
  --backup-note="<backup-id> @ <iso-time>"
```

## Safety

- Never log customer names, serials, prices, or balances  
- Never commit packages or the Excel file  
- Never call Stripe / email / storefront paths  
