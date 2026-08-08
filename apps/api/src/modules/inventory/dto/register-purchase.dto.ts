import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { WatchOwnershipType, WatchStatus } from '@prisma/client';

export enum PurchasePaymentModeDto {
  PAID = 'PAID',
  CREDIT = 'CREDIT',
  PARTIAL = 'PARTIAL',
}

/**
 * Canonical inventory purchase registration body (manual UI + future AI 17B).
 * Not AI-executable in 17A.
 */
export class RegisterPurchaseDto {
  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsString()
  @IsNotEmpty()
  condition!: string;

  /** Purchase amount in `currency` (converted to MXN canonical Watch.cost). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchaseAmount!: number;

  @IsOptional()
  @IsIn(['MXN', 'USD'])
  currency?: 'MXN' | 'USD';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMin!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMax!: number;

  @IsOptional()
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @IsOptional()
  @IsEnum(WatchOwnershipType)
  ownershipType?: WatchOwnershipType;

  @IsOptional()
  @IsString()
  consignmentOwnerName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  consignmentSplitPercentage?: number;

  /** Canonical acquisition date (YYYY-MM-DD or ISO). Required for purchase registration. */
  @IsDateString()
  acquisitionDate!: string;

  @IsOptional()
  @IsString()
  sellerClientId?: string;

  /**
   * Free-text counterparty for CXP when sellerClientId is absent.
   * Required for CREDIT / PARTIAL when sellerClientId is missing.
   */
  @IsOptional()
  @IsString()
  sellerCounterpartyName?: string;

  @IsEnum(PurchasePaymentModeDto)
  paymentMode!: PurchasePaymentModeDto;

  /**
   * Initial payment in the same currency as purchaseAmount.
   * Required for PARTIAL. Ignored for CREDIT. For PAID may be omitted (= full).
   */
  @ValidateIf((o: RegisterPurchaseDto) => o.paymentMode === PurchasePaymentModeDto.PARTIAL)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  initialPaymentAmount?: number;

  @ValidateIf(
    (o: RegisterPurchaseDto) =>
      o.paymentMode === PurchasePaymentModeDto.PAID ||
      o.paymentMode === PurchasePaymentModeDto.PARTIAL,
  )
  @IsIn(['CASH', 'BANK', 'CESAR'])
  sourceAccount?: 'CASH' | 'BANK' | 'CESAR';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  registerIdempotencyKey?: string;
}
