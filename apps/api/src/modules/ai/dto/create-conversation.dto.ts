import { AIConversationSurface } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsEnum(AIConversationSurface) surface!: AIConversationSurface;
}
