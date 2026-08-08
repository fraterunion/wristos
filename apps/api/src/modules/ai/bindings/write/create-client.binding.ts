import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  ClientRegistrationService,
  RegisterClientResult,
} from '../../../crm/client-registration.service';
import {
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from '../../../crm/client-identity.util';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';

const createClientInputSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(7).max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(80)).max(30).optional(),
  budgetRange: z.string().max(80).nullable().optional(),
  allowProbableDuplicate: z.boolean().optional(),
  registerIdempotencyKey: z.string().min(1),
});

export type CreateClientWriteInput = z.infer<typeof createClientInputSchema>;

function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

export function createClientIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

@Injectable()
export class CreateClientWriteBinding
  implements WriteCapabilityBindingDefinition<CreateClientWriteInput>
{
  readonly capability = 'CREATE_CLIENT' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'create_client_canonical@1.0.0';
  readonly inputSchema = createClientInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registration: ClientRegistrationService,
  ) {}

  mapInput(step: BusinessPlanStep, context: WriteExecutionContext): CreateClientWriteInput {
    if (step.capability !== 'CREATE_CLIENT') {
      throw new BadRequestException('Unexpected capability for CREATE_CLIENT binding');
    }
    const args = step.arguments as Record<string, unknown>;
    // Never accept client-supplied idempotency keys.
    const name = normalizeClientName(asString(args.name) ?? '');
    if (!name) {
      throw new BadRequestException('CREATE_CLIENT requires name');
    }

    const emailRaw = asString(args.email);
    const email = emailRaw ? normalizeClientEmail(emailRaw) : null;
    if (emailRaw && !email) {
      throw new BadRequestException('CREATE_CLIENT email is invalid');
    }

    const phoneRaw = asString(args.phone);
    const phone = phoneRaw ? normalizeClientPhone(phoneRaw) : null;
    if (phoneRaw && !phone) {
      throw new BadRequestException('CREATE_CLIENT phone is invalid');
    }

    const notes = asString(args.notes);
    const budgetRange = asString(args.budgetRange);
    const tags = Array.isArray(args.tags)
      ? args.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30)
      : undefined;

    return createClientInputSchema.parse({
      name,
      email,
      phone,
      notes,
      tags,
      budgetRange,
      allowProbableDuplicate: asBool(args.allowProbableDuplicate),
      registerIdempotencyKey: createClientIdempotencyKey(context.actionRunId),
    });
  }

  async execute(
    input: CreateClientWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context.tenantId, context.userId);

    try {
      const result = await this.registration.register(context.tenantId, {
        name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        tags: input.tags,
        budgetRange: input.budgetRange,
        allowProbableDuplicate: input.allowProbableDuplicate === true,
        registerIdempotencyKey: input.registerIdempotencyKey,
      });
      return this.toResult(result);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw error;
    }
  }

  private async assertMembership(tenantId: string, userId: string) {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Actor is not a member of this tenant');
    }
  }

  private toResult(result: RegisterClientResult): BusinessActionResult {
    const client = result.client;
    return {
      actionId: 'CREATE_CLIENT',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'CLIENT',
          id: idHash(client.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
      ],
      warnings: [],
      generatedEvents: [],
      receipt: {
        kind: 'CLIENT_CREATED',
        clientId: client.id,
        name: client.name,
        hasEmail: Boolean(client.email),
        hasPhone: Boolean(client.phone),
        // Masked contact for UI only — never put full raw values in audit elsewhere.
        emailMasked: client.email ? maskEmail(client.email) : null,
        phoneMasked: client.phone ? maskPhone(client.phone) : null,
        replayed: result.replayed,
        probableDuplicateCount: result.probableDuplicates.length,
      } as unknown as JsonValue,
      rollbackPossible: false,
    };
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '••••';
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••• ${digits.slice(-4)}`;
}
