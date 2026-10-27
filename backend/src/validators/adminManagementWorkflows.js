import { z } from 'zod';

const boolean = z.boolean();
const positiveId = z.coerce.number().int().positive();
const price = z.preprocess((value) => value === '' ? null : value, z.union([
  z.null(),
  z.union([z.string(), z.number()]).transform(String)
    .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value) && Number(value) >= 0.01),
]));
const boundedString = (max, trim = true) => {
  const value = z.string().max(max);
  return trim ? value.trim() : value;
};

export const workflowPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  ordering: z.string().max(40).optional(),
  status: z.enum(['active', 'available', 'rented', 'sold', 'inactive', 'pending', 'reviewed', 'dismissed', 'action_taken']).optional(),
  publication_status: z.enum([
    'draft', 'pending_review', 'published', 'rejected', 'suspended', 'expired', 'withdrawn',
  ]).optional(),
  listing_type: z.enum(['sale', 'rent']).optional(),
  property_type: z.enum(['house', 'villa', 'apartment', 'condominium', 'land', 'office', 'shop', 'warehouse', 'commercial', 'other']).optional(),
  role: z.enum(['customer', 'owner', 'agent', 'administrator']).optional(),
  'profile__role': z.enum(['customer', 'owner', 'agent', 'administrator']).optional(),
  is_active: z.enum(['true', 'false']).optional(),
  agent_approved: z.enum(['true', 'false']).optional(),
  'profile__agent_approved': z.enum(['true', 'false']).optional(),
}).strict();

export const homepageNoteSchema = z.object({
  title: boundedString(160).optional().default(''),
  text: boundedString(2000).refine((value) => value.length > 0, 'Enter note text.'),
  is_published: boolean.optional().default(false),
  display_order: z.number().int().min(0).max(2_147_483_647).optional().default(0),
}).strict();

export const homepageNotePatchSchema = z.object({
  title: boundedString(160).optional(),
  text: boundedString(2000).refine((value) => value.length > 0, 'Enter note text.').optional(),
  is_published: boolean.optional(),
  display_order: z.number().int().min(0).max(2_147_483_647).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const publicPagePatchSchema = z.object({
  title_en: boundedString(160).optional(),
  title_am: boundedString(160).optional(),
  introduction_en: boundedString(500).optional(),
  introduction_am: boundedString(500).optional(),
  body_en: boundedString(5000).optional(),
  body_am: boundedString(5000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const adminUserPatchSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  first_name: boundedString(150).optional(),
  last_name: boundedString(150).optional(),
  is_active: boolean.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

const accountFields = {
  username: boundedString(150).min(1).optional(),
  email: z.string().trim().email().max(254).optional(),
  first_name: boundedString(150).optional(),
  last_name: boundedString(150).optional(),
  phone: boundedString(50).optional(),
  is_active: boolean.optional(),
};

export const publicAccountCreateSchema = z.object({
  ...accountFields,
  username: boundedString(150).min(1),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(['customer', 'owner']).optional().default('customer'),
}).strict();

export const publicAccountPatchSchema = z.object({
  ...accountFields,
  password: z.string().min(8).max(128).optional(),
  role: z.enum(['customer', 'owner']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

const managementPermissions = z.array(z.enum([
  'properties.manage_assigned',
  'viewings.manage_assigned',
  'locations.manage_subcities',
  'announcements.review_assigned',
  'settings.manage',
])).max(10);

export const delegatedAccountCreateSchema = z.object({
  username: boundedString(150).min(1),
  password: z.string().min(8).max(128),
  assigned_city_id: positiveId,
}).strict();

export const delegatedAccountPatchSchema = z.object({
  ...accountFields,
  initial_password: z.string().min(8).max(128).optional(),
  assigned_city_id: positiveId.nullable().optional(),
  management_permissions: managementPermissions.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const adminPropertyPatchSchema = z.object({
  status: z.enum(['active', 'available', 'rented', 'sold', 'inactive']).optional(),
  publication_status: z.enum([
    'draft', 'pending_review', 'published', 'rejected', 'suspended', 'expired', 'withdrawn',
  ]).optional(),
  is_featured: boolean.optional(),
  moderation_note: boundedString(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const managedPropertyCreateSchema = z.object({
  title: boundedString(200),
  location: boundedString(200),
  administrative_location: positiveId.nullable().optional().default(null),
  category: z.enum(['house', 'villa', 'apartment', 'condominium', 'land', 'office', 'shop', 'warehouse', 'commercial', 'other']).default('house'),
  listing_type: z.enum(['sale', 'rent']).default('sale'),
  price: price.optional().default(null),
  currency: z.enum(['ETB', 'USD']).optional().default('ETB'),
  bedrooms: z.number().int().min(0).max(100).default(0),
  bathrooms: z.number().int().min(0).max(100).default(0),
  area_sqft: z.number().int().min(0).max(2_147_483_647).default(0),
  area_value: z.union([z.string(), z.number()]).transform(String)
    .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value) && Number(value) >= 0.01)
    .nullable().optional().default(null),
  area_unit: z.enum(['', 'sqm', 'sqft']).optional().default(''),
  rental_frequency: z.enum(['', 'daily', 'weekly', 'monthly', 'yearly']).optional().default(''),
  description: boundedString(10000).optional().default(''),
  features: boundedString(5000).optional().default(''),
  status: z.enum(['available', 'rented', 'sold', 'inactive']).optional().default('available'),
  amenities: z.array(positiveId).max(100).optional().default([]),
  contact_name: boundedString(200).optional().default(''),
  contact_phone: boundedString(50).optional().default(''),
  contact_email: z.union([z.literal(''), z.string().trim().email().max(254)]).optional().default(''),
}).strict();

export const managedPropertyPatchSchema = z.object({
  title: boundedString(200).optional(),
  location: boundedString(200).optional(),
  administrative_location: positiveId.nullable().optional(),
  category: z.enum(['house', 'villa', 'apartment', 'condominium', 'land', 'office', 'shop', 'warehouse', 'commercial', 'other']).optional(),
  listing_type: z.enum(['sale', 'rent']).optional(),
  price: price.optional(),
  currency: z.enum(['ETB', 'USD']).optional(),
  bedrooms: z.number().int().min(0).max(100).optional(),
  bathrooms: z.number().int().min(0).max(100).optional(),
  area_sqft: z.number().int().min(0).max(2_147_483_647).optional(),
  area_value: z.union([z.string(), z.number()]).transform(String)
    .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value) && Number(value) >= 0.01).nullable().optional(),
  area_unit: z.enum(['', 'sqm', 'sqft']).optional(),
  rental_frequency: z.enum(['', 'daily', 'weekly', 'monthly', 'yearly']).optional(),
  description: boundedString(10000).optional(),
  features: boundedString(5000).optional(),
  status: z.enum(['available', 'rented', 'sold', 'inactive']).optional(),
  amenities: z.array(positiveId).max(100).optional(),
  contact_name: boundedString(200).optional(),
  contact_phone: boundedString(50).optional(),
  contact_email: z.union([z.literal(''), z.string().trim().email().max(254)]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const publicationSchema = z.object({
  publication_status: z.enum(['published', 'draft']),
}).strict();

export const idsSchema = z.object({
  ids: z.array(positiveId).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, 'IDs must be unique.'),
}).strict();

export const assignmentSchema = z.object({ agent_id: positiveId }).strict();
export const reportPatchSchema = z.object({
  status: z.enum(['pending', 'reviewed', 'dismissed', 'action_taken']).optional(),
  moderator_notes: boundedString(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export { positiveId };
