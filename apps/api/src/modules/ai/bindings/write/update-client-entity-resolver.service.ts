import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { clientNameMatchKey, normalizeClientName } from '../../../crm/client-identity.util';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';
import {
  ClientSnapshot,
  inferUpdateOperations,
  materializeClientUpdate,
  MaterializedClientUpdate,
  UpdateClientOperation,
} from './update-client-operations';

export type UpdateClientClarify = {
  field: 'client' | 'operation' | 'value' | 'noop';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
  code?: 'NO_CHANGES' | 'CLIENT_NOT_FOUND' | 'AMBIGUOUS_CLIENT';
};

export type UpdateClientResolution =
  | {
      kind: 'READY';
      entities: Record<string, JsonValue>;
      materialization: MaterializedClientUpdate;
    }
  | { kind: 'NOOP'; entities: Record<string, JsonValue>; message: string }
  | {
      kind: 'CLARIFY';
      entities: Record<string, JsonValue>;
      clarify: UpdateClientClarify;
    };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assignDefined(
  target: Record<string, JsonValue>,
  key: string,
  value: JsonValue | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Trusted UPDATE_CLIENT resolution before planner preview.
 * Domain receives only a trusted clientId + materialized final patch.
 */
@Injectable()
export class UpdateClientEntityResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<UpdateClientResolution> {
    let next: Record<string, JsonValue> = { ...entities };

    const trustedId =
      asString(next.selectedClientId) ??
      asString(next.useExistingClientId) ??
      asString(next.clientId);

    let client: ClientSnapshot | null =
      trustedId != null
        ? await this.prisma.client.findFirst({
            where: { id: trustedId, tenantId, deletedAt: null },
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              notes: true,
              tags: true,
              budgetRange: true,
              updatedAt: true,
            },
          })
        : null;

    if (!client) {
      const query =
        asString(next.clientQuery) ??
        asString(next.customerQuery) ??
        asString(next.clientName) ??
        asString(next.customerName) ??
        // Only use bare `name` as search when not also a SET_NAME target without setName.
        (asString(next.setName) || asString(next.newName) ? null : asString(next.name)) ??
        asString(next.query);

      if (!query) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'client',
            entityType: 'CLIENT',
            code: 'CLIENT_NOT_FOUND',
            message: '¿De qué cliente hablamos?',
            candidates: [],
            items: [],
          },
        };
      }

      const normalized = normalizeClientName(query);
      const key = clientNameMatchKey(normalized);
      const candidates = await this.prisma.client.findMany({
        where: { tenantId, deletedAt: null, name: { contains: normalized, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          notes: true,
          tags: true,
          budgetRange: true,
          updatedAt: true,
        },
        take: 12,
        orderBy: { name: 'asc' },
      });

      const exact = candidates.filter((c) => clientNameMatchKey(c.name) === key);
      const pool = exact.length ? exact : candidates;

      if (pool.length === 0) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'client',
            entityType: 'CLIENT',
            code: 'CLIENT_NOT_FOUND',
            message: `No encontré un cliente activo que coincida con «${normalized}».`,
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
            field: 'client',
            entityType: 'CLIENT',
            code: 'AMBIGUOUS_CLIENT',
            message: `Encontré ${pool.length} clientes. ¿Cuál quieres actualizar?`,
            candidates: pool.map((c, i) => ({
              id: c.id,
              label: c.name.slice(0, 160),
              ordinal: i + 1,
            })),
            items: pool.map((c) => ({ id: c.id, label: c.name, name: c.name })),
          },
        };
      }

      client = pool[0]!;
    }

    const ops = inferUpdateOperations(next);
    if (!ops.length) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'operation',
          entityType: 'CLIENT',
          message: '¿Qué quieres cambiar (teléfono, correo, notas, etiquetas…)?',
          candidates: [],
          items: [],
        },
      };
    }

    const snapshot: ClientSnapshot = {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      notes: client.notes,
      tags: client.tags ?? [],
      budgetRange: client.budgetRange,
      updatedAt: client.updatedAt,
    };

    const materialized = materializeClientUpdate(snapshot, next);
    if ('kind' in materialized && materialized.kind === 'INVALID') {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'value',
          entityType: 'CLIENT',
          message: materialized.message,
          candidates: [],
          items: [],
        },
      };
    }
    if ('kind' in materialized && materialized.kind === 'NOOP') {
      return {
        kind: 'NOOP',
        entities: {
          ...next,
          clientId: client.id,
          clientLabel: client.name,
          selectedClientId: client.id,
        },
        message: 'No hay cambios que guardar.',
      };
    }

    const plan = materialized as MaterializedClientUpdate;
    next = {
      ...next,
      clientId: plan.clientId,
      selectedClientId: plan.clientId,
      clientLabel: plan.clientName,
      expectedUpdatedAt: plan.expectedUpdatedAt,
      operations: plan.operations as unknown as JsonValue,
      changedFields: plan.changes.map((c) => c.field) as unknown as JsonValue,
      changePreview: plan.changes.map((c) => ({
        field: c.field,
        operation: c.operation,
        before: c.beforeMasked,
        after: c.afterMasked,
      })) as unknown as JsonValue,
      preStateHashes: plan.preStateHashes as unknown as JsonValue,
      hasEmail: Boolean(client.email),
      hasPhone: Boolean(client.phone),
    };
    assignDefined(next, 'patchName', plan.patch.name);
    assignDefined(
      next,
      'patchEmail',
      plan.patch.email === undefined ? undefined : (plan.patch.email as JsonValue),
    );
    assignDefined(
      next,
      'patchPhone',
      plan.patch.phone === undefined ? undefined : (plan.patch.phone as JsonValue),
    );
    assignDefined(
      next,
      'patchNotes',
      plan.patch.notes === undefined ? undefined : (plan.patch.notes as JsonValue),
    );
    assignDefined(
      next,
      'patchTags',
      plan.patch.tags === undefined ? undefined : (plan.patch.tags as JsonValue),
    );
    assignDefined(
      next,
      'patchBudgetRange',
      plan.patch.budgetRange === undefined ? undefined : (plan.patch.budgetRange as JsonValue),
    );

    return { kind: 'READY', entities: next, materialization: plan };
  }
}

export type { UpdateClientOperation };
