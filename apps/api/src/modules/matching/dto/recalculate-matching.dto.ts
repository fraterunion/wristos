import { IsOptional, IsString } from 'class-validator';

export class RecalculateMatchingDto {
  @IsOptional()
  @IsString()
  watchId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;
}
