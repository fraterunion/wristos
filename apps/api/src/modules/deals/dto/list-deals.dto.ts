import { DealStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListDealsDto {
  @IsOptional()
  @IsEnum(DealStage)
  stage?: DealStage;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  watchId?: string;
}
