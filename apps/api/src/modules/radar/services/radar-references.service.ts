import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface WatchReferenceRow {
  id: string;
  brand: string;
  model: string;
  reference: string;
  aliases: string[];
}

@Injectable()
export class RadarReferencesService {
  private cache: WatchReferenceRow[] | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<WatchReferenceRow[]> {
    if (this.cache) return this.cache;

    const rows = await this.prisma.watchReference.findMany({
      select: { id: true, brand: true, model: true, reference: true, aliases: true },
    });

    this.cache = rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      model: r.model,
      reference: r.reference,
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    }));

    return this.cache;
  }

  async search(q: string | undefined, brand: string | undefined, limit: number) {
    const where: {
      brand?: { contains: string; mode: 'insensitive' };
      OR?: Array<Record<string, unknown>>;
    } = {};

    if (brand) {
      where.brand = { contains: brand, mode: 'insensitive' };
    }

    if (q) {
      where.OR = [
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { line: { contains: q, mode: 'insensitive' } },
        // JSON string_contains searches within the serialized aliases array
        { aliases: { string_contains: q } },
      ];
    }

    return this.prisma.watchReference.findMany({
      where,
      select: {
        id: true,
        brand: true,
        model: true,
        reference: true,
        line: true,
        aliases: true,
        approximateRetailUsd: true,
        discontinued: true,
      },
      orderBy: [{ brand: 'asc' }, { model: 'asc' }],
      take: limit,
    });
  }

  // Call this if the catalog is updated at runtime so the next getAll() re-fetches
  invalidateCache(): void {
    this.cache = null;
  }
}
