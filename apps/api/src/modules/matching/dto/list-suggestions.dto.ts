import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';

export class ListSuggestionsDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  includeDismissed?: boolean;
}
