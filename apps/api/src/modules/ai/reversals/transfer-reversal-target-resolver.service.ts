import { Injectable } from '@nestjs/common';
import { Prisma, TreasuryDirection } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  treasuryTransferInflowProvenanceKey,
  treasuryTransferOutflowProvenanceKey,
} from '../../treasury/treasury-transfer.service';
import {
  buildTransferFingerprintInput,
  transferReversalFingerprint,
  transferReversalSnapshot,
} from './transfer-reversal-fingerprint';
import { utcDayBucket } from './expense-reversal-fingerprint';
import { TrustedReversalTarget } from './financial-reversal.types';
import { classifyTransferPairEconomics } from '../../treasury/treasury-transfer-pair-economics';

export type TransferReversalSearchQuery = {
  amount?: Prisma.Decimal | number | string | null;
  sourceAccount?: 'CASH' | 'BANK' | 'CESAR' | null;
  destinationAccount?: 'CASH' | 'BANK' | 'CESAR' | null;
  transferDate?: Date | string | null;
  limit?: number;
};

export type TransferReversalResolveResult =
  | { kind: 'TRUSTED'; target: TrustedReversalTarget }
  | {
      kind: 'AMBIGUOUS';
      candidates: Array<{ ordinal: number; label: string; targetId: string }>;
    }
  | { kind: 'NONE' }
  | { kind: 'ALREADY_REVERSED'; targetId: string; safeLabel: string }
  | { kind: 'INVARIANT'; code: string };

/**
 * Read-only treasury-transfer reversal target resolver (26A).
 * Identifies the LOGICAL transfer (pair), never a lone leg.
 */
@Injectable()
export class TransferReversalTargetResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTrustedTransferId(
    tenantId: string,
    transferId: string,
  ): Promise<TransferReversalResolveResult> {
    const logicalKey = String(transferId ?? '').trim();
    if (!logicalKey) return { kind: 'NONE' };

    const outflow = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId,
        provenanceKey: treasuryTransferOutflowProvenanceKey(logicalKey),
      },
    });
    const inflow = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId,
        provenanceKey: treasuryTransferInflowProvenanceKey(logicalKey),
      },
    });

    if (!outflow && !inflow) return { kind: 'NONE' };
    if (!outflow || !inflow) {
      return { kind: 'INVARIANT', code: 'STALE_TREASURY_TRANSFER_INVARIANT' };
    }

    // Defense-in-depth: amount/account economics before READY_FOR_CONFIRMATION.
    if (!classifyTransferPairEconomics(outflow, inflow).ok) {
      return { kind: 'INVARIANT', code: 'STALE_TREASURY_TRANSFER_INVARIANT' };
    }

    const snapshot = transferReversalSnapshot({
      transferId: logicalKey,
      outflow,
      inflow,
    });
    const safeLabel = `${snapshot.sourceAccount} → ${snapshot.destinationAccount} ${snapshot.amount} MXN`;

    if (outflow.deletedAt && inflow.deletedAt) {
      return { kind: 'ALREADY_REVERSED', targetId: logicalKey, safeLabel };
    }
    if (Boolean(outflow.deletedAt) !== Boolean(inflow.deletedAt)) {
      return { kind: 'INVARIANT', code: 'STALE_TREASURY_TRANSFER_INVARIANT' };
    }

    const fpInput = buildTransferFingerprintInput({
      transferId: logicalKey,
      outflow,
      inflow,
    });
    return {
      kind: 'TRUSTED',
      target: {
        capability: 'REVERSE_TREASURY_TRANSFER',
        targetType: 'TREASURY_TRANSFER',
        targetId: logicalKey,
        tenantId,
        targetFingerprint: transferReversalFingerprint(fpInput),
        targetSnapshot: snapshot,
        observedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Search ACTIVE complete transfer pairs by outflow filters, then join inflows.
   * Never selects a single unpaired leg as a trusted target.
   */
  async resolveSearch(
    tenantId: string,
    query: TransferReversalSearchQuery,
  ): Promise<TransferReversalResolveResult> {
    const where: Prisma.TreasuryEntryWhereInput = {
      tenantId,
      deletedAt: null,
      direction: TreasuryDirection.OUTFLOW,
      provenanceKey: { startsWith: 'treasury-transfer:' },
    };
    if (query.sourceAccount) where.account = query.sourceAccount;
    if (query.amount != null && query.amount !== '') {
      where.amount = new Prisma.Decimal(query.amount);
    }
    const day = utcDayBucket(query.transferDate ?? null);
    if (day) {
      const start = new Date(`${day}T00:00:00.000Z`);
      const end = new Date(`${day}T23:59:59.999Z`);
      where.transactionDate = { gte: start, lte: end };
    }

    const limit = Math.min(Math.max(query.limit ?? 8, 1), 20);
    const outflows = await this.prisma.treasuryEntry.findMany({
      where,
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      take: 40,
    });

    const pairs: Array<{ transferId: string; label: string }> = [];
    for (const out of outflows) {
      const m = /^treasury-transfer:(.+):outflow$/.exec(out.provenanceKey ?? '');
      if (!m) continue;
      const transferId = m[1]!;
      const inflow = await this.prisma.treasuryEntry.findFirst({
        where: {
          tenantId,
          provenanceKey: treasuryTransferInflowProvenanceKey(transferId),
          deletedAt: null,
        },
      });
      if (!inflow) continue;
      if (query.destinationAccount && inflow.account !== query.destinationAccount) {
        continue;
      }
      // Skip economically malformed pairs — never offer as executable targets.
      if (!classifyTransferPairEconomics(out, inflow).ok) {
        continue;
      }
      const dayLabel = utcDayBucket(out.transactionDate) ?? '';
      pairs.push({
        transferId,
        label: `${out.amount.toFixed(0)} MXN · ${out.account} → ${inflow.account} · ${dayLabel}`,
      });
      if (pairs.length >= limit + 1) break;
    }

    if (pairs.length === 0) return { kind: 'NONE' };
    if (pairs.length === 1) {
      return this.resolveTrustedTransferId(tenantId, pairs[0]!.transferId);
    }

    return {
      kind: 'AMBIGUOUS',
      candidates: pairs.slice(0, limit).map((p, i) => ({
        ordinal: i + 1,
        label: p.label,
        targetId: p.transferId,
      })),
    };
  }
}
