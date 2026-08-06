import { AIConversationSurface, AIInteractionState, Prisma } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateWorkspaceDto {
  @IsEnum(AIConversationSurface) surface!: AIConversationSurface;
  @IsOptional() @IsString() conversationId?: string;
  @IsOptional() @IsString() activeActionRunId?: string;
  @IsOptional() @IsEnum(AIInteractionState) interactionState?: AIInteractionState;
  @IsOptional() @IsObject() draftPayload?: Prisma.InputJsonObject;
  @IsOptional() @IsObject() resolvedContext?: Prisma.InputJsonObject;
  @IsOptional() @IsObject() selectedEntities?: Prisma.InputJsonObject;
  @IsOptional() @IsObject() pendingResponse?: Prisma.InputJsonObject;
}

export class UpdateWorkspaceDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() conversationId?: string | null;
  @IsOptional() @IsString() activeActionRunId?: string | null;
  @IsOptional() @IsEnum(AIInteractionState) interactionState?: AIInteractionState;
  @IsOptional() @IsObject() draftPayload?: Prisma.InputJsonObject | null;
  @IsOptional() @IsObject() resolvedContext?: Prisma.InputJsonObject | null;
  @IsOptional() @IsObject() selectedEntities?: Prisma.InputJsonObject | null;
  @IsOptional() @IsObject() pendingResponse?: Prisma.InputJsonObject | null;
}

export class WorkspaceVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
