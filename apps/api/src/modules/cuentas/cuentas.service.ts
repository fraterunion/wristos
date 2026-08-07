import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountEntry,
  AccountEntryCategory,
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  AccountPayment,
  AccountSettlement,
  CounterpartyType,
  Currency,
  DealStage,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { TreasuryService } from '../treasury/treasury.service';
import { CreateAccountEntryDto } from './dto/create-account-entry.dto';
import {
  AccountPaymentDestination,
  CreateAccountPaymentDto,
} from './dto/create-account-payment.dto';
import { ListAccountEntriesQueryDto } from './dto/list-account-entries-query.dto';
import { UpdateAccountEntryDto } from './dto/update-account-entry.dto';
import { UpdateAccountPaymentDto } from './dto/update-account-payment.dto';
import { isHistoricalDealSourceTag } from './historical-ar-exclusion';

type SettlementPaymentLinks = {
  settlementAsReceivablePayment: (AccountSettlement & {
    payableEntry: Pick<AccountEntry, 'id' | 'counterpartyName' | 'concept' | 'type'>;
  }) | null;
  settlementAsPayablePayment: (AccountSettlement & {
    receivableEntry: Pick<AccountEntry, 'id' | 'counterpartyName' | 'concept' | 'type'>;
  }) | null;
};

type PaymentWithSettlement = AccountPayment & Partial<SettlementPaymentLinks>;

type EntryWithPayments = AccountEntry & { payments: PaymentWithSettlement[] };

type DbClient = Prisma.TransactionClient | PrismaService;

const paymentIncludeSettlement = {
  settlementAsReceivablePayment: {
    include: {
      payableEntry: {
        select: { id: true, counterpartyName: true, concept: true, type: true },
      },
    },
  },
  settlementAsPayablePayment: {
    include: {
      receivableEntry: {
        select: { id: true, counterpartyName: true, concept: true, type: true },
      },
    },
  },
} satisfies Prisma.AccountPaymentInclude;

type CurrencyBreakdown = {
  MXN: Prisma.Decimal;
  USD: Prisma.Decimal;
};

