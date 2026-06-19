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

export class CreateWatchImageDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({}, { message: 'url must be a valid URL' })
  url!: string;

  @IsOptional()
  @IsString()
  altText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
