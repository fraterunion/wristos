import { Currency, PaymentMethod, TreasuryAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateAccountPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsDateString()
  paidAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsEnum(TreasuryAccount)
  cashAccount!: TreasuryAccount;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  exchangeRateUsed?: number;
}