@Injectable()
export class CuentasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fxService: FxService,
    private readonly treasuryService: TreasuryService,
  ) {}

  // ─── Summary ─────────────────────────────────────────────────────────────────

  async getSummary(tenantId: string) {
    const entries = await this.prisma.accountEntry.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        payments: { where: { deletedAt: null } },
      },
    });

    const computed = await this.computeEntries(entries, tenantId, false);

    const receivableByCurrency = this.emptyCurrencyBreakdown();
    const payableByCurrency = this.emptyCurrencyBreakdown();
    const overdueReceivableByCurrency = this.emptyCurrencyBreakdown();
    const overduePayableByCurrency = this.emptyCurrencyBreakdown();
    let overdueReceivableCount = 0;
    let overduePayableCount = 0;

    for (const row of computed) {
      const balance = new Prisma.Decimal(row.balance);
      const currency = row.currency as Currency;
      if (row.type === AccountEntryType.RECEIVABLE) {
        this.addToCurrencyBreakdown(receivableByCurrency, currency, balance);
        if (row.status === AccountEntryStatus.OVERDUE) {
          overdueReceivableCount += 1;
          this.addToCurrencyBreakdown(overdueReceivableByCurrency, currency, balance);
        }
      } else {
        this.addToCurrencyBreakdown(payableByCurrency, currency, balance);
        if (row.status === AccountEntryStatus.OVERDUE) {
          overduePayableCount += 1;
          this.addToCurrencyBreakdown(overduePayableByCurrency, currency, balance);
        }
      }
    }

    const hasUsdBalances =
      !receivableByCurrency.USD.isZero() ||
      !payableByCurrency.USD.isZero() ||
      !overdueReceivableByCurrency.USD.isZero() ||
      !overduePayableByCurrency.USD.isZero();

    let fxRate: number | null = null;
    let exchangeRateUsed: string | null = null;
    if (hasUsdBalances) {
      try {
        const fx = await this.fxService.getUsdMxn();
        fxRate = fx.rate;
        exchangeRateUsed = fx.rate.toFixed(2);
      } catch {
        // USD balances exist but FX is unavailable — consolidated totals exclude USD.
        fxRate = null;
        exchangeRateUsed = null;
      }
    }

    const totalReceivable = this.consolidateBreakdownToMxn(receivableByCurrency, fxRate);
    const totalPayable = this.consolidateBreakdownToMxn(payableByCurrency, fxRate);
    const overdueReceivableAmount = this.consolidateBreakdownToMxn(
      overdueReceivableByCurrency,
      fxRate,
    );
    const overduePayableAmount = this.consolidateBreakdownToMxn(
      overduePayableByCurrency,
      fxRate,
    );

    return {
      totalReceivable: totalReceivable.toFixed(2),
      totalPayable: totalPayable.toFixed(2),
      overdueReceivableCount,
      overduePayableCount,
      overdueReceivableAmount: overdueReceivableAmount.toFixed(2),
      overduePayableAmount: overduePayableAmount.toFixed(2),
      totalReceivableByCurrency: this.formatCurrencyBreakdown(receivableByCurrency),
      totalPayableByCurrency: this.formatCurrencyBreakdown(payableByCurrency),
      overdueReceivableByCurrency: this.formatCurrencyBreakdown(overdueReceivableByCurrency),
      overduePayableByCurrency: this.formatCurrencyBreakdown(overduePayableByCurrency),
      exchangeRateUsed,
      receivableStatusCounts: this.countStatuses(computed, AccountEntryType.RECEIVABLE),
      payableStatusCounts: this.countStatuses(computed, AccountEntryType.PAYABLE),
      expectedNetFlow: totalReceivable.minus(totalPayable).toFixed(2),
    };
  }

  private countStatuses(
    rows: Array<{ type: string; status: string }>,
    type: AccountEntryType,
  ): Record<AccountEntryStatus, number> {
    const counts: Record<AccountEntryStatus, number> = {
      OPEN: 0,
      PARTIAL: 0,
      PAID: 0,
      OVERDUE: 0,
      CANCELLED: 0,
    };
    for (const row of rows) {
      if (row.type !== type) continue;
      const status = row.status as AccountEntryStatus;
      if (status in counts) counts[status] += 1;
    }
    return counts;
  }

  private emptyCurrencyBreakdown(): CurrencyBreakdown {
    return {
      MXN: new Prisma.Decimal(0),
      USD: new Prisma.Decimal(0),
    };
  }

  private addToCurrencyBreakdown(
    breakdown: CurrencyBreakdown,
    currency: Currency,
    amount: Prisma.Decimal,
  ) {
    if (currency === Currency.USD) {
      breakdown.USD = breakdown.USD.plus(amount);
    } else {
      breakdown.MXN = breakdown.MXN.plus(amount);
    }
  }

  private formatCurrencyBreakdown(breakdown: CurrencyBreakdown) {
    return {
      MXN: breakdown.MXN.toFixed(2),
      USD: breakdown.USD.toFixed(2),
    };
  }

  private consolidateBreakdownToMxn(
    breakdown: CurrencyBreakdown,
    fxRate: number | null,
  ): Prisma.Decimal {
    let total = breakdown.MXN;
    if (!breakdown.USD.isZero()) {
      if (fxRate === null) {
        return breakdown.MXN;
      }
      total = total.plus(breakdown.USD.mul(fxRate));
    }
    return total;
  }

  // ─── Entries ─────────────────────────────────────────────────────────────────

  async listEntries(tenantId: string, query: ListAccountEntriesQueryDto) {
    const where = this.buildEntryWhere(tenantId, query);
    const entries = await this.prisma.accountEntry.findMany({
      where,
      include: {
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          include: paymentIncludeSettlement,
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    let computed = await this.computeEntries(entries as EntryWithPayments[], tenantId, true);

    const q = query.q?.trim().toLowerCase();
    if (q) {
      computed = computed.filter((row) => {
        const haystack = [
          row.counterpartyName,
          row.concept,
          row.notes ?? '',
          row.reference ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    const page = query.page;
    const pageSize = query.pageSize ?? 50;
    if (page !== undefined) {
      const total = computed.length;
      const start = (page - 1) * pageSize;
      return {
        items: computed.slice(start, start + pageSize),
        total,
        page,
        pageSize,
      };
    }

    return computed;
  }

  /**
   * Top debtors by outstanding RECEIVABLE balance.
   * MXN and USD are returned separately — never silently converted.
   */
  async getTopDebtors(tenantId: string, limit = 10) {
    const entries = await this.prisma.accountEntry.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: AccountEntryType.RECEIVABLE,
      },
      include: {
        payments: { where: { deletedAt: null } },
        client: { select: { id: true, name: true } },
      },
    });

    const computed = await this.computeEntries(entries, tenantId, false);
    type Acc = {
      clientId: string | null;
      counterpartyName: string;
      currency: Currency;
      outstanding: Prisma.Decimal;
      openAccounts: number;
    };
    const map = new Map<string, Acc>();

    for (const row of computed) {
      const balance = new Prisma.Decimal(row.balance);
      if (balance.lte(0)) continue;
      if (
        row.status === AccountEntryStatus.PAID ||
        row.status === AccountEntryStatus.CANCELLED
      ) {
        continue;
      }
      const key = `${row.currency}::${row.clientId ?? row.counterpartyName}`;
      const existing = map.get(key);
      if (existing) {
        existing.outstanding = existing.outstanding.plus(balance);
        existing.openAccounts += 1;
      } else {
        map.set(key, {
          clientId: row.clientId,
          counterpartyName: row.counterpartyName,
          currency: row.currency as Currency,
          outstanding: balance,
          openAccounts: 1,
        });
      }
    }

    return [...map.values()]
      .sort((a, b) => b.outstanding.comparedTo(a.outstanding))
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map((row) => ({
        clientId: row.clientId,
        counterpartyName: row.counterpartyName,
        currency: row.currency,
        outstanding: row.outstanding.toFixed(2),
        openAccounts: row.openAccounts,
      }));
  }

  async getCustomerLedger(tenantId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!client) {
      throw new NotFoundException('Customer not found');
    }

    const entries = await this.prisma.accountEntry.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { clientId },
          {
            clientId: null,
            counterpartyName: { equals: client.name, mode: 'insensitive' },
          },
        ],
      },
      include: {
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'asc' } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const computed = await this.computeEntries(entries, tenantId, true);
    const receivables = computed.filter((e) => e.type === AccountEntryType.RECEIVABLE);
    const payables = computed.filter((e) => e.type === AccountEntryType.PAYABLE);

    const byCurrency = (rows: typeof computed) => {
      const out = this.emptyCurrencyBreakdown();
      for (const row of rows) {
        const bal = new Prisma.Decimal(row.balance);
        if (bal.lte(0)) continue;
        if (
          row.status === AccountEntryStatus.PAID ||
          row.status === AccountEntryStatus.CANCELLED
        ) {
          continue;
        }
        this.addToCurrencyBreakdown(out, row.currency as Currency, bal);
      }
      return this.formatCurrencyBreakdown(out);
    };

    return {
      customer: client,
      receivables,
      payables,
      receivableOutstandingByCurrency: byCurrency(receivables),
      payableOutstandingByCurrency: byCurrency(payables),
    };
  }

  async findEntry(id: string, tenantId: string) {
    const entry = await this.findEntryOrThrow(id, tenantId);
    const [serialized] = await this.computeEntries([entry], tenantId, true);
    return serialized;
  }

  async getClientAccountsForTools(tenantId: string, clientId: string, type?: AccountEntryType, status?: AccountEntryStatus) {
    await this.getCustomerLedger(tenantId, clientId);
    const rows = await this.listEntries(tenantId, { clientId, type, status });
    return Array.isArray(rows) ? rows : rows.items;
  }

  async getOpenAccountsForTools(tenantId: string, type: AccountEntryType, clientId?: string) {
    const rows = await this.listEntries(tenantId, { type, clientId });
    const items = (Array.isArray(rows) ? rows : rows.items).filter((row) => !['PAID', 'CANCELLED'].includes(row.status) && new Prisma.Decimal(row.balance).gt(0));
    return items;
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
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          include: paymentIncludeSettlement,
        },
      },
    });

    const [serialized] = await this.computeEntries(
      [updated as EntryWithPayments],
      tenantId,
      true,
    );
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

  async createPayment(
    entryId: string,
    tenantId: string,
    dto: CreateAccountPaymentDto,
    actorUserId?: string,
  ) {
    const destination = this.resolvePaymentDestination(dto);
    if (destination === AccountPaymentDestination.APPLY_TO_PAYABLE) {
      return this.createPayableSettlement(entryId, tenantId, dto, actorUserId);
    }

    const entry = await this.findEntryOrThrow(entryId, tenantId);
    this.assertManualEntry(entry);

    const currency = dto.currency ?? entry.currency;
    if (currency !== entry.currency) {
      throw new BadRequestException('Payment currency must match entry currency');
    }

    const cashAccount = this.resolveTreasuryAccount(dto, destination);
    const method = this.resolveTreasuryPaymentMethod(dto, cashAccount);
    this.assertExchangeRateForCurrency(currency, dto.exchangeRateUsed);

    const amount = new Prisma.Decimal(dto.amount);
    const outstanding = await this.getEntryOutstanding(entry);
    if (amount.greaterThan(outstanding)) {
      throw new BadRequestException(
        `El monto excede el saldo pendiente (${outstanding.toFixed(2)} ${entry.currency}).`,
      );
    }

    const payment = await this.prisma.accountPayment.create({
      data: {
        tenant: { connect: { id: tenantId } },
        entry: { connect: { id: entryId } },
        amount,
        currency,
        method,
        paidAt: new Date(dto.paidAt),
        notes: dto.notes,
        cashAccount,
        exchangeRateUsed:
          currency === Currency.USD && dto.exchangeRateUsed !== undefined
            ? new Prisma.Decimal(dto.exchangeRateUsed)
            : null,
      },
    });

    await this.treasuryService.createFromAccountPayment({
      tenantId,
      accountPaymentId: payment.id,
      account: cashAccount,
      direction: this.treasuryDirectionForEntry(entry.type),
      amount: payment.amount,
      currency: payment.currency,
      exchangeRateUsed: payment.exchangeRateUsed,
      transactionDate: payment.paidAt,
      description: this.treasuryDescriptionForEntry(entry),
    });

    return this.findEntry(entryId, tenantId);
  }

  async reverseSettlement(settlementId: string, tenantId: string) {
    const settlement = await this.prisma.accountSettlement.findFirst({
      where: { id: settlementId, tenantId, deletedAt: null },
    });
    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.accountSettlement.update({
        where: { id: settlement.id },
        data: { deletedAt: now },
      });
      await tx.accountPayment.updateMany({
        where: {
          id: { in: [settlement.receivablePaymentId, settlement.payablePaymentId] },
          tenantId,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });
    });

    const [receivable, payable] = await Promise.all([
      this.findEntry(settlement.receivableEntryId, tenantId),
      this.findEntry(settlement.payableEntryId, tenantId),
    ]);

    return {
      settlementId: settlement.id,
      reversed: true,
      receivable,
      payable,
    };
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
    await this.assertPaymentNotSettlementLinked(paymentId);

    const nextCurrency = dto.currency ?? payment.currency;
    if (nextCurrency !== entry.currency) {
      throw new BadRequestException('Payment currency must match entry currency');
    }

    const nextExchangeRateUsed =
      dto.exchangeRateUsed !== undefined
        ? dto.exchangeRateUsed
        : payment.exchangeRateUsed !== null
          ? Number(payment.exchangeRateUsed)
          : undefined;

    this.assertExchangeRateForCurrency(nextCurrency, nextExchangeRateUsed);

    const data: Prisma.AccountPaymentUpdateInput = {};
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.method !== undefined) data.method = dto.method;
    if (dto.paidAt !== undefined) data.paidAt = new Date(dto.paidAt);
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.cashAccount !== undefined) data.cashAccount = dto.cashAccount;
    if (dto.exchangeRateUsed !== undefined) {
      data.exchangeRateUsed =
        nextCurrency === Currency.USD
          ? new Prisma.Decimal(dto.exchangeRateUsed)
          : null;
    } else if (dto.currency === Currency.MXN) {
      data.exchangeRateUsed = null;
    }

    const updated =
      Object.keys(data).length > 0
        ? await this.prisma.accountPayment.update({ where: { id: paymentId }, data })
        : payment;

    const cashAccount = updated.cashAccount ?? dto.cashAccount;
    if (!cashAccount) {
      throw new BadRequestException('cashAccount is required for treasury-linked payments');
    }

    await this.treasuryService.updateFromAccountPayment(paymentId, {
      tenantId,
      account: cashAccount,
      direction: this.treasuryDirectionForEntry(entry.type),
      amount: updated.amount,
      currency: updated.currency,
      exchangeRateUsed: updated.exchangeRateUsed,
      transactionDate: updated.paidAt,
      description: this.treasuryDescriptionForEntry(entry),
    });

    return this.findEntry(entryId, tenantId);
  }

  async removePayment(entryId: string, paymentId: string, tenantId: string) {
    const entry = await this.findEntryOrThrow(entryId, tenantId);
    this.assertManualEntry(entry);
    await this.findPaymentOrThrow(paymentId, entryId, tenantId);

    const linkedSettlement = await this.findActiveSettlementForPayment(paymentId, tenantId);
    if (linkedSettlement) {
      return this.reverseSettlement(linkedSettlement.id, tenantId);
    }

    await this.prisma.accountPayment.update({
      where: { id: paymentId },
      data: { deletedAt: new Date() },
    });

    await this.treasuryService.deleteByAccountPaymentId(paymentId);

    return this.findEntry(entryId, tenantId);
  }

  // ─── Deal sync ───────────────────────────────────────────────────────────────

  private async createPayableSettlement(
    receivableEntryId: string,
    tenantId: string,
    dto: CreateAccountPaymentDto,
    actorUserId?: string,
  ) {
    if (!dto.payableEntryId?.trim()) {
      throw new BadRequestException('payableEntryId is required for APPLY_TO_PAYABLE');
    }

    const payableEntryId = dto.payableEntryId.trim();
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Settlement amount must be greater than 0');
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.prisma.accountSettlement.findFirst({
        where: { tenantId, idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        return this.buildSettlementResponse(existing.id, tenantId);
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'idempotencyKey already used by a reversed settlement; use a new key',
        );
      }
    }

    let settlementId: string;
    try {
      settlementId = await this.prisma.$transaction(
        async (tx) => {
          const receivable = await tx.accountEntry.findFirst({
            where: { id: receivableEntryId, tenantId, deletedAt: null },
            include: {
              payments: { where: { deletedAt: null } },
            },
          });
          if (!receivable) {
            throw new NotFoundException('Account entry not found');
          }
          this.assertManualEntry(receivable);
          if (receivable.type !== AccountEntryType.RECEIVABLE) {
            throw new BadRequestException(
              'APPLY_TO_PAYABLE only applies when registering a payment on a RECEIVABLE',
            );
          }
          if (receivable.status === AccountEntryStatus.CANCELLED) {
            throw new BadRequestException('Cannot settle a cancelled receivable');
          }
          if (receivable.status === AccountEntryStatus.PAID) {
            throw new BadRequestException('Cannot settle a fully paid receivable');
          }

          const payable = await tx.accountEntry.findFirst({
            where: { id: payableEntryId, tenantId, deletedAt: null },
            include: {
              payments: { where: { deletedAt: null } },
            },
          });
          if (!payable) {
            throw new NotFoundException('Payable account entry not found');
          }
          if (payable.type !== AccountEntryType.PAYABLE) {
            throw new BadRequestException('Target must be a PAYABLE account entry');
          }
          if (payable.status === AccountEntryStatus.CANCELLED) {
            throw new BadRequestException('Cannot settle against a cancelled payable');
          }
          if (payable.status === AccountEntryStatus.PAID) {
            throw new BadRequestException('Cannot settle against a fully paid payable');
          }

          this.assertManualEntry(payable);

          if (receivable.currency !== payable.currency) {
            throw new BadRequestException(
              'Las cuentas deben estar en la misma moneda para aplicar una compensación.',
            );
          }

          const currency = dto.currency ?? receivable.currency;
          if (currency !== receivable.currency) {
            throw new BadRequestException('Payment currency must match entry currency');
          }

          const receivableOutstanding = this.outstandingFromPayments(
            receivable.totalAmount,
            receivable.payments,
          );
          const payableOutstanding = this.outstandingFromPayments(
            payable.totalAmount,
            payable.payments,
          );

          if (amount.greaterThan(receivableOutstanding)) {
            throw new BadRequestException(
              `El monto excede el saldo pendiente del cobro (${receivableOutstanding.toFixed(2)} ${currency}).`,
            );
          }
          if (amount.greaterThan(payableOutstanding)) {
            throw new BadRequestException(
              `El monto excede el saldo pendiente de la cuenta por pagar (${payableOutstanding.toFixed(2)} ${currency}).`,
            );
          }

          const paidAt = new Date(dto.paidAt);
          const receivablePayment = await tx.accountPayment.create({
            data: {
              tenantId,
              entryId: receivable.id,
              amount,
              currency,
              method: PaymentMethod.SETTLEMENT,
              paidAt,
              notes: dto.notes ?? null,
              cashAccount: null,
              exchangeRateUsed: null,
            },
          });
          const payablePayment = await tx.accountPayment.create({
            data: {
              tenantId,
              entryId: payable.id,
              amount,
              currency,
              method: PaymentMethod.SETTLEMENT,
              paidAt,
              notes: dto.notes ?? null,
              cashAccount: null,
              exchangeRateUsed: null,
            },
          });

          const settlement = await tx.accountSettlement.create({
            data: {
              tenantId,
              receivableEntryId: receivable.id,
              payableEntryId: payable.id,
              receivablePaymentId: receivablePayment.id,
              payablePaymentId: payablePayment.id,
              amount,
              currency,
              effectiveDate: paidAt,
              notes: dto.notes ?? null,
              createdByUserId: actorUserId ?? null,
              idempotencyKey,
            },
          });

          return settlement.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const existing = await this.prisma.accountSettlement.findFirst({
          where: { tenantId, idempotencyKey, deletedAt: null },
        });
        if (existing) {
          return this.buildSettlementResponse(existing.id, tenantId);
        }
      }
      throw error;
    }

    return this.buildSettlementResponse(settlementId, tenantId);
  }

  private async buildSettlementResponse(settlementId: string, tenantId: string) {
    const settlement = await this.prisma.accountSettlement.findFirst({
      where: { id: settlementId, tenantId },
      include: {
        receivablePayment: { include: paymentIncludeSettlement },
        payablePayment: { include: paymentIncludeSettlement },
      },
    });
    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    const [receivable, payable] = await Promise.all([
      this.findEntry(settlement.receivableEntryId, tenantId),
      this.findEntry(settlement.payableEntryId, tenantId),
    ]);

    return {
      settlementId: settlement.id,
      receivablePayment: this.serializePayment(
        settlement.receivablePayment as PaymentWithSettlement,
      ),
      payablePayment: this.serializePayment(
        settlement.payablePayment as PaymentWithSettlement,
      ),
      receivable,
      payable,
    };
  }

  private resolvePaymentDestination(
    dto: CreateAccountPaymentDto,
  ): AccountPaymentDestination {
    if (dto.destination) return dto.destination;
    if (dto.cashAccount === TreasuryAccount.CASH) return AccountPaymentDestination.CASH;
    if (dto.cashAccount === TreasuryAccount.BANK) return AccountPaymentDestination.BANK;
    if (dto.cashAccount === TreasuryAccount.CESAR) return AccountPaymentDestination.CESAR;
    throw new BadRequestException(
      'destination or cashAccount is required (CASH, BANK, CESAR, or APPLY_TO_PAYABLE)',
    );
  }

  private resolveTreasuryAccount(
    dto: CreateAccountPaymentDto,
    destination: AccountPaymentDestination,
  ): TreasuryAccount {
    if (destination === AccountPaymentDestination.CASH) return TreasuryAccount.CASH;
    if (destination === AccountPaymentDestination.BANK) return TreasuryAccount.BANK;
    if (destination === AccountPaymentDestination.CESAR) return TreasuryAccount.CESAR;
    if (dto.cashAccount) return dto.cashAccount;
    throw new BadRequestException('cashAccount is required for treasury destinations');
  }

  private resolveTreasuryPaymentMethod(
    dto: CreateAccountPaymentDto,
    cashAccount: TreasuryAccount,
  ): PaymentMethod {
    if (dto.method) return dto.method;
    if (cashAccount === TreasuryAccount.CASH) return PaymentMethod.CASH;
    if (cashAccount === TreasuryAccount.BANK) return PaymentMethod.BANCOS;
    return PaymentMethod.CESAR;
  }

  private outstandingFromPayments(
    totalAmount: Prisma.Decimal,
    payments: Array<{ amount: Prisma.Decimal }>,
  ): Prisma.Decimal {
    const paid = payments.reduce(
      (sum, p) => sum.plus(p.amount),
      new Prisma.Decimal(0),
    );
    return totalAmount.minus(paid);
  }

  private async getEntryOutstanding(entry: EntryWithPayments): Promise<Prisma.Decimal> {
    return this.outstandingFromPayments(entry.totalAmount, entry.payments);
  }

  private async findActiveSettlementForPayment(paymentId: string, tenantId: string) {
    return this.prisma.accountSettlement.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ receivablePaymentId: paymentId }, { payablePaymentId: paymentId }],
      },
    });
  }

  private async assertPaymentNotSettlementLinked(paymentId: string) {
    const linked = await this.prisma.accountSettlement.findFirst({
      where: {
        deletedAt: null,
        OR: [{ receivablePaymentId: paymentId }, { payablePaymentId: paymentId }],
      },
      select: { id: true },
    });
    if (linked) {
      throw new BadRequestException(
        'Settlement payments cannot be edited in place. Reverse the settlement instead.',
      );
    }
  }

  // ─── Deal sync ───────────────────────────────────────────────────────────────

  /**
   * Canonical deal → AccountEntry RECEIVABLE sync.
   * Pass `tx` to participate in an outer Prisma transaction (sale registration).
   * Returns the active receivable row when one exists after sync, otherwise null.
   */
  async syncDealReceivable(
    dealId: string,
    tenantId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AccountEntry | null> {
    const db: DbClient = tx ?? this.prisma;
    const deal = await db.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
      include: {
        client: { select: { name: true } },
        watch: { select: { brand: true, model: true } },
      },
    });

    if (!deal) {
      await this.cancelDealEntries(dealId, tenantId, db);
      return null;
    }

    // Completed historical sales snapshots must never become live AR.
    if (isHistoricalDealSourceTag(deal.sourceTag)) {
      return null;
    }

    if (
      deal.stage !== DealStage.PENDING_PAYMENT &&
      deal.stage !== DealStage.CLOSED_WON
    ) {
      await this.cancelDealEntries(dealId, tenantId, db);
      return null;
    }

    const existing = await db.accountEntry.findFirst({
      where: {
        tenantId,
        dealId,
        type: AccountEntryType.RECEIVABLE,
        deletedAt: null,
      },
    });

    let entry = existing;
    if (!existing) {
      const watchLabel = deal.watch
        ? `${deal.watch.brand} ${deal.watch.model}`
        : 'Histórico';
      entry = await db.accountEntry.create({
        data: {
          tenant: { connect: { id: tenantId } },
          type: AccountEntryType.RECEIVABLE,
          status: AccountEntryStatus.OPEN,
          category: AccountEntryCategory.SALE_BALANCE,
          source: AccountEntrySource.DEAL_AUTO,
          counterpartyName: deal.client.name,
          counterpartyType: CounterpartyType.CLIENT,
          concept: `Saldo pendiente — ${watchLabel}`,
          totalAmount: deal.agreedPrice,
          currency: Currency.MXN,
          exchangeRate: deal.exchangeRate ?? undefined,
          issuedAt: deal.updatedAt,
          client: { connect: { id: deal.clientId } },
          deal: { connect: { id: deal.id } },
          watch: deal.watchId ? { connect: { id: deal.watchId } } : undefined,
        },
      });
    } else if (!existing.totalAmount.equals(deal.agreedPrice)) {
      entry = await db.accountEntry.update({
        where: { id: existing.id },
        data: { totalAmount: deal.agreedPrice },
      });
    }

    void entry;
    return this.refreshEntryStatusForDeal(dealId, tenantId, db);
  }

  async refreshEntryStatusForDeal(
    dealId: string,
    tenantId: string,
    tx?: Prisma.TransactionClient | DbClient,
  ): Promise<AccountEntry | null> {
    const db: DbClient = tx ?? this.prisma;
    const entry = await db.accountEntry.findFirst({
      where: {
        tenantId,
        dealId,
        type: AccountEntryType.RECEIVABLE,
        deletedAt: null,
      },
    });

    if (!entry) return null;

    const paidTotal = await this.getDealPaidTotal(tenantId, dealId, db);
    const { status, closedAt } = this.resolveStatus(entry, paidTotal);

    if (
      entry.status !== status ||
      entry.closedAt?.getTime() !== closedAt?.getTime()
    ) {
      return db.accountEntry.update({
        where: { id: entry.id },
        data: { status, closedAt },
      });
    }

    return entry;
  }

  private async cancelDealEntries(
    dealId: string,
    tenantId: string,
    db: DbClient = this.prisma,
  ): Promise<void> {
    const entries = await db.accountEntry.findMany({
      where: {
        tenantId,
        dealId,
        type: AccountEntryType.RECEIVABLE,
        deletedAt: null,
      },
    });

    const now = new Date();
    for (const entry of entries) {
      const paidTotal = await this.getDealPaidTotal(tenantId, dealId, db);
      const { status } = this.resolveStatus(entry, paidTotal);
      if (status !== AccountEntryStatus.PAID) {
        await db.accountEntry.update({
          where: { id: entry.id },
          data: { deletedAt: now },
        });
      }
    }
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
    db: DbClient = this.prisma,
  ): Promise<Map<string, Prisma.Decimal>> {
    if (dealIds.length === 0) return new Map();

    const aggs = await db.payment.groupBy({
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

  private async getDealPaidTotal(
    tenantId: string,
    dealId: string,
    db: DbClient = this.prisma,
  ): Promise<Prisma.Decimal> {
    const map = await this.getDealPaidTotals(tenantId, [dealId], db);
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

  private serializePayment(payment: PaymentWithSettlement | AccountPayment) {
    const withLinks = payment as PaymentWithSettlement;
    const asReceivable = withLinks.settlementAsReceivablePayment ?? null;
    const asPayable = withLinks.settlementAsPayablePayment ?? null;
    const settlement = asReceivable ?? asPayable;

    return {
      id: payment.id,
      tenantId: payment.tenantId,
      entryId: payment.entryId,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      notes: payment.notes,
      cashAccount: payment.cashAccount,
      exchangeRateUsed: payment.exchangeRateUsed?.toFixed(6) ?? null,
      deletedAt: payment.deletedAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      settlementId: settlement?.id ?? null,
      settlement:
        settlement == null
          ? null
          : {
              id: settlement.id,
              amount: settlement.amount.toFixed(2),
              currency: settlement.currency,
              effectiveDate: settlement.effectiveDate.toISOString(),
              role: asReceivable ? 'RECEIVABLE_SIDE' : 'PAYABLE_SIDE',
              counterpartEntryId: asReceivable
                ? asReceivable.payableEntry.id
                : asPayable!.receivableEntry.id,
              counterpartName: asReceivable
                ? asReceivable.payableEntry.counterpartyName
                : asPayable!.receivableEntry.counterpartyName,
              counterpartConcept: asReceivable
                ? asReceivable.payableEntry.concept
                : asPayable!.receivableEntry.concept,
            },
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

  private assertExchangeRateForCurrency(
    currency: Currency,
    exchangeRateUsed?: number | null,
  ) {
    if (currency === Currency.USD && (exchangeRateUsed === undefined || exchangeRateUsed === null)) {
      throw new BadRequestException('Tipo de cambio requerido para pagos en USD');
    }
  }

  private treasuryDirectionForEntry(type: AccountEntryType): TreasuryDirection {
    return type === AccountEntryType.RECEIVABLE
      ? TreasuryDirection.INFLOW
      : TreasuryDirection.OUTFLOW;
  }

  private treasuryDescriptionForEntry(entry: AccountEntry): string {
    const label = entry.type === AccountEntryType.RECEIVABLE ? 'Cobro' : 'Pago';
    return `${label} — ${entry.counterpartyName} · ${entry.concept}`;
  }

  private async findEntryOrThrow(id: string, tenantId: string): Promise<EntryWithPayments> {
    const entry = await this.prisma.accountEntry.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          include: paymentIncludeSettlement,
        },
      },
    });
    if (!entry) throw new NotFoundException('Account entry not found');
    return entry as EntryWithPayments;
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
