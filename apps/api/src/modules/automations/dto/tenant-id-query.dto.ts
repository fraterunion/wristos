import { IsNotEmpty, IsString } from 'class-validator';

/** Used until tenant context is resolved from JWT. */
export class TenantIdQueryDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;
}
