import { z } from 'zod';

const positiveDecimal = z.string().regex(/^\d+(\.\d+)?$/).refine(
  (value) => Number.isFinite(Number(value)),
  'Enter a valid number.',
);

export const publicPropertyQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  listing_type: z.enum(['sale', 'rent']).optional(),
  property_type: z.enum([
    'house', 'villa', 'apartment', 'condominium', 'land',
    'office', 'shop', 'warehouse', 'commercial', 'other',
  ]).optional(),
  status: z.enum(['available', 'active']).optional(),
  min_price: positiveDecimal.optional(),
  max_price: positiveDecimal.optional(),
  min_bedrooms: z.coerce.number().int().min(0).optional(),
  max_bedrooms: z.coerce.number().int().min(0).optional(),
  min_bathrooms: z.coerce.number().int().min(0).optional(),
  max_bathrooms: z.coerce.number().int().min(0).optional(),
  min_size: z.coerce.number().int().min(0).optional(),
  max_size: z.coerce.number().int().min(0).optional(),
  amenities: z.string().max(1000).optional(),
  location: z.string().trim().max(200).optional(),
  location_id: z.coerce.number().int().positive().optional(),
  city_id: z.coerce.number().int().positive().optional(),
  ordering: z.enum(['-created_at', 'created_at', '-price', 'price']).default('-created_at'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(12),
}).strict().superRefine((filters, context) => {
  for (const [minimum, maximum] of [
    ['min_price', 'max_price'],
    ['min_bedrooms', 'max_bedrooms'],
    ['min_bathrooms', 'max_bathrooms'],
    ['min_size', 'max_size'],
  ]) {
    if (filters[minimum] !== undefined && filters[maximum] !== undefined
      && Number(filters[minimum]) > Number(filters[maximum])) {
      context.addIssue({
        code: 'custom',
        path: [maximum],
        message: `${maximum} must be greater than or equal to ${minimum}.`,
      });
    }
  }
});
