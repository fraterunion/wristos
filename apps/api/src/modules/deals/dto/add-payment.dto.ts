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

export class AddPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'amount must be greater than 0' })
  amount!: number;

  @IsIn(['CASH', 'BANCOS', 'CESAR'], {
    message: 'method must be one of: CASH, BANCOS, CESAR',
  })
  method!: 'CASH' | 'BANCOS' | 'CESAR';

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ValidateIf((o: AddPaymentDto) => o.method === 'BANCOS')
  @IsNotEmpty({ message: 'bankChannel is required when method is BANCOS' })
  @IsIn(['JOSE', 'MAYTE'], { message: 'bankChannel must be JOSE or MAYTE' })
  bankChannel?: 'JOSE' | 'MAYTE';

  @IsOptional()
  @IsString()
  notes?: string;
}
