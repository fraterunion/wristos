import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  clientPhoneIdentityKey,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from './client-identity.util';

/**
 * Partial patch for Client CRM fields.
 * - omitted / undefined → unchanged
 * - explicit null or '' on optional contact/text fields → clear to null
 * - tags: provided array replaces the whole set (use helpers for add/remove)
 */
export type UpdateClientPatch = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
  budgetRange?: string | null;
};

export type UpdateClientOptions = {
  /**
   * Optimistic concurrency token (ISO timestamp of Client.updatedAt at preview time).
   * When set, update applies only if the row is still at that updatedAt.
   */
  expectedUpdatedAt?: Date | string | null;
};

export type ClientChangedField =
  | 'name'
  | 'email'
  | 'phone'
  | 'notes'
  | 'tags'
  | 'budgetRange';

export type UpdateClientResult = {
  client: Client;
  changedFields: ClientChangedField[];
  /** True when patch was a no-op (including CAS-compatible identical values). */
  noop: boolean;
};

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  return tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function parseExpectedUpdatedAt(raw: Date | string | null | undefined): Date | null {
  if (raw == null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('expectedUpdatedAt must be a valid timestamp');
  }
  return d;
}

/**
 * Deterministic notes helpers for future UPDATE_CLIENT AI.
 * Canonical storage remains a single Client.notes string (no history table).
 */
export function resolveNotesPatch(
  current: string | null | undefined,
  patch: { replace?: string | null; append?: string },
): string | null | undefined {
  if (patch.replace !== undefined && patch.append !== undefined) {
    throw new BadRequestException('notes replace and append are mutually exclusive');
  }
  if (patch.replace !== undefined) {
    return blankToNull(patch.replace);
  }
  if (patch.append !== undefined) {
    const addition = String(patch.append).trim();
    if (!addition) return undefined; // no-op
    const base = current?.trim() ? current.trim() : '';
    return base ? `${base}\n${addition}` : addition;
  }
  return undefined;
}

/**
 * Deterministic tags helpers for future UPDATE_CLIENT AI.
 * Storage is a full String[] replace under the hood.
 */
export function resolveTagsPatch(
  current: string[],
  patch: { replace?: string[]; add?: string[]; remove?: string[] },
): string[] | undefined {
  if (patch.replace !== undefined) {
    if (patch.add !== undefined || patch.remove !== undefined) {
      throw new BadRequestException('tags replace cannot combine with add/remove');
    }
    return normalizeTags(patch.replace) ?? [];
  }
  if (patch.add === undefined && patch.remove === undefined) return undefined;
  const next = [...current];
  for (const raw of patch.remove ?? []) {
    const tag = String(raw).trim();
    if (!tag) continue;
    const idx = next.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
    if (idx >= 0) next.splice(idx, 1);
  }
  for (const raw of patch.add ?? []) {
    const tag = String(raw).trim();
    if (!tag) continue;
    if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      next.push(tag);
    }
  }
  return next.slice(0, 30);
}

