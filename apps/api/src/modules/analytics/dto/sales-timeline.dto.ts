import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export enum TimelineGranularityParam {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

export class SalesTimelineQueryDto {
  @IsOptional()
  @IsEnum(TimelineGranularityParam)
  granularity: TimelineGranularityParam = TimelineGranularityParam.MONTH;

  /** Inclusive start YYYY-MM-DD (UTC). Optional — defaults to earliest sale. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  /** Inclusive end YYYY-MM-DD (UTC). Optional — defaults to today. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
