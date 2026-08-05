import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePriceSnapshotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9.\-_]+$/, {
    message: 'ticker must be alphanumeric (dots, dashes, underscores allowed)',
  })
  ticker!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  priceMxn!: number;

  /** Explicit market observation time — required; never inferred from createdAt. */
  @IsDateString()
  capturedAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  source!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
