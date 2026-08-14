import { AIConversationSurface } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * "Empezar de nuevo" — Conversation Reset (V1 simplicity, not conversational
 * editing). Clears the in-flight transaction (ConversationDraft, pending
 * clarification/picker state, plan checkpoint) while the conversation's
 * message history and every completed ActionRun stay untouched. See
 * NaturalLanguageAssistantService.resetConversation().
 */
export class ConversationResetDto {
  @IsOptional() @IsString() @MaxLength(128) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(128) workspaceId?: string;
  @IsEnum(AIConversationSurface) surface!: AIConversationSurface;
  @IsOptional() @IsString() @MaxLength(35) locale?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsString() @MinLength(1) @MaxLength(128) clientRequestId!: string;
}
