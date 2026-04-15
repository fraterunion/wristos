import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Client,
  ClientPreference,
  Prisma,
  Watch,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RecalculateMatchingDto } from './dto/recalculate-matching.dto';

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async recalculate(tenantId: string, dto: RecalculateMatchingDto) {
    if (dto.watchId) {
      const watch = await this.ensureWatchInTenant(dto.watchId, tenantId);
      const count = await this.recalculateForWatch(tenantId, watch, dto.clientId);
      return { mode: 'single_watch', watchId: dto.watchId, suggestionsUpserted: count };
    }

    const watches = await this.prisma.watch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { not: WatchStatus.SOLD },
      },
      orderBy: { createdAt: 'desc' },
    });

    let total = 0;
    for (const watch of watches) {
      total += await this.recalculateForWatch(tenantId, watch, dto.clientId);
    }

    return {
      mode: 'all_watches',
      watchesProcessed: watches.length,
      suggestionsUpserted: total,
    };
  }

  async listForClient(clientId: string, tenantId: string, includeDismissed = false) {
    await this.ensureClientInTenant(clientId, tenantId);

    const suggestions = await this.prisma.matchSuggestion.findMany({
      where: {
        tenantId,
        clientId,
        ...(includeDismissed ? {} : { dismissedAt: null }),
      },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
    });

    return suggestions.map((s) => this.serializeSuggestion(s));
  }

  async listForWatch(watchId: string, tenantId: string, includeDismissed = false) {
    await this.ensureWatchInTenant(watchId, tenantId);

    const suggestions = await this.prisma.matchSuggestion.findMany({
      where: {
        tenantId,
        watchId,
        ...(includeDismissed ? {} : { dismissedAt: null }),
      },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
    });

    return suggestions.map((s) => this.serializeSuggestion(s));
  }

  async dismissSuggestion(id: string, tenantId: string) {
    const suggestion = await this.prisma.matchSuggestion.findFirst({
      where: { id, tenantId },
    });

    if (!suggestion) {
      throw new NotFoundException('Match suggestion not found');
    }

    const updated = await this.prisma.matchSuggestion.update({
      where: { id },
      data: { dismissedAt: new Date() },
    });

    return this.serializeSuggestion(updated);
  }

  private async recalculateForWatch(
    tenantId: string,
    watch: Watch,
    onlyClientId?: string,
  ) {
    if (watch.status === WatchStatus.SOLD) {
      await this.prisma.matchSuggestion.deleteMany({
        where: { tenantId, watchId: watch.id },
      });
      return 0;
    }

    const clients = await this.prisma.client.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(onlyClientId ? { id: onlyClientId } : {}),
      },
      include: {
        preferences: true,
      },
    });

    if (onlyClientId && clients.length === 0) {
      throw new BadRequestException('clientId is invalid for this tenant');
    }

    let upserted = 0;
    for (const client of clients) {
      const pref = client.preferences[0] ?? null;
      const result = this.scoreClientToWatch(client, pref, watch);

      if (result.score <= 0) {
        await this.prisma.matchSuggestion.deleteMany({
          where: {
            tenantId,
            clientId: client.id,
            watchId: watch.id,
          },
        });
        continue;
      }

      await this.prisma.matchSuggestion.upsert({
        where: {
          tenantId_clientId_watchId: {
            tenantId,
            clientId: client.id,
            watchId: watch.id,
          },
        },
        create: {
          tenant: { connect: { id: tenantId } },
          client: { connect: { id: client.id } },
          watch: { connect: { id: watch.id } },
          score: result.score,
          reason: result.reason,
        },
        update: {
          score: result.score,
          reason: result.reason,
          dismissedAt: null,
        },
      });

      upserted += 1;
    }

    return upserted;
  }

  private scoreClientToWatch(
    client: Client,
    preference: ClientPreference | null,
    watch: Watch,
  ) {
    let score = 0;
    const reasons: string[] = [];

    const brand = watch.brand.trim();
    const model = watch.model.trim();
    const reference = (watch.reference ?? '').trim();

    const preferredBrands = (preference?.preferredBrands ?? []).map((b) =>
      b.toLowerCase(),
    );
    const preferredModels = (preference?.preferredModels ?? []).map((m) =>
      m.toLowerCase(),
    );

    if (preferredBrands.includes(brand.toLowerCase())) {
      score += 40;
      reasons.push(`Brand match: ${brand}`);
    }

    const modelNeedle = `${model} ${reference}`.toLowerCase();
    const modelHit = preferredModels.find(
      (needle) => needle && modelNeedle.includes(needle),
    );
    if (modelHit) {
      score += 25;
      reasons.push(`Model/reference match: ${modelHit}`);
    }

    const watchPrice = Number(watch.price);
    const budgetMin = preference?.budgetMin ? Number(preference.budgetMin) : null;
    const budgetMax = preference?.budgetMax ? Number(preference.budgetMax) : null;
    if (
      budgetMin !== null &&
      budgetMax !== null &&
      watchPrice >= budgetMin &&
      watchPrice <= budgetMax
    ) {
      score += 25;
      reasons.push(`Budget match: ${budgetMin}-${budgetMax}`);
    } else if (budgetMax !== null && watchPrice <= budgetMax) {
      score += 10;
      reasons.push(`Within max budget: <= ${budgetMax}`);
    }

    const haystack = `${client.name} ${(client.tags ?? []).join(' ')} ${client.notes ?? ''}`
      .toLowerCase()
      .trim();
    if (haystack.includes(brand.toLowerCase())) {
      score += 10;
      reasons.push(`Client context mentions brand: ${brand}`);
    }
    if (model && haystack.includes(model.toLowerCase())) {
      score += 5;
      reasons.push(`Client context mentions model: ${model}`);
    }

    return {
      score,
      reason: reasons.length > 0 ? reasons.join('; ') : 'No explicit preference match',
    };
  }

  private async ensureClientInTenant(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }

  private async ensureWatchInTenant(watchId: string, tenantId: string) {
    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId, deletedAt: null },
    });

    if (!watch) {
      throw new NotFoundException('Watch not found');
    }

    return watch;
  }

  private serializeSuggestion(suggestion: {
    id: string;
    tenantId: string;
    clientId: string;
    watchId: string;
    score: number;
    reason: string;
    dismissedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: suggestion.id,
      tenantId: suggestion.tenantId,
      clientId: suggestion.clientId,
      watchId: suggestion.watchId,
      score: suggestion.score,
      reason: suggestion.reason,
      dismissedAt: suggestion.dismissedAt?.toISOString() ?? null,
      createdAt: suggestion.createdAt.toISOString(),
      updatedAt: suggestion.updatedAt.toISOString(),
    };
  }
}
