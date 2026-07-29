import { Injectable, NotFoundException } from '@nestjs/common';
import { OperatingExpense, OperatingExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { structuredBankCommissionWhere } from '../treasury/migration-bank-commission';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesDto } from './dto/list-expenses.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateExpenseDto) {
    const expense = await this.prisma.operatingExpense.create({
      data: {
        tenant: { connect: { id: tenantId } },
        category: dto.category,
        amount: new Prisma.Decimal(dto.amount),
        notes: dto.notes ?? null,
        expenseDate: new Date(dto.expenseDate),
      },
    });
    return this.serialize(expense);
  }

  async list(tenantId: string, query: ListExpensesDto) {
    const where = this.buildWhere(tenantId, query);
    const expenses = await this.prisma.operatingExpense.findMany({
      where,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    });
    return expenses.map((e) => this.serialize(e));
  }

  async findOne(id: string, tenantId: string) {
    const expense = await this.prisma.operatingExpense.findFirst({
      where: { id, tenantId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return this.serialize(expense);
  }

  async update(id: string, tenantId: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.operatingExpense.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Expense not found');

    const data: Prisma.OperatingExpenseUpdateInput = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.expenseDate !== undefined) data.expenseDate = new Date(dto.expenseDate);

    if (Object.keys(data).length === 0) return this.serialize(existing);

    const updated = await this.prisma.operatingExpense.update({
      where: { id },
      data,
    });
    return this.serialize(updated);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.operatingExpense.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Expense not found');
    await this.prisma.operatingExpense.delete({ where: { id } });
  }

  async summary(tenantId: string, query: ListExpensesDto) {
    const where = this.buildWhere(tenantId, query);
    const rows = await this.prisma.operatingExpense.findMany({
      where,
      select: { category: true, amount: true },
    });

    // Operativos = all non-COMMISSIONS OpEx (includes any residual BANK_FEES OpEx).
    // Sales commissions = COMMISSIONS only.
    // Bank commissions = structured TreasuryEntry.commission (Control Bancos) — never OpEx BANK_FEES.
    let totalOperating = 0;
    let totalCommissions = 0;
    const byCategory: Record<string, { total: number; count: number }> = {};

    for (const row of rows) {
      const amt = Number(row.amount);
      if (row.category === OperatingExpenseCategory.COMMISSIONS) {
        totalCommissions += amt;
      } else {
        totalOperating += amt;
      }
      if (!byCategory[row.category]) {
        byCategory[row.category] = { total: 0, count: 0 };
      }
      byCategory[row.category].total += amt;
      byCategory[row.category].count += 1;
    }

    const treasuryDateFilter = this.buildTreasuryDateFilter(query);
    const bankWhere = structuredBankCommissionWhere(tenantId, treasuryDateFilter);
    const [bankSum, bankCount] = await Promise.all([
      this.prisma.treasuryEntry.aggregate({
        where: bankWhere,
        _sum: { commission: true },
      }),
      this.prisma.treasuryEntry.count({ where: bankWhere }),
    ]);

    const totalBankFees = Number(bankSum._sum.commission ?? 0);
    const totalSpend = totalOperating + totalCommissions + totalBankFees;

    const categorySummary = Object.entries(byCategory)
      .filter(([cat]) => cat !== OperatingExpenseCategory.BANK_FEES)
      .map(([cat, data]) => ({
        category: cat,
        total: data.total.toFixed(2),
        count: data.count,
        percentage: totalSpend > 0 ? ((data.total / totalSpend) * 100).toFixed(1) : '0.0',
        isCommission: cat === OperatingExpenseCategory.COMMISSIONS,
        sourceLabel: undefined as string | undefined,
      }));

    // Residual OpEx BANK_FEES (should be 0 after internet reclass) fold into operating bars.
    const residualBankFees = byCategory[OperatingExpenseCategory.BANK_FEES];
    if (residualBankFees && residualBankFees.total > 0) {
      categorySummary.push({
        category: OperatingExpenseCategory.BANK_FEES,
        total: residualBankFees.total.toFixed(2),
        count: residualBankFees.count,
        percentage:
          totalSpend > 0 ? ((residualBankFees.total / totalSpend) * 100).toFixed(1) : '0.0',
        isCommission: false,
        sourceLabel: undefined,
      });
    }

    // Synthetic Bancos row from Treasury structured commissions.
    if (bankCount > 0 || totalBankFees > 0) {
      categorySummary.push({
        category: 'TREASURY_BANK_COMMISSIONS',
        total: totalBankFees.toFixed(2),
        count: bankCount,
        percentage: totalSpend > 0 ? ((totalBankFees / totalSpend) * 100).toFixed(1) : '0.0',
        isCommission: true,
        sourceLabel: 'Fuente: Control Bancos',
      });
    }

    categorySummary.sort((a, b) => Number(b.total) - Number(a.total));

    const biggestCategory =
      categorySummary.length > 0 ? categorySummary[0].category : null;

    return {
      totalOperatingExpenses: totalOperating.toFixed(2),
      totalCommissions: totalCommissions.toFixed(2),
      totalBankFees: totalBankFees.toFixed(2),
      bankCommissionsAllTime: totalBankFees.toFixed(2),
      bankCommissionMovementCountAllTime: bankCount,
      totalSpend: totalSpend.toFixed(2),
      expenseCount: rows.length,
      biggestCategory,
      byCategory: categorySummary,
    };
  }

  private buildTreasuryDateFilter(
    query: ListExpensesDto,
  ): { gte?: Date; lte?: Date } | undefined {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    let has = false;

    if (query.startDate) {
      dateFilter.gte = new Date(query.startDate);
      has = true;
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = end;
      has = true;
    }

    if (query.year && !query.startDate && !query.endDate) {
      const y = parseInt(query.year, 10);
      const m = query.month ? parseInt(query.month, 10) - 1 : null;
      const d = query.day ? parseInt(query.day, 10) : null;

      if (d !== null && m !== null) {
        dateFilter.gte = new Date(Date.UTC(y, m, d));
        dateFilter.lte = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
      } else if (m !== null) {
        dateFilter.gte = new Date(Date.UTC(y, m, 1));
        dateFilter.lte = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      } else {
        dateFilter.gte = new Date(Date.UTC(y, 0, 1));
        dateFilter.lte = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
      }
      has = true;
    }

    return has ? dateFilter : undefined;
  }

  private buildWhere(tenantId: string, query: ListExpensesDto): Prisma.OperatingExpenseWhereInput {
    const where: Prisma.OperatingExpenseWhereInput = { tenantId };

    if (query.category) {
      where.category = query.category;
    }

    const dateFilter: Prisma.DateTimeFilter<'OperatingExpense'> = {};
    let hasDateFilter = false;

    if (query.startDate) {
      dateFilter.gte = new Date(query.startDate);
      hasDateFilter = true;
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = end;
      hasDateFilter = true;
    }

    if (query.year && !query.startDate && !query.endDate) {
      const y = parseInt(query.year, 10);
      const m = query.month ? parseInt(query.month, 10) - 1 : null;
      const d = query.day ? parseInt(query.day, 10) : null;

      if (d !== null && m !== null) {
        dateFilter.gte = new Date(Date.UTC(y, m, d));
        dateFilter.lte = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
      } else if (m !== null) {
        dateFilter.gte = new Date(Date.UTC(y, m, 1));
        dateFilter.lte = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      } else {
        dateFilter.gte = new Date(Date.UTC(y, 0, 1));
        dateFilter.lte = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
      }
      hasDateFilter = true;
    }

    if (hasDateFilter) {
      where.expenseDate = dateFilter;
    }

    return where;
  }

  private serialize(expense: OperatingExpense) {
    return {
      id: expense.id,
      tenantId: expense.tenantId,
      category: expense.category,
      amount: expense.amount.toString(),
      notes: expense.notes,
      expenseDate: expense.expenseDate.toISOString().split('T')[0],
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString(),
    };
  }
}
