import { IsDateString, IsOptional, IsString } from 'class-validator';

export class MarkPaymentPaidDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
