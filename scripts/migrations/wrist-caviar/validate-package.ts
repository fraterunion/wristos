import * as fs from 'fs';
import * as path from 'path';

import { PARSER_VERSION } from './config';
import { sha256Hex } from './hash';
import { readJson } from './args';

export function validatePackage(packageDir: string): {
  ok: boolean;
  errors: string[];
  packageFingerprint: string;
} {
  const errors: string[] = [];
  const required = [
    'manifest.json',
    'checksums.json',
    'candidates.json',
    'customers.json',
    'inventory.json',
    'sales.json',
    'receivables.json',
    'payables.json',
    'expenses.json',
    'deferred.json',
    'resolutions.json',
    'reconciliation.json',
  ];
  for (const f of required) {
    if (!fs.existsSync(path.join(packageDir, f))) errors.push(`missing ${f}`);
  }
  if (errors.length) {
    return { ok: false, errors, packageFingerprint: '' };
  }

  const manifest = readJson<{
    packageFingerprint: string;
    parserVersion: string;
    groupAccounting: Record<string, { source: number; CREATE: number; LINK: number; SKIP: number; CONFLICT: number; DEFERRED: number; EXCLUDED: number }>;
  }>(path.join(packageDir, 'manifest.json'));

  if (manifest.parserVersion !== PARSER_VERSION) {
    errors.push(`unsupported parserVersion ${manifest.parserVersion}`);
  }

  const checksums = readJson<Record<string, string>>(path.join(packageDir, 'checksums.json'));
  for (const [file, expected] of Object.entries(checksums)) {
    const full = path.join(packageDir, file);
    if (!fs.existsSync(full)) {
      errors.push(`checksum file missing: ${file}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const actual = sha256Hex(data);
    if (actual !== expected) errors.push(`checksum mismatch: ${file}`);
  }

  for (const [group, counts] of Object.entries(manifest.groupAccounting ?? {})) {
    const sum =
      counts.CREATE + counts.LINK + counts.SKIP + counts.CONFLICT + counts.DEFERRED + counts.EXCLUDED;
    if (sum !== counts.source) {
      errors.push(`group ${group} disposition accounting ${sum} != ${counts.source}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    packageFingerprint: manifest.packageFingerprint,
  };
}
