import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { WatchOwnershipType } from '@prisma/client';

type ConsignmentFields = {
  ownershipType?: WatchOwnershipType;
  consignmentOwnerName?: string | null;
  consignmentSplitPercentage?: number | null;
};

@ValidatorConstraint({ name: 'watchOwnershipConsignment', async: false })
export class WatchOwnershipConsignmentConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as ConsignmentFields;
    if (o.ownershipType !== WatchOwnershipType.OWNED) {
      return true;
    }
    const name = o.consignmentOwnerName;
    const hasName =
      name !== undefined && name !== null && String(name).trim() !== '';
    const hasSplit =
      o.consignmentSplitPercentage !== undefined &&
      o.consignmentSplitPercentage !== null;
    return !hasName && !hasSplit;
  }

  defaultMessage(): string {
    return 'consignmentOwnerName and consignmentSplitPercentage must not be set when ownershipType is OWNED';
  }
}
