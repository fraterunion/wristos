import {
  AccountEntryCategory,
  CounterpartyType,
  Currency,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateManualPayableDto {
  @IsString()
  @IsNotEmpty()
  counterpartyName!: string;

  @IsString()
  @IsNotEmpty()
  concept!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount!: number;

  @IsOptional()
  @IsEnum(AccountEntryCategory)
  category?: AccountEntryCategory;

  @IsOptional()
  @IsEnum(CounterpartyType)
  counterpartyType?: CounterpartyType;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  /**
   * Durable idempotency. Future AI marker: `ai-action-run:<actionRunId>`.
   * Manual UI may omit.
   */
  @IsOptional()
  @IsString()
  registerIdempotencyKey?: string;
}
