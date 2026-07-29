import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

import { normalizeCustomerName } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/normalization/customer-normalize';

import { MIGRATION_SOURCE, type Disposition } from './config';
import { prefix, safeLog, sha256Hex } from './hash';
import { writeJson, readJson } from './args';
import type { CanonicalCandidate } from './build-package';

export type PlanItem = CanonicalCandidate & {
  plannedAction: Disposition;
  destinationId?: string | null;
  conflictCode?: string | null;
};

export type DryRunPlan = {
  packageFingerprint: string;
  destinationStateFingerprint: string;
  items: PlanItem[];
  actionCounts: Record<string, number>;
  conflictCounts: Record<string, number>;
  projected: Record<string, number>;
  current: Record<string, number>;
  blockers: string[];
};

export async function planImport(params: {
  packageDir: string;
  tenantId: string;
  prisma?: PrismaClient;
}): Promise<DryRunPlan> {
  const prisma = params.prisma ?? new PrismaClient();
  const owned = !params.prisma;
  try {
    const manifest = readJson<{ packageFingerprint: string }>(
      path.join(params.packageDir, 'manifest.json'),
    );
    const candidates = readJson<CanonicalCandidate[]>(
      path.join(params.packageDir, 'candidates.json'),
    );

    const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } });
    if (!tenant) throw new Error(`Tenant not found: ${params.tenantId}`);

    const [clients, watches, deals, maps] = await Promise.all([
      prisma.client.findMany({
        where: { tenantId: params.tenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.watch.findMany({
        where: { tenantId: params.tenantId, deletedAt: null },
        select: { id: true, serialNumber: true, status: true },
      }),
      prisma.deal.findMany({
        where: { tenantId: params.tenantId, deletedAt: null },
        select: { id: true, importFingerprint: true },
      }),
      prisma.wristCaviarOneTimeImportMap.findMany({
        where: {
          tenantId: params.tenantId,
          migrationSource: MIGRATION_SOURCE,
          packageFingerprint: manifest.packageFingerprint,
        },
      }),
    ]);

    const clientsByNorm = new Map<string, typeof clients>();
    for (const c of clients) {
      const n = normalizeCustomerName(c.name);
      const list = clientsByNorm.get(n) ?? [];
      list.push(c);
      clientsByNorm.set(n, list);
    }
    const watchesBySerial = new Map<string, typeof watches>();
    for (const w of watches) {
      if (!w.serialNumber) continue;
      const k = w.serialNumber.trim().toUpperCase();
      const list = watchesBySerial.get(k) ?? [];
      list.push(w);
      watchesBySerial.set(k, list);
    }
    const dealsByFp = new Map(
      deals.filter((d) => d.importFingerprint).map((d) => [d.importFingerprint!, d.id]),
    );
    const mapByKey = new Map(
      maps.map((m) => [`${m.destinationEntityType}:${m.sourceCandidateId}`, m]),
    );

    const destinationStateFingerprint = sha256Hex({
      clients: clients.map((c) => c.id).sort(),
      watches: watches.map((w) => w.id).sort(),
      deals: deals.map((d) => d.id).sort(),
      maps: maps.map((m) => m.id).sort(),
    });

    const items: PlanItem[] = [];
    const conflictCounts: Record<string, number> = {};
    const blockers: string[] = [];

    for (const c of candidates) {
      const existingMap = mapByKey.get(`${c.entityType}:${c.sourceCandidateId}`);
      let plannedAction = c.disposition;
      let destinationId: string | null = null;
      let conflictCode: string | null = null;

      if (existingMap) {
        plannedAction = 'SKIP';
        destinationId = existingMap.destinationId;
        if (existingMap.sourceFingerprint !== c.candidateFingerprint) {
          plannedAction = 'CONFLICT';
          conflictCode = 'IMPORT_DRIFT';
          blockers.push(`${c.entityType}:${c.sourceCandidateId}:drift`);
        }
      } else if (c.disposition === 'CREATE' || c.disposition === 'LINK') {
        if (c.entityType === 'customer') {
          const norm = String(c.normalizedPayload.normalizedName ?? '');
          const matches = clientsByNorm.get(norm) ?? [];
          const explicit = c.resolutionIds.length
            ? (c.normalizedPayload as { destinationId?: string }).destinationId
            : undefined;
          if (typeof explicit === 'string') {
            plannedAction = 'LINK';
            destinationId = explicit;
          } else if (matches.length > 1) {
            plannedAction = 'CONFLICT';
            conflictCode = 'CUSTOMER_MATCH_AMBIGUOUS';
            blockers.push(`${c.sourceCandidateId}:customer_ambiguous`);
          } else if (matches.length === 1) {
            plannedAction = 'LINK';
            destinationId = matches[0].id;
          } else {
            plannedAction = 'CREATE';
          }
        } else if (c.entityType === 'inventory') {
          const serial = c.normalizedPayload.serial
            ? String(c.normalizedPayload.serial).trim().toUpperCase()
            : null;
          if (serial) {
            const matches = watchesBySerial.get(serial) ?? [];
            if (matches.length > 1) {
              plannedAction = 'CONFLICT';
              conflictCode = 'INVENTORY_SERIAL_CONFLICT';
              blockers.push(`${c.sourceCandidateId}:serial_dup`);
            } else if (matches.length === 1) {
              if (matches[0].status === 'SOLD') {
                plannedAction = 'CONFLICT';
                conflictCode = 'INVENTORY_SERIAL_CONFLICT';
                blockers.push(`${c.sourceCandidateId}:serial_sold`);
              } else {
                plannedAction = 'LINK';
                destinationId = matches[0].id;
              }
            }
          }
        } else if (c.entityType === 'sale') {
          const importFp = sha256Hex({
            kind: 'historical-sale',
            package: manifest.packageFingerprint,
            candidateId: c.sourceCandidateId,
            payload: c.normalizedPayload,
          });
          if (dealsByFp.has(importFp)) {
            plannedAction = 'SKIP';
            destinationId = dealsByFp.get(importFp)!;
          }
          (c.normalizedPayload as Record<string, unknown>).importFingerprint = importFp;
        }
      }

      if (plannedAction === 'CONFLICT' && conflictCode) {
        conflictCounts[conflictCode] = (conflictCounts[conflictCode] ?? 0) + 1;
      }
      if (c.disposition === 'CONFLICT' && plannedAction === 'CONFLICT') {
        blockers.push(`${c.entityType}:${c.sourceCandidateId}:${c.dispositionReason}`);
      }

      items.push({
        ...c,
        plannedAction,
        destinationId,
        conflictCode,
      });
    }

    const actionCounts: Record<string, number> = {
      CREATE: 0,
      LINK: 0,
      SKIP: 0,
      CONFLICT: 0,
      DEFERRED: 0,
      EXCLUDED: 0,
    };
    for (const i of items) actionCounts[i.plannedAction] += 1;

    const current = {
      clients: clients.length,
      watches: watches.length,
      deals: deals.length,
    };
    const projected = {
      clients: current.clients + items.filter((i) => i.entityType === 'customer' && i.plannedAction === 'CREATE').length,
      watches: current.watches + items.filter((i) => i.entityType === 'inventory' && i.plannedAction === 'CREATE').length,
      deals: current.deals + items.filter((i) => i.entityType === 'sale' && i.plannedAction === 'CREATE').length,
    };

    const plan: DryRunPlan = {
      packageFingerprint: manifest.packageFingerprint,
      destinationStateFingerprint,
      items,
      actionCounts,
      conflictCounts,
      projected,
      current,
      blockers: [...new Set(blockers)],
    };

    writeJson(path.join(params.packageDir, 'dry-run-report.json'), {
      ...plan,
      items: undefined,
      itemCount: items.length,
      label: 'Simulación; ningún dato operativo ha sido modificado.',
    });
    writeJson(path.join(params.packageDir, 'dry-run-items.json'), items);

    const md = [
      '# Wrist Caviar dry-run',
      '',
      `Package fingerprint prefix: \`${prefix(manifest.packageFingerprint)}\``,
      `Tenant: \`${params.tenantId}\` (${tenant.name})`,
      '',
      '## Actions',
      ...Object.entries(actionCounts).map(([k, v]) => `- ${k}: ${v}`),
      '',
      '## Current → projected counts',
      `- Clients: ${current.clients} → ${projected.clients}`,
      `- Watches: ${current.watches} → ${projected.watches}`,
      `- Deals: ${current.deals} → ${projected.deals}`,
      '',
      `## Blockers: ${plan.blockers.length}`,
      ...(plan.blockers.length === 0
        ? ['- none']
        : plan.blockers.slice(0, 100).map((b) => `- \`${b}\``)),
      '',
      '_No operational records were written._',
    ].join('\n');
    fs.writeFileSync(path.join(params.packageDir, 'dry-run-report.md'), `${md}\n`);

    safeLog('wrist_caviar_dry_run_complete', {
      tenantId: params.tenantId,
      packageFingerprintPrefix: prefix(manifest.packageFingerprint),
      actionCounts,
      blockerCount: plan.blockers.length,
    });

    return plan;
  } finally {
    if (owned) await prisma.$disconnect();
  }
}
