import { Injectable, NotFoundException } from '@nestjs/common';
import { CapitalAccount, DealStage, Prisma } from '@prisma/client';
import {
  dealEffectiveSaleDateRangeWhere,
  effectiveSaleDate,
} from '../../common/utils/effective-sale-date';
import { PrismaService } from '../../prisma/prisma.service';
import { CapitalContributionService, capitalContributionImmutableConflict } from './capital-contribution.service';
import { CapitalDistributionService, capitalDistributionImmutableConflict } from './capital-distribution.service';
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
  openingBalances: { amount: Prisma.Decimal; effectiveDate: Date; source: string; notes: string | null }[];
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly capitalContribution: CapitalContributionService,
    private readonly capitalDistribution: CapitalDistributionService,
  ) {}

  // ─── Summary ─────────────────────────────────────────────────────────────────

  async getSummary(tenantId: string) {
    const [soldDeals, bankCommissionAgg, investors] = await Promise.all([
      this.prisma.deal.findMany({
        where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON },
        select: {
          agreedPrice: true,
          historicalCost: true,
          watch: { select: { cost: true, expenses: { select: { amount: true } } } },
        },
      }),
      // All-time structured bank commissions (same all-time scope as revenue/COGS).
      this.prisma.treasuryEntry.aggregate({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
        },
        _sum: { commission: true },
      }),
      this.prisma.investor.findMany({
        where: { tenantId, deletedAt: null },
        include: {
          contributions: { where: { deletedAt: null }, select: { amount: true } },
          distributions: { where: { deletedAt: null }, select: { amount: true } },
          openingBalances: {
            where: { deletedAt: null },
            select: { amount: true, effectiveDate: true, source: true, notes: true },
            orderBy: { effectiveDate: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalRevenue = soldDeals.reduce(
      (sum, d) => sum.plus(d.agreedPrice),
      new Prisma.Decimal(0),
    );
    const totalCostOfSold = soldDeals.reduce((sum, d) => {
      if (!d.watch) {
        return sum.plus(d.historicalCost ?? 0);
      }
      const expSum = d.watch.expenses.reduce(
        (s, e) => s.plus(e.amount),
        new Prisma.Decimal(0),
      );
      return sum.plus(d.watch.cost ?? 0).plus(expSum);
    }, new Prisma.Decimal(0));
    const totalBankFees = bankCommissionAgg._sum.commission ?? new Prisma.Decimal(0);
    // BUSINESS PROFIT (Capital module — Commit 15A financial gate):
    //   revenue − COGS − Treasury bank commissions
    // Intentionally DOES NOT subtract OperatingExpense (Gastos).
    // Analytics monthly net profit DOES subtract OpEx.
    // Correcting Capital to include OpEx would retroactively change partner
    // entitlement vs already-paid distributions (Wrist Caviar ~MXN 3.08M OpEx).
    // Do not change this formula without an explicit Capital reconciliation decision.
    // See docs/ai/REGISTER_EXPENSE_BINDING.md § Capital / OpEx gate.
    const totalBusinessProfit = totalRevenue.minus(totalCostOfSold).minus(totalBankFees);

    let totalOpeningCapital = new Prisma.Decimal(0);
    let totalLaterContributions = new Prisma.Decimal(0);
    let totalCapitalContributed = new Prisma.Decimal(0);
    let totalDistributionsPaid = new Prisma.Decimal(0);
    let totalPendingToPartners = new Prisma.Decimal(0);
    const openingBalanceRows: Array<{
      investorId: string;
      investorName: string;
      amount: string;
      currency: 'MXN';
      effectiveDate: string;
      source: string;
      notes: string | null;
    }> = [];

    const investorRows = investors.map((investor) => {
      const openingCapital = investor.openingBalances.reduce(
        (sum, row) => sum.plus(row.amount),
        new Prisma.Decimal(0),
      );
      const laterContributions = investor.contributions.reduce(
        (sum, c) => sum.plus(c.amount),
        new Prisma.Decimal(0),
      );
      // Invested capital = opening balances + later contributions (withdrawals would subtract if modeled).
      const capitalContributed = openingCapital.plus(laterContributions);
      const distributionsPaid = investor.distributions.reduce(
        (sum, d) => sum.plus(d.amount),
        new Prisma.Decimal(0),
      );
      const profitEntitlement = totalBusinessProfit
        .times(investor.ownershipPercent)
        .dividedBy(100);
      // Por pagar socios = profit entitlement only (never opening capital).
      const pendingProfit = profitEntitlement.minus(distributionsPaid);

      totalOpeningCapital = totalOpeningCapital.plus(openingCapital);
      totalLaterContributions = totalLaterContributions.plus(laterContributions);
      totalCapitalContributed = totalCapitalContributed.plus(capitalContributed);
      totalDistributionsPaid = totalDistributionsPaid.plus(distributionsPaid);
      totalPendingToPartners = totalPendingToPartners.plus(pendingProfit);

      for (const row of investor.openingBalances) {
        openingBalanceRows.push({
          investorId: investor.id,
          investorName: investor.name,
          amount: row.amount.toFixed(2),
          currency: 'MXN',
          effectiveDate: row.effectiveDate.toISOString(),
          source: row.source,
          notes: row.notes,
        });
      }

      return {
        id: investor.id,
        name: investor.name,
        ownershipPercent: investor.ownershipPercent.toString(),
        isActive: investor.isActive,
        openingCapital: openingCapital.toFixed(2),
        laterContributions: laterContributions.toFixed(2),
        capitalContributed: capitalContributed.toFixed(2),
        profitEntitlement: profitEntitlement.toFixed(2),
        distributionsPaid: distributionsPaid.toFixed(2),
        pendingProfit: pendingProfit.toFixed(2),
      };
    });

    const capitalNeto = totalCapitalContributed
      .plus(totalBusinessProfit)
      .minus(totalDistributionsPaid);

    const contributionsIncomplete = totalCapitalContributed.lte(0);

    return {
      totalOpeningCapital: totalOpeningCapital.toFixed(2),
      totalLaterContributions: totalLaterContributions.toFixed(2),
      totalCapitalContributed: totalCapitalContributed.toFixed(2),
      totalBusinessProfit: totalBusinessProfit.toFixed(2),
      totalBankCommissions: totalBankFees.toFixed(2),
      totalDistributionsPaid: totalDistributionsPaid.toFixed(2),
      totalPendingToPartners: totalPendingToPartners.toFixed(2),
      capitalNeto: capitalNeto.toFixed(2),
      contributionsIncomplete,
      roiAvailable: !contributionsIncomplete,
      openingBalances: openingBalanceRows,
      investors: investorRows,
    };
  }

  async getAnnualBreakdown(tenantId: string, year: number) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    const [soldDeals, bankCommissions, distributions, investors] = await Promise.all([
      this.prisma.deal.findMany({
        where: {
          tenantId,
          deletedAt: null,
          stage: DealStage.CLOSED_WON,
          AND: [dealEffectiveSaleDateRangeWhere(yearStart, yearEnd)],
        },
        select: {
          agreedPrice: true,
          soldAt: true,
          updatedAt: true,
          createdAt: true,
          historicalCost: true,
          watch: { select: { cost: true, expenses: { select: { amount: true } } } },
        },
      }),
      this.prisma.treasuryEntry.findMany({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
          transactionDate: { gte: yearStart, lt: yearEnd },
        },
        select: { commission: true, transactionDate: true },
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
      const monthIdx = effectiveSaleDate(deal).getUTCMonth();
      buckets[monthIdx].revenue = buckets[monthIdx].revenue.plus(deal.agreedPrice);
      if (!deal.watch) {
        buckets[monthIdx].costOfSold = buckets[monthIdx].costOfSold.plus(
          deal.historicalCost ?? 0,
        );
      } else {
        const expSum = deal.watch.expenses.reduce(
          (s, e) => s.plus(e.amount),
          new Prisma.Decimal(0),
        );
        buckets[monthIdx].costOfSold = buckets[monthIdx].costOfSold
          .plus(deal.watch.cost ?? 0)
          .plus(expSum);
      }
    }

    for (const fee of bankCommissions) {
      const monthIdx = fee.transactionDate.getUTCMonth();
      buckets[monthIdx].bankFees = buckets[monthIdx].bankFees.plus(fee.commission ?? 0);
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
      // Annual month buckets use the same Capital definition (no OperatingExpense).
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

  private readonly investorBalanceInclude = {
    contributions: { where: { deletedAt: null }, select: { amount: true } },
    distributions: { where: { deletedAt: null }, select: { amount: true } },
    openingBalances: {
      where: { deletedAt: null },
      select: { amount: true, effectiveDate: true, source: true, notes: true },
      orderBy: { effectiveDate: 'asc' as const },
    },
  };

  async listInvestors(tenantId: string) {
    const [investors, totalBusinessProfit] = await Promise.all([
      this.prisma.investor.findMany({
        where: { tenantId, deletedAt: null },
        include: this.investorBalanceInclude,
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
      include: this.investorBalanceInclude,
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
      include: this.investorBalanceInclude,
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

  /**
   * Manual Capital aporte → canonical CapitalContributionService.register().
   * Partner equity ledger only — no Treasury write (V1 frozen semantics).
   */
  async createContribution(tenantId: string, dto: CreateContributionDto) {
    const { contribution } = await this.capitalContribution.register(tenantId, {
      investorId: dto.investorId,
      amount: dto.amount,
      account: dto.account,
      contributedAt: dto.contributedAt,
      notes: dto.notes ?? null,
      registerIdempotencyKey: dto.registerIdempotencyKey ?? null,
    });
    const withInvestor = await this.prisma.investorContribution.findFirstOrThrow({
      where: { id: contribution.id, tenantId },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeContribution(withInvestor);
  }

  /**
   * PATCH contribution — notes only (Commit 23B economic immutability).
   * Any amount/account/contributedAt attempt → CAPITAL_CONTRIBUTION_IMMUTABLE.
   */
  async updateContribution(id: string, tenantId: string, dto: UpdateContributionDto) {
    if (
      dto.amount !== undefined ||
      dto.account !== undefined ||
      dto.contributedAt !== undefined
    ) {
      throw capitalContributionImmutableConflict();
    }
    const { contribution } = await this.capitalContribution.updateNotes(tenantId, id, {
      notes: dto.notes,
      expectedUpdatedAt: dto.expectedUpdatedAt ?? null,
    });
    const withInvestor = await this.prisma.investorContribution.findFirstOrThrow({
      where: { id: contribution.id, tenantId },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeContribution(withInvestor);
  }

  async removeContribution(id: string, tenantId: string) {
    await this.capitalContribution.reverse(tenantId, id);
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

  /**
   * Manual Capital retiro → canonical CapitalDistributionService.register().
   * Partner distribution ledger only — no Treasury write (V1 frozen semantics).
   * Over-entitlement remains allowed (UI warning only).
   */
  async createDistribution(tenantId: string, dto: CreateDistributionDto) {
    const { distribution } = await this.capitalDistribution.register(tenantId, {
      investorId: dto.investorId,
      amount: dto.amount,
      account: dto.account,
      paidAt: dto.paidAt,
      notes: dto.notes ?? null,
      registerIdempotencyKey: dto.registerIdempotencyKey ?? null,
    });
    const withInvestor = await this.prisma.investorDistribution.findFirstOrThrow({
      where: { id: distribution.id, tenantId },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeDistribution(withInvestor);
  }

  /**
   * PATCH distribution — notes only (Commit 23B economic immutability).
   * Any amount/account/paidAt attempt → CAPITAL_DISTRIBUTION_IMMUTABLE.
   */
  async updateDistribution(id: string, tenantId: string, dto: UpdateDistributionDto) {
    if (dto.amount !== undefined || dto.account !== undefined || dto.paidAt !== undefined) {
      throw capitalDistributionImmutableConflict();
    }
    const { distribution } = await this.capitalDistribution.updateNotes(tenantId, id, {
      notes: dto.notes,
      expectedUpdatedAt: dto.expectedUpdatedAt ?? null,
    });
    const withInvestor = await this.prisma.investorDistribution.findFirstOrThrow({
      where: { id: distribution.id, tenantId },
      include: { investor: { select: { name: true } } },
    });
    return this.serializeDistribution(withInvestor);
  }

  async removeDistribution(id: string, tenantId: string) {
    await this.capitalDistribution.reverse(tenantId, id);
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
    const [soldDeals, bankCommissionAgg] = await Promise.all([
      this.prisma.deal.findMany({
        where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON },
        select: {
          agreedPrice: true,
          historicalCost: true,
          watch: { select: { cost: true, expenses: { select: { amount: true } } } },
        },
      }),
      this.prisma.treasuryEntry.aggregate({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
        },
        _sum: { commission: true },
      }),
    ]);
    const totalRevenue = soldDeals.reduce(
      (sum, d) => sum.plus(d.agreedPrice),
      new Prisma.Decimal(0),
    );
    const totalCostOfSold = soldDeals.reduce((sum, d) => {
      if (!d.watch) {
        return sum.plus(d.historicalCost ?? 0);
      }
      const expSum = d.watch.expenses.reduce(
        (s, e) => s.plus(e.amount),
        new Prisma.Decimal(0),
      );
      return sum.plus(d.watch.cost ?? 0).plus(expSum);
    }, new Prisma.Decimal(0));
    const totalBankFees = bankCommissionAgg._sum.commission ?? new Prisma.Decimal(0);
    // Same Capital business-profit definition as getSummary (excludes OperatingExpense).
    return totalRevenue.minus(totalCostOfSold).minus(totalBankFees);
  }

  private serializeInvestor(investor: InvestorWithBalances, totalBusinessProfit: Prisma.Decimal) {
    const openingBalances = investor.openingBalances ?? [];
    const openingCapital = openingBalances.reduce(
      (sum, row) => sum.plus(row.amount),
      new Prisma.Decimal(0),
    );
    const laterContributions = investor.contributions.reduce(
      (sum, c) => sum.plus(c.amount),
      new Prisma.Decimal(0),
    );
    const capitalContributed = openingCapital.plus(laterContributions);
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
      openingCapital: openingCapital.toFixed(2),
      laterContributions: laterContributions.toFixed(2),
      capitalContributed: capitalContributed.toFixed(2),
      profitEntitlement: profitEntitlement.toFixed(2),
      distributionsPaid: distributionsPaid.toFixed(2),
      pendingProfit: pendingProfit.toFixed(2),
      openingBalances: openingBalances.map((row) => ({
        amount: row.amount.toFixed(2),
        effectiveDate: row.effectiveDate.toISOString(),
        source: row.source,
        notes: row.notes,
      })),
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
