import { ClientInteractionType } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateClientInteractionDto {
  @IsEnum(ClientInteractionType)
  type!: ClientInteractionType;

  @IsString()
  @IsNotEmpty()
  notes!: string;

  @IsDateString()
  occurredAt!: string;
}
