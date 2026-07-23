import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  DealStage,
  FinancialAuditEventType,
  PaymentStatus,
  Prisma,
  Receivable,
  ReceivablePayment,
  ReceivableStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { AddReceivablePaymentDto } from './dto/add-receivable-payment.dto';
import { ListReceivablesDto } from './dto/list-receivables.dto';
import {
  ageDays,
  agingBucket,
  AgingBucket,
  deriveReceivableStatus,
  mapReceivableMethodToDealPayment,
  remainingBalance,
  sumNormalizedPayments,
} from './receivable-balance';

const DEFAULT_DUE_DATE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

type ReceivableWithPayments = Receivable & {
  payments: ReceivablePayment[];
  customer?: { id: string; name: string; email: string | null } | null;
  deal?: {
    id: string;
    stage: DealStage;
    agreedPrice: Prisma.Decimal;
    soldAt: Date | null;
    sourceTag: string | null;
  } | null;
};

export type EnsureForDealOpts = {
  actorUserId?: string;
  sourceTag?: string;
  notes?: string;
  dueDateDays?: number;
};

@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fxService: FxService,
  ) {}

  /**
   * Create Receivable 1:1 for CLOSED_WON / PENDING_PAYMENT deals if missing.
   * Idempotent on unique (tenantId, dealId).
   */
  async ensureForDeal(
    tenantId: string,
    dealId: string,
    opts?: EnsureForDealOpts,
  ): Promise<Receivable | null> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
    });
    if (!deal) {
      return null;
    }

    if (
      deal.stage !== DealStage.CLOSED_WON &&
      deal.stage !== DealStage.PENDING_PAYMENT
    ) {
      return null;
    }

    const existing = await this.prisma.receivable.findFirst({
      where: { tenantId, dealId, deletedAt: null },
    });
    if (existing) {
      return existing;
    }

    const issueDate = deal.soldAt ?? deal.updatedAt ?? deal.createdAt;
    const dueDateDays = opts?.dueDateDays ?? DEFAULT_DUE_DATE_DAYS;
    const dueDate = new Date(issueDate.getTime() + dueDateDays * MS_PER_DAY);

    // agreedPrice is already canonical MXN
    const normalizedAmount = deal.agreedPrice;
    const fxRate = deal.exchangeRate;

    try {
      const receivable = await this.prisma.receivable.create({
        data: {
          tenantId,
          dealId: deal.id,
          customerId: deal.clientId,
          originalAmount: normalizedAmount,
          currency: Currency.MXN,
          fxRate,
          normalizedAmount,
          issueDate,
          dueDate,
          status: ReceivableStatus.PENDING,
          notes: opts?.notes ?? null,
          sourceTag: opts?.sourceTag ?? deal.sourceTag ?? null,
        },
      });

      await this.writeAudit({
        tenantId,
        eventType: FinancialAuditEventType.RECEIVABLE_CREATED,
        entityType: 'Receivable',
        entityId: receivable.id,
        dealId: deal.id,
        receivableId: receivable.id,
        actorUserId: opts?.actorUserId,
        message: `Receivable created for deal ${deal.id}`,
        metadata: {
          normalizedAmount: normalizedAmount.toString(),
          currency: receivable.currency,
          sourceTag: receivable.sourceTag,
        },
      });

      return receivable;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.receivable.findFirst({
          where: { tenantId, dealId, deletedAt: null },
        });
      }
      throw error;
    }
  }

  async refreshStatus(tenantId: string, receivableId: string): Promise<Receivable> {
    const receivable = await this.requireReceivable(tenantId, receivableId, true);
    const paidNormalized = sumNormalizedPayments(receivable.payments);
    const status = deriveReceivableStatus({
      normalizedAmount: receivable.normalizedAmount,
      paidNormalized,
      dueDate: receivable.dueDate,
      now: new Date(),
      writtenOff: receivable.status === ReceivableStatus.WRITTEN_OFF || !!receivable.writtenOffAt,
    });

    if (status === receivable.status) {
      return receivable;
    }

    return this.prisma.receivable.update({
      where: { id: receivable.id },
      data: { status },
    });
  }

  async list(tenantId: string, query: ListReceivablesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const now = new Date();

    const where: Prisma.ReceivableWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.currency) where.currency = query.currency;

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { notes: { contains: term, mode: 'insensitive' } },
        { sourceTag: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        { dealId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.receivable.findMany({
      where,
      include: {
        payments: { where: { deletedAt: null } },
        customer: { select: { id: true, name: true, email: true } },
        deal: {
          select: {
            id: true,
            stage: true,
            agreedPrice: true,
            soldAt: true,
            sourceTag: true,
          },
        },
      },
    });

    let items = rows.map((row) => this.serializeListItem(row, now));

    if (query.aging) {
      items = items.filter((item) => item.aging === query.aging);
    }

    items = this.sortListItems(items, query.sort);

    const total = items.length;
    const start = (page - 1) * limit;
    const data = items.slice(start, start + limit);

    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getById(tenantId: string, id: string) {
    const receivable = await this.prisma.receivable.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        payments: {
          where: { deletedAt: null },
          orderBy: { paymentDate: 'asc' },
        },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        deal: {
          select: {
            id: true,
            stage: true,
            agreedPrice: true,
            soldAt: true,
            sourceTag: true,
            notes: true,
          },
        },
      },
    });

    if (!receivable) {
      throw new NotFoundException('Receivable not found');
    }

    const now = new Date();
    const paidNormalized = sumNormalizedPayments(receivable.payments);
    const remaining = remainingBalance(receivable.normalizedAmount, paidNormalized);
    const age = ageDays(receivable.issueDate, now);

    // Refresh derived status on read when not written off
    const derived = deriveReceivableStatus({
      normalizedAmount: receivable.normalizedAmount,
      paidNormalized,
      dueDate: receivable.dueDate,
      now,
      writtenOff: !!receivable.writtenOffAt,
    });
    if (
      derived !== receivable.status &&
      receivable.status !== ReceivableStatus.WRITTEN_OFF
    ) {
      await this.prisma.receivable.update({
        where: { id: receivable.id },
        data: { status: derived },
      });
      receivable.status = derived;
    }

    return {
      ...this.serializeReceivableBase(receivable),
      collected: paidNormalized.toFixed(2),
      remaining: remaining.toFixed(2),
      ageDays: age,
      aging: agingBucket(age),
      customer: receivable.customer,
      deal: receivable.deal
        ? {
            id: receivable.deal.id,
            stage: receivable.deal.stage,
            agreedPrice: receivable.deal.agreedPrice.toString(),
            soldAt: receivable.deal.soldAt?.toISOString() ?? null,
            sourceTag: receivable.deal.sourceTag,
            notes: receivable.deal.notes,
          }
        : null,
      payments: receivable.payments.map((p) => this.serializePayment(p)),
    };
  }

  async dashboard(tenantId: string) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const upcomingEnd = new Date(now.getTime() + 14 * MS_PER_DAY);

    const receivables = await this.prisma.receivable.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        payments: { where: { deletedAt: null } },
        customer: { select: { id: true, name: true } },
      },
    });

    let totalAR = new Prisma.Decimal(0);
    let outstanding = new Prisma.Decimal(0);
    let overdue = new Prisma.Decimal(0);
    let current = new Prisma.Decimal(0);
    let collectedLifetime = new Prisma.Decimal(0);
    let openAgeSum = 0;
    let openCount = 0;

    const agingTotals: Record<AgingBucket, Prisma.Decimal> = {
      CURRENT: new Prisma.Decimal(0),
      D1_30: new Prisma.Decimal(0),
      D31_60: new Prisma.Decimal(0),
      D61_90: new Prisma.Decimal(0),
      D90_PLUS: new Prisma.Decimal(0),
    };

    const customerOutstanding = new Map<
      string,
      { customerId: string; customerName: string; outstanding: Prisma.Decimal }
    >();

    const upcomingDue: Array<{
      id: string;
      customerName: string;
      dueDate: string;
      remaining: string;
    }> = [];

    for (const row of receivables) {
      const writtenOff = !!row.writtenOffAt || row.status === ReceivableStatus.WRITTEN_OFF;
      const paid = sumNormalizedPayments(row.payments);
      const rem = remainingBalance(row.normalizedAmount, paid);
      const status = deriveReceivableStatus({
        normalizedAmount: row.normalizedAmount,
        paidNormalized: paid,
        dueDate: row.dueDate,
        now,
        writtenOff,
      });

      totalAR = totalAR.plus(row.normalizedAmount);
      collectedLifetime = collectedLifetime.plus(paid);

      if (!writtenOff && rem.greaterThan(0)) {
        outstanding = outstanding.plus(rem);
        const age = ageDays(row.issueDate, now);
        openAgeSum += age;
        openCount += 1;
        agingTotals[agingBucket(age)] = agingTotals[agingBucket(age)].plus(rem);

        if (status === ReceivableStatus.OVERDUE) {
          overdue = overdue.plus(rem);
        } else {
          current = current.plus(rem);
        }

        const existing = customerOutstanding.get(row.customerId);
        if (existing) {
          existing.outstanding = existing.outstanding.plus(rem);
        } else {
          customerOutstanding.set(row.customerId, {
            customerId: row.customerId,
            customerName: row.customer?.name ?? row.customerId,
            outstanding: rem,
          });
        }

        if (
          row.dueDate &&
          row.dueDate.getTime() >= now.getTime() &&
          row.dueDate.getTime() <= upcomingEnd.getTime()
        ) {
          upcomingDue.push({
            id: row.id,
            customerName: row.customer?.name ?? row.customerId,
            dueDate: row.dueDate.toISOString(),
            remaining: rem.toFixed(2),
          });
        }
      }
    }

    const monthPayments = await this.prisma.receivablePayment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        paymentDate: { gte: monthStart },
        normalizedAmount: { gt: 0 },
      },
      select: { normalizedAmount: true },
    });
    const collectedThisMonth = monthPayments.reduce(
      (sum, p) => sum.plus(p.normalizedAmount),
      new Prisma.Decimal(0),
    );

    const largestOutstandingCustomers = [...customerOutstanding.values()]
      .sort((a, b) => b.outstanding.comparedTo(a.outstanding))
      .slice(0, 5)
      .map((c) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        outstanding: c.outstanding.toFixed(2),
      }));

    upcomingDue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const collectionRate =
      totalAR.greaterThan(0)
        ? collectedLifetime.div(totalAR).mul(100).toDecimalPlaces(1).toString()
        : '0.0';

    return {
      totalAR: totalAR.toFixed(2),
      collectedThisMonth: collectedThisMonth.toFixed(2),
      outstanding: outstanding.toFixed(2),
      overdue: overdue.toFixed(2),
      current: current.toFixed(2),
      averageDaysOutstanding:
        openCount > 0 ? Math.round(openAgeSum / openCount) : 0,
      collectionRate,
      largestOutstandingCustomers,
      upcomingDue: upcomingDue.slice(0, 20),
      aging: {
        CURRENT: agingTotals.CURRENT.toFixed(2),
        D1_30: agingTotals.D1_30.toFixed(2),
        D31_60: agingTotals.D31_60.toFixed(2),
        D61_90: agingTotals.D61_90.toFixed(2),
        D90_PLUS: agingTotals.D90_PLUS.toFixed(2),
      },
    };
  }

  async customerLedger(tenantId: string, customerId: string) {
    const customer = await this.prisma.client.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const now = new Date();
    const receivables = await this.prisma.receivable.findMany({
      where: { tenantId, customerId, deletedAt: null },
      include: {
        payments: {
          where: { deletedAt: null },
          orderBy: { paymentDate: 'asc' },
        },
        deal: { select: { id: true, soldAt: true, sourceTag: true } },
      },
      orderBy: { issueDate: 'desc' },
    });

    let lifetimeCollected = new Prisma.Decimal(0);
    let outstanding = new Prisma.Decimal(0);
    let paymentLagSum = 0;
    let paymentLagCount = 0;

    const items = receivables.map((row) => {
      const paid = sumNormalizedPayments(row.payments);
      const rem = remainingBalance(row.normalizedAmount, paid);
      lifetimeCollected = lifetimeCollected.plus(paid);
      if (!row.writtenOffAt && rem.greaterThan(0)) {
        outstanding = outstanding.plus(rem);
      }

      for (const payment of row.payments) {
        if (payment.normalizedAmount.greaterThan(0)) {
          paymentLagSum += ageDays(row.issueDate, payment.paymentDate);
          paymentLagCount += 1;
        }
      }

      return {
        ...this.serializeReceivableBase(row),
        collected: paid.toFixed(2),
        remaining: rem.toFixed(2),
        ageDays: ageDays(row.issueDate, now),
        deal: row.deal
          ? {
              id: row.deal.id,
              soldAt: row.deal.soldAt?.toISOString() ?? null,
              sourceTag: row.deal.sourceTag,
            }
          : null,
        payments: row.payments.map((p) => this.serializePayment(p)),
      };
    });

    return {
      customer,
      outstanding: outstanding.toFixed(2),
      lifetimeCollected: lifetimeCollected.toFixed(2),
      averagePaymentDays:
        paymentLagCount > 0 ? Math.round(paymentLagSum / paymentLagCount) : null,
      receivables: items,
    };
  }

  async addPayment(
    tenantId: string,
    receivableId: string,
    dto: AddReceivablePaymentDto,
    actorUserId?: string,
  ) {
    const receivable = await this.requireReceivable(tenantId, receivableId, true);

    if (receivable.writtenOffAt || receivable.status === ReceivableStatus.WRITTEN_OFF) {
      throw new BadRequestException('Cannot add payment to a written-off receivable');
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const currency = dto.currency ?? Currency.MXN;
    let fxRate: Prisma.Decimal | null = null;
    let normalizedAmount: Prisma.Decimal;

    if (currency === Currency.USD) {
      const fx = await this.fxService.getUsdMxn();
      fxRate = new Prisma.Decimal(fx.rate.toString());
      normalizedAmount = new Prisma.Decimal(dto.amount.toString())
        .mul(fxRate)
        .toDecimalPlaces(2);
    } else {
      normalizedAmount = new Prisma.Decimal(dto.amount.toString()).toDecimalPlaces(2);
    }

    const paidSoFar = sumNormalizedPayments(receivable.payments);
    const remaining = remainingBalance(receivable.normalizedAmount, paidSoFar);
    const allowOverpayment = dto.allowOverpayment === true;

    if (!allowOverpayment && normalizedAmount.greaterThan(remaining)) {
      throw new BadRequestException(
        `Payment exceeds remaining balance of ${remaining.toFixed(2)} MXN`,
      );
    }

    const paymentDate = new Date(dto.paymentDate);

    const payment = await this.prisma.receivablePayment.create({
      data: {
        tenantId,
        receivableId: receivable.id,
        amount: new Prisma.Decimal(dto.amount.toString()).toDecimalPlaces(2),
        currency,
        fxRate,
        normalizedAmount,
        paymentDate,
        method: dto.method,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        createdByUserId: actorUserId ?? null,
      },
    });

    await this.writeAudit({
      tenantId,
      eventType: FinancialAuditEventType.PAYMENT_CREATED,
      entityType: 'ReceivablePayment',
      entityId: payment.id,
      dealId: receivable.dealId,
      receivableId: receivable.id,
      actorUserId,
      message: `Payment ${normalizedAmount.toFixed(2)} MXN recorded`,
      metadata: {
        amount: payment.amount.toString(),
        currency: payment.currency,
        normalizedAmount: payment.normalizedAmount.toString(),
        method: payment.method,
      },
    });

    // Optionally mirror to Deal Payment for ventas compatibility
    if (dto.syncDealPayment !== false && receivable.dealId) {
      try {
        await this.prisma.payment.create({
          data: {
            tenantId,
            dealId: receivable.dealId,
            amount: normalizedAmount,
            method: mapReceivableMethodToDealPayment(dto.method),
            status: PaymentStatus.PAID,
            paidAt: paymentDate,
            notes: dto.notes ?? null,
          },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Failed mirroring receivable payment to deal payment: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.refreshStatus(tenantId, receivable.id);

    return this.serializePayment(payment);
  }

  async softDeletePayment(
    tenantId: string,
    receivableId: string,
    paymentId: string,
    actorUserId?: string,
  ) {
    const payment = await this.prisma.receivablePayment.findFirst({
      where: { id: paymentId, tenantId, receivableId, deletedAt: null },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const reversal = await this.prisma.receivablePayment.findFirst({
      where: {
        tenantId,
        reversesPaymentId: payment.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (reversal) {
      throw new BadRequestException('Cannot delete a payment that has been reversed');
    }

    await this.prisma.receivablePayment.update({
      where: { id: payment.id },
      data: { deletedAt: new Date() },
    });

    await this.writeAudit({
      tenantId,
      eventType: FinancialAuditEventType.PAYMENT_DELETED,
      entityType: 'ReceivablePayment',
      entityId: payment.id,
      receivableId,
      actorUserId,
      message: `Payment ${payment.id} soft-deleted`,
      metadata: {
        normalizedAmount: payment.normalizedAmount.toString(),
      },
    });

    await this.refreshStatus(tenantId, receivableId);
  }

  async reversePayment(
    tenantId: string,
    receivableId: string,
    paymentId: string,
    actorUserId?: string,
  ) {
    const original = await this.prisma.receivablePayment.findFirst({
      where: { id: paymentId, tenantId, receivableId, deletedAt: null },
    });
    if (!original) {
      throw new NotFoundException('Payment not found');
    }
    if (original.reversesPaymentId) {
      throw new BadRequestException('Cannot reverse a reversing payment');
    }

    const existingReversal = await this.prisma.receivablePayment.findFirst({
      where: {
        tenantId,
        reversesPaymentId: original.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingReversal) {
      throw new BadRequestException('Payment has already been reversed');
    }

    const reversingAmount = original.amount.negated();
    const reversingNormalized = original.normalizedAmount.negated();

    const reversal = await this.prisma.receivablePayment.create({
      data: {
        tenantId,
        receivableId,
        amount: reversingAmount,
        currency: original.currency,
        fxRate: original.fxRate,
        normalizedAmount: reversingNormalized,
        paymentDate: new Date(),
        method: original.method,
        reference: original.reference,
        notes: `Reversal of payment ${original.id}`,
        createdByUserId: actorUserId ?? null,
        reversesPaymentId: original.id,
      },
    });

    await this.writeAudit({
      tenantId,
      eventType: FinancialAuditEventType.PAYMENT_REVERSED,
      entityType: 'ReceivablePayment',
      entityId: reversal.id,
      receivableId,
      actorUserId,
      message: `Payment ${original.id} reversed by ${reversal.id}`,
      metadata: {
        originalPaymentId: original.id,
        reversalPaymentId: reversal.id,
        normalizedAmount: reversingNormalized.toString(),
      },
    });

    await this.refreshStatus(tenantId, receivableId);
    return this.serializePayment(reversal);
  }

  async writeOff(
    tenantId: string,
    receivableId: string,
    reason: string,
    actorUserId?: string,
  ) {
    const receivable = await this.requireReceivable(tenantId, receivableId, false);

    if (receivable.writtenOffAt) {
      throw new BadRequestException('Receivable is already written off');
    }

    const updated = await this.prisma.receivable.update({
      where: { id: receivable.id },
      data: {
        status: ReceivableStatus.WRITTEN_OFF,
        writtenOffAt: new Date(),
        writtenOffReason: reason,
      },
    });

    await this.writeAudit({
      tenantId,
      eventType: FinancialAuditEventType.RECEIVABLE_WRITTEN_OFF,
      entityType: 'Receivable',
      entityId: receivable.id,
      dealId: receivable.dealId,
      receivableId: receivable.id,
      actorUserId,
      message: `Receivable written off: ${reason}`,
      metadata: { reason },
    });

    return this.serializeReceivableBase(updated);
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private async requireReceivable(
    tenantId: string,
    id: string,
    withPayments: boolean,
  ): Promise<ReceivableWithPayments> {
    const receivable = await this.prisma.receivable.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: withPayments
        ? { payments: { where: { deletedAt: null } } }
        : undefined,
    });
    if (!receivable) {
      throw new NotFoundException('Receivable not found');
    }
    return receivable as ReceivableWithPayments;
  }

  private async writeAudit(params: {
    tenantId: string;
    eventType: FinancialAuditEventType;
    entityType: string;
    entityId: string;
    dealId?: string | null;
    receivableId?: string | null;
    actorUserId?: string;
    message: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    await this.prisma.financialAuditEvent.create({
      data: {
        tenantId: params.tenantId,
        eventType: params.eventType,
        entityType: params.entityType,
        entityId: params.entityId,
        dealId: params.dealId ?? null,
        receivableId: params.receivableId ?? null,
        actorUserId: params.actorUserId ?? null,
        message: params.message,
        metadata: params.metadata ?? undefined,
      },
    });
  }

  private serializeReceivableBase(row: Receivable) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      dealId: row.dealId,
      customerId: row.customerId,
      originalAmount: row.originalAmount.toString(),
      currency: row.currency,
      fxRate: row.fxRate?.toString() ?? null,
      normalizedAmount: row.normalizedAmount.toString(),
      issueDate: row.issueDate.toISOString(),
      dueDate: row.dueDate?.toISOString() ?? null,
      status: row.status,
      notes: row.notes,
      sourceTag: row.sourceTag,
      writtenOffAt: row.writtenOffAt?.toISOString() ?? null,
      writtenOffReason: row.writtenOffReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializePayment(payment: ReceivablePayment) {
    return {
      id: payment.id,
      receivableId: payment.receivableId,
      amount: payment.amount.toString(),
      currency: payment.currency,
      fxRate: payment.fxRate?.toString() ?? null,
      normalizedAmount: payment.normalizedAmount.toString(),
      paymentDate: payment.paymentDate.toISOString(),
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      createdByUserId: payment.createdByUserId,
      reversesPaymentId: payment.reversesPaymentId,
      createdAt: payment.createdAt.toISOString(),
    };
  }

  private serializeListItem(row: ReceivableWithPayments, now: Date) {
    const paid = sumNormalizedPayments(row.payments);
    const rem = remainingBalance(row.normalizedAmount, paid);
    const age = ageDays(row.issueDate, now);
    const status = deriveReceivableStatus({
      normalizedAmount: row.normalizedAmount,
      paidNormalized: paid,
      dueDate: row.dueDate,
      now,
      writtenOff: !!row.writtenOffAt,
    });

    return {
      ...this.serializeReceivableBase({ ...row, status }),
      collected: paid.toFixed(2),
      remaining: rem.toFixed(2),
      ageDays: age,
      aging: agingBucket(age),
      customer: row.customer
        ? { id: row.customer.id, name: row.customer.name, email: row.customer.email }
        : null,
      deal: row.deal
        ? {
            id: row.deal.id,
            stage: row.deal.stage,
            soldAt: row.deal.soldAt?.toISOString() ?? null,
            sourceTag: row.deal.sourceTag,
          }
        : null,
    };
  }

  private sortListItems<
    T extends {
      issueDate: string;
      dueDate: string | null;
      normalizedAmount: string;
      remaining: string;
    },
  >(items: T[], sort?: ListReceivablesDto['sort']): T[] {
    const copy = [...items];
    switch (sort) {
      case 'issueDate_asc':
        return copy.sort((a, b) => a.issueDate.localeCompare(b.issueDate));
      case 'dueDate_asc':
        return copy.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
      case 'dueDate_desc':
        return copy.sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''));
      case 'amount_asc':
        return copy.sort(
          (a, b) => Number(a.normalizedAmount) - Number(b.normalizedAmount),
        );
      case 'amount_desc':
        return copy.sort(
          (a, b) => Number(b.normalizedAmount) - Number(a.normalizedAmount),
        );
      case 'remaining_asc':
        return copy.sort((a, b) => Number(a.remaining) - Number(b.remaining));
      case 'remaining_desc':
        return copy.sort((a, b) => Number(b.remaining) - Number(a.remaining));
      case 'issueDate_desc':
      default:
        return copy.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    }
  }
}
