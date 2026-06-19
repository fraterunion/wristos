import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StorefrontReservationStatus, WatchStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CreateReservationCheckoutDto } from './dto/create-reservation-checkout.dto';

const PUBLIC_WATCH_IMAGE_SELECT = {
  id: true,
  url: true,
  altText: true,
  sortOrder: true,
  isPrimary: true,
} satisfies Prisma.WatchImageSelect;

const PUBLIC_WATCH_IMAGE_ORDER: Prisma.WatchImageOrderByWithRelationInput[] = [
  { isPrimary: 'desc' },
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
];

const PUBLIC_WATCH_SELECT = {
  id: true,
  brand: true,
  model: true,
  reference: true,
  imageUrl: true,
  condition: true,
  status: true,
  publicSlug: true,
  publicDescription: true,
  publicPrice: true,
  reservationAmount: true,
  createdAt: true,
  updatedAt: true,
  images: {
    where: { deletedAt: null },
    select: PUBLIC_WATCH_IMAGE_SELECT,
    orderBy: PUBLIC_WATCH_IMAGE_ORDER,
  },
} satisfies Prisma.WatchSelect;

type PublicWatchRecord = Prisma.WatchGetPayload<{ select: typeof PUBLIC_WATCH_SELECT }>;

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  async listPublishedWatches(tenantSlug: string) {
    const tenantId = await this.resolveTenantId(tenantSlug);
    const watches = await this.prisma.watch.findMany({
      where: this.publishedWatchWhere(tenantId),
      select: PUBLIC_WATCH_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return watches.map((watch) => this.serializeWatch(watch));
  }

  async getPublishedWatch(tenantSlug: string, slug: string) {
    const tenantId = await this.resolveTenantId(tenantSlug);
    const watch = await this.prisma.watch.findFirst({
      where: {
        ...this.publishedWatchWhere(tenantId),
        publicSlug: slug,
      },
      select: PUBLIC_WATCH_SELECT,
    });

    if (!watch) {
      throw new NotFoundException('Watch not found');
    }

    return this.serializeWatch(watch);
  }

  async createReservationCheckout(tenantSlug: string, dto: CreateReservationCheckoutDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, slug: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const watch = await this.prisma.watch.findFirst({
      where: {
        tenantId: tenant.id,
        publicSlug: dto.slug,
        deletedAt: null,
      },
      select: {
        id: true,
        brand: true,
        model: true,
        status: true,
        isPublished: true,
        publicSlug: true,
        reservationAmount: true,
      },
    });

    if (!watch) {
      throw new NotFoundException('Watch not found');
    }

    if (!watch.isPublished || watch.status !== WatchStatus.AVAILABLE) {
      throw new ConflictException('This watch is not available for reservation');
    }

    if (!watch.publicSlug || watch.reservationAmount === null) {
      throw new ConflictException('This watch is not configured for storefront reservation');
    }

    const amountMxn = watch.reservationAmount.toNumber();
    if (amountMxn <= 0) {
      throw new ConflictException('This watch has no valid reservation amount');
    }

    const reservationId = randomUUID();
    let sessionId: string | null = null;

    try {
      const session = await this.stripeService.createReservationCheckoutSession({
        reservationId,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        watchId: watch.id,
        publicSlug: watch.publicSlug,
        customerEmail: dto.customerEmail,
        watchLabel: `${watch.brand} ${watch.model}`,
        amountMxn,
      });

      sessionId = session.id;
      if (!session.url) {
        throw new ConflictException('Stripe did not return a checkout URL');
      }

      await this.prisma.storefrontReservation.create({
        data: {
          id: reservationId,
          tenantId: tenant.id,
          watchId: watch.id,
          customerName: dto.customerName.trim(),
          customerEmail: dto.customerEmail.trim().toLowerCase(),
          customerPhone: dto.customerPhone?.trim() || null,
          stripeCheckoutSessionId: session.id,
          reservationAmount: watch.reservationAmount,
          currency: 'mxn',
          status: StorefrontReservationStatus.PENDING,
        },
      });

      return {
        reservationId,
        checkoutUrl: session.url,
      };
    } catch (error) {
      if (sessionId) {
        await this.stripeService.expireCheckoutSession(sessionId);
      }
      throw error;
    }
  }

  private publishedWatchWhere(tenantId: string): Prisma.WatchWhereInput {
    return {
      tenantId,
      isPublished: true,
      status: WatchStatus.AVAILABLE,
      deletedAt: null,
      publicSlug: { not: null },
      publicPrice: { not: null },
      reservationAmount: { not: null },
    };
  }

  private async resolveTenantId(tenantSlug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant.id;
  }

  private serializeWatch(watch: PublicWatchRecord) {
    return {
      id: watch.id,
      brand: watch.brand,
      model: watch.model,
      reference: watch.reference,
      imageUrl: watch.imageUrl,
      images: watch.images.map((image) => ({
        id: image.id,
        url: image.url,
        altText: image.altText,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
      })),
      condition: watch.condition,
      status: watch.status,
      publicSlug: watch.publicSlug!,
      publicDescription: watch.publicDescription,
      publicPrice: watch.publicPrice!.toFixed(2),
      reservationAmount: watch.reservationAmount!.toFixed(2),
      createdAt: watch.createdAt.toISOString(),
      updatedAt: watch.updatedAt.toISOString(),
    };
  }
}
