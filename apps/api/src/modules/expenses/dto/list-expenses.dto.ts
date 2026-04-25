import { OperatingExpenseCategory } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional } from 'class-validator';

export class ListExpensesDto {
  @IsOptional()
  @IsEnum(OperatingExpenseCategory)
  category?: OperatingExpenseCategory;

  @IsOptional()
  @IsNumberString()
  year?: string;

  @IsOptional()
  @IsNumberString()
  month?: string;

  @IsOptional()
  @IsNumberString()
  day?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
