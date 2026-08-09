import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { clientNameMatchKey, normalizeClientName } from '../../../crm/client-identity.util';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';
import {
  CAPITAL_ACCOUNT_LABELS,
  normalizeCapitalContributionAccount,
} from './register-capital-contribution.binding';

export type CapitalInvestorClarify = {
  field: 'investor' | 'account' | 'amount' | 'currency';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
  code?: 'INVESTOR_NOT_FOUND' | 'AMBIGUOUS_INVESTOR' | 'UNSUPPORTED_CURRENCY';
};

export type CapitalInvestorResolution =
  | { kind: 'READY'; entities: Record<string, JsonValue> }
  | {
      kind: 'CLARIFY';
      entities: Record<string, JsonValue>;
      clarify: CapitalInvestorClarify;
    };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Trusted investor resolution for REGISTER_CAPITAL_CONTRIBUTION.
 * Provider-supplied investorId is never trusted — only selectedInvestorId /
 * useExistingInvestorId from picker/ordinal/context, or unique name match.
 */
@Injectable()
export class CapitalInvestorEntityResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<CapitalInvestorResolution> {
    const next: Record<string, JsonValue> = { ...entities };

    // Strip provider-forged investorId; trust only explicit selection keys.
    delete next.investorId;

    const currency = asString(next.currency)?.toUpperCase();
    if (
      currency &&
      currency !== 'MXN' &&
      (currency === 'USD' ||
        currency === 'USDT' ||
        currency === 'CRYPTO' ||
        /d[oó]lar/i.test(String(next.currency)))
    ) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'currency',
          entityType: 'INVESTOR',
          code: 'UNSUPPORTED_CURRENCY',
          message:
            'Las aportaciones de capital V1 son solo en MXN. No registro FX ni crypto desde aquí.',
          candidates: [],
          items: [],
        },
      };
    }
    if (currency === 'MXN' || !currency) {
      next.currency = 'MXN';
    }

    const account =
      normalizeCapitalContributionAccount(next.account) ??
      normalizeCapitalContributionAccount(next.capitalAccount) ??
      normalizeCapitalContributionAccount(next.accountLabel);
    if (account) {
      next.account = account;
      next.accountLabel = CAPITAL_ACCOUNT_LABELS[account];
    } else if (asString(next.account) || asString(next.capitalAccount)) {
      delete next.account;
      delete next.accountLabel;
    }

    const trustedId =
      asString(next.selectedInvestorId) ?? asString(next.useExistingInvestorId);

    let investor =
      trustedId != null
        ? await this.prisma.investor.findFirst({
            where: { id: trustedId, tenantId, deletedAt: null, isActive: true },
            select: { id: true, name: true, ownershipPercent: true },
          })
        : null;

    if (!investor) {
      const query =
        asString(next.investorQuery) ??
        asString(next.investorName) ??
        asString(next.partnerQuery) ??
        asString(next.partnerName) ??
        asString(next.socio) ??
        asString(next.name);

      if (!query) {
        const all = await this.prisma.investor.findMany({
          where: { tenantId, deletedAt: null, isActive: true },
          select: { id: true, name: true },
          orderBy: { createdAt: 'asc' },
          take: 10,
        });
        if (all.length === 0) {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'investor',
              entityType: 'INVESTOR',
              code: 'INVESTOR_NOT_FOUND',
              message:
                'No hay socios activos en Capital. Crea el socio en Capital antes de registrar una aportación.',
              candidates: [],
              items: [],
            },
          };
        }
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'investor',
            entityType: 'INVESTOR',
            code: 'AMBIGUOUS_INVESTOR',
            message: '¿De qué socio es la aportación?',
            candidates: all.map((inv, i) => ({
              id: inv.id,
              label: inv.name.slice(0, 160),
              ordinal: i + 1,
            })),
            items: all.map((inv) => ({ id: inv.id, label: inv.name, name: inv.name })),
          },
        };
      }

      const normalized = normalizeClientName(query);
      const key = clientNameMatchKey(normalized);
      const candidates = await this.prisma.investor.findMany({
        where: {
          tenantId,
          deletedAt: null,
          isActive: true,
          name: { contains: normalized, mode: 'insensitive' },
        },
        select: { id: true, name: true, ownershipPercent: true },
        take: 12,
        orderBy: { name: 'asc' },
      });

      // Also scan all active when contains-match is empty (short names / accent variants).
      const poolSource =
        candidates.length > 0
          ? candidates
          : await this.prisma.investor.findMany({
              where: { tenantId, deletedAt: null, isActive: true },
              select: { id: true, name: true, ownershipPercent: true },
              take: 50,
              orderBy: { name: 'asc' },
            });

      const exact = poolSource.filter((c) => clientNameMatchKey(c.name) === key);
      const startsWith = poolSource.filter((c) =>
        clientNameMatchKey(c.name).startsWith(key),
      );
      const pool = exact.length ? exact : startsWith.length ? startsWith : candidates;

      if (pool.length === 0) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'investor',
            entityType: 'INVESTOR',
            code: 'INVESTOR_NOT_FOUND',
            message: `No encontré un socio activo que coincida con «${normalized}».`,
            candidates: [],
            items: [],
          },
        };
      }

      if (pool.length > 1) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'investor',
            entityType: 'INVESTOR',
            code: 'AMBIGUOUS_INVESTOR',
            message: `Encontré ${pool.length} socios. ¿Cuál aportó?`,
            candidates: pool.map((inv, i) => ({
              id: inv.id,
              label: inv.name.slice(0, 160),
              ordinal: i + 1,
            })),
            items: pool.map((inv) => ({ id: inv.id, label: inv.name, name: inv.name })),
          },
        };
      }

      investor = pool[0]!;
    }

    next.investorId = investor.id;
    next.investorLabel = investor.name;
    next.selectedInvestorId = investor.id;
    delete next.investorQuery;
    delete next.investorName;
    delete next.partnerQuery;
    delete next.partnerName;
    delete next.socio;
    // Avoid treating bare name as material after resolution.
    if (asString(next.name) && clientNameMatchKey(String(next.name)) === clientNameMatchKey(investor.name)) {
      delete next.name;
    }

    return { kind: 'READY', entities: next };
  }
}
