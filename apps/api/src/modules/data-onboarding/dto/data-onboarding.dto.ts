import { IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DataImportEntityType } from '@prisma/client';

import { DuplicatePolicy, SKIP_FIELD, WATCH_IMPORT_FIELDS } from '../inventory-import/watch-import.types';

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

  @IsOptional()
  @IsIn(['VALID', 'WARNING', 'INVALID'])
  rowStatus?: 'VALID' | 'WARNING' | 'INVALID';
}

export class MappingEntryDto {
  @IsString()
  @MaxLength(255)
  sourceColumn!: string;

  @IsString()
  @IsIn([...WATCH_IMPORT_FIELDS, SKIP_FIELD])
  targetField!: string;
}

export class SaveMappingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingEntryDto)
  mapping!: MappingEntryDto[];
}

export class CommitImportDto {
  @IsIn(['SKIP_DUPLICATES', 'IMPORT_AS_NEW'])
  duplicatePolicy!: DuplicatePolicy;
}
