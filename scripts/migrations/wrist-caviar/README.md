# Wrist Caviar one-time CLI migration

Internal tool. Not a product feature.

See:

- `docs/migrations/WRIST_CAVIAR_ONE_TIME_IMPORT_PLAN.md`
- `docs/migrations/WRIST_CAVIAR_ONE_TIME_IMPORT_RUNBOOK.md`

```bash
npm run migrate:wrist-caviar:analyze -- --tenant-id=… --workbook=…
npm run migrate:wrist-caviar:build -- --tenant-id=… --workbook=… --resolutions=…
npm run migrate:wrist-caviar:dry-run -- --tenant-id=… --package=…
npm run migrate:wrist-caviar:execute -- --execute … # many confirmations required
npm run migrate:wrist-caviar:reconcile -- --tenant-id=… --package=…
```

Never commit `.local/migrations/` or the Excel workbook.
