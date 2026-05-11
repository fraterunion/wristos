import { IsOptional, IsString } from 'class-validator';
import { UpdateListingDto } from './update-listing.dto';

// Confirm may optionally apply editable field updates before confirming.
export class ConfirmListingDto extends UpdateListingDto {}

export class DismissListingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
