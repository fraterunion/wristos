import { Currency, ReceivableStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AgingBucket } from '../receivable-balance';

export class ListReceivablesDto {
  @IsOptional()
  @IsEnum(ReceivableStatus)
  status?: ReceivableStatus;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'])
  aging?: AgingBucket;

  @IsOptional()
  @IsIn([
    'issueDate_asc',
    'issueDate_desc',
    'dueDate_asc',
    'dueDate_desc',
    'amount_asc',
    'amount_desc',
    'remaining_asc',
    'remaining_desc',
  ])
  sort?:
    | 'issueDate_asc'
    | 'issueDate_desc'
    | 'dueDate_asc'
    | 'dueDate_desc'
    | 'amount_asc'
    | 'amount_desc'
    | 'remaining_asc'
    | 'remaining_desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
