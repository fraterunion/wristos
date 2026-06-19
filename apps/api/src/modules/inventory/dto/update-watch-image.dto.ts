import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class UpdateWatchImageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsUrl({}, { message: 'url must be a valid URL' })
  url?: string;

  @IsOptional()
  @IsString()
  altText?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
