import { ClientInteractionType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListClientInteractionsDto {
  @IsOptional()
  @IsEnum(ClientInteractionType)
  type?: ClientInteractionType;
}
