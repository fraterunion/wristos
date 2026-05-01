import { z } from 'zod';

import type { Watch } from '@/types/domain';

export const WATCH_STATUS_VALUES = [
  'AVAILABLE',
  'RESERVED',
  'SOLD',
  'IN_TRANSIT',
  'IN_SERVICE',
] as const;

export const WATCH_OWNERSHIP_VALUES = ['OWNED', 'CONSIGNMENT'] as const;

const numericField = (label: string) =>
  z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return 0;
    if (typeof val === 'number' && Number.isNaN(val)) return 0;
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }, z.number().min(0, `${label} must be 0 or more`));

export const watchFormSchema = z
  .object({
    brand: z.string().trim().min(1, 'Brand is required'),
    model: z.string().trim().min(1, 'Model is required'),
    serialNumber: z.string().optional(),
    imageUrl: z.string().optional(),
    condition: z.string().trim().min(1, 'Condition is required'),
    cost: numericField('Base cost'),
    priceMin: numericField('Min price'),
    priceMax: numericField('Max price'),
    status: z.enum(WATCH_STATUS_VALUES),
    ownershipType: z.enum(WATCH_OWNERSHIP_VALUES),
    consignmentOwnerName: z.string().optional(),
    consignmentSplitPercentage: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.priceMax < data.priceMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Max price must be ≥ min price',
        path: ['priceMax'],
      });
    }
    if (data.ownershipType === 'CONSIGNMENT') {
      const raw = data.consignmentSplitPercentage?.trim();
      if (raw) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Split must be between 0 and 100',
            path: ['consignmentSplitPercentage'],
          });
        }
      }
    }
  });

export type WatchFormValues = z.infer<typeof watchFormSchema>;

export const defaultWatchFormValues: WatchFormValues = {
  brand: '',
  model: '',
  serialNumber: '',
  imageUrl: '',
  condition: '',
  cost: 0,
  priceMin: 0,
  priceMax: 0,
  status: 'AVAILABLE',
  ownershipType: 'OWNED',
  consignmentOwnerName: '',
  consignmentSplitPercentage: '',
};

export function watchToFormValues(watch: Watch): WatchFormValues {
  return {
    brand: watch.brand,
    model: watch.model,
    serialNumber: watch.serialNumber ?? '',
    imageUrl: watch.imageUrl ?? '',
    condition: watch.condition,
    cost: Number(watch.cost),
    priceMin: Number(watch.priceMin),
    priceMax: Number(watch.priceMax),
    status: watch.status,
    ownershipType: watch.ownershipType,
    consignmentOwnerName: watch.consignmentOwnerName ?? '',
    consignmentSplitPercentage:
      watch.consignmentSplitPercentage != null
        ? String(watch.consignmentSplitPercentage)
        : '',
  };
}

export function buildCreateWatchBody(values: WatchFormValues) {
  const body: Record<string, unknown> = {
    brand: values.brand.trim(),
    model: values.model.trim(),
    condition: values.condition.trim(),
    cost: values.cost,
    priceMin: values.priceMin,
    priceMax: values.priceMax,
    ownershipType: values.ownershipType,
    status: values.status,
  };

  const serial = values.serialNumber?.trim();
  if (serial) body.serialNumber = serial;

  const imageUrl = values.imageUrl?.trim();
  if (imageUrl) body.imageUrl = imageUrl;

  if (values.ownershipType === 'CONSIGNMENT') {
    const owner = values.consignmentOwnerName?.trim();
    if (owner) body.consignmentOwnerName = owner;
    const split = values.consignmentSplitPercentage?.trim();
    if (split) body.consignmentSplitPercentage = Number(split);
  }

  return body;
}

export function buildUpdateWatchBody(values: WatchFormValues) {
  const body: Record<string, unknown> = {
    brand: values.brand.trim(),
    model: values.model.trim(),
    condition: values.condition.trim(),
    cost: values.cost,
    priceMin: values.priceMin,
    priceMax: values.priceMax,
    status: values.status,
    ownershipType: values.ownershipType,
  };

  const serial = values.serialNumber?.trim();
  body.serialNumber = serial || null;

  const imageUrl = values.imageUrl?.trim();
  body.imageUrl = imageUrl || null;

  if (values.ownershipType === 'CONSIGNMENT') {
    const owner = values.consignmentOwnerName?.trim();
    body.consignmentOwnerName = owner || null;
    const split = values.consignmentSplitPercentage?.trim();
    body.consignmentSplitPercentage =
      split === '' || split === undefined ? null : Number(split);
  } else {
    body.consignmentOwnerName = null;
    body.consignmentSplitPercentage = null;
  }

  return body;
}
