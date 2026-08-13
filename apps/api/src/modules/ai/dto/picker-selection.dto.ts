import { AIConversationSurface } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CONTEXT_ENTITY_TYPES, ContextEntityType } from '../context/entity-types';

/**
 * A picker click is an EVENT, not a chat message: the frontend already knows
 * the selected candidate's trusted id (it came from the server's own last
 * ENTITY_PICKER response) and must submit it directly instead of re-encoding
 * the candidate's label as free text through /ai/assistant/message. See
 * NaturalLanguageAssistantService.handlePickerSelection().
 */
export class PickerSelectionDto {
  @IsOptional() @IsString() @MaxLength(128) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(128) workspaceId?: string;
  @IsEnum(CONTEXT_ENTITY_TYPES) entityType!: ContextEntityType;
  @IsString() @MinLength(1) @MaxLength(128) selectedId!: string;
  @IsString() @MinLength(1) @MaxLength(160) selectedLabel!: string;
  @IsEnum(AIConversationSurface) surface!: AIConversationSurface;
  @IsOptional() @IsString() @MaxLength(35) locale?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsString() @MinLength(1) @MaxLength(128) clientRequestId!: string;
}
