import { WatchOwnershipType, WatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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

export class CreateWatchDto {
  @Validate(WatchOwnershipConsignmentConstraint)
  @IsEnum(WatchOwnershipType)
  ownershipType!: WatchOwnershipType;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsString()
  @IsNotEmpty()
  condition!: string;

  @IsOptional()
  @IsIn(['MXN', 'USD'])
  costCurrency?: 'MXN' | 'USD';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMin!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMax!: number;

  @IsOptional()
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @ValidateIf((o: CreateWatchDto) => o.ownershipType === WatchOwnershipType.CONSIGNMENT)
  @IsOptional()
  @IsString()
  consignmentOwnerName?: string;

  @ValidateIf((o: CreateWatchDto) => o.ownershipType === WatchOwnershipType.CONSIGNMENT)
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  consignmentSplitPercentage?: number;
}
