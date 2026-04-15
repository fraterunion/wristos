import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Watch, WatchOwnershipType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWatchDto } from './dto/create-watch.dto';
import { ListWatchesDto } from './dto/list-watches.dto';
import { UpdateWatchDto } from './dto/update-watch.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateWatchDto) {
    const data: Prisma.WatchCreateInput = {
      tenant: { connect: { id: tenantId } },
      brand: dto.brand,
      model: dto.model,
      reference: dto.reference,
      serialNumber: dto.serialNumber,
      condition: dto.condition,
      cost: new Prisma.Decimal(dto.cost),
      price: new Prisma.Decimal(dto.price),
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

    const watch = await this.prisma.watch.create({ data });
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
      where.brand = {
        contains: query.brand.trim(),
        mode: 'insensitive',
      };
    }
    if (query.model !== undefined && query.model.trim() !== '') {
      where.model = {
        contains: query.model.trim(),
        mode: 'insensitive',
      };
    }

    const watches = await this.prisma.watch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return watches.map((w) => this.serializeWatch(w));
  }

  async findOne(id: string, tenantId: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!watch) {
      throw new NotFoundException('Watch not found');
    }
    return this.serializeWatch(watch);
  }

  async update(id: string, tenantId: string, dto: UpdateWatchDto) {
    const existing = await this.prisma.watch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Watch not found');
    }

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
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.serialNumber !== undefined) data.serialNumber = dto.serialNumber;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.cost !== undefined) data.cost = new Prisma.Decimal(dto.cost);
    if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.ownershipType !== undefined) {
      data.ownershipType = dto.ownershipType;
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
    });

    return this.serializeWatch(watch);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.watch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Watch not found');
    }

    await this.prisma.watch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private serializeWatch(watch: Watch) {
    return {
      id: watch.id,
      tenantId: watch.tenantId,
      brand: watch.brand,
      model: watch.model,
      reference: watch.reference,
      serialNumber: watch.serialNumber,
      condition: watch.condition,
      cost: watch.cost.toString(),
      price: watch.price.toString(),
      status: watch.status,
      ownershipType: watch.ownershipType,
      consignmentOwnerName: watch.consignmentOwnerName,
      consignmentSplitPercentage:
        watch.consignmentSplitPercentage === null
          ? null
          : watch.consignmentSplitPercentage.toString(),
      createdAt: watch.createdAt.toISOString(),
      updatedAt: watch.updatedAt.toISOString(),
    };
  }
}
