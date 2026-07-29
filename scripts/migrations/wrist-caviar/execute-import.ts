import { createId } from '@paralleldrive/cuid2';
import { Prisma, PrismaClient } from '@prisma/client';
import * as path from 'path';

import { MIGRATION_SOURCE } from './config';
import { prefix, safeLog } from './hash';
import {
  databaseHost,
  readJson,
  redactDatabaseUrl,
  requireArg,
  type ArgMap,
} from './args';
import { planImport, type PlanItem } from './plan-import';

function dec(n: number | null | undefined): Prisma.Decimal | undefined {
  if (n == null || Number.isNaN(Number(n))) return undefined;
  return new Prisma.Decimal(Number(n));
}

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function assertExecuteSafety(args: ArgMap, packageFingerprint: string): void {
  if (process.env.WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT !== 'true') {
    throw new Error('Refused: set WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT=true');
  }
  if (args.execute !== true && args.execute !== 'true') {
    throw new Error('Refused: missing --execute');
  }
  const env = requireArg(args, 'environment');
  if (env === 'production' && args['backup-verified'] !== true && args['backup-verified'] !== 'true') {
    throw new Error('Refused: production requires --backup-verified');
  }
  if (env === 'production' && !args['backup-note']) {
    throw new Error('Refused: production requires --backup-note');
  }
  const expectedFp = requireArg(args, 'package-fingerprint');
  if (expectedFp !== packageFingerprint) {
    throw new Error('Refused: --package-fingerprint mismatch');
  }
  const dbUrl = process.env.DATABASE_URL ?? '';
  const hostConfirm = requireArg(args, 'database-host-confirmation');
  const host = databaseHost(dbUrl);
  if (!host.includes(hostConfirm)) {
    throw new Error(
      `Refused: database host "${host}" does not include confirmation "${hostConfirm}"`,
    );
  }
  const confirmation = requireArg(args, 'confirmation');
  const expected = `IMPORT WRIST CAVIAR ${prefix(packageFingerprint)}`;
  if (confirmation !== expected) {
    throw new Error(`Refused: confirmation must be exactly "${expected}"`);
  }
}

