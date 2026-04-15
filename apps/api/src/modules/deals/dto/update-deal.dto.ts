import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateDealDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  watchId?: string;

  @IsOptional()
  @IsDateString()
  expectedCloseAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  agreedPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
