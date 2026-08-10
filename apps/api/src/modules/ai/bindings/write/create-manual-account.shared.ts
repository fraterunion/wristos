import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { z } from 'zod';
import { toAccountBusinessDate } from '../../../cuentas/manual-account-entry.service';

const currencySchema = z.enum(['MXN', 'USD']);

export const createManualAccountInputSchema = z.object({
  counterpartyName: z.string().min(1).max(160),
  concept: z.string().min(1).max(200),
  amount: z.number().positive(),
  currency: currencySchema,
  clientId: z.string().min(1).nullable().optional(),
  issuedAt: z.date().nullable().optional(),
  dueDate: z.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  registerIdempotencyKey: z.string().min(1),
});

export type CreateManualAccountWriteInput = z.infer<typeof createManualAccountInputSchema>;

/** Server-owned logical key — never from LLM / client / planner args. */
export function createManualAccountIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

export const createReceivableIdempotencyKey = createManualAccountIdempotencyKey;
export const createPayableIdempotencyKey = createManualAccountIdempotencyKey;

export function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeManualAccountCurrency(raw: unknown): Currency | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'MXN' || upper === 'USD') return upper as Currency;
  return null;
}

export function normalizeOptionalBusinessDate(
  value: unknown,
  field: string,
): Date | null {
  if (value == null || value === '') return null;
  try {
    return toAccountBusinessDate(value as Date | string, field);
  } catch {
    throw new BadRequestException(`${field} is invalid`);
  }
}

export function formatMoney(amount: number | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  return n.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function defaultConcept(kind: 'RECEIVABLE' | 'PAYABLE'): string {
  return kind === 'RECEIVABLE' ? 'Cuenta por cobrar' : 'Cuenta por pagar';
}
