import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const ACCOUNTS = ['CASH', 'BANK', 'CESAR'] as const;

export class RegisterTreasuryTransferDto {
  @IsIn(ACCOUNTS)
  sourceAccount!: (typeof ACCOUNTS)[number];

  @IsIn(ACCOUNTS)
  destinationAccount!: (typeof ACCOUNTS)[number];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsDateString()
  transferDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Optional durable logical key for idempotent register. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  registerIdempotencyKey?: string;
}
