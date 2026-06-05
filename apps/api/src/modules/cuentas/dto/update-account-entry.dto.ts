import {
  AccountEntryCategory,
  AccountEntrySource,
  AccountEntryStatus,
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

export class UpdateAccountEntryDto {
  @IsOptional()
  @IsEnum(AccountEntryType)
  type?: AccountEntryType;

  @IsOptional()
  @IsEnum(AccountEntryStatus)
  status?: AccountEntryStatus;

  @IsOptional()
  @IsEnum(AccountEntryCategory)
  category?: AccountEntryCategory;

  @IsOptional()
  @IsEnum(AccountEntrySource)
  source?: AccountEntrySource;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  counterpartyName?: string;

  @IsOptional()
  @IsEnum(CounterpartyType)
  counterpartyType?: CounterpartyType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  concept?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount?: number;

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
