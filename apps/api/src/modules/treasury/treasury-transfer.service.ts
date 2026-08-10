import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
  TreasuryEntry,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export type TreasuryTransferAccount = 'CASH' | 'BANK' | 'CESAR';

export type RegisterTreasuryTransferInput = {
  sourceAccount: TreasuryTransferAccount;
  destinationAccount: TreasuryTransferAccount;
  amount: Prisma.Decimal | number | string;
  transferDate?: Date;
  notes?: string | null;
  /**
   * Durable logical transfer key.
   * Future AI: ai-action-run:<actionRunId>
   * Legs: treasury-transfer:<key>:outflow / :inflow
   */
  registerIdempotencyKey?: string | null;
  actorUserId?: string | null;
};

export type RegisterTreasuryTransferResult = {
  transferId: string;
  outflowEntry: TreasuryEntry;
  inflowEntry: TreasuryEntry;
  sourceAccount: TreasuryTransferAccount;
  destinationAccount: TreasuryTransferAccount;
  amount: Prisma.Decimal;
  currency: Currency;
  replayed: boolean;
};

export type ReverseTreasuryTransferCausality =
  | 'APPLIED'
  | 'SAME_COMMAND'
  | 'EXTERNAL';

export type ReverseTreasuryTransferResult = {
  transferId: string;
  reversed: boolean;
  alreadyReversed: boolean;
  /**
   * Commit 26A causality:
   * - APPLIED: this call soft-deleted both legs
   * - SAME_COMMAND: already reversed with the same reversalIdempotencyKey
   * - EXTERNAL: already reversed by a different/unknown actor
   */
  causality: ReverseTreasuryTransferCausality;
  outflowEntry: TreasuryEntry | null;
  inflowEntry: TreasuryEntry | null;
};

export type ReverseTreasuryTransferOptions = {
  /**
   * Durable reverse causality. Future AI: `ai-action-run:<actionRunId>`.
   * Never accept from provider/user — server-owned only.
   */
  reversalIdempotencyKey?: string | null;
};

const ALLOWED: ReadonlySet<TreasuryTransferAccount> = new Set([
  'CASH',
  'BANK',
  'CESAR',
]);

export function treasuryTransferOutflowProvenanceKey(logicalKey: string): string {
  return `treasury-transfer:${logicalKey}:outflow`;
}

export function treasuryTransferInflowProvenanceKey(logicalKey: string): string {
  return `treasury-transfer:${logicalKey}:inflow`;
}

export function parseTreasuryTransferLogicalKeyFromProvenance(
  provenanceKey: string | null | undefined,
): string | null {
  if (!provenanceKey) return null;
  const m = /^treasury-transfer:(.+):(outflow|inflow)$/.exec(provenanceKey);
  return m?.[1] ?? null;
}

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function accountLabel(account: TreasuryTransferAccount): string {
  if (account === 'CASH') return 'Efectivo';
  if (account === 'BANK') return 'Bancos';
  return 'Cuenta César';
}

function materialDateBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Canonical internal Treasury transfer — paired OUTFLOW + INFLOW, total liquidity Δ0.
 *
 * Not income, not OpEx, not Capital distribution.
 * Cuenta César (TreasuryAccount.CESAR) is an internal liquidity bucket.
 * Balance policy V1: insufficient funds are NOT rejected (matches existing Treasury outflows).
 * Schema: no new table — durable identity via provenanceKey pair.
 */