export async function executeImport(params: {
  args: ArgMap;
  packageDir: string;
  tenantId: string;
}): Promise<{ importRunId: string; resultCounts: Record<string, number> }> {
  const manifest = readJson<{ packageFingerprint: string; dispositionCounts: Record<string, number> }>(
    path.join(params.packageDir, 'manifest.json'),
  );
  assertExecuteSafety(params.args, manifest.packageFingerprint);

  const prisma = new PrismaClient();
  const env = String(params.args.environment);
  const dbUrl = process.env.DATABASE_URL ?? '';

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } });
    if (!tenant) throw new Error('Tenant not found');

    safeLog('wrist_caviar_execute_preflight', {
      environment: env,
      database: redactDatabaseUrl(dbUrl),
      tenantId: params.tenantId,
      tenantName: tenant.name,
      packageFingerprintPrefix: prefix(manifest.packageFingerprint),
      planned: manifest.dispositionCounts,
    });

    const plan = await planImport({
      packageDir: params.packageDir,
      tenantId: params.tenantId,
      prisma,
    });

    const blocking = plan.items.filter((i) => i.plannedAction === 'CONFLICT');
    if (blocking.length > 0) {
      throw new Error(`Refused: ${blocking.length} CONFLICT items remain — resolve resolutions.json`);
    }

    const importRunId = createId();
    await prisma.wristCaviarOneTimeImportRun.create({
      data: {
        id: importRunId,
        tenantId: params.tenantId,
        migrationSource: MIGRATION_SOURCE,
        workbookFingerprint: readJson<{ workbookFingerprint: string }>(
          path.join(params.packageDir, 'manifest.json'),
        ).workbookFingerprint,
        packageFingerprint: manifest.packageFingerprint,
        environment: env,
        mode: 'execute',
        status: 'RUNNING',
        plannedCounts: plan.actionCounts,
        backupVerified:
          params.args['backup-verified'] === true || params.args['backup-verified'] === 'true',
        backupNote: typeof params.args['backup-note'] === 'string' ? params.args['backup-note'] : null,
      },
    });

    const resultCounts: Record<string, number> = {
      customersCreated: 0,
      customersLinked: 0,
      watchesCreated: 0,
      watchesLinked: 0,
      dealsCreated: 0,
      receivablesCreated: 0,
      receivablePaymentsCreated: 0,
      payablesCreated: 0,
      payablePaymentsCreated: 0,
      expensesCreated: 0,
      cashCreated: 0,
      bankCreated: 0,
      partnerCreated: 0,
      profitCreated: 0,
      skipped: 0,
      deferred: 0,
      excluded: 0,
      maps: 0,
    };

    const idMap = new Map<string, string>(); // sourceCandidateId -> destinationId

    try {
      await prisma.$transaction(
        async (tx) => {
          const ordered = [...plan.items].sort((a, b) => {
            const order = [
              'customer',
              'inventory',
              'sale',
              'receivable',
              'receivable_payment',
              'payable',
              'payable_payment',
              'expense',
              'cash',
              'bank',
              'partner',
              'profit',
              'deferred',
              'cash_hidden',
            ];
            return order.indexOf(a.entityType) - order.indexOf(b.entityType);
          });

          for (const item of ordered) {
            if (item.plannedAction === 'SKIP') {
              resultCounts.skipped += 1;
              if (item.destinationId) idMap.set(item.sourceCandidateId, item.destinationId);
              continue;
            }
            if (item.plannedAction === 'DEFERRED') {
              resultCounts.deferred += 1;
              continue;
            }
            if (item.plannedAction === 'EXCLUDED') {
              resultCounts.excluded += 1;
              continue;
            }
            if (item.plannedAction === 'LINK' && item.destinationId) {
              idMap.set(item.sourceCandidateId, item.destinationId);
              await writeMap(tx, params, manifest.packageFingerprint, importRunId, item, item.destinationId);
              resultCounts.maps += 1;
              if (item.entityType === 'customer') resultCounts.customersLinked += 1;
              if (item.entityType === 'inventory') resultCounts.watchesLinked += 1;
              continue;
            }
            if (item.plannedAction !== 'CREATE') {
              throw new Error(`Unexpected action ${item.plannedAction} for ${item.sourceCandidateId}`);
            }

            const destId = await createOne(tx, params.tenantId, item, idMap);
            idMap.set(item.sourceCandidateId, destId);
            await writeMap(tx, params, manifest.packageFingerprint, importRunId, item, destId);
            resultCounts.maps += 1;
            bumpCreate(resultCounts, item.entityType);
          }
        },
        { timeout: 600_000, maxWait: 60_000 },
      );

      await prisma.wristCaviarOneTimeImportRun.update({
        where: { id: importRunId },
        data: {
          status: 'COMPLETED',
          resultCounts,
          completedAt: new Date(),
        },
      });

      safeLog('wrist_caviar_execute_complete', {
        tenantId: params.tenantId,
        importRunId,
        packageFingerprintPrefix: prefix(manifest.packageFingerprint),
        resultCounts,
      });

      return { importRunId, resultCounts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'execute_failed';
      await prisma.wristCaviarOneTimeImportRun.update({
        where: { id: importRunId },
        data: {
          status: 'FAILED',
          errorMessage: message.slice(0, 500),
          completedAt: new Date(),
          resultCounts,
        },
      });
      throw err;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function writeMap(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; packageDir: string },
  packageFingerprint: string,
  importRunId: string,
  item: PlanItem,
  destinationId: string,
) {
  const manifest = readJson<{ workbookFingerprint: string }>(
    path.join(params.packageDir, 'manifest.json'),
  );
  await tx.wristCaviarOneTimeImportMap.create({
    data: {
      tenantId: params.tenantId,
      migrationSource: MIGRATION_SOURCE,
      workbookFingerprint: manifest.workbookFingerprint,
      packageFingerprint,
      sourceCandidateId: item.sourceCandidateId,
      sourceFingerprint: item.candidateFingerprint,
      destinationEntityType: item.entityType,
      destinationId,
      importRunId,
    },
  });
}

function bumpCreate(counts: Record<string, number>, entityType: string) {
  const map: Record<string, string> = {
    customer: 'customersCreated',
    inventory: 'watchesCreated',
    sale: 'dealsCreated',
    receivable: 'receivablesCreated',
    receivable_payment: 'receivablePaymentsCreated',
    payable: 'payablesCreated',
    payable_payment: 'payablePaymentsCreated',
    expense: 'expensesCreated',
    cash: 'cashCreated',
    bank: 'bankCreated',
    partner: 'partnerCreated',
    profit: 'profitCreated',
  };
  const key = map[entityType];
  if (key) counts[key] += 1;
}

async function createOne(
  tx: Prisma.TransactionClient,
  tenantId: string,
  item: PlanItem,
  idMap: Map<string, string>,
): Promise<string> {
  const p = item.normalizedPayload;

  if (item.entityType === 'customer') {
    const row = await tx.client.create({
      data: {
        tenantId,
        name: String(p.displayName),
        tags: ['wrist-caviar-migration'],
        notes: `migration:${MIGRATION_SOURCE}:${item.sourceCandidateId}`,
      },
    });
    return row.id;
  }

  if (item.entityType === 'inventory') {
    const row = await tx.watch.create({
      data: {
        tenantId,
        brand: String(p.brand),
        model: String(p.model),
        reference: p.reference == null ? null : String(p.reference),
        serialNumber: p.serial == null ? null : String(p.serial),
        cost: dec(p.cost as number | null),
        status: 'AVAILABLE',
      },
    });
    return row.id;
  }

  if (item.entityType === 'sale') {
    const custNorm = String(p.customerNormalized);
    // find client by scanning idMap customers — match via payload dependency
    let clientId: string | undefined;
    for (const [src, dest] of idMap) {
      if (src.startsWith('cust') || src.includes('customer') || true) {
        // Prefer client resolved from normalized name among created/linked customers
        void src;
        void dest;
      }
    }
    // Resolve client: look up any customer candidate with same normalized name in package items is heavy;
    // instead find Client by exact normalized name among tenant after creates.
    const clients = await tx.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const { normalizeCustomerName } = await import(
      '../../../apps/api/src/modules/platform-migrations/wrist-caviar/normalization/customer-normalize'
    );
    const match = clients.find((c) => normalizeCustomerName(c.name) === custNorm);
    if (!match) {
      throw new Error(`Sale ${item.sourceCandidateId}: customer dependency unresolved`);
    }
    clientId = match.id;

    const snapshot = [
      `brand=${p.brand}`,
      `model=${p.model}`,
      `ref=${p.reference ?? ''}`,
      `serial=${p.serial ?? ''}`,
      `migration=${item.sourceCandidateId}`,
    ].join('; ');

    const row = await tx.deal.create({
      data: {
        tenantId,
        clientId,
        watchId: null,
        stage: 'CLOSED_WON',
        soldAt: parseDate(p.saleDate),
        agreedPrice: dec(p.salePrice as number) ?? new Prisma.Decimal(0),
        originalCurrency:
          p.originalCurrency != null ? String(p.originalCurrency) : undefined,
        originalAmount: dec(p.originalAmount as number | null),
        exchangeRate: dec(p.exchangeRate as number | null),
        historicalCost: dec(p.cost as number | null),
        extrasAmount: dec(p.extras as number | null),
        extrasCurrency: p.extrasNote ? 'MXN' : undefined,
        reportedProfit: dec(p.approvedProfit as number | null),
        calculatedProfit: dec(p.approvedProfit as number | null),
        importFingerprint: String(p.importFingerprint ?? item.candidateFingerprint),
        sourceTag: MIGRATION_SOURCE,
        notes: [
          snapshot,
          p.extrasNote ? `extrasNote=${p.extrasNote}` : '',
          p.businessOwnerOverride ? `override=${p.businessOwnerOverride}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      },
    });
    return row.id;
  }

  if (item.entityType === 'receivable') {
    const clients = await tx.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const { normalizeCustomerName } = await import(
      '../../../apps/api/src/modules/platform-migrations/wrist-caviar/normalization/customer-normalize'
    );
    const norm = String(p.customerNormalized);
    const match = clients.find((c) => normalizeCustomerName(c.name) === norm);
    const row = await tx.accountEntry.create({
      data: {
        tenantId,
        type: 'RECEIVABLE',
        status: 'OPEN',
        category: 'OTHER',
        source: 'MANUAL',
        counterpartyName: String(p.customerName),
        counterpartyType: 'CLIENT',
        concept: String(p.watchOrConcept ?? 'CXC'),
        totalAmount: dec(p.principal as number) ?? new Prisma.Decimal(0),
        currency: p.currency === 'USD' ? 'USD' : 'MXN',
        clientId: match?.id,
        notes: `migration:${item.sourceCandidateId}`,
      },
    });
    return row.id;
  }

  if (item.entityType === 'receivable_payment') {
    const parentId = idMap.get(String(p.parentId));
    if (!parentId) throw new Error(`Payment ${item.sourceCandidateId}: parent unresolved`);
    const row = await tx.accountPayment.create({
      data: {
        tenantId,
        entryId: parentId,
        amount: dec(p.amount as number) ?? new Prisma.Decimal(0),
        currency: 'MXN',
        method: 'OTHER',
        paidAt: parseDate(p.paymentDate) ?? new Date('1970-01-01'),
        notes: String(p.label ?? item.sourceCandidateId),
        cashAccount: null, // no treasury side-write; cash sheet is ledger of record
      },
    });
    return row.id;
  }

  if (item.entityType === 'payable') {
    const row = await tx.accountEntry.create({
      data: {
        tenantId,
        type: 'PAYABLE',
        status: 'OPEN',
        category: 'PURCHASE',
        source: 'MANUAL',
        counterpartyName: String(p.creditorName),
        counterpartyType: 'SUPPLIER',
        concept: String(p.watchOrConcept ?? 'CXP'),
        totalAmount: dec(p.principal as number) ?? new Prisma.Decimal(0),
        currency: p.currency === 'USD' ? 'USD' : 'MXN',
        notes: `migration:${item.sourceCandidateId}`,
      },
    });
    return row.id;
  }

  if (item.entityType === 'payable_payment') {
    const parentId = idMap.get(String(p.parentId));
    if (!parentId) throw new Error(`Payment ${item.sourceCandidateId}: parent unresolved`);
    const row = await tx.accountPayment.create({
      data: {
        tenantId,
        entryId: parentId,
        amount: dec(p.amount as number) ?? new Prisma.Decimal(0),
        currency: 'MXN',
        method: 'OTHER',
        paidAt: parseDate(p.paymentDate) ?? new Date('1970-01-01'),
        notes: String(p.label ?? item.sourceCandidateId),
        cashAccount: null,
      },
    });
    return row.id;
  }

  if (item.entityType === 'expense') {
    const row = await tx.operatingExpense.create({
      data: {
        tenantId,
        category: String(p.category) as never,
        amount: dec(p.amount as number) ?? new Prisma.Decimal(0),
        notes: String(p.concept),
        expenseDate: parseDate(p.expenseDate) ?? new Date('1970-01-01'),
      },
    });
    return row.id;
  }

  if (item.entityType === 'cash') {
    const entry = Number(p.entryAmount ?? 0);
    const exit = Number(p.exitAmount ?? 0);
    const amount = entry > 0 ? entry : exit;
    const direction = entry > 0 ? 'INFLOW' : 'OUTFLOW';
    const currency = p.currency === 'USD' ? 'USD' : 'MXN';
    const rate = p.exchangeRate != null ? Number(p.exchangeRate) : null;
    const amountMxn =
      currency === 'USD' && rate ? amount * rate : amount;
    const row = await tx.treasuryEntry.create({
      data: {
        tenantId,
        account: 'CASH',
        direction: direction as 'INFLOW' | 'OUTFLOW',
        amount: new Prisma.Decimal(amount),
        currency: currency as 'MXN' | 'USD',
        amountMxn: new Prisma.Decimal(amountMxn),
        exchangeRate: rate != null ? new Prisma.Decimal(rate) : null,
        transactionDate: parseDate(p.entryDate) ?? new Date('1970-01-01'),
        description: `migration:${item.sourceCandidateId}`,
      },
    });
    return row.id;
  }

  if (item.entityType === 'bank') {
    const deposit = Number(p.deposit ?? 0);
    const withdrawal = Number(p.withdrawal ?? 0);
    const commission = Number(p.commission ?? 0);
    // Represent net movement; commission preserved in description
    let amount = 0;
    let direction: 'INFLOW' | 'OUTFLOW' = 'INFLOW';
    if (deposit > 0) {
      amount = deposit;
      direction = 'INFLOW';
    } else if (withdrawal > 0 || commission > 0) {
      amount = withdrawal + commission;
      direction = 'OUTFLOW';
    }
    const row = await tx.treasuryEntry.create({
      data: {
        tenantId,
        account: 'BANK',
        direction,
        amount: new Prisma.Decimal(amount || 0),
        currency: 'MXN',
        amountMxn: new Prisma.Decimal(amount || 0),
        // Structured commission (source of truth). Description retains token for audit.
        commission: new Prisma.Decimal(commission),
        transactionDate: parseDate(p.entryDate) ?? new Date('1970-01-01'),
        description: `migration:${item.sourceCandidateId}; commission=${commission}; ref=${p.reference ?? ''}`,
      },
    });
    return row.id;
  }

  if (item.entityType === 'partner') {
    const entry = Number(p.entryAmount ?? 0);
    const exit = Number(p.exitAmount ?? 0);
    const amount = entry > 0 ? entry : exit;
    const direction = entry > 0 ? 'INFLOW' : 'OUTFLOW';
    const row = await tx.treasuryEntry.create({
      data: {
        tenantId,
        account: 'CESAR',
        direction: direction as 'INFLOW' | 'OUTFLOW',
        amount: new Prisma.Decimal(amount || 0),
        currency: 'MXN',
        amountMxn: new Prisma.Decimal(amount || 0),
        transactionDate: parseDate(p.entryDate) ?? new Date('1970-01-01'),
        description: `migration:${item.sourceCandidateId}; ${p.classification}`,
      },
    });
    return row.id;
  }

  if (item.entityType === 'profit') {
    const partner = String(p.partner);
    const ownership = partner === 'CESAR' ? 75 : 25;
    let investor = await tx.investor.findFirst({
      where: { tenantId, name: partner, deletedAt: null },
    });
    if (!investor) {
      investor = await tx.investor.create({
        data: {
          tenantId,
          name: partner,
          ownershipPercent: new Prisma.Decimal(ownership),
          notes: 'Created by wrist-caviar one-time import',
        },
      });
    }
    const collected = Number(p.collected ?? 0);
    if (collected <= 0) {
      // Accrual-only row: store as zero-amount distribution note via map destination = investor
      return investor.id;
    }
    const row = await tx.investorDistribution.create({
      data: {
        tenantId,
        investorId: investor.id,
        amount: new Prisma.Decimal(collected),
        account: 'CESAR_ACCOUNT',
        notes: `migration:${item.sourceCandidateId}; month=${p.monthLabel ?? ''}`,
        paidAt: new Date('1970-01-01'),
      },
    });
    return row.id;
  }

  throw new Error(`Unsupported entityType for CREATE: ${item.entityType}`);
}
