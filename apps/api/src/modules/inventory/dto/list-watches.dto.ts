import { WatchStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListWatchesDto {
  @IsOptional()
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;
}
