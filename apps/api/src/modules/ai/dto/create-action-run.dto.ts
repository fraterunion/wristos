import { Prisma } from '@prisma/client';
import { IsBoolean, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateActionRunDto {
  @IsString() @MinLength(1) conversationId!: string;
  @IsString() @MinLength(1) intent!: string;
  @IsObject() proposedPlan!: Prisma.InputJsonObject;
  @IsObject() normalizedArguments!: Prisma.InputJsonObject;
  @IsOptional() @IsObject() resolvedEntities?: Prisma.InputJsonObject;
  @IsOptional() @IsObject() warnings?: Prisma.InputJsonObject;
  @IsOptional() @IsBoolean() requiresConfirmation?: boolean;
}
