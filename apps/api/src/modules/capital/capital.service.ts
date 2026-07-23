import { Injectable, NotFoundException } from '@nestjs/common';
import { CapitalAccount, DealStage, OperatingExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContributionDto } from './dto/create-contribution.dto';
import { CreateDistributionDto } from './dto/create-distribution.dto';
import { CreateInvestorDto } from './dto/create-investor.dto';
import { UpdateContributionDto } from './dto/update-contribution.dto';
import { UpdateDistributionDto } from './dto/update-distribution.dto';
import { UpdateInvestorDto } from './dto/update-investor.dto';

type InvestorWithBalances = {
  id: string;
  tenantId: string;
  name: string;
  ownershipPercent: Prisma.Decimal;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  contributions: { amount: Prisma.Decimal }[];
  distributions: { amount: Prisma.Decimal }[];
};

type ContributionWithInvestor = {
  id: string;
  tenantId: string;
  investorId: string;
  amount: Prisma.Decimal;
  account: CapitalAccount;
  notes: string | null;
  contributedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  investor: { name: string };
};

type DistributionWithInvestor = {
  id: string;
  tenantId: string;
  investorId: string;
  amount: Prisma.Decimal;
  account: CapitalAccount;
  notes: string | null;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
  investor: { name: string };
};

