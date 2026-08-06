import { AIMessageRole, Prisma } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class AppendMessageDto {
  @IsString() @MinLength(1) conversationId!: string;
  @IsEnum(AIMessageRole) role!: AIMessageRole;
  @IsString() content!: string;
  @IsOptional() @IsObject() structuredPayload?: Prisma.InputJsonObject;
  @IsOptional() @IsObject() metadata?: Prisma.InputJsonObject;
  @IsOptional() @IsInt() @Min(0) tokenCount?: number;
}
