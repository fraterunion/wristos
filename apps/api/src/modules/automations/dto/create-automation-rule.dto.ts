import { AutomationRuleType } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class CreateAutomationRuleDto {
  @IsEnum(AutomationRuleType)
  type!: AutomationRuleType;

  @IsInt()
  @Min(1)
  thresholdDays!: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