@Injectable()
export class CapitalService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Summary ─────────────────────────────────────────────────────────────────

  async getSummary(tenantId: string) {
    const [soldDeals, bankFeeAgg, investors] = await Promise.all([
      this.prisma.deal.findMany({
        where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON },
        select: {
          agreedPrice: true,
          watch: { select: { cost: true, expenses: { select: { amount: true } } } },
        },
      }),
      this.prisma.operatingExpense.aggregate({
        where: { tenantId, category: OperatingExpenseCategory.BANK_FEES },
        _sum: { amount: true },
      }),
      this.prisma.investor.findMany({
        where: { tenantId, deletedAt: null },
        include: {
          contributions: { where: { deletedAt: null }, select: { amount: true } },
          distributions: { where: { deletedAt: null }, select: { amount: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalRevenue = soldDeals.reduce(
      (sum, d) => sum.plus(d.agreedPrice),
      new Prisma.Decimal(0),
    );
    const totalCostOfSold = soldDeals.reduce((sum, d) => {
      const expSum = d.watch.expenses.reduce(
        (s, e) => s.plus(e.amount),
        new Prisma.Decimal(0),
      );
      return sum.plus(d.watch.cost ?? 0).plus(expSum);
    }, new Prisma.Decimal(0));
    const totalBankFees = bankFeeAgg._sum.amount ?? new Prisma.Decimal(0);
    const totalBusinessProfit = totalRevenue.minus(totalCostOfSold).minus(totalBankFees);

    let totalCapitalContributed = new Prisma.Decimal(0);
    let totalDistributionsPaid = new Prisma.Decimal(0);
    let totalPendingToPartners = new Prisma.Decimal(0);

    const investorRows = investors.map((investor) => {
      const capitalContributed = investor.contributions.reduce(
        (sum, c) => sum.plus(c.amount),
        new Prisma.Decimal(0),
      );
      const distributionsPaid = investor.distributions.reduce(
        (sum, d) => sum.plus(d.amount),
        new Prisma.Decimal(0),
      );
      const profitEntitlement = totalBusinessProfit
        .times(investor.ownershipPercent)
        .dividedBy(100);
      const pendingProfit = profitEntitlement.minus(distributionsPaid);

      totalCapitalContributed = totalCapitalContributed.plus(capitalContributed);
      totalDistributionsPaid = totalDistributionsPaid.plus(distributionsPaid);
      totalPendingToPartners = totalPendingToPartners.plus(pendingProfit);

      return {
        id: investor.id,
        name: investor.name,
        ownershipPercent: investor.ownershipPercent.toString(),
        isActive: investor.isActive,
        capitalContributed: capitalContributed.toFixed(2),
        profitEntitlement: profitEntitlement.toFixed(2),
        distributionsPaid: distributionsPaid.toFixed(2),
        pendingProfit: pendingProfit.toFixed(2),
      };
    });

    const capitalNeto = totalCapitalContributed
      .plus(totalBusinessProfit)
      .minus(totalDistributionsPaid);

    return {
      totalCapitalContributed: totalCapitalContributed.toFixed(2),
      totalBusinessProfit: totalBusinessProfit.toFixed(2),
      totalDistributionsPaid: totalDistributionsPaid.toFixed(2),
      totalPendingToPartners: totalPendingToPartners.toFixed(2),
      capitalNeto: capitalNeto.toFixed(2),
      investors: investorRows,
    };
  }

  async getAnnualBreakdown(tenantId: string, year: number) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    const [soldDeals, bankFees, distributions, investors] = await Promise.all([
      this.prisma.deal.findMany({
        where: {
          tenantId,
          deletedAt: null,
          stage: DealStage.CLOSED_WON,
          updatedAt: { gte: yearStart, lt: yearEnd },
        },
        select: {
          agreedPrice: true,
          updatedAt: true,
          watch: { select: { cost: true, expenses: { select: { amount: true } } } },
        },
      }),
      this.prisma.operatingExpense.findMany({
        where: {
          tenantId,
          category: OperatingExpenseCategory.BANK_FEES,
          expenseDate: { gte: yearStart, lt: yearEnd },
        },
        select: { amount: true, expenseDate: true },
      }),
      this.prisma.investorDistribution.findMany({
        where: {
          tenantId,
          deletedAt: null,
          paidAt: { gte: yearStart, lt: yearEnd },
        },
        select: { investorId: true, amount: true, paidAt: true },
      }),
      this.prisma.investor.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, ownershipPercent: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    type MonthBucket = {
      revenue: Prisma.Decimal;
      costOfSold: Prisma.Decimal;
      bankFees: Prisma.Decimal;
      distributionsByInvestor: Map<string, Prisma.Decimal>;
      totalDistributionsPaid: Prisma.Decimal;
    };

    const buckets: MonthBucket[] = Array.from({ length: 12 }, () => ({
      revenue: new Prisma.Decimal(0),
      costOfSold: new Prisma.Decimal(0),
      bankFees: new Prisma.Decimal(0),
      distributionsByInvestor: new Map<string, Prisma.Decimal>(),
      totalDistributionsPaid: new Prisma.Decimal(0),
    }));

    for (const deal of soldDeals) {
      const monthIdx = deal.updatedAt.getUTCMonth();
      buckets[monthIdx].revenue = buckets[monthIdx].revenue.plus(deal.agreedPrice);
      const expSum = deal.watch.expenses.reduce(
        (s, e) => s.plus(e.amount),
        new Prisma.Decimal(0),
      );
      buckets[monthIdx].costOfSold = buckets[monthIdx].costOfSold
        .plus(deal.watch.cost ?? 0)
        .plus(expSum);
    }

    for (const fee of bankFees) {
      const monthIdx = fee.expenseDate.getUTCMonth();
      buckets[monthIdx].bankFees = buckets[monthIdx].bankFees.plus(fee.amount);
    }

    for (const distribution of distributions) {
      const monthIdx = distribution.paidAt.getUTCMonth();
      const bucket = buckets[monthIdx];
      bucket.totalDistributionsPaid = bucket.totalDistributionsPaid.plus(distribution.amount);
      const current =
        bucket.distributionsByInvestor.get(distribution.investorId) ?? new Prisma.Decimal(0);
      bucket.distributionsByInvestor.set(
        distribution.investorId,
        current.plus(distribution.amount),
      );
    }

    const months = buckets.map((bucket, idx) => {
      const businessProfit = bucket.revenue.minus(bucket.costOfSold).minus(bucket.bankFees);
      let totalPendingToPartners = new Prisma.Decimal(0);

      const investorRows = investors.map((investor) => {
        const profitEntitlement = businessProfit
          .times(investor.ownershipPercent)
          .dividedBy(100);
        const distributionsPaid =
          bucket.distributionsByInvestor.get(investor.id) ?? new Prisma.Decimal(0);
        const pendingProfit = profitEntitlement.minus(distributionsPaid);
        totalPendingToPartners = totalPendingToPartners.plus(pendingProfit);

        return {
          id: investor.id,
          name: investor.name,
          ownershipPercent: investor.ownershipPercent.toFixed(2),
          profitEntitlement: profitEntitlement.toFixed(2),
          distributionsPaid: distributionsPaid.toFixed(2),
          pendingProfit: pendingProfit.toFixed(2),
        };
      });

      return {
        month: idx + 1,
        revenue: bucket.revenue.toFixed(2),
        costOfSold: bucket.costOfSold.toFixed(2),
        bankFees: bucket.bankFees.toFixed(2),
        businessProfit: businessProfit.toFixed(2),
        totalDistributionsPaid: bucket.totalDistributionsPaid.toFixed(2),
        totalPendingToPartners: totalPendingToPartners.toFixed(2),
        investors: investorRows,
      };
    });

    return { year, months };
  }

  // ─── Investors ────────────────────────────────────────────────────────────────

  async listInvestors(tenantId: string) {
    const [investors, totalBusinessProfit] = await Promise.all([
      this.prisma.investor.findMany({
        where: { tenantId, deletedAt: null },
        include: {
          contributions: { where: { deletedAt: null }, select: { amount: true } },
          distributions: { where: { deletedAt: null }, select: { amount: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.computeBusinessProfit(tenantId),
    ]);
    return investors.map((inv) => this.serializeInvestor(inv, totalBusinessProfit));
  }

  async createInvestor(tenantId: string, dto: CreateInvestorDto) {
    const investor = await this.prisma.investor.create({
      data: {
        tenant: { connect: { id: tenantId } },
        name: dto.name,
        ownershipPercent: new Prisma.Decimal(dto.ownershipPercent),
        notes: dto.notes ?? null,
      },
      include: {
        contributions: { where: { deletedAt: null }, select: { amount: true } },
        distributions: { where: { deletedAt: null }, select: { amount: true } },
      },
    });
    const totalBusinessProfit = await this.computeBusinessProfit(tenantId);
    return this.serializeInvestor(investor, totalBusinessProfit);
  }

  async updateInvestor(id: string, tenantId: string, dto: UpdateInvestorDto) {
    await this.findInvestorOrThrow(id, tenantId);
    const investor = await this.prisma.investor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.ownershipPercent !== undefined && {
          ownershipPercent: new Prisma.Decimal(dto.ownershipPercent),
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        contributions: { where: { deletedAt: null }, select: { amount: true } },
        distributions: { where: { deletedAt: null }, select: { amount: true } },
      },
    });
    const totalBusinessProfit = await this.computeBusinessProfit(tenantId);
    return this.serializeInvestor(investor, totalBusinessProfit);
  }

  // ─── Contributions ────────────────────────────────────────────────────────────

  async listContributions(
    tenantId: string,
    investorId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const where: Prisma.InvestorContributionWhereInput = { tenantId, deletedAt: null };
    if (investorId) where.investorId = investorId;
    if (startDate || endDate) {
      const filter: Prisma.DateTimeFilter = {};
      if (startDate) filter.gte = new Date(startDate);
      if (endDate) filter.lte = new Date(endDate);
      where.contributedAt = filter;
    }
    const contributions = await this.prisma.investorContribution.findMany({
      where,
      include: { investor: { select: { name: true } } },
      orderBy: { contributedAt: 'desc' },
    });
    return contributions.map((c) => this.serializeContribution(c));
  }

  async createContribution(tenantId: string, dto: CreateContributionDto) {
    await this.findInvestorOrThrow(dto.investorId, tenantId);
    const contribution = await this.prisma.investorContribution.create({
      data: {
        tenant: { connect: { id: tenantId } },
        investor: { connect: { id: dto.investorId } },
        amount: new Prisma.Decimal(dto.amount),
        account: dto.account,
        notes: dto.notes ?? null,
        contributedAt: new Date(dto.contributedAt),
      },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeContribution(contribution);
  }

  async updateContribution(id: string, tenantId: string, dto: UpdateContributionDto) {
    await this.findContributionOrThrow(id, tenantId);
    const contribution = await this.prisma.investorContribution.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.account !== undefined && { account: dto.account }),
        ...(dto.contributedAt !== undefined && { contributedAt: new Date(dto.contributedAt) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeContribution(contribution);
  }

  async removeContribution(id: string, tenantId: string) {
    await this.findContributionOrThrow(id, tenantId);
    await this.prisma.investorContribution.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Distributions ────────────────────────────────────────────────────────────

  async listDistributions(
    tenantId: string,
    investorId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const where: Prisma.InvestorDistributionWhereInput = { tenantId, deletedAt: null };
    if (investorId) where.investorId = investorId;
    if (startDate || endDate) {
      const filter: Prisma.DateTimeFilter = {};
      if (startDate) filter.gte = new Date(startDate);
      if (endDate) filter.lte = new Date(endDate);
      where.paidAt = filter;
    }
    const distributions = await this.prisma.investorDistribution.findMany({
      where,
      include: { investor: { select: { name: true } } },
      orderBy: { paidAt: 'desc' },
    });
    return distributions.map((d) => this.serializeDistribution(d));
  }

  async createDistribution(tenantId: string, dto: CreateDistributionDto) {
    await this.findInvestorOrThrow(dto.investorId, tenantId);
    const distribution = await this.prisma.investorDistribution.create({
      data: {
        tenant: { connect: { id: tenantId } },
        investor: { connect: { id: dto.investorId } },
        amount: new Prisma.Decimal(dto.amount),
        account: dto.account,
        notes: dto.notes ?? null,
        paidAt: new Date(dto.paidAt),
      },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeDistribution(distribution);
  }

  async updateDistribution(id: string, tenantId: string, dto: UpdateDistributionDto) {
    await this.findDistributionOrThrow(id, tenantId);
    const distribution = await this.prisma.investorDistribution.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.account !== undefined && { account: dto.account }),
        ...(dto.paidAt !== undefined && { paidAt: new Date(dto.paidAt) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeDistribution(distribution);
  }

  async removeDistribution(id: string, tenantId: string) {
    await this.findDistributionOrThrow(id, tenantId);
    await this.prisma.investorDistribution.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async findInvestorOrThrow(id: string, tenantId: string) {
    const investor = await this.prisma.investor.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!investor) throw new NotFoundException('Investor not found');
    return investor;
  }

  private async findContributionOrThrow(id: string, tenantId: string) {
    const contribution = await this.prisma.investorContribution.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!contribution) throw new NotFoundException('Contribution not found');
    return contribution;
  }

  private async findDistributionOrThrow(id: string, tenantId: string) {
    const distribution = await this.prisma.investorDistribution.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!distribution) throw new NotFoundException('Distribution not found');
    return distribution;
  }

  private async computeBusinessProfit(tenantId: string): Promise<Prisma.Decimal> {
    const [soldDeals, bankFeeAgg] = await Promise.all([
      this.prisma.deal.findMany({
        where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON },
        select: {
          agreedPrice: true,
          watch: { select: { cost: true, expenses: { select: { amount: true } } } },
        },
      }),
      this.prisma.operatingExpense.aggregate({
        where: { tenantId, category: OperatingExpenseCategory.BANK_FEES },
        _sum: { amount: true },
      }),
    ]);
    const totalRevenue = soldDeals.reduce(
      (sum, d) => sum.plus(d.agreedPrice),
      new Prisma.Decimal(0),
    );
    const totalCostOfSold = soldDeals.reduce((sum, d) => {
      const expSum = d.watch.expenses.reduce(
        (s, e) => s.plus(e.amount),
        new Prisma.Decimal(0),
      );
      return sum.plus(d.watch.cost ?? 0).plus(expSum);
    }, new Prisma.Decimal(0));
    const totalBankFees = bankFeeAgg._sum.amount ?? new Prisma.Decimal(0);
    return totalRevenue.minus(totalCostOfSold).minus(totalBankFees);
  }

  private serializeInvestor(investor: InvestorWithBalances, totalBusinessProfit: Prisma.Decimal) {
    const capitalContributed = investor.contributions.reduce(
      (sum, c) => sum.plus(c.amount),
      new Prisma.Decimal(0),
    );
    const distributionsPaid = investor.distributions.reduce(
      (sum, d) => sum.plus(d.amount),
      new Prisma.Decimal(0),
    );
    const profitEntitlement = totalBusinessProfit
      .times(investor.ownershipPercent)
      .dividedBy(100);
    const pendingProfit = profitEntitlement.minus(distributionsPaid);

    return {
      id: investor.id,
      name: investor.name,
      ownershipPercent: investor.ownershipPercent.toString(),
      isActive: investor.isActive,
      notes: investor.notes,
      capitalContributed: capitalContributed.toFixed(2),
      profitEntitlement: profitEntitlement.toFixed(2),
      distributionsPaid: distributionsPaid.toFixed(2),
      pendingProfit: pendingProfit.toFixed(2),
      createdAt: investor.createdAt.toISOString(),
      updatedAt: investor.updatedAt.toISOString(),
    };
  }

  private serializeContribution(contribution: ContributionWithInvestor) {
    return {
      id: contribution.id,
      tenantId: contribution.tenantId,
      investorId: contribution.investorId,
      investorName: contribution.investor.name,
      amount: contribution.amount.toFixed(2),
      account: contribution.account,
      notes: contribution.notes ?? null,
      contributedAt: contribution.contributedAt.toISOString(),
      createdAt: contribution.createdAt.toISOString(),
      updatedAt: contribution.updatedAt.toISOString(),
    };
  }

  private serializeDistribution(distribution: DistributionWithInvestor) {
    return {
      id: distribution.id,
      tenantId: distribution.tenantId,
      investorId: distribution.investorId,
      investorName: distribution.investor.name,
      amount: distribution.amount.toFixed(2),
      account: distribution.account,
      notes: distribution.notes ?? null,
      paidAt: distribution.paidAt.toISOString(),
      createdAt: distribution.createdAt.toISOString(),
      updatedAt: distribution.updatedAt.toISOString(),
    };
  }
}
