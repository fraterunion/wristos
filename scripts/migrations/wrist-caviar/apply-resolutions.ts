import * as fs from 'fs';
import * as path from 'path';

import { buildPackage } from './build-package';
import { LOCAL_ROOT, MIGRATION_SOURCE, type ResolutionType } from './config';
import {
  CXC_CXP_RESOLUTION_TYPES,
  FINAL_DECISION_IDS,
  REPORT_RESOLUTION_TYPES,
  SALE_RESOLUTION_TYPES,
  type FinalDecisionTemplate,
} from './generate-human-review';
import { prefix, safeLog } from './hash';
import { planImport } from './plan-import';
import type { ResolutionRecord, ResolutionsFile } from './resolutions.schema';
import { emptyResolutionsTemplate } from './resolutions.schema';
import { validatePackage } from './validate-package';
import { writeJson } from './args';

const REQUIRES_APPROVED_VALUE = new Set([
  'CORRECT_PRINCIPAL',
  'CORRECT_PAYMENT',
  'CORRECT_OUTSTANDING',
  'CORRECT_COST',
  'CORRECT_SALE_PRICE',
  'CORRECT_EXTRAS',
  'CORRECT_UNDERLYING_RECORDS',
]);

function mapToInternalType(decisionType: string): ResolutionType {
  switch (decisionType) {
    case 'ACCEPT_SOURCE_OUTSTANDING':
    case 'ACCEPT_SOURCE_PROFIT':
      return 'ACCEPT_SOURCE';
    case 'ACCEPT_CALCULATED_OUTSTANDING':
    case 'ACCEPT_CALCULATED_PROFIT':
      return 'ACCEPT_CALCULATED';
    case 'CORRECT_PRINCIPAL':
    case 'CORRECT_PAYMENT':
    case 'CORRECT_OUTSTANDING':
    case 'CORRECT_COST':
    case 'CORRECT_SALE_PRICE':
    case 'CORRECT_EXTRAS':
    case 'CORRECT_UNDERLYING_RECORDS':
      return 'CORRECT_VALUE';
    case 'EXCLUDE_INVALID_CARD':
    case 'EXCLUDE_INVALID_SALE':
      return 'EXCLUDE_INVALID_SOURCE_BLOCK';
    case 'ACKNOWLEDGE_SCOPE_DIFFERENCE':
      return 'ACKNOWLEDGE_SCOPE_DIFFERENCE';
    case 'KEEP_BLOCKED':
      return 'DEFER';
    default:
      throw new Error(`Unknown resolution type: ${decisionType}`);
  }
}

function resolvedValueFor(
  decisionType: string,
  approvedValue: unknown,
  area: string,
): Record<string, unknown> {
  if (decisionType === 'ACKNOWLEDGE_SCOPE_DIFFERENCE') {
    return typeof approvedValue === 'object' && approvedValue
      ? (approvedValue as Record<string, unknown>)
      : { acknowledged: true };
  }
  if (decisionType === 'KEEP_BLOCKED') {
    return { keepBlocked: true };
  }
  if (decisionType === 'CORRECT_PRINCIPAL') {
    return { principal: approvedValue };
  }
  if (decisionType === 'CORRECT_OUTSTANDING') {
    return area === 'CXP'
      ? { declaredRemaining: approvedValue }
      : { declaredOutstanding: approvedValue };
  }
  if (decisionType === 'CORRECT_PAYMENT') {
    return { payments: approvedValue };
  }
  if (decisionType === 'CORRECT_COST') return { cost: approvedValue };
  if (decisionType === 'CORRECT_SALE_PRICE') return { salePrice: approvedValue };
  if (decisionType === 'CORRECT_EXTRAS') return { extras: approvedValue };
  if (typeof approvedValue === 'object' && approvedValue) {
    return approvedValue as Record<string, unknown>;
  }
  return approvedValue != null ? { value: approvedValue } : {};
}

