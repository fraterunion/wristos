#!/usr/bin/env tsx
/**
 * Wrist Caviar one-time migration CLI.
 * Usage: tsx scripts/migrations/wrist-caviar/cli.ts <command> [flags]
 */
import * as fs from 'fs';
import * as path from 'path';

import { parseArgs, requireArg, writeJson } from './args';
import { analyzeWorkbookFile, assertAcceptanceCounts, buildPackage } from './build-package';
import { LOCAL_ROOT } from './config';
import { executeImport } from './execute-import';
import { prefix, safeLog } from './hash';
import { planImport } from './plan-import';
import { reconcileImport } from './reconcile-import';
import { emptyResolutionsTemplate } from './resolutions.schema';
import { validatePackage } from './validate-package';

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === 'help') {
    // eslint-disable-next-line no-console
    console.log(
      `Commands: analyze | build | validate | dry-run | apply-resolutions | execute | reconcile`,
    );
    process.exit(0);
  }

  if (command === 'analyze') {
    const workbook = requireArg(args, 'workbook');
    const tenantId = requireArg(args, 'tenant-id');
    const analysis = await analyzeWorkbookFile(workbook);
    const warnings = assertAcceptanceCounts(analysis.counts);
    const dir = path.resolve(LOCAL_ROOT, prefix(analysis.fingerprint));
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'analyze-summary.json'), {
      tenantId,
      readiness: analysis.readiness,
      parserVersion: analysis.parserVersion,
      fingerprintPrefix: analysis.fingerprintPrefix,
      counts: analysis.counts,
      issueSummary: analysis.issueSummary,
      acceptanceWarnings: warnings,
      sheets: analysis.sheets.map((s) => ({
        sheet: s.sheetName,
        status: s.status,
        detectedRecords: s.detectedRecords,
      })),
      reconciliationStatuses: analysis.reconciliation.map((r) => ({
        concept: r.concept,
        status: r.status,
      })),
    });
    const resPath = path.resolve(LOCAL_ROOT, 'resolutions.json');
    if (!fs.existsSync(resPath)) {
      writeJson(resPath, emptyResolutionsTemplate(analysis.fingerprint));
    }
    safeLog('wrist_caviar_analyze', {
      tenantId,
      fingerprintPrefix: analysis.fingerprintPrefix,
      counts: analysis.counts,
      readiness: analysis.readiness,
      acceptanceWarnings: warnings.length,
    });
    if (warnings.length) {
      // eslint-disable-next-line no-console
      console.error('ACCEPTANCE COUNT WARNINGS:', warnings);
      process.exitCode = 2;
    }
    return;
  }

  if (command === 'build') {
    const workbook = requireArg(args, 'workbook');
    requireArg(args, 'tenant-id');
    const resolutions =
      typeof args.resolutions === 'string' ? args.resolutions : path.resolve(LOCAL_ROOT, 'resolutions.json');
    const allow = args['allow-out-of-range-counts'] === true || args['allow-out-of-range-counts'] === 'true';
    const result = await buildPackage({
      workbookPath: workbook,
      resolutionsPath: resolutions,
      allowOutOfRangeCounts: allow,
    });
    const v = validatePackage(result.packageDir);
    if (!v.ok) throw new Error(`Package invalid: ${v.errors.join('; ')}`);
    safeLog('wrist_caviar_build_ok', {
      packageDir: result.packageDir,
      packageFingerprintPrefix: prefix(result.packageFingerprint),
    });
    return;
  }

  if (command === 'validate') {
    const pkg = requireArg(args, 'package');
    const v = validatePackage(pkg);
    safeLog('wrist_caviar_validate', { ok: v.ok, errors: v.errors.length });
    if (!v.ok) {
      // eslint-disable-next-line no-console
      console.error(v.errors);
      process.exit(1);
    }
    return;
  }

  if (command === 'dry-run') {
    const pkg = requireArg(args, 'package');
    const tenantId = requireArg(args, 'tenant-id');
    const v = validatePackage(pkg);
    if (!v.ok) throw new Error(`Package invalid: ${v.errors.join('; ')}`);
    const before = await countOps(tenantId);
    await planImport({ packageDir: pkg, tenantId });
    const after = await countOps(tenantId);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Dry-run mutated operational counts — abort');
    }
    return;
  }

  if (command === 'apply-resolutions') {
    const pkg = requireArg(args, 'package');
    const resolutions = requireArg(args, 'resolutions');
    const workbook = requireArg(args, 'workbook');
    const tenantId = requireArg(args, 'tenant-id');
    const { applyFinalResolutions } = await import('./apply-resolutions');
    await applyFinalResolutions({
      packageDir: pkg,
      resolutionsPath: resolutions,
      workbookPath: workbook,
      tenantId,
      dryRunTenant: true,
    });
    return;
  }

  if (command === 'execute') {
    const pkg = requireArg(args, 'package');
    const tenantId = requireArg(args, 'tenant-id');
    await executeImport({ args, packageDir: pkg, tenantId });
    return;
  }

  if (command === 'reconcile') {
    const pkg = requireArg(args, 'package');
    const tenantId = requireArg(args, 'tenant-id');
    await reconcileImport({ packageDir: pkg, tenantId });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function countOps(tenantId: string) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const [clients, watches, deals, entries, payments, expenses, treasury] = await Promise.all([
      prisma.client.count({ where: { tenantId } }),
      prisma.watch.count({ where: { tenantId } }),
      prisma.deal.count({ where: { tenantId } }),
      prisma.accountEntry.count({ where: { tenantId } }),
      prisma.accountPayment.count({ where: { tenantId } }),
      prisma.operatingExpense.count({ where: { tenantId } }),
      prisma.treasuryEntry.count({ where: { tenantId } }),
    ]);
    return { clients, watches, deals, entries, payments, expenses, treasury };
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  safeLog('wrist_caviar_cli_error', {
    message: err instanceof Error ? err.message.slice(0, 300) : 'error',
  });
  process.exit(1);
});
