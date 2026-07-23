import { createHash } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Watch, WatchExpense, WatchImage, WatchOwnershipType, WatchStatus } from '@prisma/client';
import { computeEffectiveCost } from '../../common/utils/effective-cost';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateWatchDto } from './dto/create-watch.dto';
import { CreateWatchImageDto } from './dto/create-watch-image.dto';
import { ListWatchesDto } from './dto/list-watches.dto';
import { UpdateWatchDto } from './dto/update-watch.dto';
import { UpdateWatchImageDto } from './dto/update-watch-image.dto';
import {
  isValidPublicSlug,
  normalizePublicSlug,
} from './validators/public-slug.validator';

type WatchWithExpenses = Watch & { expenses: WatchExpense[] };

const WATCH_IMAGE_ORDER: Prisma.WatchImageOrderByWithRelationInput[] = [
  { isPrimary: 'desc' },
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
];

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly fxService: FxService,
  ) {}

  async create(tenantId: string, dto: CreateWatchDto) {
    const currency = dto.costCurrency ?? 'MXN';
    const { canonicalCost, originalAmount, exchangeRate } = await this.resolveCost(
      dto.cost,
      currency,
    );

    const data: Prisma.WatchCreateInput = {
      tenant: { connect: { id: tenantId } },
      brand: dto.brand,
      model: dto.model,
      reference: dto.reference?.trim() || null,
      serialNumber: dto.serialNumber,
      imageUrl: dto.imageUrl ?? null,
      condition: dto.condition,
      cost: canonicalCost,
      costCurrency: currency,
      costOriginalAmount: originalAmount,
      costExchangeRate: exchangeRate,
      priceMin: new Prisma.Decimal(dto.priceMin),
      priceMax: new Prisma.Decimal(dto.priceMax),
      status: dto.status ?? undefined,
      ownershipType: dto.ownershipType,
      consignmentOwnerName:
        dto.ownershipType === WatchOwnershipType.CONSIGNMENT
          ? dto.consignmentOwnerName ?? null
          : null,
      consignmentSplitPercentage:
        dto.ownershipType === WatchOwnershipType.CONSIGNMENT &&
        dto.consignmentSplitPercentage !== undefined &&
        dto.consignmentSplitPercentage !== null
          ? new Prisma.Decimal(dto.consignmentSplitPercentage)
          : null,
    };

    const status = dto.status ?? WatchStatus.AVAILABLE;
    this.applyPublishFieldsToCreate(data, dto, status);

    let watch: WatchWithExpenses;
    try {
      watch = await this.prisma.watch.create({
        data,
        include: { expenses: { orderBy: { createdAt: 'asc' } } },
      });
    } catch (error) {
      this.rethrowPublicSlugConflict(error);
      throw error;
    }
    return this.serializeWatch(watch);
  }

  async list(tenantId: string, query: ListWatchesDto) {
    const where: Prisma.WatchWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.brand !== undefined && query.brand.trim() !== '') {
      where.brand = { contains: query.brand.trim(), mode: 'insensitive' };
    }
    if (query.model !== undefined && query.model.trim() !== '') {
      where.model = { contains: query.model.trim(), mode: 'insensitive' };
    }

    const watches = await this.prisma.watch.findMany({
      where,
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    return watches.map((w) => this.serializeWatch(w));
  }

  async findOne(id: string, tenantId: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
    });
    if (!watch) throw new NotFoundException('Watch not found');
    return this.serializeWatch(watch);
  }

  async update(id: string, tenantId: string, dto: UpdateWatchDto) {
    const existing = await this.prisma.watch.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
    });
    if (!existing) throw new NotFoundException('Watch not found');

    const nextOwnership = dto.ownershipType ?? existing.ownershipType;

    if (nextOwnership === WatchOwnershipType.OWNED) {
      const explicitName =
        dto.consignmentOwnerName !== undefined &&
        dto.consignmentOwnerName !== null &&
        String(dto.consignmentOwnerName).trim() !== '';
      const explicitSplit =
        dto.consignmentSplitPercentage !== undefined &&
        dto.consignmentSplitPercentage !== null;
      if (explicitName || explicitSplit) {
        throw new BadRequestException(
          'consignmentOwnerName and consignmentSplitPercentage must not be set when ownershipType is OWNED',
        );
      }
    }

    const data: Prisma.WatchUpdateInput = {};

    if (dto.brand !== undefined) data.brand = dto.brand;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.serialNumber !== undefined) data.serialNumber = dto.serialNumber;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.priceMin !== undefined) data.priceMin = new Prisma.Decimal(dto.priceMin);
    if (dto.priceMax !== undefined) data.priceMax = new Prisma.Decimal(dto.priceMax);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.ownershipType !== undefined) data.ownershipType = dto.ownershipType;

    if (dto.cost !== undefined) {
      const currency = dto.costCurrency ?? 'MXN';
      const { canonicalCost, originalAmount, exchangeRate } = await this.resolveCost(
        dto.cost,
        currency,
      );
      data.cost = canonicalCost;
      data.costCurrency = currency;
      data.costOriginalAmount = originalAmount;
      data.costExchangeRate = exchangeRate;
    }

    if (nextOwnership === WatchOwnershipType.OWNED) {
      data.consignmentOwnerName = null;
      data.consignmentSplitPercentage = null;
    } else {
      if (dto.consignmentOwnerName !== undefined) {
        data.consignmentOwnerName = dto.consignmentOwnerName;
      }
      if (dto.consignmentSplitPercentage !== undefined) {
        data.consignmentSplitPercentage =
          dto.consignmentSplitPercentage === null
            ? null
            : new Prisma.Decimal(dto.consignmentSplitPercentage);
      }
    }

    const nextStatus = dto.status ?? existing.status;
    this.applyPublishFieldsToUpdate(data, dto, existing, nextStatus);

    if (Object.keys(data).length === 0) {
      return this.serializeWatch(existing);
    }

    let watch: WatchWithExpenses;
    try {
      watch = await this.prisma.watch.update({
        where: { id },
        data,
        include: { expenses: { orderBy: { createdAt: 'asc' } } },
      });
    } catch (error) {
      this.rethrowPublicSlugConflict(error);
      throw error;
    }

    return this.serializeWatch(watch);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.watch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Watch not found');

    await this.prisma.watch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addExpense(watchId: string, tenantId: string, dto: CreateExpenseDto) {
    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId, deletedAt: null },
    });
    if (!watch) throw new NotFoundException('Watch not found');

    const expense = await this.prisma.watchExpense.create({
      data: {
        tenant: { connect: { id: tenantId } },
        watch: { connect: { id: watchId } },
        category: dto.category,
        amount: new Prisma.Decimal(dto.amount),
        notes: dto.notes ?? null,
      },
    });

    return this.serializeExpense(expense);
  }

  async removeExpense(watchId: string, expenseId: string, tenantId: string) {
    const expense = await this.prisma.watchExpense.findFirst({
      where: { id: expenseId, watchId, tenantId },
    });
    if (!expense) throw new NotFoundException('Expense not found');

    await this.prisma.watchExpense.delete({ where: { id: expenseId } });
  }

  async listWatchImages(watchId: string, tenantId: string) {
    await this.ensureWatchInTenant(watchId, tenantId);

    const images = await this.prisma.watchImage.findMany({
      where: { tenantId, watchId, deletedAt: null },
      orderBy: WATCH_IMAGE_ORDER,
    });

    return images.map((image) => this.serializeWatchImage(image));
  }

  async createWatchImage(watchId: string, tenantId: string, dto: CreateWatchImageDto) {
    await this.ensureWatchInTenant(watchId, tenantId);

    const isPrimary = dto.isPrimary ?? false;

    const image = await this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await this.unsetOtherPrimaryImages(tx, tenantId, watchId);
      }

      return tx.watchImage.create({
        data: {
          tenant: { connect: { id: tenantId } },
          watch: { connect: { id: watchId } },
          url: dto.url.trim(),
          altText: dto.altText?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
          isPrimary,
        },
      });
    });

    return this.serializeWatchImage(image);
  }

  async updateWatchImage(
    watchId: string,
    imageId: string,
    tenantId: string,
    dto: UpdateWatchImageDto,
  ) {
    await this.ensureWatchInTenant(watchId, tenantId);
    const existing = await this.findWatchImageOrThrow(watchId, imageId, tenantId);

    const isPrimary = dto.isPrimary === true;

    const image = await this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await this.unsetOtherPrimaryImages(tx, tenantId, watchId, imageId);
      }

      const data: Prisma.WatchImageUpdateInput = {};
      if (dto.url !== undefined) data.url = dto.url.trim();
      if (dto.altText !== undefined) {
        data.altText =
          dto.altText === null ? null : dto.altText.trim() || null;
      }
      if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
      if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;

      if (Object.keys(data).length === 0) {
        return existing;
      }

      return tx.watchImage.update({
        where: { id: existing.id },
        data,
      });
    });

    return this.serializeWatchImage(image);
  }

  async removeWatchImage(watchId: string, imageId: string, tenantId: string) {
    await this.ensureWatchInTenant(watchId, tenantId);
    await this.findWatchImageOrThrow(watchId, imageId, tenantId);

    await this.prisma.watchImage.update({
      where: { id: imageId },
      data: { deletedAt: new Date() },
    });
  }

  async setPrimaryWatchImage(watchId: string, imageId: string, tenantId: string) {
    await this.ensureWatchInTenant(watchId, tenantId);
    await this.findWatchImageOrThrow(watchId, imageId, tenantId);

    const image = await this.prisma.$transaction(async (tx) => {
      await this.unsetOtherPrimaryImages(tx, tenantId, watchId, imageId);

      return tx.watchImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      });
    });

    return this.serializeWatchImage(image);
  }

  generateUploadSignature(tenantId: string) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    const baseFolder =
      this.configService.get<string>('CLOUDINARY_UPLOAD_FOLDER') ?? 'wristos/watches';

    if (!cloudName || !apiKey || !apiSecret) {
      throw new BadRequestException('Image upload is not configured on this server.');
    }

    const folder = `${baseFolder}/${tenantId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const paramString = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
      .update(paramString + apiSecret)
      .digest('hex');

    return { signature, timestamp, cloudName, apiKey, folder };
  }

  // Converts the user-supplied cost to canonical MXN, fetching FX rate when needed.
  private async resolveCost(
    amount: number,
    currency: 'MXN' | 'USD',
  ): Promise<{
    canonicalCost: Prisma.Decimal;
    originalAmount: Prisma.Decimal | null;
    exchangeRate: Prisma.Decimal | null;
  }> {
    if (currency === 'MXN') {
      return {
        canonicalCost: new Prisma.Decimal(amount),
        originalAmount: null,
        exchangeRate: null,
      };
    }

    const fx = await this.fxService.getUsdMxn();
    const rate = fx.rate;
    const mxnAmount = Math.round(amount * rate * 100) / 100;

    return {
      canonicalCost: new Prisma.Decimal(mxnAmount),
      originalAmount: new Prisma.Decimal(amount),
      exchangeRate: new Prisma.Decimal(rate),
    };
  }

  private applyPublishFieldsToCreate(
    data: Prisma.WatchCreateInput,
    dto: CreateWatchDto,
    status: WatchStatus,
  ) {
    const hasPublishInput =
      dto.isPublished !== undefined ||
      dto.publicSlug !== undefined ||
      dto.publicDescription !== undefined ||
      dto.publicPrice !== undefined ||
      dto.reservationAmount !== undefined;

    if (!hasPublishInput) return;

    let isPublished = dto.isPublished ?? false;
    if (status !== WatchStatus.AVAILABLE) {
      isPublished = false;
    }

    const publicSlug = this.resolvePublicSlug(dto.publicSlug);
    const publicDescription = this.resolvePublicDescription(dto.publicDescription);
    const publicPrice = this.resolvePublicPrice(dto.publicPrice);
    const reservationAmount = this.resolveReservationAmount(dto.reservationAmount);

    if (publicSlug !== undefined && publicSlug !== null && !isValidPublicSlug(publicSlug)) {
      throw new BadRequestException(
        'publicSlug must contain only lowercase letters, numbers, and hyphens',
      );
    }

    if (isPublished) {
      this.assertPublishRequirements(status, publicSlug, publicPrice, reservationAmount);
    }

    data.isPublished = isPublished;
    if (dto.publicSlug !== undefined) data.publicSlug = publicSlug;
    if (dto.publicDescription !== undefined) data.publicDescription = publicDescription;
    if (dto.publicPrice !== undefined) {
      data.publicPrice = publicPrice === null ? null : new Prisma.Decimal(publicPrice);
    }
    if (dto.reservationAmount !== undefined) {
      data.reservationAmount =
        reservationAmount === null ? null : new Prisma.Decimal(reservationAmount);
    }
  }

  private applyPublishFieldsToUpdate(
    data: Prisma.WatchUpdateInput,
    dto: UpdateWatchDto,
    existing: Watch,
    nextStatus: WatchStatus,
  ) {
    const hasPublishInput =
      dto.isPublished !== undefined ||
      dto.publicSlug !== undefined ||
      dto.publicDescription !== undefined ||
      dto.publicPrice !== undefined ||
      dto.reservationAmount !== undefined;

    const statusChanged = nextStatus !== existing.status;
    if (!hasPublishInput && !statusChanged) return;

    let isPublished =
      dto.isPublished !== undefined ? dto.isPublished : existing.isPublished;
    if (nextStatus !== WatchStatus.AVAILABLE) {
      isPublished = false;
    }

    const publicSlug =
      dto.publicSlug !== undefined
        ? this.resolvePublicSlug(dto.publicSlug)
        : existing.publicSlug;
    const publicDescription =
      dto.publicDescription !== undefined
        ? this.resolvePublicDescription(dto.publicDescription)
        : existing.publicDescription;
    const publicPrice =
      dto.publicPrice !== undefined
        ? this.resolvePublicPrice(dto.publicPrice)
        : existing.publicPrice?.toNumber() ?? null;
    const reservationAmount =
      dto.reservationAmount !== undefined
        ? this.resolveReservationAmount(dto.reservationAmount)
        : existing.reservationAmount?.toNumber() ?? null;

    if (dto.publicSlug !== undefined && publicSlug !== null && !isValidPublicSlug(publicSlug)) {
      throw new BadRequestException(
        'publicSlug must contain only lowercase letters, numbers, and hyphens',
      );
    }

    if (isPublished) {
      this.assertPublishRequirements(nextStatus, publicSlug, publicPrice, reservationAmount);
    }

    if (hasPublishInput || statusChanged) {
      data.isPublished = isPublished;
    }
    if (dto.publicSlug !== undefined) data.publicSlug = publicSlug;
    if (dto.publicDescription !== undefined) data.publicDescription = publicDescription;
    if (dto.publicPrice !== undefined) {
      data.publicPrice = publicPrice === null ? null : new Prisma.Decimal(publicPrice);
    }
    if (dto.reservationAmount !== undefined) {
      data.reservationAmount =
        reservationAmount === null ? null : new Prisma.Decimal(reservationAmount);
    }
  }

  private assertPublishRequirements(
    status: WatchStatus,
    publicSlug: string | null | undefined,
    publicPrice: number | null | undefined,
    reservationAmount: number | null | undefined,
  ) {
    if (status !== WatchStatus.AVAILABLE) {
      throw new BadRequestException('Only AVAILABLE watches can be published');
    }
    if (!publicSlug?.trim()) {
      throw new BadRequestException('publicSlug is required when publishing');
    }
    if (publicPrice === null || publicPrice === undefined || publicPrice <= 0) {
      throw new BadRequestException('publicPrice is required and must be greater than 0');
    }
    if (
      reservationAmount === null ||
      reservationAmount === undefined ||
      reservationAmount <= 0
    ) {
      throw new BadRequestException(
        'reservationAmount is required and must be greater than 0',
      );
    }
  }

  private resolvePublicSlug(value: string | null | undefined): string | null {
    if (value === undefined) return null;
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return normalizePublicSlug(trimmed);
  }

  private resolvePublicDescription(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private resolvePublicPrice(value: number | null | undefined): number | null {
    if (value === undefined || value === null) return null;
    return value;
  }

  private resolveReservationAmount(value: number | null | undefined): number | null {
    if (value === undefined || value === null) return null;
    return value;
  }

  private async ensureWatchInTenant(watchId: string, tenantId: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!watch) {
      throw new NotFoundException('Watch not found');
    }
  }

  private async findWatchImageOrThrow(
    watchId: string,
    imageId: string,
    tenantId: string,
  ): Promise<WatchImage> {
    const image = await this.prisma.watchImage.findFirst({
      where: { id: imageId, watchId, tenantId, deletedAt: null },
    });
    if (!image) {
      throw new NotFoundException('Watch image not found');
    }
    return image;
  }

  private async unsetOtherPrimaryImages(
    tx: Prisma.TransactionClient,
    tenantId: string,
    watchId: string,
    excludeImageId?: string,
  ) {
    await tx.watchImage.updateMany({
      where: {
        tenantId,
        watchId,
        deletedAt: null,
        ...(excludeImageId ? { id: { not: excludeImageId } } : {}),
      },
      data: { isPrimary: false },
    });
  }

  private serializeWatchImage(image: WatchImage) {
    return {
      id: image.id,
      watchId: image.watchId,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    };
  }

  private rethrowPublicSlugConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target : [];
      if (fields.includes('publicSlug') || fields.includes('tenantId_publicSlug')) {
        throw new ConflictException(
          'This public slug is already in use by another watch in your store.',
        );
      }
    }
  }

  private serializeWatch(watch: WatchWithExpenses) {
    return {
      id: watch.id,
      tenantId: watch.tenantId,
      brand: watch.brand,
      model: watch.model,
      reference: watch.reference ?? null,
      serialNumber: watch.serialNumber,
      imageUrl: watch.imageUrl,
      condition: watch.condition,
      cost: watch.cost?.toString() ?? null,
      costCurrency: watch.costCurrency ?? 'MXN',
      costOriginalAmount: watch.costOriginalAmount?.toString() ?? null,
      costExchangeRate: watch.costExchangeRate?.toString() ?? null,
      priceMin: watch.priceMin?.toString() ?? null,
      priceMax: watch.priceMax?.toString() ?? null,
      effectiveCost: computeEffectiveCost(watch.cost ?? 0, watch.expenses),
      status: watch.status,
      ownershipType: watch.ownershipType,
      consignmentOwnerName: watch.consignmentOwnerName,
      consignmentSplitPercentage:
        watch.consignmentSplitPercentage === null
          ? null
          : watch.consignmentSplitPercentage.toString(),
      isPublished: watch.isPublished,
      publicSlug: watch.publicSlug,
      publicDescription: watch.publicDescription,
      publicPrice: watch.publicPrice?.toString() ?? null,
      reservationAmount: watch.reservationAmount?.toString() ?? null,
      expenses: watch.expenses.map((e) => this.serializeExpense(e)),
      createdAt: watch.createdAt.toISOString(),
      updatedAt: watch.updatedAt.toISOString(),
    };
  }

  private serializeExpense(expense: WatchExpense) {
    return {
      id: expense.id,
      watchId: expense.watchId,
      category: expense.category,
      amount: expense.amount.toString(),
      notes: expense.notes,
      createdAt: expense.createdAt.toISOString(),
    };
  }
}
