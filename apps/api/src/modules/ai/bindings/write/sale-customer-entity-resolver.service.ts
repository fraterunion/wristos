import { Injectable } from '@nestjs/common';
import { CrmService } from '../../../crm/crm.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';

export type SaleCustomerClarify = {
  field: 'customerId';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
};

export type SaleCustomerDependency = {
  reason: 'SALE_CUSTOMER';
  query: string;
  message: string;
};

export type SaleCustomerResolution = {
  entities: Record<string, JsonValue>;
  clarify: SaleCustomerClarify | null;
  dependencyRequired: SaleCustomerDependency | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Trusted customer resolution for REGISTER_SALE preview.
 * Missing named customer → closed composition CREATE_CLIENT dependency.
 */
@Injectable()
export class SaleCustomerEntityResolver {
  constructor(
    private readonly crm: CrmService,
    private readonly prisma: PrismaService,
  ) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<SaleCustomerResolution> {
    let next: Record<string, JsonValue> = { ...entities };

    const claimedId = asString(next.customerId) ?? asString(next.clientId);
    if (claimedId) {
      const client = await this.prisma.client.findFirst({
        where: { id: claimedId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (client) {
        next = {
          ...next,
          customerId: client.id,
          customerName: client.name,
        };
        return { entities: next, clarify: null, dependencyRequired: null };
      }
      const { customerId: _c, clientId: _i, ...rest } = next;
      next = rest;
    }

    const customerQuery =
      asString(next.customerQuery) ??
      asString(next.customerName) ??
      asString(next.clientQuery) ??
      asString(next.cliente) ??
      asString(next.buyerName);
    if (!customerQuery) {
      return { entities: next, clarify: null, dependencyRequired: null };
    }

    const clients = await this.crm.searchClientsForTools(tenantId, customerQuery, 5);
    if (clients.length === 1) {
      return {
        entities: {
          ...next,
          customerId: clients[0]!.id,
          customerName: clients[0]!.name,
        },
        clarify: null,
        dependencyRequired: null,
      };
    }
    if (clients.length > 1) {
      return {
        entities: next,
        clarify: {
          field: 'customerId',
          entityType: 'CLIENT',
          message:
            'Hay varios clientes que coinciden. ¿Cuál es el comprador? Di “el primero”, “el segundo”, o elige uno.',
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
    }

    return {
      entities: {
        ...next,
        customerQuery,
        customerName: customerQuery,
      },
      clarify: null,
      dependencyRequired: {
        reason: 'SALE_CUSTOMER',
        query: customerQuery,
        message: `No encuentro a «${customerQuery}» en Clientes. Necesito identificar al comprador antes de registrar la venta.`,
      },
    };
  }
}
