import { IsString, MinLength } from 'class-validator';

export class WriteOffReceivableDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
