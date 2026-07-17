import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DataImportEntityType } from '@prisma/client';

export class CreateDataImportSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class ListDataImportRecordsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fileId?: string;

  @IsOptional()
  @IsEnum(DataImportEntityType)
  entityType?: DataImportEntityType;

  @IsOptional()
  @IsIn(['true', 'false'])
  valid?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
