import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateAutomationRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdDays?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
