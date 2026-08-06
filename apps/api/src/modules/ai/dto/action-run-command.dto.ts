import { IsString, MinLength } from 'class-validator';

export class ConfirmActionRunDto {
  @IsString() @MinLength(64) planFingerprint!: string;
}
