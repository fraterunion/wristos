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

export class CreateHoldingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9.\-_]+$/, {
    message: 'ticker must be alphanumeric (dots, dashes, underscores allowed)',
  })
  ticker!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 18 })
  @Min(0)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  averageCostMxn!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  location!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  custodian?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
