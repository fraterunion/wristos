import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WatchStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
} satisfies Prisma.WatchSelect;

type PublicWatchRecord = Prisma.WatchGetPayload<{ select: typeof PUBLIC_WATCH_SELECT }>;

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

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
