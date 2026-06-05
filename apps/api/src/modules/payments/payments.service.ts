import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { MarkPaymentPaidDto } from './dto/mark-payment-paid.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cuentasService: CuentasService,
  ) {}

  async create(tenantId: string, dto: CreatePaymentDto) {
    await this.ensureDealInTenant(dto.dealId, tenantId);

    const nextStatus = dto.status ?? PaymentStatus.PENDING;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    let paidAt = dto.paidAt ? new Date(dto.paidAt) : null;

    if (nextStatus === PaymentStatus.PENDING && dueDate === null) {
      throw new BadRequestException('dueDate is required for PENDING payments');
    }

    if (nextStatus === PaymentStatus.PAID && paidAt === null) {
      paidAt = new Date();
    }

    const payment = await this.prisma.payment.create({
      data: {
        tenant: { connect: { id: tenantId } },
        deal: { connect: { id: dto.dealId } },
        amount: new Prisma.Decimal(dto.amount),
        method: dto.method,
        status: nextStatus,
        dueDate,
        paidAt,
        notes: dto.notes,
      },
    });

    if (payment.status === PaymentStatus.PAID && payment.dealId) {
      await this.refreshReceivableSafe(payment.dealId, tenantId);
    }

    return this.serializePayment(payment);
  }

  async list(tenantId: string, query: ListPaymentsDto) {
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.dealId !== undefined && query.dealId.trim() !== '') {
      where.dealId = query.dealId.trim();
    }
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.method !== undefined) {
      where.method = query.method;
    }

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((payment) => this.serializePayment(payment));
  }

  async findOne(id: string, tenantId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return this.serializePayment(payment);
  }

  async update(id: string, tenantId: string, dto: UpdatePaymentDto) {
    const existing = await this.prisma.payment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Payment not found');
    }

    const previousDealId = existing.dealId;

    const nextDealId = dto.dealId ?? existing.dealId;
    if (dto.dealId !== undefined) {
      await this.ensureDealInTenant(nextDealId, tenantId);
    }

    const nextStatus = dto.status ?? existing.status;
    const dueDateValue =
      dto.dueDate === undefined
        ? existing.dueDate
        : dto.dueDate === null
          ? null
          : new Date(dto.dueDate);

    if (nextStatus === PaymentStatus.PENDING && dueDateValue === null) {
      throw new BadRequestException('dueDate is required for PENDING payments');
    }

    let paidAtValue =
      dto.paidAt === undefined
        ? existing.paidAt
        : dto.paidAt === null
          ? null
          : new Date(dto.paidAt);

    if (nextStatus === PaymentStatus.PAID && paidAtValue === null) {
      paidAtValue = new Date();
    }

    const data: Prisma.PaymentUpdateInput = {};

    if (dto.dealId !== undefined) data.deal = { connect: { id: nextDealId } };
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.method !== undefined) data.method = dto.method;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.dueDate !== undefined) data.dueDate = dueDateValue;
    if (dto.paidAt !== undefined || nextStatus === PaymentStatus.PAID) {
      data.paidAt = paidAtValue;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (Object.keys(data).length === 0) {
      return this.serializePayment(existing);
    }

    const payment = await this.prisma.payment.update({
      where: { id },
      data,
    });

    if (previousDealId) {
      await this.refreshReceivableSafe(previousDealId, tenantId);
    }
    if (payment.dealId && payment.dealId !== previousDealId) {
      await this.refreshReceivableSafe(payment.dealId, tenantId);
    }

    return this.serializePayment(payment);
  }

  async markPaid(id: string, tenantId: string, dto: MarkPaymentPaidDto) {
    const existing = await this.prisma.payment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Payment not found');
    }

    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.PAID,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : existing.paidAt ?? new Date(),
        notes: dto.notes ?? existing.notes,
      },
    });

    await this.refreshReceivableSafe(existing.dealId, tenantId);

    return this.serializePayment(payment);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.payment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Payment not found');
    }

    await this.prisma.payment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.refreshReceivableSafe(existing.dealId, tenantId);
  }

  async getDealPaymentSummary(dealId: string, tenantId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
      select: { id: true, agreedPrice: true },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    const paidAgg = await this.prisma.payment.aggregate({
      where: {
        tenantId,
        dealId,
        status: PaymentStatus.PAID,
        deletedAt: null,
      },
      _sum: { amount: true },
    });

    const totalAgreedPrice = deal.agreedPrice;
    const totalPaid = paidAgg._sum.amount ?? new Prisma.Decimal(0);

    const rawPending = totalAgreedPrice.minus(totalPaid);
    const pendingBalance = rawPending.lessThan(0)
      ? new Prisma.Decimal(0)
      : rawPending;

    return {
      dealId,
      tenantId,
      totalAgreedPrice: totalAgreedPrice.toString(),
      totalPaid: totalPaid.toString(),
      pendingBalance: pendingBalance.toString(),
    };
  }

  private async refreshReceivableSafe(
    dealId: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!dealId) return;

    try {
      await this.cuentasService.refreshEntryStatusForDeal(dealId, tenantId);
    } catch (error: unknown) {
      this.logger.error(
        `Failed refreshing receivable for deal ${dealId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async ensureDealInTenant(dealId: string, tenantId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!deal) {
      throw new BadRequestException('Deal is invalid for this tenant');
    }
  }

  private serializePayment(payment: Payment) {
    return {
      id: payment.id,
      tenantId: payment.tenantId,
      dealId: payment.dealId,
      amount: payment.amount.toString(),
      method: payment.method,
      status: payment.status,
      dueDate: payment.dueDate?.toISOString() ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
      notes: payment.notes,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
