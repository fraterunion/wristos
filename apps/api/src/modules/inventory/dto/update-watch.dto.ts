import { WatchOwnershipType, WatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { WatchOwnershipConsignmentConstraint } from '../validators/watch-ownership-consignment.validator';

export class UpdateWatchDto {
  @Validate(WatchOwnershipConsignmentConstraint)
  @IsOptional()
  @IsEnum(WatchOwnershipType)
  ownershipType?: WatchOwnershipType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  brand?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  model?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  condition?: string;

  @IsOptional()
  @IsIn(['MXN', 'USD'])
  costCurrency?: 'MXN' | 'USD';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @ValidateIf(
    (o: UpdateWatchDto) =>
      o.ownershipType === undefined ||
      o.ownershipType === WatchOwnershipType.CONSIGNMENT,
  )
  @IsOptional()
  @IsString()
  consignmentOwnerName?: string | null;

  @ValidateIf(
    (o: UpdateWatchDto) =>
      o.ownershipType === undefined ||
      o.ownershipType === WatchOwnershipType.CONSIGNMENT,
  )
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  consignmentSplitPercentage?: number | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsString()
  @ValidateIf((o: UpdateWatchDto) => o.publicSlug !== null && o.publicSlug !== undefined)
  @IsNotEmpty()
  publicSlug?: string | null;

  @IsOptional()
  @IsString()
  publicDescription?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  publicPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reservationAmount?: number | null;
}
