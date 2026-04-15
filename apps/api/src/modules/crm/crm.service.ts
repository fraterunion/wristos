import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Client, ClientInteraction, ClientPreference, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientInteractionDto } from './dto/create-client-interaction.dto';
import { ListClientInteractionsDto } from './dto/list-client-interactions.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { UpsertClientPreferenceDto } from './dto/upsert-client-preference.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  async createClient(tenantId: string, dto: CreateClientDto) {
    const client = await this.prisma.client.create({
      data: {
        tenant: { connect: { id: tenantId } },
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        notes: dto.notes,
        tags: dto.tags ?? [],
        budgetRange: dto.budgetRange,
      },
    });

    return this.serializeClient(client);
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

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.budgetRange !== undefined) data.budgetRange = dto.budgetRange;

    if (Object.keys(data).length === 0) {
      return this.serializeClient(existing);
    }

    const client = await this.prisma.client.update({
      where: { id },
      data,
    });

    return this.serializeClient(client);
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
