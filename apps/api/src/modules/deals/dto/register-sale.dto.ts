import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class RegisterSaleDto {
  @IsString()
  @IsNotEmpty()
  watchId!: string;

  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'salePrice must be greater than 0' })
  salePrice!: number;

  @IsIn(['CASH', 'BANCOS', 'CESAR'], {
    message: 'paymentMethod must be one of: CASH, BANCOS, CESAR',
  })
  paymentMethod!: 'CASH' | 'BANCOS' | 'CESAR';

  @ValidateIf((o: RegisterSaleDto) => o.paymentMethod === 'BANCOS')
  @IsNotEmpty({ message: 'bankChannel is required when paymentMethod is BANCOS' })
  @IsIn(['JOSE', 'MAYTE'], { message: 'bankChannel must be JOSE or MAYTE' })
  bankChannel?: 'JOSE' | 'MAYTE';

  @IsOptional()
  @IsDateString()
  saleDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
