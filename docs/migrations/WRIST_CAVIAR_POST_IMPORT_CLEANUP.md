# Wrist Caviar — Post-Import Cleanup Recommendation

**Do not execute destructive cleanup until production import is verified.**

## Keep

- Deterministic parsers under `apps/api/.../wrist-caviar/parsers`
- `analyze-workbook.ts`, types, reconciliation, issue taxonomy
- One-time CLI under `scripts/migrations/wrist-caviar`
- `WristCaviarOneTimeImportMap` / `ImportRun` tables (audit trail)

## Candidate for later archival (after successful production import + soak period)

- Platform Admin upload UI (`apps/admin/.../platform/migrations/wrist-caviar`)
- HTTP analyze/review endpoints (if unused)
- Staging models: analyses, issues, resolutions, entity approvals, reviewed datasets  
  (export any needed audit first)
- Closed PR #8 dry-run API/UI (never merged)

## Do not delete

- Historical Deal `importFingerprint` / historical cost fields  
- Imported operational data  
- Import map rows  

## Suggested cleanup PR (future)

1. Feature-flag or remove nav entry to migration wizard  
2. Mark platform migration controllers `@deprecated`  
3. Archive docs; keep runbook as historical record  
4. Optional: soft-delete old staging analyses for the tenant after export  
