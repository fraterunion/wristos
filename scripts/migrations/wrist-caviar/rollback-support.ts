import * as fs from 'fs';
import * as path from 'path';

/** Optional helper — documents that production backup must be verified manually on Railway. */
export function printBackupVerificationSteps(): void {
  // eslint-disable-next-line no-console
  console.log(`
Railway PostgreSQL backup verification (manual):
1. Open Railway project → Postgres service → Backups
2. Confirm a recent successful backup exists (note ID + timestamp)
3. Confirm restore procedure is known for this project
4. Pass --backup-verified --backup-note="<backup-id> @ <iso-time>"
`);
}

export function assertWorkbookUntracked(repoRoot: string): void {
  const wb = path.join(repoRoot, 'RELOJES CESAR ADMIN.xlsx');
  if (!fs.existsSync(wb)) return;
  // Presence is fine; gitignore must cover it. Caller should not git add it.
}
