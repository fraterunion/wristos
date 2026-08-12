import { IsNotEmpty, IsString } from 'class-validator';

export class SwitchTenantDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;
}
