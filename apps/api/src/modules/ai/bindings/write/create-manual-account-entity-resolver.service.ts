import { Injectable } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { clientNameMatchKey, normalizeClientName } from '../../../crm/client-identity.util';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';
import { asString, defaultConcept, normalizeManualAccountCurrency } from './create-manual-account.shared';

export type ManualAccountClarify = {
  field: 'counterparty' | 'amount' | 'currency' | 'dueDate';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
  code?: 'AMBIGUOUS_CLIENT' | 'UNSUPPORTED_CURRENCY' | 'MISSING_COUNTERPARTY' | 'MISSING_AMOUNT';
};

export type ManualAccountResolution =
  | { kind: 'READY'; entities: Record<string, JsonValue> }
  | {
      kind: 'CLARIFY';
      entities: Record<string, JsonValue>;
      clarify: ManualAccountClarify;
    };

/**
 * Trusted counterparty resolution for CREATE_RECEIVABLE / CREATE_PAYABLE.
 *
 * Free-text counterpartyName is canonical — Client is optional.
 * Provider-supplied clientId is never trusted.
 * Unique active Client name match → bind clientId.
 * Ambiguous match → ENTITY_PICKER.
 * No match → keep free-text (no CREATE_CLIENT composition).
 */
@Injectable()
export class CreateManualAccountEntityResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
    kind: 'RECEIVABLE' | 'PAYABLE',
  ): Promise<ManualAccountResolution> {
    const next: Record<string, JsonValue> = { ...entities };

    delete next.clientId;
    delete next.accountEntryId;
    delete next.entryId;
    delete next.accountId;

    const currencyRaw = asString(next.currency);
    const currency = normalizeManualAccountCurrency(currencyRaw);
    if (currencyRaw && !currency) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'currency',
          entityType: 'CLIENT',
          code: 'UNSUPPORTED_CURRENCY',
          message: 'Solo MXN o USD para cuentas manuales. No invento tipo de cambio aquí.',
          candidates: [],
          items: [],
        },
      };
    }
    next.currency = (currency ?? Currency.MXN) as JsonValue;

    const amountRaw = next.amount;
    const amount =
      typeof amountRaw === 'number'
        ? amountRaw
        : typeof amountRaw === 'string'
          ? Number(amountRaw)
          : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'amount',
          entityType: 'CLIENT',
          code: 'MISSING_AMOUNT',
          message:
            kind === 'RECEIVABLE'
              ? '¿De cuánto es la cuenta por cobrar?'
              : '¿De cuánto es la cuenta por pagar?',
          candidates: [],
          items: [],
        },
      };
    }
    next.amount = amount;

    if (!asString(next.concept)) {
      next.concept = defaultConcept(kind);
    }

    const trustedId =
      asString(next.selectedClientId) ?? asString(next.useExistingClientId);

    let client =
      trustedId != null
        ? await this.prisma.client.findFirst({
            where: { id: trustedId, tenantId, deletedAt: null },
            select: { id: true, name: true },
          })
        : null;

    const query =
      asString(next.clientQuery) ??
      asString(next.customerQuery) ??
      asString(next.supplierQuery) ??
      asString(next.counterpartyQuery) ??
      asString(next.counterpartyName);

    if (!client && query) {
      const key = clientNameMatchKey(normalizeClientName(query));
      const candidates = await this.prisma.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
        take: 50,
        orderBy: { updatedAt: 'desc' },
      });
      const matches = candidates.filter(
        (c) => clientNameMatchKey(normalizeClientName(c.name)) === key,
      );
      if (matches.length === 1) {
        client = matches[0]!;
      } else if (matches.length > 1) {
        const presented: PresentedCandidate[] = matches.slice(0, 8).map((c, i) => ({
          id: c.id,
          label: c.name.slice(0, 160),
          ordinal: i + 1,
        }));
        return {
          kind: 'CLARIFY',
          entities: {
            ...next,
            counterpartyName: query,
          },
          clarify: {
            field: 'counterparty',
            entityType: 'CLIENT',
            code: 'AMBIGUOUS_CLIENT',
            message: `Encontré varios clientes parecidos a “${query}”. ¿Cuál es?`,
            candidates: presented,
            items: matches.slice(0, 8).map((c) => ({
              id: c.id,
              label: c.name,
              type: 'CLIENT',
            })),
          },
        };
      }
    }

    if (client) {
      next.clientId = client.id;
      next.counterpartyName = client.name;
      next.counterpartyLabel = client.name;
      next.hasClient = true;
    } else {
      const freeText =
        asString(next.counterpartyName) ??
        asString(next.customerName) ??
        asString(next.supplierName) ??
        query;
      if (!freeText) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'counterparty',
            entityType: 'CLIENT',
            code: 'MISSING_COUNTERPARTY',
            message:
              kind === 'RECEIVABLE'
                ? '¿Quién nos debe? Puedes darme un nombre o un cliente del CRM.'
                : '¿A quién le debemos? Puedes darme un nombre o un cliente del CRM.',
            candidates: [],
            items: [],
          },
        };
      }
      next.counterpartyName = freeText;
      next.counterpartyLabel = freeText;
      next.hasClient = false;
      delete next.clientId;
    }

    return { kind: 'READY', entities: next };
  }
}
