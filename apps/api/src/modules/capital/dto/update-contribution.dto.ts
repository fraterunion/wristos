import { CapitalAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateContributionDto {
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
  contributedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
