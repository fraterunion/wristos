import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

import { MIGRATION_SOURCE } from './config';
import { prefix, safeLog } from './hash';
import { readJson, writeJson } from './args';

export async function reconcileImport(params: {
  packageDir: string;
  tenantId: string;
}): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const manifest = readJson<{
      packageFingerprint: string;
      sourceCounts: Record<string, number>;
      dispositionCounts: Record<string, number>;
    }>(path.join(params.packageDir, 'manifest.json'));

    const maps = await prisma.wristCaviarOneTimeImportMap.findMany({
      where: {
        tenantId: params.tenantId,
        migrationSource: MIGRATION_SOURCE,
        packageFingerprint: manifest.packageFingerprint,
      },
    });

    const [
      clients,
      watches,
      deals,
      receivables,
      payables,
      expenses,
      treasury,
      distributions,
    ] = await Promise.all([
      prisma.client.count({
        where: { tenantId: params.tenantId, deletedAt: null, tags: { has: 'wrist-caviar-migration' } },
      }),
      prisma.watch.count({ where: { tenantId: params.tenantId, deletedAt: null } }),
      prisma.deal.count({
        where: { tenantId: params.tenantId, deletedAt: null, sourceTag: MIGRATION_SOURCE },
      }),
      prisma.accountEntry.count({
        where: { tenantId: params.tenantId, type: 'RECEIVABLE', deletedAt: null },
      }),
      prisma.accountEntry.count({
        where: { tenantId: params.tenantId, type: 'PAYABLE', deletedAt: null },
      }),
      prisma.operatingExpense.count({ where: { tenantId: params.tenantId } }),
      prisma.treasuryEntry.count({
        where: {
          tenantId: params.tenantId,
          deletedAt: null,
          description: { startsWith: 'migration:' },
        },
      }),
      prisma.investorDistribution.count({
        where: {
          tenantId: params.tenantId,
          deletedAt: null,
          notes: { startsWith: 'migration:' },
        },
      }),
    ]);

    const uniqueCandidates = new Set(maps.map((m) => `${m.destinationEntityType}:${m.sourceCandidateId}`));
    const report = {
      packageFingerprintPrefix: prefix(manifest.packageFingerprint),
      mapRows: maps.length,
      uniqueMappedCandidates: uniqueCandidates.size,
      duplicateMapDetected: maps.length !== uniqueCandidates.size,
      counts: {
        migratedClientsTagged: clients,
        watches: watches,
        migratedDeals: deals,
        receivables,
        payables,
        expenses,
        migratedTreasury: treasury,
        migratedDistributions: distributions,
      },
      sourceCounts: manifest.sourceCounts,
      dispositionCounts: manifest.dispositionCounts,
      label: 'Post-import verification (safe counts only)',
    };

    writeJson(path.join(params.packageDir, 'post-import-report.json'), report);
    const md = [
      '# Wrist Caviar post-import report',
      '',
      `- Package fingerprint prefix: \`${report.packageFingerprintPrefix}\``,
      `- Map rows: ${report.mapRows}`,
      `- Unique mapped candidates: ${report.uniqueMappedCandidates}`,
      `- Duplicate map detected: ${report.duplicateMapDetected}`,
      '',
      '## Counts',
      ...Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`),
    ].join('\n');
    fs.writeFileSync(path.join(params.packageDir, 'post-import-report.md'), `${md}\n`);

    // Traceability (local only — may contain candidate ids, not business values)
    writeJson(
      path.join(params.packageDir, 'traceability.json'),
      maps.map((m) => ({
        sourceCandidateId: m.sourceCandidateId,
        entityType: m.destinationEntityType,
        destinationId: m.destinationId,
        sourceFingerprint: m.sourceFingerprint,
        importRunId: m.importRunId,
        importedAt: m.importedAt,
      })),
    );

    safeLog('wrist_caviar_reconcile_complete', {
      tenantId: params.tenantId,
      packageFingerprintPrefix: report.packageFingerprintPrefix,
      mapRows: report.mapRows,
      duplicateMapDetected: report.duplicateMapDetected,
    });
  } finally {
    await prisma.$disconnect();
  }
}
