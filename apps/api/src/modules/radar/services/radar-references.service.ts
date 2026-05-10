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

  // Call this if the catalog is updated at runtime so the next getAll() re-fetches
  invalidateCache(): void {
    this.cache = null;
  }
}
