import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  clientNameMatchKey,
  clientPhoneIdentityKey,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from './client-identity.util';

export type RegisterClientInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
  budgetRange?: string | null;
  registerIdempotencyKey?: string | null;
  /** Explicit override after probable-duplicate warning (future AI / advanced UI). */
  allowProbableDuplicate?: boolean;
};

export type ClientDuplicateCandidate = {
  id: string;
  name: string;
  matchReason: 'EXACT_EMAIL' | 'EXACT_PHONE' | 'EXACT_NAME' | 'DELETED_EMAIL' | 'DELETED_PHONE';
  deleted: boolean;
};

export type RegisterClientResult = {
  client: Client;
  replayed: boolean;
  probableDuplicates: ClientDuplicateCandidate[];
};

export type ClientIdentityMatchField = 'email' | 'phone';

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function p2002TargetBlob(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map(String).join(',');
  if (typeof target === 'string') return target;
  return String(target ?? error.message ?? '');
}

@Injectable()
export class ClientRegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical Client creation for CRM + future CREATE_CLIENT.
   * Side effects: Client row only. No financial mutation.
   *
   * Correctness boundaries:
   * - registerIdempotencyKey unique → same-command replay
   * - active email/phone expression unique indexes → identity integrity under concurrency
   * - deleted contact search → CLIENT_DELETED_MATCH (indexes exclude deleted rows)
   */
  async register(tenantId: string, input: RegisterClientInput): Promise<RegisterClientResult> {
    const name = normalizeClientName(input.name ?? '');
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const email = normalizeClientEmail(input.email);
    const phone = normalizeClientPhone(input.phone);
    if (input.phone != null && String(input.phone).trim() !== '' && !phone) {
      throw new BadRequestException('phone must be a valid phone-like string');
    }
    if (input.email != null && String(input.email).trim() !== '' && !email) {
      throw new BadRequestException('email must be a valid email');
    }

    const notes =
      input.notes == null || String(input.notes).trim() === ''
        ? null
        : String(input.notes).trim();
    const budgetRange =
      input.budgetRange == null || String(input.budgetRange).trim() === ''
        ? null
        : String(input.budgetRange).trim();
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);

    if (idempotencyKey) {
      const existingByKey = await this.prisma.client.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existingByKey) {
        this.assertCompatibleReplay(existingByKey, { name, email, phone, notes, budgetRange, tags });
        return {
          client: existingByKey,
          replayed: true,
          probableDuplicates: [],
        };
      }
    }

    await this.assertNoExactDuplicate(tenantId, { email, phone });

    const probableDuplicates = await this.findProbableDuplicates(tenantId, name, email, phone);
    if (probableDuplicates.length > 0 && !input.allowProbableDuplicate) {
      // Soft gate for future AI: manual CRM still creates (name-only overlap is common).
    }

    try {
      const client = await this.prisma.client.create({
        data: {
          tenant: { connect: { id: tenantId } },
          name,
          email,
          phone,
          notes,
          tags,
          budgetRange,
          registerIdempotencyKey: idempotencyKey,
        },
      });
      return {
        client,
        replayed: false,
        probableDuplicates,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.recoverFromUniqueViolation(tenantId, error, {
          name,
          email,
          phone,
          notes,
          budgetRange,
          tags,
          idempotencyKey,
          probableDuplicates,
        });
      }
      throw error;
    }
  }

  private async recoverFromUniqueViolation(
    tenantId: string,
    error: Prisma.PrismaClientKnownRequestError,
    ctx: {
      name: string;
      email: string | null;
      phone: string | null;
      notes: string | null;
      budgetRange: string | null;
      tags: string[];
      idempotencyKey: string | null;
      probableDuplicates: ClientDuplicateCandidate[];
    },
  ): Promise<RegisterClientResult> {
    const blob = p2002TargetBlob(error);

    // Same command replay race
    if (
      ctx.idempotencyKey &&
      (blob.includes('registerIdempotencyKey') ||
        blob.includes('clients_tenantId_registerIdempotencyKey_key'))
    ) {
      const raced = await this.prisma.client.findFirst({
        where: { tenantId, registerIdempotencyKey: ctx.idempotencyKey },
      });
      if (raced) {
        this.assertCompatibleReplay(raced, {
          name: ctx.name,
          email: ctx.email,
          phone: ctx.phone,
          notes: ctx.notes,
          budgetRange: ctx.budgetRange,
          tags: ctx.tags,
        });
        return { client: raced, replayed: true, probableDuplicates: [] };
      }
    }

    // Identity race: different command, same email/phone
    if (
      blob.includes('email') ||
      blob.includes('clients_tenantId_email_active_key') ||
      blob.includes('phone') ||
      blob.includes('clients_tenantId_phone_identity_active_key')
    ) {
      const field: ClientIdentityMatchField =
        blob.includes('phone') || blob.includes('phone_identity') ? 'phone' : 'email';
      await this.throwExactOrDeletedMatch(tenantId, {
        email: ctx.email,
        phone: ctx.phone,
        preferredField: field,
      });
    }

    // Ambiguous P2002 — still try identity then idempotency recovery
    if (ctx.email || ctx.phone) {
      try {
        await this.throwExactOrDeletedMatch(tenantId, {
          email: ctx.email,
          phone: ctx.phone,
        });
      } catch (mapped) {
        if (mapped instanceof ConflictException) throw mapped;
      }
    }
    if (ctx.idempotencyKey) {
      const raced = await this.prisma.client.findFirst({
        where: { tenantId, registerIdempotencyKey: ctx.idempotencyKey },
      });
      if (raced) {
        this.assertCompatibleReplay(raced, {
          name: ctx.name,
          email: ctx.email,
          phone: ctx.phone,
          notes: ctx.notes,
          budgetRange: ctx.budgetRange,
          tags: ctx.tags,
        });
        return { client: raced, replayed: true, probableDuplicates: [] };
      }
    }

    throw new ConflictException({
      code: 'CLIENT_IDENTITY_CONFLICT',
      message: 'No se pudo crear el cliente por un conflicto de identidad.',
      matchField: null,
    });
  }

  private assertCompatibleReplay(
    existing: Client,
    expected: {
      name: string;
      email: string | null;
      phone: string | null;
      notes: string | null;
      budgetRange: string | null;
      tags: string[];
    },
  ) {
    const mismatches: string[] = [];
    if (existing.name !== expected.name) mismatches.push('name');
    if ((existing.email ?? null) !== expected.email) mismatches.push('email');
    if ((existing.phone ?? null) !== expected.phone) mismatches.push('phone');
    if ((existing.notes ?? null) !== expected.notes) mismatches.push('notes');
    if ((existing.budgetRange ?? null) !== expected.budgetRange) mismatches.push('budgetRange');
    const existingTags = [...(existing.tags ?? [])].sort().join('|');
    const expectedTags = [...expected.tags].sort().join('|');
    if (existingTags !== expectedTags) mismatches.push('tags');
    if (mismatches.length > 0) {
      throw new ConflictException({
        code: 'CLIENT_IDEMPOTENCY_PAYLOAD_CONFLICT',
        message: `Idempotency key conflict: payload differs on ${mismatches.join(', ')}`,
        mismatchFields: mismatches,
      });
    }
  }

  private exactDuplicateConflict(
    field: ClientIdentityMatchField,
    existing: { id: string; name: string },
  ): never {
    throw new ConflictException({
      code: 'CLIENT_EXACT_DUPLICATE',
      message:
        field === 'email'
          ? 'Ya existe un cliente activo con ese correo. No se crea un duplicado.'
          : 'Ya existe un cliente activo con ese teléfono. No se crea un duplicado.',
      matchField: field,
      existingClientId: existing.id,
      existingClientName: existing.name,
    });
  }

  private deletedMatchConflict(
    field: ClientIdentityMatchField,
    existing: { id: string; name: string },
  ): never {
    throw new ConflictException({
      code: 'CLIENT_DELETED_MATCH',
      message:
        field === 'email'
          ? 'Existe un cliente eliminado con ese correo. Restáuralo desde CRM; no se crea uno nuevo automáticamente.'
          : 'Existe un cliente eliminado con ese teléfono. Restáuralo desde CRM; no se crea uno nuevo automáticamente.',
      matchField: field,
      existingClientId: existing.id,
      existingClientName: existing.name,
    });
  }

  private async throwExactOrDeletedMatch(
    tenantId: string,
    identity: {
      email: string | null;
      phone: string | null;
      preferredField?: ClientIdentityMatchField;
    },
  ): Promise<never> {
    const order: ClientIdentityMatchField[] =
      identity.preferredField === 'phone' ? ['phone', 'email'] : ['email', 'phone'];
    for (const field of order) {
      if (field === 'email' && identity.email) {
        const matches = await this.findEmailMatches(tenantId, identity.email);
        const active = matches.find((c) => !c.deletedAt);
        if (active) this.exactDuplicateConflict('email', active);
        const deleted = matches.find((c) => c.deletedAt);
        if (deleted) this.deletedMatchConflict('email', deleted);
      }
      if (field === 'phone' && identity.phone) {
        const matches = await this.findPhoneMatches(tenantId, identity.phone);
        const active = matches.find((c) => !c.deletedAt);
        if (active) this.exactDuplicateConflict('phone', active);
        const deleted = matches.find((c) => c.deletedAt);
        if (deleted) this.deletedMatchConflict('phone', deleted);
      }
    }
    throw new ConflictException({
      code: 'CLIENT_EXACT_DUPLICATE',
      message: 'Ya existe un cliente con esa identidad de contacto.',
      matchField: identity.preferredField ?? null,
    });
  }

  private async findEmailMatches(tenantId: string, email: string) {
    return this.prisma.client.findMany({
      where: {
        tenantId,
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true, name: true, deletedAt: true, email: true },
      take: 10,
    });
  }

  private async findPhoneMatches(tenantId: string, phone: string) {
    const phoneKey = clientPhoneIdentityKey(phone);
    if (!phoneKey) return [];
    const candidates = await this.prisma.client.findMany({
      where: { tenantId, phone: { not: null } },
      select: { id: true, name: true, phone: true, deletedAt: true },
    });
    return candidates.filter((c) => clientPhoneIdentityKey(c.phone) === phoneKey);
  }

  private async assertNoExactDuplicate(
    tenantId: string,
    identity: { email: string | null; phone: string | null },
  ) {
    if (identity.email) {
      const emailMatches = await this.findEmailMatches(tenantId, identity.email);
      const active = emailMatches.find((c) => !c.deletedAt);
      if (active) this.exactDuplicateConflict('email', active);
      const deleted = emailMatches.find((c) => c.deletedAt);
      if (deleted) this.deletedMatchConflict('email', deleted);
    }

    if (identity.phone) {
      const matches = await this.findPhoneMatches(tenantId, identity.phone);
      const active = matches.find((c) => !c.deletedAt);
      if (active) this.exactDuplicateConflict('phone', active);
      const deleted = matches.find((c) => c.deletedAt);
      if (deleted) this.deletedMatchConflict('phone', deleted);
    }
  }

  private async findProbableDuplicates(
    tenantId: string,
    name: string,
    email: string | null,
    phone: string | null,
  ): Promise<ClientDuplicateCandidate[]> {
    const nameKey = clientNameMatchKey(name);
    const actives = await this.prisma.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true },
      take: 5000,
    });
    const out: ClientDuplicateCandidate[] = [];
    for (const c of actives) {
      if (clientNameMatchKey(c.name) !== nameKey) continue;
      const sameEmail =
        email &&
        normalizeClientEmail(c.email) &&
        normalizeClientEmail(c.email) === email;
      const samePhone =
        phone && clientPhoneIdentityKey(c.phone) === clientPhoneIdentityKey(phone);
      if (sameEmail || samePhone) continue;
      out.push({
        id: c.id,
        name: c.name,
        matchReason: 'EXACT_NAME',
        deleted: false,
      });
      if (out.length >= 10) break;
    }
    return out;
  }
}
