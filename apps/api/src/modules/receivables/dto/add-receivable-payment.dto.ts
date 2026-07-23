import { Currency, ReceivablePaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AddReceivablePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'amount must be greater than 0' })
  amount!: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsEnum(ReceivablePaymentMethod)
  method!: ReceivablePaymentMethod;

  @IsDateString()
  paymentDate!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  allowOverpayment?: boolean;

  /** When false, do not mirror into Deal Payment (used by deals.addPayment). Default true. */
  @IsOptional()
  @IsBoolean()
  syncDealPayment?: boolean;
}
