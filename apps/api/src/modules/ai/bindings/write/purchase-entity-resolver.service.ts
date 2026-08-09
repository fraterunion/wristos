import { Injectable } from '@nestjs/common';
import { CrmService } from '../../../crm/crm.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';

export type PurchaseEntityClarify = {
  field: 'sellerClientId';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
};

export type PurchaseSellerDependency = {
  reason: 'PURCHASE_SELLER';
  query: string;
  message: string;
};

export type PurchaseEntityResolution = {
  entities: Record<string, JsonValue>;
  clarify: PurchaseEntityClarify | null;
  /** Closed composition V1: missing seller Client — do not free-text unlinked. */
  dependencyRequired: PurchaseSellerDependency | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Trusted seller + serial resolution for REGISTER_PURCHASE preview.
 * Never auto-creates clients. Never trusts LLM-invented sellerClientId unless
 * it resolves to a live Client in the tenant.
 */
@Injectable()
export class PurchaseEntityResolver {
  constructor(
    private readonly crm: CrmService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<PurchaseEntityResolution> {
    let next: Record<string, JsonValue> = { ...entities };

    // Strip untrusted seller IDs that do not resolve in-tenant.
    const claimedSellerId = asString(next.sellerClientId);
    if (claimedSellerId) {
      const client = await this.prisma.client.findFirst({
        where: { id: claimedSellerId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (client) {
        next = {
          ...next,
          sellerClientId: client.id,
          sellerLabel: client.name,
          sellerCounterpartyName: asString(next.sellerCounterpartyName) ?? client.name,
        };
      } else {
        const { sellerClientId: _drop, ...rest } = next;
        next = rest;
      }
    }

    // Resolve seller by name when CREDIT/PARTIAL needs counterparty, or when named.
    if (!asString(next.sellerClientId)) {
      const sellerQuery =
        asString(next.sellerQuery) ??
        asString(next.supplierQuery) ??
        asString(next.sellerName) ??
        asString(next.sellerCounterpartyName) ??
        asString(next.vendedor);
      if (sellerQuery) {
        const clients = await this.crm.searchClientsForTools(tenantId, sellerQuery, 5);
        if (clients.length === 1) {
          next = {
            ...next,
            sellerClientId: clients[0]!.id,
            sellerLabel: clients[0]!.name,
            sellerCounterpartyName: clients[0]!.name,
          };
        } else if (clients.length > 1) {
          return {
            entities: next,
            clarify: {
              field: 'sellerClientId',
              entityType: 'CLIENT',
              message:
                'Hay varios clientes que coinciden como vendedor. ¿Cuál es? Di “el primero”, “el segundo”, o elige uno.',
              candidates: clients.slice(0, 10).map((c, i) => ({
                id: c.id,
                label: c.name.slice(0, 160),
                ordinal: i + 1,
              })),
              items: clients.slice(0, 10).map((c) => ({
                id: c.id,
                label: c.name,
                name: c.name,
              })),
            },
            dependencyRequired: null,
          };
        } else {
          // Controlled composition V1: offer CREATE_CLIENT dependency (no silent unlinked seller).
          return {
            entities: {
              ...next,
              sellerQuery: sellerQuery,
              sellerLabel: sellerQuery,
            },
            clarify: null,
            dependencyRequired: {
              reason: 'PURCHASE_SELLER',
              query: sellerQuery,
              message: `No encuentro a «${sellerQuery}» en Clientes. Necesito identificar al vendedor antes de registrar la compra.`,
            },
          };
        }
      }
    }

    // Active serial uniqueness check (preview-time; DB remains authoritative).
    const serial = asString(next.serialNumber) ?? asString(next.serial);
    if (serial) {
      const dup = await this.prisma.watch.findFirst({
        where: { tenantId, deletedAt: null, serialNumber: serial },
        select: { id: true },
      });
      if (dup) {
        next = { ...next, duplicateSerial: true, serialNumber: serial, serial };
      } else {
        next = { ...next, serialNumber: serial, serial };
        delete next.duplicateSerial;
      }
    }

    return { entities: next, clarify: null, dependencyRequired: null };
  }
}
