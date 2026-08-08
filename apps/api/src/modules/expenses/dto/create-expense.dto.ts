import { OperatingExpenseCategory, TreasuryAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Paid-from sources for cash-linked Gastos (CRYPTO unsupported). */
const EXPENSE_SOURCES = [TreasuryAccount.CASH, TreasuryAccount.BANK, TreasuryAccount.CESAR] as const;

export class CreateExpenseDto {
  @IsEnum(OperatingExpenseCategory)
  category!: OperatingExpenseCategory;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Required for canonical paid registration (Commit 15A). */
  @IsEnum(TreasuryAccount)
  source!: (typeof EXPENSE_SOURCES)[number];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  expenseDate!: string;

  /** Optional durable idempotency key (manual retries / future AI). */
  @IsOptional()
  @IsString()
  registerIdempotencyKey?: string;
}
