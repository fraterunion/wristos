import { CapitalAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * PATCH /capital/distributions/:id — notes-only after Commit 23B.
 * Economic fields (amount/account/paidAt) are accepted for detection and
 * rejected with CAPITAL_DISTRIBUTION_IMMUTABLE (do not silently ignore).
 */
export class UpdateDistributionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsEnum(CapitalAccount)
  account?: CapitalAccount;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Optional optimistic concurrency token (ISO timestamp of row.updatedAt). */
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}
