import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Deal,
  DealStage,
  Prisma,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { AddPaymentDto } from './dto/add-payment.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { ListDealsDto } from './dto/list-deals.dto';
import { RegisterSaleDto } from './dto/register-sale.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { UpdateDealStageDto } from './dto/update-deal-stage.dto';
import { SaleRegistrationService } from './sale-registration.service';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cuentasService: CuentasService,
    private readonly saleRegistration: SaleRegistrationService,
  ) {}

  async create(tenantId: string, dto: CreateDealDto) {
    await this.ensureClientInTenant(dto.clientId, tenantId);
    await this.ensureWatchInTenant(dto.watchId, tenantId);

    if (dto.stage === DealStage.CLOSED_WON) {
      await this.ensureNoOtherWonDealForWatch(dto.watchId, tenantId);
    }

    const deal = await this.prisma.deal.create({
      data: {
        tenant: { connect: { id: tenantId } },
        client: { connect: { id: dto.clientId } },
        watch: { connect: { id: dto.watchId } },
        stage: dto.stage ?? undefined,
        expectedCloseAt: dto.expectedCloseAt
          ? new Date(dto.expectedCloseAt)
          : undefined,
        agreedPrice: new Prisma.Decimal(dto.agreedPrice),
        notes: dto.notes,
      },
    });

    await this.syncReceivableSafe(deal.id, tenantId);

    return this.serializeDeal(deal);
  }

  async list(tenantId: string, query: ListDealsDto) {
    const where: Prisma.DealWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.stage !== undefined) {
      where.stage = query.stage;
    }
    if (query.clientId !== undefined && query.clientId.trim() !== '') {
      where.clientId = query.clientId.trim();
    }
    if (query.watchId !== undefined && query.watchId.trim() !== '') {
      where.watchId = query.watchId.trim();
    }

    const deals = await this.prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return deals.map((deal) => this.serializeDeal(deal));
  }

  async findOne(id: string, tenantId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    return this.serializeDeal(deal);
  }

  async update(id: string, tenantId: string, dto: UpdateDealDto) {
    const existing = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Deal not found');
    }

    const nextClientId = dto.clientId ?? existing.clientId;

    if (dto.clientId !== undefined) {
      await this.ensureClientInTenant(dto.clientId, tenantId);
    }
    if (dto.watchId !== undefined) {
      await this.ensureWatchInTenant(dto.watchId, tenantId);
    }

    const data: Prisma.DealUpdateInput = {};

    if (dto.clientId !== undefined) data.client = { connect: { id: nextClientId } };
    if (dto.watchId !== undefined) data.watch = { connect: { id: dto.watchId } };
    if (dto.expectedCloseAt !== undefined) {
      data.expectedCloseAt =
        dto.expectedCloseAt === null ? null : new Date(dto.expectedCloseAt);
    }
    if (dto.agreedPrice !== undefined) {
      data.agreedPrice = new Prisma.Decimal(dto.agreedPrice);
    }
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (Object.keys(data).length === 0) {
      return this.serializeDeal(existing);
    }

    // If deal is already won and watch changes, enforce uniqueness on new watch.
    if (
      existing.stage === DealStage.CLOSED_WON &&
      dto.watchId !== undefined &&
      dto.watchId !== existing.watchId
    ) {
      await this.ensureNoOtherWonDealForWatch(dto.watchId, tenantId, existing.id);
    }

    const deal = await this.prisma.deal.update({
      where: { id },
      data,
    });

    await this.syncReceivableSafe(deal.id, tenantId);

    return this.serializeDeal(deal);
  }

  async updateStage(id: string, tenantId: string, dto: UpdateDealStageDto) {
    const existing = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Deal not found');
    }

    if (dto.stage === DealStage.CLOSED_WON && existing.watchId) {
      await this.ensureNoOtherWonDealForWatch(
        existing.watchId,
        tenantId,
        existing.id,
      );
    }

    const deal = await this.prisma.deal.update({
      where: { id },
      data: { stage: dto.stage },
    });

    if (deal.watchId) {
      await this.syncWatchStatusFromDealStage({
        tenantId,
        dealId: deal.id,
        watchId: deal.watchId,
        nextStage: dto.stage,
      });
    }

    await this.syncReceivableSafe(deal.id, tenantId);

    return this.serializeDeal(deal);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Deal not found');
    }

    await this.prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.syncReceivableSafe(id, tenantId);
  }

  /**
   * Manual Ventas + future AI path — delegates to canonical SaleRegistrationService.
   * Response shape preserved for existing admin clients.
   */
  async registerSale(tenantId: string, dto: RegisterSaleDto) {
    const result = await this.saleRegistration.register(tenantId, {
      watchId: dto.watchId,
      clientId: dto.clientId,
      agreedPrice: dto.salePrice,
      currency: dto.currency,
      soldAt: dto.saleDate ? new Date(dto.saleDate) : undefined,
      notes: dto.notes,
      payment: {
        amountReceived: dto.initialPaymentAmount,
        method: dto.initialPaymentMethod ?? dto.paymentMethod ?? null,
        bankChannel: dto.bankChannel ?? null,
        paidAt: dto.initialPaymentDate
          ? new Date(dto.initialPaymentDate)
          : null,
      },
      legacyFullPaymentMethod:
        dto.paymentMethod && dto.initialPaymentAmount === undefined
          ? dto.paymentMethod
          : null,
      registerIdempotencyKey: dto.registerIdempotencyKey,
    });

    const deal = result.deal;
    const bankFeeDecimal = result.bankFeeAmount;

    return {
      id: deal.id,
      watchId: deal.watchId,
      clientId: deal.clientId,
      salePrice: deal.agreedPrice.toString(),
      originalCurrency: deal.originalCurrency,
      originalAmount: deal.originalAmount?.toString() ?? null,
      exchangeRate: deal.exchangeRate?.toString() ?? null,
      paymentMethod: result.payment?.method ?? null,
      bankChannel: result.bankChannel,
      bankFee: result.bankFee ? bankFeeDecimal.toString() : null,
      netReceived: result.canonicalMxn.minus(bankFeeDecimal).toString(),
      paidAt: result.payment?.paidAt?.toISOString() ?? null,
      paidTotal: result.paidTotal.toString(),
      pendingAmount: result.pendingAmount.toString(),
      computedStatus: result.computedStatus,
      notes: deal.notes,
      createdAt: deal.createdAt.toISOString(),
      registerIdempotencyKey: deal.registerIdempotencyKey ?? null,
      replayed: result.replayed,
    };
  }

  async addPayment(dealId: string, tenantId: string, dto: AddPaymentDto) {
    const existing = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Deal not found');

    try {
      const result = await this.saleRegistration.addPayment(dealId, tenantId, {
        amount: dto.amount,
        method: dto.method,
        bankChannel: dto.bankChannel ?? null,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
        notes: dto.notes,
      });

      const bankFeeDecimal = result.bankFee?.amount ?? new Prisma.Decimal(0);

      return {
        payment: {
          id: result.payment.id,
          amount: result.payment.amount.toString(),
          method: result.payment.method,
          status: result.payment.status,
          paidAt: result.payment.paidAt?.toISOString() ?? null,
          notes: result.payment.notes,
        },
        bankFee: result.bankFee ? bankFeeDecimal.toString() : null,
        paidTotal: result.paidTotal.toString(),
        pendingAmount: result.pendingAmount.toString(),
        computedStatus: result.computedStatus,
      };
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException &&
        error.message === 'Deal not found'
      ) {
        throw new NotFoundException('Deal not found');
      }
      throw error;
    }
  }

  /** Canonical AR sync only — never writes Receivable / ReceivablePayment. */
  private async syncReceivableSafe(dealId: string, tenantId: string): Promise<void> {
    try {
      await this.cuentasService.syncDealReceivable(dealId, tenantId);
    } catch (error: unknown) {
      this.logger.error(
        `Failed syncing receivable for deal ${dealId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async ensureClientInTenant(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new BadRequestException('Client is invalid for this tenant');
    }
  }

  private async ensureWatchInTenant(watchId: string, tenantId: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!watch) {
      throw new BadRequestException('Watch is invalid for this tenant');
    }
  }

  private async ensureNoOtherWonDealForWatch(
    watchId: string,
    tenantId: string,
    excludeDealId?: string,
  ) {
    const wonDeal = await this.prisma.deal.findFirst({
      where: {
        tenantId,
        watchId,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
        ...(excludeDealId ? { id: { not: excludeDealId } } : {}),
      },
      select: { id: true },
    });

    if (wonDeal) {
      throw new BadRequestException(
        'This watch already has an active CLOSED_WON deal',
      );
    }
  }

  private async syncWatchStatusFromDealStage(params: {
    tenantId: string;
    dealId: string;
    watchId: string;
    nextStage: DealStage;
  }) {
    const { tenantId, dealId, watchId, nextStage } = params;

    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!watch) {
      return;
    }

    if (nextStage === DealStage.PENDING_PAYMENT) {
      // Do not downgrade SOLD status in V1.
      if (watch.status === WatchStatus.SOLD) return;
      await this.prisma.watch.update({
        where: { id: watch.id },
        data: { status: WatchStatus.RESERVED },
      });
      return;
    }

    if (nextStage === DealStage.CLOSED_WON) {
      await this.prisma.watch.update({
        where: { id: watch.id },
        data: { status: WatchStatus.SOLD },
      });
      return;
    }

    if (nextStage !== DealStage.CLOSED_LOST) {
      return;
    }

    // Do not revive SOLD status in V1.
    if (watch.status === WatchStatus.SOLD) {
      return;
    }

    const openStages: DealStage[] = [
      DealStage.LEAD,
      DealStage.INTERESTED,
      DealStage.NEGOTIATING,
      DealStage.PENDING_PAYMENT,
    ];

    const otherActiveOpenDeal = await this.prisma.deal.findFirst({
      where: {
        tenantId,
        watchId,
        id: { not: dealId },
        deletedAt: null,
        stage: { in: openStages },
      },
      select: { id: true },
    });

    if (otherActiveOpenDeal) {
      return;
    }

    await this.prisma.watch.update({
      where: { id: watch.id },
      data: { status: WatchStatus.AVAILABLE },
    });
  }

  private serializeDeal(deal: Deal) {
    return {
      id: deal.id,
      tenantId: deal.tenantId,
      clientId: deal.clientId,
      watchId: deal.watchId,
      stage: deal.stage,
      expectedCloseAt: deal.expectedCloseAt?.toISOString() ?? null,
      agreedPrice: deal.agreedPrice.toString(),
      notes: deal.notes,
      sourceTag: deal.sourceTag ?? null,
      importSessionId: deal.importSessionId ?? null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };
  }
}
