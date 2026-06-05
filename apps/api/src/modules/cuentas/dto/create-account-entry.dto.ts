import {
  AccountEntryCategory,
  AccountEntrySource,
  AccountEntryType,
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

export class CreateAccountEntryDto {
  @IsEnum(AccountEntryType)
  type!: AccountEntryType;

  @IsOptional()
  @IsEnum(AccountEntryCategory)
  category?: AccountEntryCategory;

  @IsOptional()
  @IsEnum(AccountEntrySource)
  source?: AccountEntrySource;

  @IsString()
  @IsNotEmpty()
  counterpartyName!: string;

  @IsOptional()
  @IsEnum(CounterpartyType)
  counterpartyType?: CounterpartyType;

  @IsString()
  @IsNotEmpty()
  concept!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount!: number;

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

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  watchId?: string;

  @IsOptional()
  @IsString()
  expenseId?: string;
}
