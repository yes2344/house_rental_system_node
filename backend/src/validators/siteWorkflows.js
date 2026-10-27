import { z } from 'zod';

const locationType = z.enum([
  'country',
  'region',
  'city_administration',
  'city',
  'subcity',
  'woreda',
  'neighborhood',
]);

const aliases = z.array(z.string().trim().min(1).max(120)).max(20);

export const publicLocationQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  all: z.enum(['0', '1']).optional(),
  parent_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  types: z.string().max(200).optional(),
  type: z.string().max(50).optional(),
}).strict();

export const managedLocationQuerySchema = z.object({
  all: z.enum(['0', '1']).optional(),
  parent_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

export const locationWriteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  name_am: z.string().trim().max(120).optional(),
  location_type: locationType.optional(),
  parent: z.coerce.number().int().positive().nullable().optional(),
  slug: z.string().trim().max(140).optional(),
  aliases_en: aliases.optional(),
  aliases_am: aliases.optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().nonnegative().max(2_147_483_647).optional(),
}).strict();

export const locationPatchSchema = locationWriteSchema.partial();

export const listingReportSchema = z.object({
  property_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reporter_name: z.string().max(200).transform((value) => value.trim()).pipe(z.string().min(1)),
  reporter_email: z.string().trim().email().max(254),
  reason: z.enum(['inaccurate', 'unavailable', 'fraud', 'inappropriate', 'other']),
  details: z.string().max(2000).optional().default(''),
}).strict();

export const favoriteCreateSchema = z.object({
  property_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const socialLinkSchema = z.object({
  platform: z.enum([
    'facebook',
    'whatsapp',
    'telegram',
    'instagram',
    'tiktok',
    'youtube',
    'linkedin',
    'x',
  ]),
  url: z.string().url().max(300).refine((value) => value.startsWith('https://'), {
    message: 'Enter a secure HTTPS URL.',
  }),
  is_enabled: z.boolean().default(true),
  display_order: z.number().int().nonnegative().max(2_147_483_647).default(0),
}).strict();

const multipartBoolean = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

export const brokerageContactPatchSchema = z.object({
  site_name: z.string().trim().min(1).max(100).optional(),
  clear_site_logo: multipartBoolean.optional(),
  clear_homepage_hero_image: multipartBoolean.optional(),
  business_name: z.string().max(160).optional(),
  phone: z.string().max(50).optional(),
  email: z.union([z.literal(''), z.string().email().max(254)]).optional(),
  footer_copyright: z.string().max(200).optional(),
  social_links: z.array(socialLinkSchema).optional(),
}).strict().refine((data) => {
  const platforms = data.social_links?.map((link) => link.platform) || [];
  return new Set(platforms).size === platforms.length;
}, {
  message: 'Each social platform can only have one link.',
  path: ['social_links'],
});
