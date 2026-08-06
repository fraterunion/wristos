import { AIConversationSurface } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { BUSINESS_ACTIONS } from '../planner/actions/business-actions';
import { BusinessActionId } from '../planner/planner.types';
import { JsonValue } from '../domain/canonical-json';

const actionIds = BUSINESS_ACTIONS.map((action) => action.id);

export class StructuredAssistantRequestDto {
  @IsOptional() @IsString() @MaxLength(128) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(128) workspaceId?: string;
  @IsString() @IsIn(actionIds) intent!: BusinessActionId;
  @IsObject() entities!: Record<string, JsonValue>;
  @IsOptional() @IsObject() entityVersions?: Record<string, string | number>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedWorkspaceVersion?: number;
  @IsEnum(AIConversationSurface) surface!: AIConversationSurface;
  @IsOptional() @IsString() @MaxLength(35) locale?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsString() @MinLength(1) @MaxLength(128) clientRequestId!: string;
  @IsOptional() @IsString() @MaxLength(2000) userDisplayText?: string;
}
