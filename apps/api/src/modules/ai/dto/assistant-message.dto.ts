import { AIConversationSurface } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_USER_TEXT_LENGTH } from '../intent-adapter/safety';

export class AssistantMessageDto {
  @IsOptional() @IsString() @MaxLength(128) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(128) workspaceId?: string;
  @IsString() @MinLength(1) @MaxLength(MAX_USER_TEXT_LENGTH) text!: string;
  @IsEnum(AIConversationSurface) surface!: AIConversationSurface;
  @IsOptional() @IsString() @MaxLength(35) locale?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsString() @MinLength(1) @MaxLength(128) clientRequestId!: string;
}
