import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';
import {
  clientNameMatchKey,
  clientPhoneIdentityKey,
  isValidClientPhoneInput,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from '../../../crm/client-identity.util';

export type CreateClientClarify = {
  field: 'name' | 'email' | 'phone' | 'probableDuplicate' | 'exactDuplicate' | 'deletedMatch';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
  code?: 'CLIENT_EXACT_DUPLICATE' | 'CLIENT_DELETED_MATCH' | 'PROBABLE_DUPLICATE_DECISION';
  matchField?: 'email' | 'phone' | null;
  blockCreate?: boolean;
};

export type CreateClientResolution =
  | { kind: 'READY'; entities: Record<string, JsonValue> }
  | { kind: 'USE_EXISTING'; entities: Record<string, JsonValue>; clientId: string; clientName: string }
  | { kind: 'CLARIFY'; entities: Record<string, JsonValue>; clarify: CreateClientClarify };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

const CREATE_NEW_SENTINEL = '__CREATE_NEW_CLIENT__';

export function isCreateNewClientSentinel(id: string | null | undefined): boolean {
  return Boolean(id && (id === CREATE_NEW_SENTINEL || id.startsWith(`${CREATE_NEW_SENTINEL}|`)));
}

export function createNewClientSentinel(name: string): string {
  return `${CREATE_NEW_SENTINEL}|${name}`;
}

export function nameFromCreateNewSentinel(id: string): string | null {
  if (!id.startsWith(`${CREATE_NEW_SENTINEL}|`)) return null;
  const name = id.slice(CREATE_NEW_SENTINEL.length + 1).trim();
  return name || null;
}

/**
 * Trusted CREATE_CLIENT identity resolution before planner preview.
 * Exact contact matches hard-block. Probable name matches require explicit create-new.
 */
@Injectable()
export class CreateClientEntityResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<CreateClientResolution> {
    let next: Record<string, JsonValue> = { ...entities };

    // Existing-client selection only via explicit picker/deictic (never stale bare clientId).
    const useExisting = asString(next.useExistingClientId) ?? asString(next.selectedClientId);
    if (useExisting && !isCreateNewClientSentinel(useExisting)) {
      const existing = await this.prisma.client.findFirst({
        where: { id: useExisting, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (existing) {
        return {
          kind: 'USE_EXISTING',
          entities: {
            ...next,
            useExistingClientId: existing.id,
            clientLabel: existing.name,
          },
          clientId: existing.id,
          clientName: existing.name,
        };
      }
    }
    if (useExisting && isCreateNewClientSentinel(useExisting)) {
      const pendingName = nameFromCreateNewSentinel(useExisting);
      next = {
        ...next,
        allowProbableDuplicate: true,
        ...(pendingName && !asString(next.name) ? { name: pendingName } : {}),
      };
      delete next.clientId;
      delete next.useExistingClientId;
      delete next.selectedClientId;
    }

    const rawName = asString(next.name) ?? asString(next.clientName) ?? asString(next.customerName);
    if (!rawName) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'name',
          entityType: 'CLIENT',
          message: '¿Cómo se llama el cliente?',
          candidates: [],
          items: [],
        },
      };
    }

    const name = normalizeClientName(rawName);
    if (!name) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'name',
          entityType: 'CLIENT',
          message: '¿Cómo se llama el cliente?',
          candidates: [],
          items: [],
        },
      };
    }

    const rawEmail = asString(next.email) ?? asString(next.correo);
    let email: string | null = null;
    if (rawEmail) {
      email = normalizeClientEmail(rawEmail);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'email',
            entityType: 'CLIENT',
            message: 'El correo no es válido. ¿Cuál es el correo correcto?',
            candidates: [],
            items: [],
          },
        };
      }
    }

    const rawPhone = asString(next.phone) ?? asString(next.telefono) ?? asString(next.teléfono);
    let phone: string | null = null;
    if (rawPhone) {
      if (!isValidClientPhoneInput(rawPhone) || !normalizeClientPhone(rawPhone)) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'phone',
            entityType: 'CLIENT',
            message: 'El teléfono no es válido. ¿Cuál es el teléfono correcto?',
            candidates: [],
            items: [],
          },
        };
      }
      phone = normalizeClientPhone(rawPhone);
    }

    next = {
      ...next,
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
    };

    // Exact identity — active then deleted (app policy; indexes exclude deleted).
    if (email) {
      const emailMatches = await this.prisma.client.findMany({
        where: { tenantId, email: { equals: email, mode: 'insensitive' } },
        select: { id: true, name: true, deletedAt: true },
        take: 5,
      });
      const active = emailMatches.find((c) => !c.deletedAt);
      if (active) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'exactDuplicate',
            entityType: 'CLIENT',
            code: 'CLIENT_EXACT_DUPLICATE',
            matchField: 'email',
            blockCreate: true,
            message: `Ya existe un cliente con ese correo (${active.name}). No voy a crear un duplicado.`,
            candidates: [{ id: active.id, label: active.name.slice(0, 160), ordinal: 1 }],
            items: [{ id: active.id, label: active.name, name: active.name }],
          },
        };
      }
      const deleted = emailMatches.find((c) => c.deletedAt);
      if (deleted) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'deletedMatch',
            entityType: 'CLIENT',
            code: 'CLIENT_DELETED_MATCH',
            matchField: 'email',
            blockCreate: true,
            message:
              'Encontré un cliente eliminado con esos datos. No voy a crear otro automáticamente. Restáuralo desde CRM si corresponde.',
            candidates: [{ id: deleted.id, label: deleted.name.slice(0, 160), ordinal: 1 }],
            items: [{ id: deleted.id, label: deleted.name, name: deleted.name, deleted: true }],
          },
        };
      }
    }

    if (phone) {
      const phoneKey = clientPhoneIdentityKey(phone);
      if (phoneKey) {
        const candidates = await this.prisma.client.findMany({
          where: { tenantId, phone: { not: null } },
          select: { id: true, name: true, phone: true, deletedAt: true },
        });
        const matches = candidates.filter((c) => clientPhoneIdentityKey(c.phone) === phoneKey);
        const active = matches.find((c) => !c.deletedAt);
        if (active) {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'exactDuplicate',
              entityType: 'CLIENT',
              code: 'CLIENT_EXACT_DUPLICATE',
              matchField: 'phone',
              blockCreate: true,
              message: `Ya existe un cliente con ese teléfono (${active.name}). No voy a crear un duplicado.`,
              candidates: [{ id: active.id, label: active.name.slice(0, 160), ordinal: 1 }],
              items: [{ id: active.id, label: active.name, name: active.name }],
            },
          };
        }
        const deleted = matches.find((c) => c.deletedAt);
        if (deleted) {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'deletedMatch',
              entityType: 'CLIENT',
              code: 'CLIENT_DELETED_MATCH',
              matchField: 'phone',
              blockCreate: true,
              message:
                'Encontré un cliente eliminado con esos datos. No voy a crear otro automáticamente. Restáuralo desde CRM si corresponde.',
              candidates: [{ id: deleted.id, label: deleted.name.slice(0, 160), ordinal: 1 }],
              items: [{ id: deleted.id, label: deleted.name, name: deleted.name, deleted: true }],
            },
          };
        }
      }
    }

    const allow = asBool(next.allowProbableDuplicate);
    if (!allow) {
      const nameKey = clientNameMatchKey(name);
      const actives = await this.prisma.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, phone: true, email: true },
        take: 5000,
      });
      const probable = actives.filter((c) => clientNameMatchKey(c.name) === nameKey).slice(0, 8);
      if (probable.length > 0) {
        const items: Array<Record<string, JsonValue>> = probable.map((c) => ({
          id: c.id,
          label: c.name,
          name: c.name,
        }));
        items.push({
          id: createNewClientSentinel(name),
          label: 'Crear cliente nuevo',
          name: 'Crear cliente nuevo',
          isCreateNew: true,
        });
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'probableDuplicate',
            entityType: 'CLIENT',
            code: 'PROBABLE_DUPLICATE_DECISION',
            blockCreate: false,
            message:
              probable.length === 1
                ? `Encontré un cliente con un nombre parecido (${probable[0]!.name}). ¿Lo usamos o creo uno nuevo?`
                : `Encontré ${probable.length} clientes con un nombre parecido. ¿Usamos uno existente o creo uno nuevo?`,
            candidates: items.map((item, i) => ({
              id: String(item.id),
              label: String(item.label).slice(0, 160),
              ordinal: i + 1,
            })),
            items,
          },
        };
      }
    }

    return { kind: 'READY', entities: next };
  }
}

export { CREATE_NEW_SENTINEL };
