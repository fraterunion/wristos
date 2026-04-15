import { IsEnum, IsOptional } from 'class-validator';

export enum AnalyticsPeriod {
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

export class AnalyticsPeriodDto {
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period: AnalyticsPeriod = AnalyticsPeriod.MONTH;
}
