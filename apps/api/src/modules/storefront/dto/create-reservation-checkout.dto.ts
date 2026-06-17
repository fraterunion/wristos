import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateReservationCheckoutDto {
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsEmail()
  customerEmail!: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;
}
