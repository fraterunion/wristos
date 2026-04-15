import { Injectable, NotFoundException } from '@nestjs/common';
import { AutomationRule, AutomationRuleType, AutomationRunStatus, DealStage, PaymentStatus, Prisma, WatchStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';

type AutomationRunOutput = {
  staleDeals: Array<{ id: string; stage: DealStage; updatedAt: string; daysSinceUpdate: number }>;
  overduePayments: Array<{ id: string; dealId: string; amount: string; dueDate: string }>;
  agingInventory: Array<{ id: string; brand: string; model: string; status: WatchStatus; createdAt: string; ageDays: number }>;
  summary: {
    staleDealsCount: number;
    overduePaymentsCount: number;
    agingInventoryCount: number;
  };
};

@Injectable()
export class AutomationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRule(tenantId: string, dto: CreateAutomationRuleDto) {
    const rule = await this.prisma.automationRule.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type: dto.type,
        },
      },
      create: {
        tenant: { connect: { id: tenantId } },
        type: dto.type,
        thresholdDays: dto.thresholdDays,
        isEnabled: dto.isEnabled ?? true,
      },
      update: {
        thresholdDays: dto.thresholdDays,
        isEnabled: dto.isEnabled ?? true,
      },
    });

    return this.serializeRule(rule);
  }

  async listRules(tenantId: string) {
    const rules = await this.prisma.automationRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    return rules.map((rule) => this.serializeRule(rule));
  }

  async updateRule(id: string, tenantId: string, dto: UpdateAutomationRuleDto) {
    const existing = await this.prisma.automationRule.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Automation rule not found');
    }

    const data: Prisma.AutomationRuleUpdateInput = {};
    if (dto.thresholdDays !== undefined) data.thresholdDays = dto.thresholdDays;
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;

    if (Object.keys(data).length === 0) {
      return this.serializeRule(existing);
    }

    const rule = await this.prisma.automationRule.update({
      where: { id },
      data,
    });

    return this.serializeRule(rule);
  }

  async run(tenantId: string): Promise<AutomationRunOutput> {
    const rules = await this.prisma.automationRule.findMany({
      where: { tenantId, isEnabled: true },
      orderBy: { createdAt: 'asc' },
    });

    const result: AutomationRunOutput = {
      staleDeals: [],
      overduePayments: [],
      agingInventory: [],
      summary: {
        staleDealsCount: 0,
        overduePaymentsCount: 0,
        agingInventoryCount: 0,
      },
    };

    for (const rule of rules) {
      try {
        if (rule.type === AutomationRuleType.STALE_DEAL) {
          const rows = await this.detectStaleDeals(tenantId, rule.thresholdDays);
          result.staleDeals = rows;
          result.summary.staleDealsCount = rows.length;
          await this.persistRun(rule, AutomationRunStatus.SUCCESS, rows.length);
          continue;
        }

        if (rule.type === AutomationRuleType.OVERDUE_PAYMENT) {
          const rows = await this.detectOverduePayments(tenantId, rule.thresholdDays);
          result.overduePayments = rows;
          result.summary.overduePaymentsCount = rows.length;
          await this.persistRun(rule, AutomationRunStatus.SUCCESS, rows.length);
          continue;
        }

        const rows = await this.detectAgingInventory(tenantId, rule.thresholdDays);
        result.agingInventory = rows;
        result.summary.agingInventoryCount = rows.length;
        await this.persistRun(rule, AutomationRunStatus.SUCCESS, rows.length);
      } catch (error) {
        await this.persistRun(
          rule,
          AutomationRunStatus.ERROR,
          0,
          error instanceof Error ? error.message : 'Unknown automation error',
        );
      }
    }

    return result;
  }

  private async detectStaleDeals(tenantId: string, thresholdDays: number) {
    const cutoff = this.daysAgo(thresholdDays);
    const openStages: DealStage[] = [
      DealStage.LEAD,
      DealStage.INTERESTED,
      DealStage.NEGOTIATING,
      DealStage.PENDING_PAYMENT,
    ];

    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: { in: openStages },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        stage: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
    });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return deals.map((deal) => ({
      id: deal.id,
      stage: deal.stage,
      updatedAt: deal.updatedAt.toISOString(),
      daysSinceUpdate: Math.floor((now - deal.updatedAt.getTime()) / dayMs),
    }));
  }

  private async detectOverduePayments(tenantId: string, _thresholdDays: number) {
    const now = new Date();
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: PaymentStatus.PENDING,
        dueDate: { not: null, lt: now },
      },
      select: {
        id: true,
        dealId: true,
        amount: true,
        dueDate: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    return payments.map((payment) => ({
      id: payment.id,
      dealId: payment.dealId,
      amount: payment.amount.toString(),
      dueDate: payment.dueDate!.toISOString(),
    }));
  }

  private async detectAgingInventory(tenantId: string, thresholdDays: number) {
    const cutoff = this.daysAgo(thresholdDays);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const watches = await this.prisma.watch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { not: WatchStatus.SOLD },
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        brand: true,
        model: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return watches.map((watch) => ({
      id: watch.id,
      brand: watch.brand,
      model: watch.model,
      status: watch.status,
      createdAt: watch.createdAt.toISOString(),
      ageDays: Math.floor((now - watch.createdAt.getTime()) / dayMs),
    }));
  }

  private async persistRun(
    rule: AutomationRule,
    status: AutomationRunStatus,
    resultCount: number,
    errorMessage?: string,
  ) {
    await this.prisma.automationRun.create({
      data: {
        tenant: { connect: { id: rule.tenantId } },
        rule: { connect: { id: rule.id } },
        status,
        resultCount,
        errorMessage: errorMessage ?? null,
      },
    });
  }

  private daysAgo(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  private serializeRule(rule: AutomationRule) {
    return {
      id: rule.id,
      tenantId: rule.tenantId,
      type: rule.type,
      isEnabled: rule.isEnabled,
      thresholdDays: rule.thresholdDays,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}
