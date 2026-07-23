import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountEntryType,
  CounterpartyType,
  Currency,
  Deal,
  DealStage,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StorefrontReservationStatus,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { ListStorefrontReservationsDto } from './dto/list-storefront-reservations.dto';

const WATCH_SELECT = {
  id: true,
  brand: true,
  model: true,
  reference: true,
  imageUrl: true,
  status: true,
  publicSlug: true,
} satisfies Prisma.WatchSelect;

const CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
} satisfies Prisma.ClientSelect;

const reservationInclude = {
  watch: { select: WATCH_SELECT },
  client: { select: CLIENT_SELECT },
} satisfies Prisma.StorefrontReservationInclude;

type ReservationWithRelations = Prisma.StorefrontReservationGetPayload<{
  include: typeof reservationInclude;
}>;

@Injectable()
export class StorefrontAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cuentasService: CuentasService,
    private readonly receivablesService: ReceivablesService,
  ) {}

  async listReservations(tenantId: string, query: ListStorefrontReservationsDto) {
    const where = this.buildWhere(tenantId, query);

    const reservations = await this.prisma.storefrontReservation.findMany({
      where,
      include: reservationInclude,
      orderBy: { createdAt: 'desc' },
    });

    return reservations.map((reservation) => this.serializeReservation(reservation));
  }

  async findReservation(id: string, tenantId: string) {
    const reservation = await this.prisma.storefrontReservation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: reservationInclude,
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    return this.serializeReservation(reservation);
  }

  async convertReservation(id: string, tenantId: string) {
    const reservation = await this.prisma.storefrontReservation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        watch: {
          select: {
            ...WATCH_SELECT,
            publicPrice: true,
            priceMax: true,
          },
        },
        client: { select: CLIENT_SELECT },
      },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.status !== StorefrontReservationStatus.PAID) {
      throw new BadRequestException('Only PAID reservations can be converted to a deal');
    }

    if (reservation.processedAt !== null || reservation.dealId !== null) {
      throw new ConflictException('This reservation has already been processed');
    }

    if (!reservation.clientId || !reservation.client) {
      throw new BadRequestException('Reservation must have a linked CRM client');
    }

    const agreedPriceSource =
      reservation.watch.publicPrice ?? reservation.watch.priceMax;
    if (agreedPriceSource === null) {
      throw new BadRequestException('Watch has no public or max price configured');
    }

    const agreedPrice = new Prisma.Decimal(agreedPriceSource);
    const reservationAmount = reservation.reservationAmount;
    const remainingBalance = agreedPrice.minus(reservationAmount);
    const dealStage =
      remainingBalance.lte(0) ? DealStage.CLOSED_WON : DealStage.PENDING_PAYMENT;

    if (dealStage === DealStage.CLOSED_WON) {
      await this.ensureNoOtherWonDealForWatch(reservation.watchId, tenantId);
    }

    const dealNotes = [
      'Source: STOREFRONT',
      `Reference: ${reservation.id}`,
    ].join('\n');

    const { deal, updatedReservation } = await this.prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          tenant: { connect: { id: tenantId } },
          client: { connect: { id: reservation.clientId! } },
          watch: { connect: { id: reservation.watchId } },
          stage: dealStage,
          agreedPrice,
          notes: dealNotes,
        },
      });

      await tx.payment.create({
        data: {
          tenant: { connect: { id: tenantId } },
          deal: { connect: { id: deal.id } },
          amount: reservationAmount,
          method: PaymentMethod.OTHER,
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          notes: 'Storefront reservation payment',
        },
      });

      if (dealStage === DealStage.CLOSED_WON) {
        await tx.watch.update({
          where: { id: reservation.watchId },
          data: { status: WatchStatus.SOLD },
        });
      }

      const updatedReservation = await tx.storefrontReservation.update({
        where: { id: reservation.id },
        data: {
          status: StorefrontReservationStatus.PROCESSED,
          processedAt: new Date(),
          deal: { connect: { id: deal.id } },
        },
        include: reservationInclude,
      });

      return { deal, updatedReservation };
    });

    let accountEntry: Awaited<ReturnType<CuentasService['findEntry']>> | null = null;

    if (remainingBalance.gt(0)) {
      await this.cuentasService.syncDealReceivable(deal.id, tenantId);
      await this.receivablesService.ensureForDeal(tenantId, deal.id);

      const entry = await this.prisma.accountEntry.findFirst({
        where: {
          tenantId,
          dealId: deal.id,
          type: AccountEntryType.RECEIVABLE,
          deletedAt: null,
        },
      });

      if (entry) {
        await this.prisma.accountEntry.update({
          where: { id: entry.id },
          data: {
            concept: 'Remaining balance for watch purchase',
            counterpartyName: reservation.client.name,
            counterpartyType: CounterpartyType.CLIENT,
            client: { connect: { id: reservation.clientId } },
            currency: Currency.MXN,
          },
        });
        accountEntry = await this.cuentasService.findEntry(entry.id, tenantId);
      }
    } else {
      await this.cuentasService.syncDealReceivable(deal.id, tenantId);
      await this.receivablesService.ensureForDeal(tenantId, deal.id);
    }

    return {
      reservation: this.serializeReservation(updatedReservation),
      deal: this.serializeDeal(deal),
      accountEntry,
    };
  }

  private async ensureNoOtherWonDealForWatch(watchId: string, tenantId: string) {
    const wonDeal = await this.prisma.deal.findFirst({
      where: {
        tenantId,
        watchId,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (wonDeal) {
      throw new ConflictException('This watch already has an active CLOSED_WON deal');
    }
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
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };
  }

  private buildWhere(
    tenantId: string,
    query: ListStorefrontReservationsDto,
  ): Prisma.StorefrontReservationWhereInput {
    const where: Prisma.StorefrontReservationWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.from !== undefined || query.to !== undefined) {
      where.createdAt = {};
      if (query.from !== undefined) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to !== undefined) {
        const end = new Date(query.to);
        end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
        { watch: { brand: { contains: search, mode: 'insensitive' } } },
        { watch: { model: { contains: search, mode: 'insensitive' } } },
        { watch: { reference: { contains: search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  private serializeReservation(reservation: ReservationWithRelations) {
    return {
      id: reservation.id,
      tenantId: reservation.tenantId,
      watchId: reservation.watchId,
      clientId: reservation.clientId,
      customerName: reservation.customerName,
      customerEmail: reservation.customerEmail,
      customerPhone: reservation.customerPhone,
      stripeCheckoutSessionId: reservation.stripeCheckoutSessionId,
      stripePaymentIntentId: reservation.stripePaymentIntentId,
      reservationAmount: reservation.reservationAmount.toString(),
      currency: reservation.currency,
      status: reservation.status,
      webhookEventId: reservation.webhookEventId,
      reservationExpiresAt: reservation.reservationExpiresAt?.toISOString() ?? null,
      processedAt: reservation.processedAt?.toISOString() ?? null,
      expiredAt: reservation.expiredAt?.toISOString() ?? null,
      cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
      dealId: reservation.dealId,
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
      watch: {
        id: reservation.watch.id,
        brand: reservation.watch.brand,
        model: reservation.watch.model,
        reference: reservation.watch.reference,
        imageUrl: reservation.watch.imageUrl,
        status: reservation.watch.status,
        publicSlug: reservation.watch.publicSlug,
      },
      client: reservation.client
        ? {
            id: reservation.client.id,
            name: reservation.client.name,
            email: reservation.client.email,
            phone: reservation.client.phone,
          }
        : null,
    };
  }
}
