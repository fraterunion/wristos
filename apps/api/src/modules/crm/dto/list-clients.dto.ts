import { IsOptional, IsString } from 'class-validator';

export class ListClientsDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  tag?: string;
}
