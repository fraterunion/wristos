import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountEntry,
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  AccountPayment,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountEntryDto } from './dto/create-account-entry.dto';
import { CreateAccountPaymentDto } from './dto/create-account-payment.dto';
import { ListAccountEntriesQueryDto } from './dto/list-account-entries-query.dto';
import { UpdateAccountEntryDto } from './dto/update-account-entry.dto';
import { UpdateAccountPaymentDto } from './dto/update-account-payment.dto';

type EntryWithPayments = AccountEntry & { payments: AccountPayment[] };

@Injectable()
export class CuentasService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Summary ─────────────────────────────────────────────────────────────────

  async getSummary(tenantId: string) {
    const entries = await this.prisma.accountEntry.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        payments: { where: { deletedAt: null } },
      },
    });

    const computed = await this.computeEntries(entries, tenantId, false);

    let totalReceivable = new Prisma.Decimal(0);
    let totalPayable = new Prisma.Decimal(0);
    let overdueReceivableCount = 0;
    let overduePayableCount = 0;
    let overdueReceivableAmount = new Prisma.Decimal(0);
    let overduePayableAmount = new Prisma.Decimal(0);

    for (const row of computed) {
      const balance = new Prisma.Decimal(row.balance);
      if (row.type === AccountEntryType.RECEIVABLE) {
        totalReceivable = totalReceivable.plus(balance);
        if (row.status === AccountEntryStatus.OVERDUE) {
          overdueReceivableCount += 1;
          overdueReceivableAmount = overdueReceivableAmount.plus(balance);
        }
      } else {
        totalPayable = totalPayable.plus(balance);
        if (row.status === AccountEntryStatus.OVERDUE) {
          overduePayableCount += 1;
          overduePayableAmount = overduePayableAmount.plus(balance);
        }
      }
    }

    return {
      totalReceivable: totalReceivable.toFixed(2),
      totalPayable: totalPayable.toFixed(2),
      overdueReceivableCount,
      overduePayableCount,
      overdueReceivableAmount: overdueReceivableAmount.toFixed(2),
      overduePayableAmount: overduePayableAmount.toFixed(2),
    };
  }

  // ─── Entries ─────────────────────────────────────────────────────────────────

  async listEntries(tenantId: string, query: ListAccountEntriesQueryDto) {
    const where = this.buildEntryWhere(tenantId, query);
    const entries = await this.prisma.accountEntry.findMany({
      where,
      include: {
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    const computed = await this.computeEntries(entries, tenantId, true);
    return computed;
  }

  async findEntry(id: string, tenantId: string) {
    const entry = await this.findEntryOrThrow(id, tenantId);
    const [serialized] = await this.computeEntries([entry], tenantId, true);
    return serialized;
  }

  async createEntry(tenantId: string, dto: CreateAccountEntryDto) {
    if (dto.dealId) {
      await this.ensureDealInTenant(dto.dealId, tenantId);
    }
    if (dto.clientId) {
      await this.ensureClientInTenant(dto.clientId, tenantId);
    }
    if (dto.watchId) {
      await this.ensureWatchInTenant(dto.watchId, tenantId);
    }
    if (dto.expenseId) {
      await this.ensureExpenseInTenant(dto.expenseId, tenantId);
    }

    let source = dto.source ?? AccountEntrySource.MANUAL;
    if (dto.dealId && dto.type === AccountEntryType.RECEIVABLE) {
      await this.ensureNoDuplicateReceivableForDeal(tenantId, dto.dealId);
      if (dto.source === undefined) {
        source = AccountEntrySource.DEAL_AUTO;
      }
    }

    const entry = await this.prisma.accountEntry.create({
      data: {
        tenant: { connect: { id: tenantId } },
        type: dto.type,
        category: dto.category,
        source,
        counterpartyName: dto.counterpartyName,
        counterpartyType: dto.counterpartyType,
        concept: dto.concept,
        totalAmount: new Prisma.Decimal(dto.totalAmount),
        currency: dto.currency,
        exchangeRate:
          dto.exchangeRate !== undefined
            ? new Prisma.Decimal(dto.exchangeRate)
            : undefined,
        reference: dto.reference,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
        client: dto.clientId ? { connect: { id: dto.clientId } } : undefined,
        deal: dto.dealId ? { connect: { id: dto.dealId } } : undefined,
        watch: dto.watchId ? { connect: { id: dto.watchId } } : undefined,
        expense: dto.expenseId ? { connect: { id: dto.expenseId } } : undefined,
      },
      include: {
        payments: { where: { deletedAt: null } },
      },
    });

    const [serialized] = await this.computeEntries([entry], tenantId, true);
    return serialized;
  }

  async updateEntry(id: string, tenantId: string, dto: UpdateAccountEntryDto) {
    const existing = await this.findEntryOrThrow(id, tenantId);

    if (this.isDealLinked(existing) && dto.totalAmount !== undefined) {
      throw new BadRequestException('totalAmount cannot be edited for deal-linked entries');
    }

    if (dto.dealId !== undefined && dto.dealId !== null) {
      await this.ensureDealInTenant(dto.dealId, tenantId);
    }
    if (dto.clientId !== undefined && dto.clientId !== null) {
      await this.ensureClientInTenant(dto.clientId, tenantId);
    }
    if (dto.watchId !== undefined && dto.watchId !== null) {
      await this.ensureWatchInTenant(dto.watchId, tenantId);
    }
    if (dto.expenseId !== undefined && dto.expenseId !== null) {
      await this.ensureExpenseInTenant(dto.expenseId, tenantId);
    }

    if (
      dto.dealId !== undefined &&
      dto.dealId !== null &&
      (dto.type ?? existing.type) === AccountEntryType.RECEIVABLE
    ) {
      await this.ensureNoDuplicateReceivableForDeal(tenantId, dto.dealId, id);
    }

    const data: Prisma.AccountEntryUpdateInput = {};

    if (dto.type !== undefined) data.type = dto.type;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.counterpartyName !== undefined) data.counterpartyName = dto.counterpartyName;
    if (dto.counterpartyType !== undefined) data.counterpartyType = dto.counterpartyType;
    if (dto.concept !== undefined) data.concept = dto.concept;
    if (dto.totalAmount !== undefined) {
      data.totalAmount = new Prisma.Decimal(dto.totalAmount);
    }
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.exchangeRate !== undefined) {
      data.exchangeRate = new Prisma.Decimal(dto.exchangeRate);
    }
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.issuedAt !== undefined) {
      data.issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : null;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.clientId !== undefined) {
      data.client = dto.clientId
        ? { connect: { id: dto.clientId } }
        : { disconnect: true };
    }
    if (dto.dealId !== undefined) {
      data.deal = dto.dealId ? { connect: { id: dto.dealId } } : { disconnect: true };
    }
    if (dto.watchId !== undefined) {
      data.watch = dto.watchId ? { connect: { id: dto.watchId } } : { disconnect: true };
    }
    if (dto.expenseId !== undefined) {
      data.expense = dto.expenseId
        ? { connect: { id: dto.expenseId } }
        : { disconnect: true };
    }

    if (dto.status === AccountEntryStatus.CANCELLED) {
      data.status = AccountEntryStatus.CANCELLED;
      data.closedAt = existing.closedAt ?? new Date();
    }

    if (Object.keys(data).length === 0) {
      const [serialized] = await this.computeEntries([existing], tenantId, true);
      return serialized;
    }

    const updated = await this.prisma.accountEntry.update({
      where: { id },
      data,
      include: {
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
      },
    });

    const [serialized] = await this.computeEntries([updated], tenantId, true);
    return serialized;
  }

  async removeEntry(id: string, tenantId: string) {
    const existing = await this.findEntryOrThrow(id, tenantId);
    const paidTotal = await this.resolvePaidTotal(existing, tenantId);
    const { status } = this.resolveStatus(existing, paidTotal);

    if (status === AccountEntryStatus.PAID) {
      throw new BadRequestException('Cannot delete a PAID entry');
    }

    await this.prisma.accountEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Payments ────────────────────────────────────────────────────────────────

  async createPayment(entryId: string, tenantId: string, dto: CreateAccountPaymentDto) {
    const entry = await this.findEntryOrThrow(entryId, tenantId);
    this.assertManualEntry(entry);

    const currency = dto.currency ?? entry.currency;
    if (currency !== entry.currency) {
      throw new BadRequestException('Payment currency must match entry currency');
    }

    await this.prisma.accountPayment.create({
      data: {
        tenant: { connect: { id: tenantId } },
        entry: { connect: { id: entryId } },
        amount: new Prisma.Decimal(dto.amount),
        currency,
        method: dto.method,
        paidAt: new Date(dto.paidAt),
        notes: dto.notes,
      },
    });

    return this.findEntry(entryId, tenantId);
  }

  async updatePayment(
    entryId: string,
    paymentId: string,
    tenantId: string,
    dto: UpdateAccountPaymentDto,
  ) {
    const entry = await this.findEntryOrThrow(entryId, tenantId);
    this.assertManualEntry(entry);

    const payment = await this.findPaymentOrThrow(paymentId, entryId, tenantId);

    const nextCurrency = dto.currency ?? payment.currency;
    if (nextCurrency !== entry.currency) {
      throw new BadRequestException('Payment currency must match entry currency');
    }

    const data: Prisma.AccountPaymentUpdateInput = {};
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.method !== undefined) data.method = dto.method;
    if (dto.paidAt !== undefined) data.paidAt = new Date(dto.paidAt);
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (Object.keys(data).length > 0) {
      await this.prisma.accountPayment.update({ where: { id: paymentId }, data });
    }

    return this.findEntry(entryId, tenantId);
  }

  async removePayment(entryId: string, paymentId: string, tenantId: string) {
    const entry = await this.findEntryOrThrow(entryId, tenantId);
    this.assertManualEntry(entry);
    await this.findPaymentOrThrow(paymentId, entryId, tenantId);

    await this.prisma.accountPayment.update({
      where: { id: paymentId },
      data: { deletedAt: new Date() },
    });

    return this.findEntry(entryId, tenantId);
  }

  // ─── Computation ─────────────────────────────────────────────────────────────

  private async computeEntries(
    entries: EntryWithPayments[],
    tenantId: string,
    persistStatus: boolean,
  ) {
    const dealIds = [
      ...new Set(
        entries
          .filter((e) => this.isDealLinked(e) && e.dealId)
          .map((e) => e.dealId as string),
      ),
    ];
    const dealPaidMap = await this.getDealPaidTotals(tenantId, dealIds);

    const results = [];

    for (const entry of entries) {
      const paidTotal = this.isDealLinked(entry)
        ? dealPaidMap.get(entry.dealId!) ?? new Prisma.Decimal(0)
        : entry.payments.reduce(
            (sum, p) => sum.plus(p.amount),
            new Prisma.Decimal(0),
          );

      const balance = entry.totalAmount.minus(paidTotal);
      const { status, closedAt } = this.resolveStatus(entry, paidTotal);

      if (
        persistStatus &&
        (entry.status !== status || entry.closedAt?.getTime() !== closedAt?.getTime())
      ) {
        await this.prisma.accountEntry.update({
          where: { id: entry.id },
          data: { status, closedAt },
        });
        entry.status = status;
        entry.closedAt = closedAt;
      }

      results.push(this.serializeEntry(entry, paidTotal, balance));
    }

    return results;
  }

  private resolvePaidTotal(entry: EntryWithPayments, tenantId: string): Promise<Prisma.Decimal> {
    if (this.isDealLinked(entry)) {
      if (!entry.dealId) return Promise.resolve(new Prisma.Decimal(0));
      return this.getDealPaidTotal(tenantId, entry.dealId);
    }
    const paid = entry.payments.reduce(
      (sum, p) => sum.plus(p.amount),
      new Prisma.Decimal(0),
    );
    return Promise.resolve(paid);
  }

  private resolveStatus(
    entry: AccountEntry,
    paidTotal: Prisma.Decimal,
  ): { status: AccountEntryStatus; closedAt: Date | null } {
    if (entry.status === AccountEntryStatus.CANCELLED) {
      return { status: AccountEntryStatus.CANCELLED, closedAt: entry.closedAt };
    }

    const totalAmount = entry.totalAmount;
    const balance = totalAmount.minus(paidTotal);
    const now = new Date();

    let status: AccountEntryStatus;
    if (paidTotal.greaterThanOrEqualTo(totalAmount)) {
      status = AccountEntryStatus.PAID;
    } else if (paidTotal.greaterThan(0)) {
      status = AccountEntryStatus.PARTIAL;
    } else if (entry.dueDate && entry.dueDate < now && balance.greaterThan(0)) {
      status = AccountEntryStatus.OVERDUE;
    } else {
      status = AccountEntryStatus.OPEN;
    }

    let closedAt: Date | null;
    if (status === AccountEntryStatus.PAID) {
      closedAt = entry.closedAt ?? new Date();
    } else {
      closedAt = null;
    }

    return { status, closedAt };
  }

  private isDealLinked(entry: Pick<AccountEntry, 'source' | 'dealId'>): boolean {
    return entry.source === AccountEntrySource.DEAL_AUTO || entry.dealId !== null;
  }

  private async getDealPaidTotals(
    tenantId: string,
    dealIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (dealIds.length === 0) return new Map();

    const aggs = await this.prisma.payment.groupBy({
      by: ['dealId'],
      where: {
        tenantId,
        dealId: { in: dealIds },
        status: PaymentStatus.PAID,
        deletedAt: null,
      },
      _sum: { amount: true },
    });

    return new Map(
      aggs.map((row) => [row.dealId, row._sum.amount ?? new Prisma.Decimal(0)]),
    );
  }

  private async getDealPaidTotal(tenantId: string, dealId: string): Promise<Prisma.Decimal> {
    const map = await this.getDealPaidTotals(tenantId, [dealId]);
    return map.get(dealId) ?? new Prisma.Decimal(0);
  }

  // ─── Serialization ───────────────────────────────────────────────────────────

  private serializeEntry(
    entry: EntryWithPayments,
    paidTotal: Prisma.Decimal,
    balance: Prisma.Decimal,
  ) {
    const base = {
      id: entry.id,
      tenantId: entry.tenantId,
      type: entry.type,
      status: entry.status,
      category: entry.category,
      source: entry.source,
      counterpartyName: entry.counterpartyName,
      counterpartyType: entry.counterpartyType,
      concept: entry.concept,
      totalAmount: entry.totalAmount.toFixed(2),
      currency: entry.currency,
      exchangeRate: entry.exchangeRate?.toFixed(6) ?? null,
      reference: entry.reference,
      issuedAt: entry.issuedAt?.toISOString() ?? null,
      dueDate: entry.dueDate?.toISOString() ?? null,
      closedAt: entry.closedAt?.toISOString() ?? null,
      notes: entry.notes,
      clientId: entry.clientId,
      dealId: entry.dealId,
      watchId: entry.watchId,
      expenseId: entry.expenseId,
      deletedAt: entry.deletedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      paidTotal: paidTotal.toFixed(2),
      balance: balance.toFixed(2),
      payments: this.isDealLinked(entry)
        ? []
        : entry.payments.map((p) => this.serializePayment(p)),
    };
    return base;
  }

  private serializePayment(payment: AccountPayment) {
    return {
      id: payment.id,
      tenantId: payment.tenantId,
      entryId: payment.entryId,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      notes: payment.notes,
      deletedAt: payment.deletedAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }

  // ─── Query / guards ──────────────────────────────────────────────────────────

  private buildEntryWhere(
    tenantId: string,
    query: ListAccountEntriesQueryDto,
  ): Prisma.AccountEntryWhereInput {
    const where: Prisma.AccountEntryWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.type !== undefined) where.type = query.type;
    if (query.status !== undefined) where.status = query.status;
    if (query.source !== undefined) where.source = query.source;
    if (query.clientId !== undefined && query.clientId.trim() !== '') {
      where.clientId = query.clientId.trim();
    }

    if (query.from !== undefined || query.to !== undefined) {
      const dueDate: Prisma.DateTimeNullableFilter = {};
      if (query.from !== undefined) dueDate.gte = new Date(query.from);
      if (query.to !== undefined) dueDate.lte = new Date(query.to);
      where.dueDate = dueDate;
    }

    return where;
  }

  private assertManualEntry(entry: AccountEntry) {
    if (this.isDealLinked(entry)) {
      throw new BadRequestException(
        'Payments can only be recorded on manual entries without deal linkage',
      );
    }
  }

  private async findEntryOrThrow(id: string, tenantId: string): Promise<EntryWithPayments> {
    const entry = await this.prisma.accountEntry.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
      },
    });
    if (!entry) throw new NotFoundException('Account entry not found');
    return entry;
  }

  private async findPaymentOrThrow(
    paymentId: string,
    entryId: string,
    tenantId: string,
  ): Promise<AccountPayment> {
    const payment = await this.prisma.accountPayment.findFirst({
      where: { id: paymentId, entryId, tenantId, deletedAt: null },
    });
    if (!payment) throw new NotFoundException('Account payment not found');
    return payment;
  }

  private async ensureNoDuplicateReceivableForDeal(
    tenantId: string,
    dealId: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.accountEntry.findFirst({
      where: {
        tenantId,
        dealId,
        type: AccountEntryType.RECEIVABLE,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'A non-deleted RECEIVABLE entry already exists for this deal',
      );
    }
  }

  private async ensureDealInTenant(dealId: string, tenantId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!deal) throw new BadRequestException('Deal is invalid for this tenant');
  }

  private async ensureClientInTenant(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new BadRequestException('Client is invalid for this tenant');
  }

  private async ensureWatchInTenant(watchId: string, tenantId: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!watch) throw new BadRequestException('Watch is invalid for this tenant');
  }

  private async ensureExpenseInTenant(expenseId: string, tenantId: string) {
    const expense = await this.prisma.operatingExpense.findFirst({
      where: { id: expenseId, tenantId },
      select: { id: true },
    });
    if (!expense) throw new BadRequestException('Expense is invalid for this tenant');
  }
}
