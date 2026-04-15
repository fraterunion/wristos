import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

type PreferenceBudget = {
  budgetMin?: number | null;
  budgetMax?: number | null;
};

@ValidatorConstraint({ name: 'clientPreferenceBudget', async: false })
export class ClientPreferenceBudgetConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as PreferenceBudget;
    if (dto.budgetMin === undefined || dto.budgetMin === null) return true;
    if (dto.budgetMax === undefined || dto.budgetMax === null) return true;
    return dto.budgetMin <= dto.budgetMax;
  }

  defaultMessage(): string {
    return 'budgetMin must be less than or equal to budgetMax';
  }
}