@Injectable()
export class TreasuryTransferService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    tenantId: string,
    input: RegisterTreasuryTransferInput,
  ): Promise<RegisterTreasuryTransferResult> {
    const source = input.sourceAccount;
    const destination = input.destinationAccount;
    if (!ALLOWED.has(source) || !ALLOWED.has(destination)) {
      throw new BadRequestException(
        'Unsupported treasury account. Allowed: CASH, BANK, CESAR',
      );
    }
    if (source === destination) {
      throw new BadRequestException(
        'Source and destination accounts must be different',
      );
    }

    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Transfer amount must be greater than 0');
    }

    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);
    const logicalKey = idempotencyKey ?? `tt_${randomUUID().replace(/-/g, '')}`;
    const explicitTransferDate = input.transferDate ?? null;
    const transferDate = explicitTransferDate ?? new Date();
    const notes =
      input.notes == null || String(input.notes).trim() === ''
        ? null
        : String(input.notes).trim().slice(0, 2000);

    const outflowKey = treasuryTransferOutflowProvenanceKey(logicalKey);
    const inflowKey = treasuryTransferInflowProvenanceKey(logicalKey);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existingOut = await tx.treasuryEntry.findFirst({
            where: { tenantId, provenanceKey: outflowKey },
          });
          const existingIn = await tx.treasuryEntry.findFirst({
            where: { tenantId, provenanceKey: inflowKey },
          });

          if (existingOut || existingIn) {
            return this.replayOrConflict({
              logicalKey,
              source,
              destination,
              amount,
              explicitTransferDate,
              existingOut,
              existingIn,
            });
          }

          const description =
            notes ??
            `Transferencia ${accountLabel(source)} → ${accountLabel(destination)}`;

          const outflow = await tx.treasuryEntry.create({
            data: {
              tenantId,
              account: source as TreasuryAccount,
              direction: TreasuryDirection.OUTFLOW,
              amount,
              currency: Currency.MXN,
              amountMxn: amount,
              exchangeRate: null,
              commission: null,
              transactionDate: transferDate,
              description,
              provenanceKey: outflowKey,
              deletedAt: null,
            },
          });

          const inflow = await tx.treasuryEntry.create({
            data: {
              tenantId,
              account: destination as TreasuryAccount,
              direction: TreasuryDirection.INFLOW,
              amount,
              currency: Currency.MXN,
              amountMxn: amount,
              exchangeRate: null,
              commission: null,
              transactionDate: transferDate,
              description,
              provenanceKey: inflowKey,
              deletedAt: null,
            },
          });

          return {
            transferId: logicalKey,
            outflowEntry: outflow,
            inflowEntry: inflow,
            sourceAccount: source,
            destinationAccount: destination,
            amount,
            currency: Currency.MXN,
            replayed: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingOut = await this.prisma.treasuryEntry.findFirst({
          where: { tenantId, provenanceKey: outflowKey },
        });
        const existingIn = await this.prisma.treasuryEntry.findFirst({
          where: { tenantId, provenanceKey: inflowKey },
        });
        return this.replayOrConflict({
          logicalKey,
          source,
          destination,
          amount,
          explicitTransferDate,
          existingOut,
          existingIn,
        });
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Treasury transfer could not be completed due to a concurrent update. Retry the same request.',
        );
      }
      throw error;
    }
  }

  async reverse(
    tenantId: string,
    transferId: string,
    options?: ReverseTreasuryTransferOptions,
  ): Promise<ReverseTreasuryTransferResult> {
    const logicalKey = String(transferId ?? '').trim();
    if (!logicalKey) {
      throw new BadRequestException('transferId is required');
    }
    const reversalKey = normalizeTransferReversalKey(options?.reversalIdempotencyKey);
    const outflowKey = treasuryTransferOutflowProvenanceKey(logicalKey);
    const inflowKey = treasuryTransferInflowProvenanceKey(logicalKey);

    return this.prisma.$transaction(
      async (tx) => {
        const outflow = await tx.treasuryEntry.findFirst({
          where: { tenantId, provenanceKey: outflowKey },
        });
        const inflow = await tx.treasuryEntry.findFirst({
          where: { tenantId, provenanceKey: inflowKey },
        });

        if (!outflow && !inflow) {
          throw new NotFoundException('Treasury transfer not found');
        }
        if (!outflow || !inflow) {
          throw new ConflictException(
            'STALE_TREASURY_TRANSFER_INVARIANT: unpaired transfer legs',
          );
        }

        if (outflow.deletedAt && inflow.deletedAt) {
          const outKey = outflow.reversalIdempotencyKey ?? null;
          const inKey = inflow.reversalIdempotencyKey ?? null;
          if (outKey !== inKey) {
            throw new ConflictException(
              'STALE_TREASURY_TRANSFER_INVARIANT: mismatched reversal causality keys on transfer legs',
            );
          }
          return {
            transferId: logicalKey,
            reversed: false,
            alreadyReversed: true,
            causality: classifyTransferAlreadyReversedCausality(outKey, reversalKey),
            outflowEntry: outflow,
            inflowEntry: inflow,
          };
        }
        if (Boolean(outflow.deletedAt) !== Boolean(inflow.deletedAt)) {
          throw new ConflictException(
            'STALE_TREASURY_TRANSFER_INVARIANT: partially reversed transfer',
          );
        }

        const now = new Date();
        const stamp = reversalKey ? { reversalIdempotencyKey: reversalKey } : {};
        // Claim both legs only while still active — loser classifies EXTERNAL/SAME_COMMAND.
        // Claim outflow first; if lost, do not touch inflow (avoid half-key stamp).
        const claimedOut = await tx.treasuryEntry.updateMany({
          where: { id: outflow.id, tenantId, deletedAt: null },
          data: { deletedAt: now, ...stamp },
        });
        if (claimedOut.count === 0) {
          const racedOut = await tx.treasuryEntry.findFirst({
            where: { tenantId, provenanceKey: outflowKey },
          });
          const racedIn = await tx.treasuryEntry.findFirst({
            where: { tenantId, provenanceKey: inflowKey },
          });
          return classifyRacedTransferPair({
            logicalKey,
            reversalKey,
            racedOut,
            racedIn,
          });
        }

        const claimedIn = await tx.treasuryEntry.updateMany({
          where: { id: inflow.id, tenantId, deletedAt: null },
          data: { deletedAt: now, ...stamp },
        });
        if (claimedIn.count === 0) {
          // Outflow claimed in this tx; inflow lost → fail closed (tx rolls back).
          throw new ConflictException(
            'STALE_TREASURY_TRANSFER_INVARIANT: concurrent reverse claim failed',
          );
        }

        const outflowEntry = await tx.treasuryEntry.findFirstOrThrow({
          where: { id: outflow.id },
        });
        const inflowEntry = await tx.treasuryEntry.findFirstOrThrow({
          where: { id: inflow.id },
        });

        return {
          transferId: logicalKey,
          reversed: true,
          alreadyReversed: false,
          causality: 'APPLIED' as const,
          outflowEntry,
          inflowEntry,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findByTransferId(tenantId: string, transferId: string) {
    const logicalKey = String(transferId ?? '').trim();
    if (!logicalKey) return null;
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
    if (!outflow && !inflow) return null;
    return { transferId: logicalKey, outflow, inflow };
  }

  /**
   * Commit 26B — read-only transfer causality classification for future AI recovery.
   * Does not mutate. Outcomes: ACTIVE | SAME_COMMAND | EXTERNAL | INVARIANT | MISSING.
   */
  async classifyReversal(
    tenantId: string,
    transferId: string,
    reversalIdempotencyKey?: string | null,
  ): Promise<
    | { kind: 'MISSING' }
    | { kind: 'ACTIVE'; transferId: string }
    | { kind: 'SAME_COMMAND'; transferId: string }
    | { kind: 'EXTERNAL'; transferId: string }
    | { kind: 'INVARIANT'; transferId: string; code: string }
  > {
    const logicalKey = String(transferId ?? '').trim();
    if (!logicalKey) return { kind: 'MISSING' };
    const key = normalizeTransferReversalKey(reversalIdempotencyKey);
    const found = await this.findByTransferId(tenantId, logicalKey);
    if (!found) return { kind: 'MISSING' };
    const { outflow, inflow } = found;
    if (!outflow || !inflow) {
      return {
        kind: 'INVARIANT',
        transferId: logicalKey,
        code: 'STALE_TREASURY_TRANSFER_INVARIANT',
      };
    }
    const outDeleted = outflow.deletedAt != null;
    const inDeleted = inflow.deletedAt != null;
    if (outDeleted !== inDeleted) {
      return {
        kind: 'INVARIANT',
        transferId: logicalKey,
        code: 'STALE_TREASURY_TRANSFER_INVARIANT',
      };
    }
    const outKey = outflow.reversalIdempotencyKey ?? null;
    const inKey = inflow.reversalIdempotencyKey ?? null;
    if (outDeleted && inDeleted && outKey !== inKey) {
      return {
        kind: 'INVARIANT',
        transferId: logicalKey,
        code: 'STALE_TREASURY_TRANSFER_INVARIANT',
      };
    }
    if (!outDeleted && !inDeleted) {
      return { kind: 'ACTIVE', transferId: logicalKey };
    }
    if (key && outKey === key && inKey === key) {
      return { kind: 'SAME_COMMAND', transferId: logicalKey };
    }
    return { kind: 'EXTERNAL', transferId: logicalKey };
  }

  /** Safe audit hash — no PII. */
  transferIdHash(transferId: string): string {
    return createHash('sha256').update(transferId).digest('hex').slice(0, 16);
  }

  private replayOrConflict(args: {
    logicalKey: string;
    source: TreasuryTransferAccount;
    destination: TreasuryTransferAccount;
    amount: Prisma.Decimal;
    /** When omitted on replay, material date is not part of the conflict surface. */
    explicitTransferDate: Date | null;
    existingOut: TreasuryEntry | null;
    existingIn: TreasuryEntry | null;
  }): RegisterTreasuryTransferResult {
    const {
      existingOut,
      existingIn,
      logicalKey,
      source,
      destination,
      amount,
      explicitTransferDate,
    } = args;

    if (!existingOut || !existingIn) {
      throw new ConflictException(
        'STALE_TREASURY_TRANSFER_INVARIANT: unpaired transfer legs for idempotency key',
      );
    }

    if (existingOut.deletedAt || existingIn.deletedAt) {
      throw new ConflictException(
        'STALE_TREASURY_TRANSFER_REVERSED: transfer exists but was reversed',
      );
    }

    const sameSource = existingOut.account === source;
    const sameDest = existingIn.account === destination;
    const sameAmount = existingOut.amount.equals(amount) && existingIn.amount.equals(amount);
    const sameDir =
      existingOut.direction === TreasuryDirection.OUTFLOW &&
      existingIn.direction === TreasuryDirection.INFLOW;
    const sameDate =
      explicitTransferDate == null ||
      (materialDateBucket(existingOut.transactionDate) ===
        materialDateBucket(explicitTransferDate) &&
        materialDateBucket(existingIn.transactionDate) ===
          materialDateBucket(explicitTransferDate));

    if (!sameSource || !sameDest || !sameAmount || !sameDir || !sameDate) {
      throw new ConflictException(
        'Idempotency key already used with a different treasury transfer payload',
      );
    }

    return {
      transferId: logicalKey,
      outflowEntry: existingOut,
      inflowEntry: existingIn,
      sourceAccount: source,
      destinationAccount: destination,
      amount,
      currency: Currency.MXN,
      replayed: true,
    };
  }
}

function normalizeTransferReversalKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function classifyTransferAlreadyReversedCausality(
  existingKey: string | null | undefined,
  requestedKey: string | null,
): ReverseTreasuryTransferCausality {
  if (requestedKey && existingKey && existingKey === requestedKey) {
    return 'SAME_COMMAND';
  }
  return 'EXTERNAL';
}

function classifyRacedTransferPair(args: {
  logicalKey: string;
  reversalKey: string | null;
  racedOut: TreasuryEntry | null;
  racedIn: TreasuryEntry | null;
}): ReverseTreasuryTransferResult {
  const { logicalKey, reversalKey, racedOut, racedIn } = args;
  if (!racedOut || !racedIn) {
    throw new ConflictException(
      'STALE_TREASURY_TRANSFER_INVARIANT: unpaired transfer legs',
    );
  }
  if (Boolean(racedOut.deletedAt) !== Boolean(racedIn.deletedAt)) {
    throw new ConflictException(
      'STALE_TREASURY_TRANSFER_INVARIANT: partially reversed transfer',
    );
  }
  if (!racedOut.deletedAt || !racedIn.deletedAt) {
    throw new ConflictException(
      'STALE_TREASURY_TRANSFER_INVARIANT: concurrent reverse claim failed',
    );
  }
  const outKey = racedOut.reversalIdempotencyKey ?? null;
  const inKey = racedIn.reversalIdempotencyKey ?? null;
  if (outKey !== inKey) {
    throw new ConflictException(
      'STALE_TREASURY_TRANSFER_INVARIANT: mismatched reversal causality keys on transfer legs',
    );
  }
  return {
    transferId: logicalKey,
    reversed: false,
    alreadyReversed: true,
    causality: classifyTransferAlreadyReversedCausality(outKey, reversalKey),
    outflowEntry: racedOut,
    inflowEntry: racedIn,
  };
}
