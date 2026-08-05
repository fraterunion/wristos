import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListAccountEntriesQueryDto {
  @IsOptional()
  @IsEnum(AccountEntryType)
  type?: AccountEntryType;

  @IsOptional()
  @IsEnum(AccountEntryStatus)
  status?: AccountEntryStatus;

  @IsOptional()
  @IsEnum(AccountEntrySource)
  source?: AccountEntrySource;

  @IsOptional()
  @IsString()
  clientId?: string;

  /** Search counterparty, concept, notes, or reference. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
