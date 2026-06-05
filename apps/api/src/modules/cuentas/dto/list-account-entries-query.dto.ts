import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
} from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
