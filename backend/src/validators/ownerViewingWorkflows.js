import { z } from 'zod';

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const price = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.union([z.null(), z.coerce.number().positive()]),
);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).refine((value) => {
  const [hour, minute, second = '0'] = value.split(':').map(Number);
  return hour < 24 && minute < 60 && second < 60;
});

export const submissionQuerySchema = z.object({
  status: z.enum(['pending_review', 'corrections_requested', 'approved', 'rejected', 'suspended']).optional(),
  ordering: z.enum(['-created_at', 'created_at', '-updated_at', 'updated_at']).default('-created_at'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(12),
}).strict();

const propertyFields = {
  title: z.string().trim().max(200),
  location: z.string().trim().max(255),
  category: z.enum(['house', 'villa', 'apartment', 'condominium', 'land', 'office', 'shop', 'warehouse', 'commercial', 'other']).default('house'),
  listing_type: z.enum(['sale', 'rent']).default('sale'),
  price: price.default(null),
  currency: z.enum(['ETB', 'USD']).default('ETB'),
  bedrooms: z.coerce.number().int().min(0).optional(),
  bathrooms: z.coerce.number().int().min(0).optional(),
  area_sqft: z.coerce.number().int().min(0).optional(),
  area_value: z.coerce.number().positive().nullable().optional(),
  area_unit: z.enum(['sqm', 'sqft', '']).optional(),
  rental_frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly', '']).optional(),
  amenities: z.array(id).max(100)
    .refine((values) => new Set(values).size === values.length, 'Each amenity can only be selected once.')
    .optional(),
  description: z.string().max(20_000).optional(),
  features: z.string().max(10_000).optional(),
};

export const submissionCreateSchema = z.object({
  ...propertyFields,
  owner_contact_name: z.string().trim().max(200).optional().default(''),
  owner_contact_phone: z.string().trim().max(50).optional().default(''),
  owner_contact_email: z.string().trim().email().or(z.literal('')).optional(),
  authorization_confirmed: z.literal(true),
  terms_accepted: z.literal(true),
  administrative_location: id.nullable().optional().default(null),
}).strict();

export const submissionPatchSchema = z.object({
  title: propertyFields.title.optional(),
  location: propertyFields.location.optional(),
  category: propertyFields.category.optional(),
  listing_type: propertyFields.listing_type.optional(),
  price: propertyFields.price.optional(),
  currency: propertyFields.currency.optional(),
  bedrooms: propertyFields.bedrooms,
  bathrooms: propertyFields.bathrooms,
  area_sqft: propertyFields.area_sqft,
  area_value: propertyFields.area_value,
  area_unit: propertyFields.area_unit,
  rental_frequency: propertyFields.rental_frequency,
  amenities: propertyFields.amenities,
  description: propertyFields.description,
  features: propertyFields.features,
  owner_contact_name: z.string().trim().max(200).optional(),
  owner_contact_phone: z.string().trim().max(50).optional(),
  owner_contact_email: z.string().trim().email().or(z.literal('')).optional(),
  authorization_confirmed: z.boolean().optional(),
  terms_accepted: z.boolean().optional(),
  administrative_location: id.nullable().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, 'At least one field is required.');

export const bulkDeleteSchema = z.object({
  ids: z.array(id).min(1).max(100).refine((values) => new Set(values).size === values.length, 'Each submission can only be selected once.'),
}).strict();

export const managementSubmissionQuerySchema = submissionQuerySchema.extend({
  ordering: z.enum(['-submitted_at', 'submitted_at', '-updated_at', 'updated_at']).default('-submitted_at'),
});
export const assignmentSchema = z.object({ assigned_reviewer_id: id.nullable() }).strict();
export const decisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'request_corrections']),
  feedback: z.string().max(10_000).optional(),
  agreement_start_date: date.optional(),
  agreement_duration_months: z.coerce.number().int().min(1).max(120).optional(),
  agreement_terms: z.string().max(4000).optional(),
}).strict();

export const viewingQuerySchema = z.object({
  status: z.enum(['pending', 'proposed', 'confirmed', 'rejected', 'declined', 'cancelled', 'completed']).optional(),
  ordering: z.enum(['-created_at', 'created_at', '-preferred_date', 'preferred_date', '-scheduled_date', 'scheduled_date']).default('-created_at'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(12),
}).strict();
export const viewingCreateSchema = z.object({
  property_id: id,
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(50),
  preferred_date: date,
  preferred_time: time.nullable().optional(),
  message: z.string().max(10_000).optional(),
}).strict();
export const viewingPatchSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  preferred_date: date.optional(),
  preferred_time: time.nullable().optional(),
  message: z.string().max(10_000).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, 'At least one field is required.');
export const viewingManagerPatchSchema = z.object({
  proposed_date: date.nullable().optional(),
  proposed_time: time.nullable().optional(),
  status: z.enum(['rejected']).optional(),
  agent_notes: z.string().max(10_000).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, 'At least one field is required.');
export const viewingDecisionSchema = z.object({
  decision: z.enum(['accept', 'decline']),
  message: z.string().max(2000).optional(),
}).strict();
export const viewingCancellationSchema = z.object({ message: z.string().max(2000).optional() }).strict();
export const viewingActionSchema = z.object({
  action: z.enum(['confirm_requested', 'cancel', 'complete']),
  message: z.string().max(2000).optional(),
}).strict();
export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  ordering: z.enum(['-created_at', 'created_at']).default('-created_at'),
  unread: z.enum(['true', 'false']).optional(),
}).strict();
