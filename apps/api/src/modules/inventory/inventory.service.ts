import { createHash } from 'crypto';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Watch, WatchExpense, WatchOwnershipType } from '@prisma/client';
import { computeEffectiveCost } from '../../common/utils/effective-cost';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateWatchDto } from './dto/create-watch.dto';
import { ListWatchesDto } from './dto/list-watches.dto';
import { UpdateWatchDto } from './dto/update-watch.dto';

type WatchWithExpenses = Watch & { expenses: WatchExpense[] };

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

    const watch = await this.prisma.watch.create({
      data,
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
    });
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

    if (Object.keys(data).length === 0) {
      return this.serializeWatch(existing);
    }

    const watch = await this.prisma.watch.update({
      where: { id },
      data,
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
    });

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

  private serializeWatch(watch: WatchWithExpenses) {
    return {
      id: watch.id,
      tenantId: watch.tenantId,
      brand: watch.brand,
      model: watch.model,
      serialNumber: watch.serialNumber,
      imageUrl: watch.imageUrl,
      condition: watch.condition,
      cost: watch.cost.toString(),
      costCurrency: watch.costCurrency ?? null,
      costOriginalAmount: watch.costOriginalAmount?.toString() ?? null,
      costExchangeRate: watch.costExchangeRate?.toString() ?? null,
      priceMin: watch.priceMin.toString(),
      priceMax: watch.priceMax.toString(),
      effectiveCost: computeEffectiveCost(watch.cost, watch.expenses),
      status: watch.status,
      ownershipType: watch.ownershipType,
      consignmentOwnerName: watch.consignmentOwnerName,
      consignmentSplitPercentage:
        watch.consignmentSplitPercentage === null
          ? null
          : watch.consignmentSplitPercentage.toString(),
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