export type FinalResolutionsFile = {
  version: 1;
  migrationSource: string;
  workbookFingerprintPrefix?: string;
  notes?: string;
  decisions: FinalDecisionTemplate[];
};

export function validateFinalResolutions(raw: unknown): FinalResolutionsFile {
  if (!raw || typeof raw !== 'object') throw new Error('FINAL_RESOLUTIONS must be an object');
  const file = raw as FinalResolutionsFile;
  if (file.version !== 1) throw new Error('version must be 1');
  if (!Array.isArray(file.decisions)) throw new Error('decisions must be an array');
  if (file.decisions.length !== 15) {
    throw new Error(`Expected exactly 15 decisions, got ${file.decisions.length}`);
  }

  const seen = new Set<string>();
  const issueOwner = new Map<string, string>();

  for (const d of file.decisions) {
    if (!FINAL_DECISION_IDS.includes(d.decisionId as (typeof FINAL_DECISION_IDS)[number])) {
      throw new Error(`Unknown decisionId: ${d.decisionId}`);
    }
    if (seen.has(d.decisionId)) throw new Error(`Duplicate decisionId: ${d.decisionId}`);
    seen.add(d.decisionId);

    if (!d.resolutionType || !d.reason || !d.actor || !d.date) {
      throw new Error(`Decision ${d.decisionId}: resolutionType, reason, actor, date are required`);
    }
    if (d.actor === 'PENDING_HUMAN') {
      throw new Error(`Decision ${d.decisionId}: actor still PENDING_HUMAN`);
    }

    const allowed =
      d.area === 'SALE'
        ? SALE_RESOLUTION_TYPES
        : d.area === 'REPORTE'
          ? REPORT_RESOLUTION_TYPES
          : CXC_CXP_RESOLUTION_TYPES;
    if (!(allowed as readonly string[]).includes(d.resolutionType)) {
      throw new Error(
        `Decision ${d.decisionId}: invalid resolutionType ${d.resolutionType}; allowed: ${allowed.join(', ')}`,
      );
    }

    if (REQUIRES_APPROVED_VALUE.has(d.resolutionType) && (d.approvedValue == null || d.approvedValue === '')) {
      throw new Error(`Decision ${d.decisionId}: approvedValue required for ${d.resolutionType}`);
    }

    for (const issueId of d.issueIds ?? []) {
      const prior = issueOwner.get(issueId);
      if (prior && prior !== d.decisionId) {
        throw new Error(
          `Contradictory resolutions: issue ${issueId} claimed by ${prior} and ${d.decisionId}`,
        );
      }
      issueOwner.set(issueId, d.decisionId);
    }
  }

  for (const id of FINAL_DECISION_IDS) {
    if (!seen.has(id)) throw new Error(`Missing decisionId: ${id}`);
  }

  return file;
}

