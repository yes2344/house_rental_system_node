import { z } from 'zod';

export const managedPropertyQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['available', 'rented', 'sold', 'inactive']).optional(),
  publication_status: z.enum([
    'draft', 'pending_review', 'published', 'rejected', 'suspended', 'expired', 'withdrawn',
  ]).optional(),
  ordering: z.enum(['-created_at', 'created_at', '-price', 'price']).default('-created_at'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(12),
}).strict();
