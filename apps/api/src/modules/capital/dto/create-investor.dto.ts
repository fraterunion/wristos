import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateInvestorDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ownershipPercent!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
