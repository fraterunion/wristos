import { Injectable, Optional } from '@nestjs/common';
import { WatchStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter.service';
import { telem } from '../telemetry/telemetry-hooks';
import { expandWatchKnowledge, normalizeWatchQuery } from './expand';
import {
  type InventoryWatchRow,
  rankAndResolveCandidates,
  scoreWatchCandidate,
} from './score';
import type {
  NormalizedWatchQuery,
  ScoredWatchCandidate,
  WatchInventoryResolveResult,
} from './types';
import { WATCH_KNOWLEDGE_VERSION } from './types';

export type WatchEligibility = 'SALE' | 'SEARCH';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function contextualNoMatchMessage(query: NormalizedWatchQuery): string {
  const nick = query.nicknameHits[0];
  const brand = query.brandHint;
  if (brand && nick) {
    return `No encontré un ${nick} de ${brand} activo en Inventario. ¿Qué reloj fue?`;
  }
  if (nick) {
    return `No encontré un ${nick} activo en Inventario. ¿Qué reloj fue?`;
  }
  if (brand) {
    return `¿Qué ${brand} fue exactamente?`;
  }
  if (query.original.trim()) {
    return `No encontré “${query.original.trim().slice(0, 60)}” activo en Inventario. ¿Qué reloj fue?`;
  }
  return '¿Qué reloj fue?';
}

function pickerMessage(count: number): string {
  if (count === 2) return 'Encontré dos relojes que podrían ser.';
  return `Encontré ${count} relojes que podrían ser.`;
}

/**
 * Trusted tenant inventory resolution.
 * Knowledge expands search concepts only — never invents watchId.
 */
@Injectable()
export class WatchInventoryResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly telemetry?: TelemetryEmitter,
  ) {}

  async resolve(args: {
    tenantId: string;
    query: string;
    eligibility: WatchEligibility;
    /** Cap scored candidates returned in picker. */
    limit?: number;
    meta?: { requestId?: string; conversationId?: string; capability?: string };
  }): Promise<WatchInventoryResolveResult> {
    const raw = String(args.query ?? '').trim();
    if (!raw) {
      return {
        kind: 'NO_MATCH',
        reason: 'empty_query',
        message: '¿Qué reloj fue?',
      };
    }

    const normalized = normalizeWatchQuery(raw);
    const concept = expandWatchKnowledge(normalized);
    const rows = await this.loadEligible(args.tenantId, args.eligibility);

    const scored: ScoredWatchCandidate[] = [];
    for (const row of rows) {
      const c = scoreWatchCandidate(row, normalized, concept);
      if (c) scored.push(c);
    }

    const { unique, picker, rejectWeak } = rankAndResolveCandidates(scored);
    const limit = Math.min(args.limit ?? 8, 10);

    this.emitTelemetry({
      tenantId: args.tenantId,
      normalized,
      unique: Boolean(unique),
      pickerCount: picker.length,
      noMatch: !unique && picker.length === 0,
      rejectWeak,
      aliasHit: normalized.nicknameHits.length > 0 || normalized.knowledgeEntryIds.length > 0,
      exactRef: normalized.referenceHints.length > 0 && unique?.scoreKind === 'EXACT_REFERENCE',
      confidenceBucket: unique
        ? unique.score >= 85
          ? 'HIGH'
          : unique.score >= 55
            ? 'MEDIUM'
            : 'LOW'
        : picker.length
          ? 'AMBIGUOUS'
          : 'NONE',
      nicknameCollision: normalized.nicknameHits.some((n) =>
        ['panda', 'ghost', 'tiffany', 'bluesy'].includes(n.toLowerCase()),
      ),
      meta: args.meta,
    });

    if (unique) {
      return {
        kind: 'UNIQUE',
        watchId: unique.id,
        watchLabel: unique.label,
        candidate: unique,
      };
    }

    if (picker.length > 0) {
      const shown = picker.slice(0, limit);
      return {
        kind: 'PICKER',
        message: `${pickerMessage(shown.length)} ¿Cuál es? Di “el primero”, “el segundo”, o elige uno.`,
        candidates: shown,
      };
    }

    return {
      kind: 'NO_MATCH',
      reason: rejectWeak ? 'below_threshold' : 'no_candidates',
      message: contextualNoMatchMessage(normalized),
    };
  }

  /**
   * Shared first-turn SALE resolution: bind watchId from watchQuery when unique.
   */
  async resolveSaleEntities(
    tenantId: string,
    entities: Record<string, unknown>,
    meta?: { requestId?: string; conversationId?: string },
  ): Promise<{
    entities: Record<string, unknown>;
    clarify: {
      message: string;
      candidates: ScoredWatchCandidate[];
      items: Array<Record<string, string>>;
    } | null;
    noMatchMessage: string | null;
  }> {
    let next = { ...entities };
    const claimedId = asString(next.watchId);
    if (claimedId) {
      const row = await this.prisma.watch.findFirst({
        where: {
          id: claimedId,
          tenantId,
          deletedAt: null,
          status: { in: [WatchStatus.AVAILABLE, WatchStatus.RESERVED] },
        },
        select: { id: true, brand: true, model: true, reference: true, status: true },
      });
      if (row) {
        const label = [row.brand, row.model, row.reference].filter(Boolean).join(' ').trim();
        return {
          entities: { ...next, watchId: row.id, watchLabel: label },
          clarify: null,
          noMatchMessage: null,
        };
      }
      const { watchId: _w, ...rest } = next;
      next = rest;
    }

    const query =
      asString(next.watchQuery) ??
      asString(next.watch) ??
      [asString(next.brand), asString(next.model)].filter(Boolean).join(' ');
    if (!query) {
      return { entities: next, clarify: null, noMatchMessage: null };
    }

    const resolved = await this.resolve({
      tenantId,
      query,
      eligibility: 'SALE',
      meta: { ...meta, capability: 'REGISTER_SALE' },
    });

    if (resolved.kind === 'UNIQUE') {
      return {
        entities: {
          ...next,
          watchId: resolved.watchId,
          watchLabel: resolved.watchLabel,
          watchQuery: query,
        },
        clarify: null,
        noMatchMessage: null,
      };
    }

    if (resolved.kind === 'PICKER') {
      return {
        entities: { ...next, watchQuery: query },
        clarify: {
          message: resolved.message,
          candidates: resolved.candidates,
          items: resolved.candidates.map((c) => ({
            id: c.id,
            label: c.label,
            name: c.label,
            brand: c.brand,
            model: c.model,
            ...(c.reference ? { reference: c.reference } : {}),
          })),
        },
        noMatchMessage: null,
      };
    }

    // Keep watchQuery for contextual follow-up; do not invent watchId.
    return {
      entities: { ...next, watchQuery: query },
      clarify: null,
      noMatchMessage: resolved.message,
    };
  }

  private async loadEligible(
    tenantId: string,
    eligibility: WatchEligibility,
  ): Promise<InventoryWatchRow[]> {
    const statusFilter =
      eligibility === 'SALE'
        ? { status: { in: [WatchStatus.AVAILABLE, WatchStatus.RESERVED] as WatchStatus[] } }
        : { status: { not: WatchStatus.SOLD } };

    const watches = await this.prisma.watch.findMany({
      where: { tenantId, deletedAt: null, ...statusFilter },
      select: {
        id: true,
        brand: true,
        model: true,
        reference: true,
        status: true,
      },
      take: 500,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return watches.map((w: {
      id: string;
      brand: string | null;
      model: string | null;
      reference: string | null;
      status: string;
    }) => ({
      id: w.id,
      brand: w.brand ?? '',
      model: w.model ?? '',
      referenceNumber: w.reference,
      status: w.status,
    }));
  }

  private emitTelemetry(args: {
    tenantId: string;
    normalized: NormalizedWatchQuery;
    unique: boolean;
    pickerCount: number;
    noMatch: boolean;
    rejectWeak: boolean;
    aliasHit: boolean;
    exactRef: boolean;
    confidenceBucket: string;
    nicknameCollision: boolean;
    meta?: { requestId?: string; conversationId?: string; capability?: string };
  }): void {
    telem(this.telemetry, {
      event: 'PlannerCompleted',
      tenantId: args.tenantId,
      requestId: args.meta?.requestId,
      conversationId: args.meta?.conversationId,
      capability: args.meta?.capability ?? 'WATCH_INTELLIGENCE',
      uniqueResolution: args.unique,
      multipleCandidates: args.pickerCount > 1,
      zeroCandidates: args.noMatch,
      candidateCount: args.unique ? 1 : args.pickerCount,
      meta: {
        watchKnowledgeVersion: WATCH_KNOWLEDGE_VERSION,
        aliasExpansionHit: args.aliasHit,
        exactReferenceHit: args.exactRef,
        confidenceBucket: args.confidenceBucket,
        nicknameCollision: args.nicknameCollision,
        rejectWeak: args.rejectWeak,
        brandHintPresent: Boolean(args.normalized.brandHint),
        // Never log raw query / serials — only safe counts.
        tokenCount: args.normalized.tokens.length,
        nicknameHitCount: args.normalized.nicknameHits.length,
      },
    });
  }
}
