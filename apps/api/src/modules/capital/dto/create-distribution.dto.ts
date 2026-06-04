import { CapitalAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateDistributionDto {
  @IsString()
  investorId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsEnum(CapitalAccount)
  account!: CapitalAccount;

  @IsDateString()
  paidAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
