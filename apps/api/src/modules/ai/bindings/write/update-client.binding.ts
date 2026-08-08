import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  ClientUpdateService,
  UpdateClientPatch,
} from '../../../crm/client-update.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import {
  intendedFieldsMatch,
  maskEmail,
  maskPhone,
} from './update-client-operations';

const updateClientInputSchema = z.object({
  clientId: z.string().min(1),
  expectedUpdatedAt: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).max(160).optional(),
    email: z.union([z.string().email(), z.null()]).optional(),
    phone: z.union([z.string().min(7).max(32), z.null()]).optional(),
    notes: z.union([z.string().max(2000), z.null()]).optional(),
    tags: z.array(z.string().max(80)).max(30).optional(),
    budgetRange: z.union([z.string().max(80), z.null()]).optional(),
  }),
  operations: z.array(z.string()).max(20).optional(),
  changedFields: z.array(z.string()).max(20).optional(),
});

export type UpdateClientWriteInput = z.infer<typeof updateClientInputSchema>;

function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function conflictCode(error: unknown): string | null {
  if (!(error instanceof ConflictException)) return null;
  const body = error.getResponse();
  if (typeof body === 'object' && body && 'code' in body) {
    return String((body as { code?: unknown }).code ?? '') || null;
  }
  return null;
}

@Injectable()
export class UpdateClientWriteBinding
  implements WriteCapabilityBindingDefinition<UpdateClientWriteInput>
{
  readonly capability = 'UPDATE_CLIENT' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'update_client_canonical@1.0.0';
  readonly inputSchema = updateClientInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientUpdate: ClientUpdateService,
  ) {}

  mapInput(step: BusinessPlanStep, _context: WriteExecutionContext): UpdateClientWriteInput {
    if (step.capability !== 'UPDATE_CLIENT') {
      throw new BadRequestException('Unexpected capability for UPDATE_CLIENT binding');
    }
    const args = step.arguments as Record<string, unknown>;
    const clientId = asString(args.clientId) ?? asString(args.selectedClientId);
    const expectedUpdatedAt = asString(args.expectedUpdatedAt);
    if (!clientId || !expectedUpdatedAt) {
      throw new BadRequestException('UPDATE_CLIENT requires trusted clientId and expectedUpdatedAt');
    }

    const patch: UpdateClientPatch = {};
    if (args.patchName !== undefined) patch.name = String(args.patchName);
    if (args.patchEmail !== undefined) {
      patch.email = args.patchEmail === null || args.patchEmail === '' ? null : String(args.patchEmail);
    }
    if (args.patchPhone !== undefined) {
      patch.phone = args.patchPhone === null || args.patchPhone === '' ? null : String(args.patchPhone);
    }
    if (args.patchNotes !== undefined) {
      patch.notes = args.patchNotes === null ? null : String(args.patchNotes);
    }
    if (Array.isArray(args.patchTags)) {
      patch.tags = args.patchTags.map((t) => String(t));
    }
    if (args.patchBudgetRange !== undefined) {
      patch.budgetRange =
        args.patchBudgetRange === null || args.patchBudgetRange === ''
          ? null
          : String(args.patchBudgetRange);
    }

    // Also accept nested patch object if present.
    if (args.patch && typeof args.patch === 'object') {
      Object.assign(patch, args.patch as UpdateClientPatch);
    }

    if (!Object.keys(patch).length) {
      throw new BadRequestException('UPDATE_CLIENT requires a non-empty materialized patch');
    }

    const operations = Array.isArray(args.operations)
      ? args.operations.map((o) => String(o))
      : undefined;
    const changedFields = Array.isArray(args.changedFields)
      ? args.changedFields.map((o) => String(o))
      : Object.keys(patch);

    return updateClientInputSchema.parse({
      clientId,
      expectedUpdatedAt,
      patch,
      operations,
      changedFields,
    });
  }

  async execute(
    input: UpdateClientWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context.tenantId, context.userId);

    try {
      const result = await this.clientUpdate.update(
        context.tenantId,
        input.clientId,
        input.patch,
        { expectedUpdatedAt: input.expectedUpdatedAt },
      );
      return this.toResult(result.client, {
        changedFields: result.changedFields,
        recovered: false,
        subsequentChangesDetected: false,
        noop: result.noop,
      });
    } catch (error) {
      if (conflictCode(error) === 'CLIENT_STALE') {
        return this.recoverIfIntendedStateIntact(input, context.tenantId, error);
      }
      throw error;
    }
  }

  /**
   * Conservative recovery without durable UPDATE marker:
   * If CAS fails but every intended field already equals the planned FINAL values,
   * reconstruct success. Same-field later mutations → AMBIGUOUS_RECOVERY.
   */
  private async recoverIfIntendedStateIntact(
    input: UpdateClientWriteInput,
    tenantId: string,
    originalError: unknown,
  ): Promise<BusinessActionResult> {
    const current = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException('Client not found');
    }

    const snapshot = {
      id: current.id,
      name: current.name,
      email: current.email,
      phone: current.phone,
      notes: current.notes,
      tags: current.tags ?? [],
      budgetRange: current.budgetRange,
      updatedAt: current.updatedAt,
    };

    if (!intendedFieldsMatch(snapshot, input.patch)) {
      throw new ConflictException({
        code: 'AMBIGUOUS_RECOVERY',
        message:
          'Este cliente cambió desde que preparé la actualización. Revisemos los datos actuales antes de continuar.',
        unchanged: 'No se aplicó ningún cambio adicional.',
      });
    }

    const expectedMs = new Date(input.expectedUpdatedAt).getTime();
    const subsequentChangesDetected = current.updatedAt.getTime() !== expectedMs;

    return this.toResult(current, {
      changedFields: (input.changedFields ?? Object.keys(input.patch)) as Array<
        'name' | 'email' | 'phone' | 'notes' | 'tags' | 'budgetRange'
      >,
      recovered: true,
      subsequentChangesDetected,
      noop: false,
    });
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

  private toResult(
    client: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      notes: string | null;
      tags: string[];
      budgetRange: string | null;
    },
    meta: {
      changedFields: string[];
      recovered: boolean;
      subsequentChangesDetected: boolean;
      noop: boolean;
    },
  ): BusinessActionResult {
    return {
      actionId: 'UPDATE_CLIENT',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'CLIENT',
          id: idHash(client.id),
          effect: meta.recovered ? 'REPLAYED' : 'UPDATED',
        },
      ],
      warnings: meta.subsequentChangesDetected
        ? [
            {
              code: 'SUBSEQUENT_CHANGES_DETECTED',
              message: 'Hubo otros cambios en el cliente después de la actualización prevista.',
            },
          ]
        : [],
      generatedEvents: [],
      receipt: {
        kind: 'CLIENT_UPDATED',
        clientId: client.id,
        name: client.name,
        changedFields: meta.changedFields,
        hasEmail: Boolean(client.email),
        hasPhone: Boolean(client.phone),
        emailMasked: client.email ? maskEmail(client.email) : null,
        phoneMasked: client.phone ? maskPhone(client.phone) : null,
        recovered: meta.recovered,
        subsequentChangesDetected: meta.subsequentChangesDetected,
        noop: meta.noop,
      } as unknown as JsonValue,
      rollbackPossible: false,
    };
  }
}
