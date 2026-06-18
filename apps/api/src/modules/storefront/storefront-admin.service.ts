import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StorefrontReservation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
