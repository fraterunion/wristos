import { Currency, PaymentMethod, TreasuryAccount } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export enum AccountPaymentDestination {
  CASH = 'CASH',
  BANK = 'BANK',
  CESAR = 'CESAR',
  APPLY_TO_PAYABLE = 'APPLY_TO_PAYABLE',
}

export class CreateAccountPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  /**
   * Required for treasury destinations. For APPLY_TO_PAYABLE the service
   * forces PaymentMethod.SETTLEMENT regardless of this field.
   */
  @ValidateIf(
    (o: CreateAccountPaymentDto) =>
      o.destination !== AccountPaymentDestination.APPLY_TO_PAYABLE,
  )
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsDateString()
  paidAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Preferred payment destination. When omitted, `cashAccount` preserves
   * the previous CASH/BANK/CESAR behavior.
   */
  @IsOptional()
  @IsEnum(AccountPaymentDestination)
  destination?: AccountPaymentDestination;

  @ValidateIf(
    (o: CreateAccountPaymentDto) =>
      o.destination !== AccountPaymentDestination.APPLY_TO_PAYABLE,
  )
  @IsEnum(TreasuryAccount)
  cashAccount?: TreasuryAccount;

  @ValidateIf(
    (o: CreateAccountPaymentDto) =>
      o.destination === AccountPaymentDestination.APPLY_TO_PAYABLE,
  )
  @IsString()
  payableEntryId?: string;

  /**
   * Settlement idempotency (APPLY_TO_PAYABLE → AccountSettlement.idempotencyKey).
   * Prefer `registerIdempotencyKey` for new callers; both map to the same settlement key.
   */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /**
   * Durable registration idempotency:
   * - CASH/BANK/CESAR → AccountPayment.registerIdempotencyKey
   * - APPLY_TO_PAYABLE → AccountSettlement.idempotencyKey (alias of idempotencyKey)
   */
  @IsOptional()
  @IsString()
  registerIdempotencyKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  exchangeRateUsed?: number;
}