@Injectable()
export class ClientUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical Client update for CRM + future UPDATE_CLIENT.
   * Side effects: Client row fields only. No financial mutation.
   *
   * Boundaries:
   * - tenant-scoped active Client only (soft-deleted → NotFound)
   * - active email/phone expression uniqueness (DB) + pre-check + typed conflicts
   * - optional expectedUpdatedAt CAS for stale-preview / lost-update protection
   * - registerIdempotencyKey / id / tenantId / deletedAt never patched here
   */
  async update(
    tenantId: string,
    clientId: string,
    patch: UpdateClientPatch,
    options: UpdateClientOptions = {},
  ): Promise<UpdateClientResult> {
    const existing = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    const expectedUpdatedAt = parseExpectedUpdatedAt(options.expectedUpdatedAt);
    if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new ConflictException({
        code: 'CLIENT_STALE',
        message: 'El cliente cambió desde que se preparó esta edición. Revisa y vuelve a intentar.',
        currentUpdatedAt: existing.updatedAt.toISOString(),
      });
    }

    const data: Prisma.ClientUpdateInput = {};
    const changedFields: ClientChangedField[] = [];

    if (patch.name !== undefined) {
      const name = normalizeClientName(patch.name ?? '');
      if (!name) {
        throw new BadRequestException('name is required');
      }
      if (name !== existing.name) {
        data.name = name;
        changedFields.push('name');
      }
    }

    if (patch.email !== undefined) {
      let email: string | null;
      if (patch.email === null || patch.email === '') {
        email = null;
      } else {
        email = normalizeClientEmail(patch.email);
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new BadRequestException('email must be a valid email');
        }
      }
      if (email !== (existing.email ?? null)) {
        data.email = email;
        changedFields.push('email');
      }
    }

    if (patch.phone !== undefined) {
      let phone: string | null;
      if (patch.phone === null || patch.phone === '') {
        phone = null;
      } else {
        phone = normalizeClientPhone(patch.phone);
        if (!phone) {
          throw new BadRequestException('phone must be a valid phone-like string');
        }
      }
      if (phone !== (existing.phone ?? null)) {
        data.phone = phone;
        changedFields.push('phone');
      }
    }

    if (patch.notes !== undefined) {
      const notes = blankToNull(patch.notes);
      if (notes !== (existing.notes ?? null)) {
        data.notes = notes;
        changedFields.push('notes');
      }
    }

    if (patch.tags !== undefined) {
      const tags = normalizeTags(patch.tags) ?? [];
      if (!sameTags(tags, existing.tags ?? [])) {
        data.tags = tags;
        changedFields.push('tags');
      }
    }

    if (patch.budgetRange !== undefined) {
      const budgetRange = blankToNull(patch.budgetRange);
      if (budgetRange !== (existing.budgetRange ?? null)) {
        data.budgetRange = budgetRange;
        changedFields.push('budgetRange');
      }
    }

    if (changedFields.length === 0) {
      return { client: existing, changedFields: [], noop: true };
    }

    const nextEmail =
      data.email !== undefined ? ((data.email as string | null) ?? null) : existing.email;
    const nextPhone =
      data.phone !== undefined ? ((data.phone as string | null) ?? null) : existing.phone;

    if (changedFields.includes('email') && nextEmail) {
      await this.assertEmailAvailable(tenantId, clientId, nextEmail);
    }
    if (changedFields.includes('phone') && nextPhone) {
      await this.assertPhoneAvailable(tenantId, clientId, nextPhone);
    }

    try {
      if (expectedUpdatedAt) {
        const updated = await this.prisma.client.updateMany({
          where: {
            id: clientId,
            tenantId,
            deletedAt: null,
            updatedAt: expectedUpdatedAt,
          },
          data: data as Prisma.ClientUpdateManyMutationInput,
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: 'CLIENT_STALE',
            message:
              'El cliente cambió desde que se preparó esta edición. Revisa y vuelve a intentar.',
          });
        }
        const client = await this.prisma.client.findFirstOrThrow({
          where: { id: clientId, tenantId, deletedAt: null },
        });
        return { client, changedFields, noop: false };
      }

      const client = await this.prisma.client.update({
        where: { id: clientId },
        data,
      });
      return { client, changedFields, noop: false };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        const blob = Array.isArray(target)
          ? target.map(String).join(',')
          : String(target ?? error.message ?? '');
        const field =
          blob.includes('phone') || blob.includes('phone_identity') ? 'phone' : 'email';
        throw new ConflictException({
          code: 'CLIENT_EXACT_DUPLICATE',
          message:
            field === 'phone'
              ? 'Otro cliente activo ya usa ese teléfono.'
              : 'Otro cliente activo ya usa ese correo.',
          matchField: field,
        });
      }
      throw error;
    }
  }

  /** Convenience: replace notes (canonical). */
  async replaceNotes(tenantId: string, clientId: string, notes: string | null) {
    return this.update(tenantId, clientId, { notes });
  }

  /** Convenience: append a note line (future AI “agrégale una nota”). */
  async appendNotes(tenantId: string, clientId: string, addition: string) {
    const existing = await this.requireActive(tenantId, clientId);
    const notes = resolveNotesPatch(existing.notes, { append: addition });
    if (notes === undefined) {
      return { client: existing, changedFields: [] as ClientChangedField[], noop: true };
    }
    return this.update(tenantId, clientId, { notes }, { expectedUpdatedAt: existing.updatedAt });
  }

  /** Convenience: add tags without dropping others. */
  async addTags(tenantId: string, clientId: string, tags: string[]) {
    const existing = await this.requireActive(tenantId, clientId);
    const next = resolveTagsPatch(existing.tags ?? [], { add: tags });
    return this.update(tenantId, clientId, { tags: next }, { expectedUpdatedAt: existing.updatedAt });
  }

  /** Convenience: remove tags by case-insensitive match. */
  async removeTags(tenantId: string, clientId: string, tags: string[]) {
    const existing = await this.requireActive(tenantId, clientId);
    const next = resolveTagsPatch(existing.tags ?? [], { remove: tags });
    return this.update(tenantId, clientId, { tags: next }, { expectedUpdatedAt: existing.updatedAt });
  }

  private async requireActive(tenantId: string, clientId: string): Promise<Client> {
    const existing = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Client not found');
    return existing;
  }

  private async assertEmailAvailable(tenantId: string, clientId: string, email: string) {
    const clash = await this.prisma.client.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        id: { not: clientId },
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'CLIENT_EXACT_DUPLICATE',
        message: 'Otro cliente activo ya usa ese correo.',
        matchField: 'email',
        existingClientId: clash.id,
        existingClientName: clash.name,
      });
    }
    const deleted = await this.prisma.client.findFirst({
      where: {
        tenantId,
        deletedAt: { not: null },
        id: { not: clientId },
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    if (deleted) {
      throw new ConflictException({
        code: 'CLIENT_DELETED_MATCH',
        message:
          'Existe un cliente eliminado con ese correo. Restáuralo desde CRM; no se reasigna automáticamente.',
        matchField: 'email',
        existingClientId: deleted.id,
        existingClientName: deleted.name,
      });
    }
  }

  private async assertPhoneAvailable(tenantId: string, clientId: string, phone: string) {
    const key = clientPhoneIdentityKey(phone);
    if (!key) return;
    const others = await this.prisma.client.findMany({
      where: { tenantId, id: { not: clientId }, phone: { not: null } },
      select: { id: true, name: true, phone: true, deletedAt: true },
    });
    const activeClash = others.find(
      (c) => !c.deletedAt && clientPhoneIdentityKey(c.phone) === key,
    );
    if (activeClash) {
      throw new ConflictException({
        code: 'CLIENT_EXACT_DUPLICATE',
        message: 'Otro cliente activo ya usa ese teléfono.',
        matchField: 'phone',
        existingClientId: activeClash.id,
        existingClientName: activeClash.name,
      });
    }
    const deletedClash = others.find(
      (c) => c.deletedAt && clientPhoneIdentityKey(c.phone) === key,
    );
    if (deletedClash) {
      throw new ConflictException({
        code: 'CLIENT_DELETED_MATCH',
        message:
          'Existe un cliente eliminado con ese teléfono. Restáuralo desde CRM; no se reasigna automáticamente.',
        matchField: 'phone',
        existingClientId: deletedClash.id,
        existingClientName: deletedClash.name,
      });
    }
  }
}
