import { StorefrontReservationStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class ListStorefrontReservationsDto {
  @IsOptional()
  @IsEnum(StorefrontReservationStatus)
  status?: StorefrontReservationStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