export function mergeFinalIntoResolutions(
  base: ResolutionsFile,
  finalFile: FinalResolutionsFile,
): ResolutionsFile {
  // Keep deferred crypto/oscar and prior scope acknowledgements; replace card decisions.
  const keep = base.resolutions.filter(
    (r) =>
      r.resolutionType === 'DEFER' ||
      r.resolutionType === 'ACKNOWLEDGE_SCOPE_DIFFERENCE' ||
      r.id.startsWith('res_defer_'),
  );
  const byId = new Map(keep.map((r) => [r.id, r]));

  for (const d of finalFile.decisions) {
    if (d.resolutionType === 'KEEP_BLOCKED') {
      // Explicit no-op resolution recorded for audit; does not clear CONFLICT
      const rec: ResolutionRecord = {
        id: `res_${d.decisionId.toLowerCase()}`,
        entityType: d.area.toLowerCase(),
        sourceCandidateId: d.issueIds[0] ?? null,
        issueCode: d.decisionId,
        resolutionType: 'DEFER',
        reason: d.reason,
        actor: d.actor,
        date: d.date,
        resolvedValue: { keepBlocked: true, decisionId: d.decisionId },
      };
      byId.set(rec.id, rec);
      continue;
    }

    const parents = (d.issueIds ?? []).filter((id) => !id.includes('pay_') && !id.startsWith('reporte:'));
    const primary = parents[0] ?? d.issueIds[0] ?? null;
    const internal = mapToInternalType(d.resolutionType);
    const rec: ResolutionRecord = {
      id: `res_${d.decisionId.toLowerCase()}`,
      entityType:
        d.area === 'CXC'
          ? 'receivable'
          : d.area === 'CXP'
            ? 'payable'
            : d.area === 'SALE'
              ? 'sale'
              : 'reconciliation',
      sourceCandidateId: primary?.startsWith('reporte:') ? null : primary,
      issueCode: d.decisionId,
      resolutionType: internal,
      reason: d.reason,
      actor: d.actor,
      date: d.date,
      resolvedValue: {
        decisionId: d.decisionId,
        decisionType: d.resolutionType,
        ...resolvedValueFor(d.resolutionType, d.approvedValue, d.area),
        issueIds: d.issueIds,
      },
      acknowledgedWarning: d.resolutionType === 'ACKNOWLEDGE_SCOPE_DIFFERENCE',
    };
    byId.set(rec.id, rec);
  }

  return {
    version: 1,
    migrationSource: MIGRATION_SOURCE,
    workbookFingerprint: base.workbookFingerprint,
    notes: `Merged from FINAL_RESOLUTIONS at ${new Date().toISOString()}`,
    resolutions: [...byId.values()],
  };
}

export async function applyFinalResolutions(params: {
  packageDir: string;
  resolutionsPath: string;
  workbookPath: string;
  tenantId: string;
  dryRunTenant?: boolean;
}): Promise<{
  packageDir: string;
  packageFingerprint: string;
  dispositionCounts: Record<string, number>;
  operationalWrites: 0;
}> {
  const finalRaw = JSON.parse(fs.readFileSync(params.resolutionsPath, 'utf8'));
  const finalFile = validateFinalResolutions(finalRaw);

  const existingPath = path.join(params.packageDir, 'resolutions.json');
  const base: ResolutionsFile = fs.existsSync(existingPath)
    ? JSON.parse(fs.readFileSync(existingPath, 'utf8'))
    : emptyResolutionsTemplate('unknown');

  const merged = mergeFinalIntoResolutions(base, finalFile);
  const mergedPath = path.join(params.packageDir, 'resolutions.applied.json');
  writeJson(mergedPath, merged);

  // Also write to shared local resolutions for rebuild provenance
  const shared = path.resolve(LOCAL_ROOT, 'resolutions.json');
  writeJson(shared, merged);

  const beforeOps = params.dryRunTenant
    ? await countOps(params.tenantId)
    : null;

  const result = await buildPackage({
    workbookPath: params.workbookPath,
    resolutionsPath: mergedPath,
    allowOutOfRangeCounts: true,
  });

  const v = validatePackage(result.packageDir);
  if (!v.ok) throw new Error(`Package invalid after apply: ${v.errors.join('; ')}`);

  await planImport({ packageDir: result.packageDir, tenantId: params.tenantId });

  if (beforeOps) {
    const afterOps = await countOps(params.tenantId);
    if (JSON.stringify(beforeOps) !== JSON.stringify(afterOps)) {
      throw new Error('apply-resolutions mutated operational counts — abort');
    }
  }

  safeLog('wrist_caviar_apply_resolutions', {
    packageFingerprintPrefix: prefix(result.packageFingerprint),
    dispositionCounts: result.dispositionCounts,
    decisions: finalFile.decisions.length,
    operationalWrites: 0,
  });

  return {
    packageDir: result.packageDir,
    packageFingerprint: result.packageFingerprint,
    dispositionCounts: result.dispositionCounts,
    operationalWrites: 0,
  };
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
