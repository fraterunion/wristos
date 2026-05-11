import { MarketListingIntent } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateListingDto {
  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  watchReferenceId?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  conditionNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @IsString()
  priceCurrency?: string;

  @IsOptional()
  @IsBoolean()
  hasBox?: boolean;

  @IsOptional()
  @IsBoolean()
  hasPapers?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsEnum(MarketListingIntent)
  intent?: MarketListingIntent;

  @IsOptional()
  @IsString()
  dealerNotes?: string;
}
