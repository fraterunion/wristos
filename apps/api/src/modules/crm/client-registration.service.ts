import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  clientNameMatchKey,
  clientPhoneMatchKey,
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

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class ClientRegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical Client creation for CRM + future CREATE_CLIENT.
   * Side effects: Client row only. No financial mutation.
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
      // Exact contact matches already threw above. Probable = same name, different/no contact.
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const raced = await this.prisma.client.findFirst({
          where: { tenantId, registerIdempotencyKey: idempotencyKey },
        });
        if (raced) {
          this.assertCompatibleReplay(raced, { name, email, phone, notes, budgetRange, tags });
          return { client: raced, replayed: true, probableDuplicates: [] };
        }
      }
      throw error;
    }
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
      throw new ConflictException(
        `Idempotency key conflict: payload differs on ${mismatches.join(', ')}`,
      );
    }
  }

  private async assertNoExactDuplicate(
    tenantId: string,
    identity: { email: string | null; phone: string | null },
  ) {
    if (identity.email) {
      const emailMatches = await this.prisma.client.findMany({
        where: {
          tenantId,
          email: { equals: identity.email, mode: 'insensitive' },
        },
        select: { id: true, name: true, deletedAt: true, email: true },
        take: 5,
      });
      const active = emailMatches.find((c) => !c.deletedAt);
      if (active) {
        throw new ConflictException({
          code: 'CLIENT_EXACT_DUPLICATE',
          message: `Ya existe un cliente con el correo ${identity.email}. No se crea un duplicado.`,
          matchField: 'email',
          existingClientId: active.id,
          existingClientName: active.name,
        });
      }
      const deleted = emailMatches.find((c) => c.deletedAt);
      if (deleted) {
        throw new ConflictException({
          code: 'CLIENT_DELETED_MATCH',
          message:
            'Existe un cliente eliminado con ese correo. Restáuralo desde CRM; no se crea uno nuevo automáticamente.',
          matchField: 'email',
          existingClientId: deleted.id,
          existingClientName: deleted.name,
        });
      }
    }

    if (identity.phone) {
      const phoneKey = clientPhoneMatchKey(identity.phone);
      if (phoneKey) {
        const candidates = await this.prisma.client.findMany({
          where: { tenantId, phone: { not: null } },
          select: { id: true, name: true, phone: true, deletedAt: true },
        });
        const matches = candidates.filter(
          (c) => clientPhoneMatchKey(normalizeClientPhone(c.phone)) === phoneKey,
        );
        const active = matches.find((c) => !c.deletedAt);
        if (active) {
          throw new ConflictException({
            code: 'CLIENT_EXACT_DUPLICATE',
            message: 'Ya existe un cliente con ese teléfono. No se crea un duplicado.',
            matchField: 'phone',
            existingClientId: active.id,
            existingClientName: active.name,
          });
        }
        const deleted = matches.find((c) => c.deletedAt);
        if (deleted) {
          throw new ConflictException({
            code: 'CLIENT_DELETED_MATCH',
            message:
              'Existe un cliente eliminado con ese teléfono. Restáuralo desde CRM; no se crea uno nuevo automáticamente.',
            matchField: 'phone',
            existingClientId: deleted.id,
            existingClientName: deleted.name,
          });
        }
      }
    }
  }

  private async findProbableDuplicates(
    tenantId: string,
    name: string,
    email: string | null,
    phone: string | null,
  ): Promise<ClientDuplicateCandidate[]> {
    // Same accent-insensitive name, no exact contact match (those already blocked).
    const nameKey = clientNameMatchKey(name);
    const actives = await this.prisma.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true },
      take: 5000,
    });
    const out: ClientDuplicateCandidate[] = [];
    for (const c of actives) {
      if (clientNameMatchKey(c.name) !== nameKey) continue;
      // If they share contact we would have thrown; name-only overlap is probable.
      const sameEmail =
        email &&
        normalizeClientEmail(c.email) &&
        normalizeClientEmail(c.email) === email;
      const samePhone =
        phone &&
        clientPhoneMatchKey(normalizeClientPhone(c.phone)) === clientPhoneMatchKey(phone);
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
