import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Client, ClientInteraction, ClientPreference, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientRegistrationService } from './client-registration.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientInteractionDto } from './dto/create-client-interaction.dto';
import { ListClientInteractionsDto } from './dto/list-client-interactions.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { UpsertClientPreferenceDto } from './dto/upsert-client-preference.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import {
  clientPhoneIdentityKey,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from './client-identity.util';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registration: ClientRegistrationService,
  ) {}

  async createClient(tenantId: string, dto: CreateClientDto) {
    const result = await this.registration.register(tenantId, {
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      notes: dto.notes,
      tags: dto.tags,
      budgetRange: dto.budgetRange,
      registerIdempotencyKey: dto.registerIdempotencyKey,
    });
    return this.serializeClient(result.client);
  }

  async listClients(tenantId: string, query: ListClientsDto) {
    const where: Prisma.ClientWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.name !== undefined && query.name.trim() !== '') {
      where.name = { contains: query.name.trim(), mode: 'insensitive' };
    }

    if (query.phone !== undefined && query.phone.trim() !== '') {
      where.phone = { contains: query.phone.trim(), mode: 'insensitive' };
    }

    if (query.tag !== undefined && query.tag.trim() !== '') {
      where.tags = { has: query.tag.trim() };
    }

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return clients.map((client) => this.serializeClient(client));
  }

  async searchClientsForTools(tenantId: string, query: string, limit: number) {
    const clients = await this.prisma.client.findMany({
      where: { tenantId, deletedAt: null, name: { contains: query.trim(), mode: 'insensitive' } },
      include: { accountEntries: { where: { deletedAt: null, type: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } }, select: { currency: true, totalAmount: true, payments: { where: { deletedAt: null }, select: { amount: true } } } }, interactions: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], take: Math.min(limit, 50),
    });
    return clients.map((client) => {
      const totals = { MXN: new Prisma.Decimal(0), USD: new Prisma.Decimal(0) };
      for (const entry of client.accountEntries) totals[entry.currency] = totals[entry.currency].plus(entry.totalAmount.minus(entry.payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0))));
      return { id: client.id, name: client.name, normalizedName: client.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), phone: client.phone, email: client.email, openReceivableCount: client.accountEntries.length, openReceivableTotalByCurrency: { MXN: totals.MXN.toFixed(2), USD: totals.USD.toFixed(2) }, lastActivityAt: client.interactions[0]?.occurredAt.toISOString() ?? null };
    });
  }

  async getClientById(id: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return this.serializeClient(client);
  }

  async updateClient(id: string, tenantId: string, dto: UpdateClientDto) {
    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    const data: Prisma.ClientUpdateInput = {};

    if (dto.name !== undefined) data.name = normalizeClientName(dto.name);
    if (dto.email !== undefined) {
      data.email =
        dto.email === null || dto.email === ''
          ? null
          : normalizeClientEmail(dto.email);
    }
    if (dto.phone !== undefined) {
      if (dto.phone === null || dto.phone === '') {
        data.phone = null;
      } else {
        const phone = normalizeClientPhone(dto.phone);
        if (!phone) {
          throw new BadRequestException('phone must be a valid phone-like string');
        }
        data.phone = phone;
      }
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.budgetRange !== undefined) data.budgetRange = dto.budgetRange;

    if (Object.keys(data).length === 0) {
      return this.serializeClient(existing);
    }

    // Exact contact uniqueness on update (exclude self) — DB unique is the race boundary
    const nextEmail =
      data.email !== undefined
        ? ((data.email as string | null) ?? null)
        : existing.email;
    const nextPhone =
      data.phone !== undefined
        ? ((data.phone as string | null) ?? null)
        : existing.phone;
    if (nextEmail && nextEmail !== existing.email) {
      const clash = await this.prisma.client.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          id: { not: id },
          email: { equals: nextEmail, mode: 'insensitive' },
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
          id: { not: id },
          email: { equals: nextEmail, mode: 'insensitive' },
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
    if (nextPhone && nextPhone !== existing.phone) {
      const key = clientPhoneIdentityKey(nextPhone);
      if (key) {
        const others = await this.prisma.client.findMany({
          where: { tenantId, id: { not: id }, phone: { not: null } },
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

    try {
      const client = await this.prisma.client.update({
        where: { id },
        data,
      });
      return this.serializeClient(client);
    } catch (error) {
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

  async deleteClient(id: string, tenantId: string) {
    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    await this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async createInteraction(
    clientId: string,
    tenantId: string,
    dto: CreateClientInteractionDto,
  ) {
    await this.ensureClientInTenant(clientId, tenantId);

    const interaction = await this.prisma.clientInteraction.create({
      data: {
        tenant: { connect: { id: tenantId } },
        client: { connect: { id: clientId } },
        type: dto.type,
        notes: dto.notes,
        occurredAt: new Date(dto.occurredAt),
      },
    });

    return this.serializeInteraction(interaction);
  }

  async listInteractions(
    clientId: string,
    tenantId: string,
    query: ListClientInteractionsDto,
  ) {
    await this.ensureClientInTenant(clientId, tenantId);

    const where: Prisma.ClientInteractionWhereInput = {
      tenantId,
      clientId,
    };

    if (query.type !== undefined) {
      where.type = query.type;
    }

    const interactions = await this.prisma.clientInteraction.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
    });

    return interactions.map((interaction) => this.serializeInteraction(interaction));
  }

  async getClientPreference(clientId: string, tenantId: string) {
    await this.ensureClientInTenant(clientId, tenantId);

    const preference = await this.prisma.clientPreference.findFirst({
      where: { tenantId, clientId },
    });

    if (!preference) {
      return null;
    }

    return this.serializePreference(preference);
  }

  async upsertClientPreference(
    clientId: string,
    tenantId: string,
    dto: UpsertClientPreferenceDto,
  ) {
    await this.ensureClientInTenant(clientId, tenantId);

    if (
      dto.budgetMin !== undefined &&
      dto.budgetMin !== null &&
      dto.budgetMax !== undefined &&
      dto.budgetMax !== null &&
      dto.budgetMin > dto.budgetMax
    ) {
      throw new BadRequestException(
        'budgetMin must be less than or equal to budgetMax',
      );
    }

    const preference = await this.prisma.clientPreference.upsert({
      where: {
        tenantId_clientId: {
          tenantId,
          clientId,
        },
      },
      create: {
        tenant: { connect: { id: tenantId } },
        client: { connect: { id: clientId } },
        preferredBrands: dto.preferredBrands ?? [],
        preferredModels: dto.preferredModels ?? [],
        budgetMin:
          dto.budgetMin === undefined || dto.budgetMin === null
            ? null
            : new Prisma.Decimal(dto.budgetMin),
        budgetMax:
          dto.budgetMax === undefined || dto.budgetMax === null
            ? null
            : new Prisma.Decimal(dto.budgetMax),
        notes: dto.notes ?? null,
      },
      update: {
        preferredBrands: dto.preferredBrands ?? [],
        preferredModels: dto.preferredModels ?? [],
        budgetMin:
          dto.budgetMin === undefined || dto.budgetMin === null
            ? null
            : new Prisma.Decimal(dto.budgetMin),
        budgetMax:
          dto.budgetMax === undefined || dto.budgetMax === null
            ? null
            : new Prisma.Decimal(dto.budgetMax),
        notes: dto.notes ?? null,
      },
    });

    return this.serializePreference(preference);
  }

  private async ensureClientInTenant(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }

  private serializeClient(client: Client) {
    return {
      id: client.id,
      tenantId: client.tenantId,
      name: client.name,
      email: client.email,
      phone: client.phone,
      notes: client.notes,
      tags: client.tags,
      budgetRange: client.budgetRange,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    };
  }

  private serializeInteraction(interaction: ClientInteraction) {
    return {
      id: interaction.id,
      tenantId: interaction.tenantId,
      clientId: interaction.clientId,
      type: interaction.type,
      notes: interaction.notes,
      occurredAt: interaction.occurredAt.toISOString(),
      createdAt: interaction.createdAt.toISOString(),
    };
  }

  private serializePreference(preference: ClientPreference) {
    return {
      id: preference.id,
      tenantId: preference.tenantId,
      clientId: preference.clientId,
      preferredBrands: preference.preferredBrands,
      preferredModels: preference.preferredModels,
      budgetMin: preference.budgetMin?.toString() ?? null,
      budgetMax: preference.budgetMax?.toString() ?? null,
      notes: preference.notes,
      createdAt: preference.createdAt.toISOString(),
      updatedAt: preference.updatedAt.toISOString(),
    };
  }
}
