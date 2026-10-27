import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ApiError } from '../errors.js';
import { withTransaction } from '../db.js';
import { storedMediaPath } from './propertyImageService.js';
import { getPublicProperty } from './publicPropertyService.js';
import { getDefaultPublicInformationPage } from './publicInformationPageSeedService.js';

const MAX_BRANDING_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_BRANDING_IMAGE_PIXELS = 50_000_000;
const brandingImageFormats = new Map([
  ['jpeg', 'jpg'],
  ['png', 'png'],
  ['webp', 'webp'],
]);

const publicPropertyFilter = `p.publication_status = 'published'
  AND p.status IN ('available', 'active', 'rented', 'sold')
  AND (
    p.service_type = 'agent_managed'
    OR (
      p.service_type = 'owner_announced'
      AND EXISTS (
        SELECT 1
        FROM owner_announcements_ownerannouncement AS announcement
        JOIN owner_announcements_ownerannouncementagreement AS agreement
          ON agreement.announcement_id = announcement.id
        WHERE announcement.property_id = p.id
          AND announcement.status = 'approved'
          AND agreement.status = 'active'
          AND agreement.start_date <= timezone('Africa/Addis_Ababa', CURRENT_TIMESTAMP)::date
          AND agreement.end_date >= timezone('Africa/Addis_Ababa', CURRENT_TIMESTAMP)::date
      )
    )
  )`;

function absoluteUrl(request, path) {
  if (!path) return null;
  const mediaPath = `/media/${String(path).split('/').map(encodeURIComponent).join('/')}`;
  const forwardedProtocol = request.get('x-forwarded-proto')?.trim().toLowerCase();
  const protocol = request.protocol === 'https' || forwardedProtocol === 'https'
    ? 'https'
    : request.protocol;
  return new URL(mediaPath, `${protocol}://${request.get('host')}`).toString();
}

function asLocation(row) {
  return {
    id: Number(row.id),
    name: row.name,
    name_am: row.name_am,
    aliases_en: row.aliases_en || [],
    aliases_am: row.aliases_am || [],
    slug: row.slug,
    location_type: row.location_type,
    parent_id: row.parent_id === null ? null : Number(row.parent_id),
    city_id: row.city_id === null ? null : Number(row.city_id),
    is_active: row.is_active,
    display_order: row.display_order,
  };
}

const locationProjection = `location.id, location.name, location.name_am,
  location.aliases_en, location.aliases_am, location.slug, location.location_type,
  location.parent_id, location.is_active, location.display_order,
  city.id AS city_id`;
const locationCityJoin = `LEFT JOIN LATERAL (
  WITH RECURSIVE ancestors (id, parent_id, location_type, depth, visited) AS (
    SELECT id, parent_id, location_type, 0, ARRAY[id]
    FROM properties_location WHERE id = location.id
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.location_type, child.depth + 1,
           child.visited || parent.id
    FROM ancestors AS child
    JOIN properties_location AS parent ON parent.id = child.parent_id
    WHERE child.depth < 8 AND NOT parent.id = ANY(child.visited)
  )
  SELECT id FROM ancestors
  WHERE location_type IN ('city', 'city_administration')
  ORDER BY depth
  LIMIT 1
) AS city ON TRUE`;

function slugify(value) {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140);
}

function normalizeLocationSearch(value) {
  return (value.normalize('NFC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
}

async function locationAccess(pool, userId) {
  const result = await pool.query(
    `SELECT account.is_active, account.is_staff, account.is_superuser,
            profile.role, profile.agent_approved, profile.management_permissions,
            profile.assigned_city_id
     FROM auth_user AS account
     LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
     WHERE account.id = $1`,
    [userId],
  );
  const account = result.rows[0];
  const admin = Boolean(account?.is_active && (
    account.is_superuser || (account.is_staff && account.role === 'administrator')
  ));
  const agent = Boolean(
    account?.is_active
    && account.role === 'agent'
    && account.agent_approved,
  );
  if (!admin && !agent) {
    throw new ApiError(403, 'Location management access is required.');
  }
  return {
    role: admin ? 'administrator' : 'agent',
    assignedCityId: account.assigned_city_id === null || account.assigned_city_id === undefined
      ? null
      : Number(account.assigned_city_id),
  };
}

function assertEditableFields(data, access, creating) {
  const adminFields = new Set([
    'name', 'name_am', 'is_active', 'display_order', 'location_type', 'parent',
  ]);
  const agentFields = new Set(['name', 'name_am', 'is_active', 'display_order']);
  const allowed = access.role === 'administrator' ? adminFields : agentFields;
  const unsupported = Object.keys(data).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new ApiError(400, 'Request validation failed.', Object.fromEntries(
      unsupported.map((field) => [field, ['This field is fixed or is not editable here.']]),
    ));
  }
  if (!creating && ('location_type' in data || 'parent' in data)) {
    throw new ApiError(400, 'Request validation failed.', {
      location_type: ['Location type and parent are fixed after creation.'],
    });
  }
}

async function assertLocationScope(pool, access, locationId, { forEdit = false } = {}) {
  const params = [locationId];
  let condition = `location.id = $1
    AND location.location_type IN ('city', 'subcity')`;
  if (access.role === 'agent') {
    if (access.assignedCityId === null) throw new ApiError(404, 'Not found.');
    params.push(access.assignedCityId);
    condition = `location.id = $1 AND location.location_type = 'subcity'
      AND location.id IN (
        WITH RECURSIVE branch (id, visited) AS (
          SELECT id, ARRAY[id] FROM properties_location WHERE id = $2
          UNION ALL
          SELECT child.id, branch.visited || child.id
          FROM branch
          JOIN properties_location AS child ON child.parent_id = branch.id
          WHERE NOT child.id = ANY(branch.visited)
        )
        SELECT id FROM branch
      )`;
  }
  if (forEdit && access.role === 'administrator') {
    condition = `location.id = $1
      AND location.location_type IN ('city', 'subcity')`;
  }
  const result = await pool.query(
    `SELECT location.id FROM properties_location AS location WHERE ${condition}`,
    params,
  );
  if (result.rowCount !== 1) throw new ApiError(404, 'Not found.');
}

export async function listHomepageNotes(pool, request) {
  const result = await pool.query(
    `SELECT id, title, text, image, is_published, display_order, created_at, updated_at
     FROM portal_admin_homepagenote
     WHERE is_published = TRUE
     ORDER BY display_order, created_at DESC`,
  );
  return {
    count: result.rowCount,
    next: null,
    previous: null,
    results: result.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      image: absoluteUrl(request, row.image),
    })),
  };
}

export async function getPublicInformationPage(pool, page) {
  const fallback = getDefaultPublicInformationPage(page);
  if (!fallback) throw new ApiError(404, 'Not found.');
  const result = await pool.query(
    `SELECT page, title_en, title_am, introduction_en, introduction_am,
            body_en, body_am, updated_at
     FROM portal_admin_publicinformationpage WHERE page = $1`,
    [page],
  );
  return result.rows[0] || fallback;
}

export async function getBrokerageContact(pool, request) {
  const settingsResult = await pool.query(
    `SELECT site_name, footer_copyright, site_logo, homepage_hero_image,
            business_name, phone, email
     FROM portal_admin_brokeragesettings WHERE id = 1`,
  );
  const settings = settingsResult.rows[0] || {
    site_name: 'Infinity House',
    footer_copyright: '',
    site_logo: '',
    homepage_hero_image: '',
    business_name: '',
    phone: '',
    email: '',
  };
  const socialResult = await pool.query(
    `SELECT platform, url, is_enabled, display_order
     FROM portal_admin_socialmedialink
     WHERE brokerage_id = 1 AND is_enabled = TRUE
     ORDER BY display_order, platform`,
  );
  const legacyNames = new Set([
    'infinity house',
    'infinit house',
    'habeshapropertycenter',
    'habasha property center',
    'habesha property center',
    'habesha home center',
    'habeshahome',
    'kekalehabesha home',
  ]);
  return {
    site_name: legacyNames.has(settings.site_name.trim().toLowerCase())
      ? 'Infinity House'
      : settings.site_name,
    footer_copyright: settings.footer_copyright,
    site_logo: absoluteUrl(request, settings.site_logo) || '',
    homepage_hero_image: absoluteUrl(request, settings.homepage_hero_image) || '',
    business_name: settings.business_name,
    phone: settings.phone,
    email: settings.email,
    social_links: socialResult.rows.map((row) => ({
      platform: row.platform,
      url: row.url,
      is_enabled: row.is_enabled,
      display_order: row.display_order,
    })),
  };
}

async function requireBrokerageSettingsAccess(pool, userId) {
  const result = await pool.query(
    `SELECT account.is_active, account.is_staff, account.is_superuser, profile.role,
            profile.agent_approved, profile.management_permissions,
            COALESCE(
              (SELECT owner.id
               FROM auth_user AS owner
               WHERE owner.id = brokerage.platform_owner_id
                 AND owner.is_active = TRUE AND owner.is_superuser = TRUE),
              (SELECT owner.id
               FROM auth_user AS owner
               WHERE owner.is_active = TRUE AND owner.is_superuser = TRUE
               ORDER BY owner.id
               LIMIT 1)
            ) AS effective_platform_owner_id
     FROM auth_user AS account
     LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
     LEFT JOIN portal_admin_brokeragesettings AS brokerage ON brokerage.id = 1
     WHERE account.id = $1`,
    [userId],
  );
  const account = result.rows[0];
  const isPlatformOwner = Boolean(
    account?.is_active
    && account.is_superuser
    && Number(account.effective_platform_owner_id) === Number(userId),
  );
  const hasAdministratorBrandingPermission = Boolean(
    account?.is_active
    && (
      account.is_superuser
      || (account.is_staff && account.role === 'administrator')
    ),
  );
  const permissions = Array.isArray(account?.management_permissions)
    ? account.management_permissions
    : [];
  const hasAgentSettingsPermission = Boolean(
    account?.is_active
    && account.role === 'agent'
    && account.agent_approved
    && permissions.includes('settings.manage'),
  );
  if (!isPlatformOwner && !hasAdministratorBrandingPermission && !hasAgentSettingsPermission) {
    throw new ApiError(403, 'Settings management access is required.');
  }
  return {
    isPlatformOwner,
    platformOwnerId: account.effective_platform_owner_id === null
      || account.effective_platform_owner_id === undefined
      ? null
      : Number(account.effective_platform_owner_id),
  };
}

const legacySocialColumns = Object.freeze({
  facebook: 'facebook_url',
  whatsapp: 'whatsapp_url',
  telegram: 'telegram_url',
  instagram: 'instagram_url',
  tiktok: 'tiktok_url',
  youtube: 'youtube_url',
  linkedin: 'linkedin_url',
});

async function readManagedBrokerageContact(pool, request) {
  const settingsResult = await pool.query(
    `SELECT site_name, footer_copyright, site_logo, homepage_hero_image,
            business_name, phone, whatsapp_url, telegram_url, email,
            facebook_url, instagram_url, tiktok_url, youtube_url, linkedin_url
     FROM portal_admin_brokeragesettings WHERE id = 1`,
  );
  const row = settingsResult.rows[0];
  if (!row) throw new ApiError(404, 'Not found.');
  const socialResult = await pool.query(
    `SELECT platform, url, is_enabled, display_order
     FROM portal_admin_socialmedialink
     WHERE brokerage_id = 1
     ORDER BY display_order, platform`,
  );
  const legacyNames = new Set([
    'infinity house',
    'infinit house',
    'habeshapropertycenter',
    'habasha property center',
    'habesha property center',
    'habesha home center',
    'habeshahome',
    'kekalehabesha home',
  ]);
  return {
    site_name: legacyNames.has(row.site_name.trim().toLowerCase()) ? 'Infinity House' : row.site_name,
    footer_copyright: row.footer_copyright,
    site_logo: absoluteUrl(request, row.site_logo) || '',
    homepage_hero_image: absoluteUrl(request, row.homepage_hero_image) || '',
    business_name: row.business_name,
    phone: row.phone,
    whatsapp_url: row.whatsapp_url,
    telegram_url: row.telegram_url,
    email: row.email,
    facebook_url: row.facebook_url,
    instagram_url: row.instagram_url,
    tiktok_url: row.tiktok_url,
    youtube_url: row.youtube_url,
    linkedin_url: row.linkedin_url,
    social_links: socialResult.rows.map((link) => ({
      platform: link.platform,
      url: link.url,
      is_enabled: link.is_enabled,
      display_order: link.display_order,
    })),
  };
}

export async function patchBrokerageContact(
  pool,
  request,
  userId,
  data,
  { files = {}, mediaConfig, logger = console } = {},
) {
  const access = await requireBrokerageSettingsAccess(pool, userId);
  if (access.platformOwnerId === null) {
    throw new ApiError(400, 'Request validation failed.', {
      detail: [
        'Create an active platform-owner account before saving Infinity House contact settings.',
      ],
    });
  }

  const siteLogoFile = files.site_logo?.[0];
  const homepageHeroImageFile = files.homepage_hero_image?.[0];
  if (
    (siteLogoFile && data.clear_site_logo)
    || (homepageHeroImageFile && data.clear_homepage_hero_image)
  ) {
    throw new ApiError(400, 'Request validation failed.', {
      non_field_errors: ['Choose a replacement image or remove the current image, not both.'],
    });
  }

  const newImages = [];
  const removeImage = async (storedName, context) => {
    if (!mediaConfig || !storedName) return;
    try {
      await unlink(storedMediaPath(mediaConfig.publicRoot, storedName, 'site-branding'));
    } catch (error) {
      if (error.code === 'ENOENT' || error.statusCode === 404) return;
      logger.error(`Failed to remove ${context} branding image.`, error.code || error.name);
    }
  };
  const storeImage = async (file) => {
    if (!mediaConfig) {
      throw new ApiError(503, 'Branding image storage is not configured.');
    }
    if (!file?.buffer || file.size > MAX_BRANDING_IMAGE_SIZE_BYTES) {
      throw new ApiError(413, 'Branding images must be 5 MB or smaller.');
    }

    let extension;
    let imageBuffer;
    try {
      const image = sharp(file.buffer, {
        failOn: 'error',
        limitInputPixels: MAX_BRANDING_IMAGE_PIXELS,
      });
      const metadata = await image.metadata();
      extension = brandingImageFormats.get(metadata.format);
      if (!extension || !metadata.width || !metadata.height) {
        throw new Error('Unsupported branding image format.');
      }
      imageBuffer = await sharp(file.buffer, {
        failOn: 'error',
        limitInputPixels: MAX_BRANDING_IMAGE_PIXELS,
      }).rotate().toFormat(metadata.format).toBuffer();
    } catch {
      throw new ApiError(400, 'Choose a valid JPEG, PNG, or WebP branding image.');
    }

    const storedName = `site-branding/${randomUUID()}.${extension}`;
    const destination = path.resolve(mediaConfig.publicRoot, storedName);
    await mkdir(path.dirname(destination), { recursive: true });
    newImages.push(storedName);
    await writeFile(destination, imageBuffer, { flag: 'wx', mode: 0o644 });
    return storedName;
  };

  let newSiteLogo = '';
  let newHomepageHeroImage = '';
  try {
    if (siteLogoFile) newSiteLogo = await storeImage(siteLogoFile);
    if (homepageHeroImageFile) newHomepageHeroImage = await storeImage(homepageHeroImageFile);
  } catch (error) {
    await Promise.all(newImages.map((image) => removeImage(image, 'new')));
    throw error;
  }

  let replacedImages;
  try {
    replacedImages = await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO portal_admin_brokeragesettings
         (id, business_name, site_name, footer_copyright, site_logo, homepage_hero_image,
          phone, whatsapp_url, telegram_url, email, facebook_url, instagram_url,
          tiktok_url, youtube_url, linkedin_url, updated_at, platform_owner_id)
       VALUES (1, '', 'Infinity House', '', '', '', '', '', '', '', '', '', '', '', '',
               CURRENT_TIMESTAMP, $1)
       ON CONFLICT (id) DO NOTHING`,
      [access.platformOwnerId],
    );
    const owner = await client.query(
      `SELECT platform_owner_id FROM portal_admin_brokeragesettings
       WHERE id = 1 FOR UPDATE`,
    );
    if (!owner.rowCount) throw new ApiError(404, 'Not found.');
    if (Number(owner.rows[0].platform_owner_id) !== access.platformOwnerId) {
      await client.query(
        `UPDATE portal_admin_brokeragesettings
         SET platform_owner_id = $1 WHERE id = 1`,
        [access.platformOwnerId],
      );
    }
    const currentSettings = await client.query(
      `SELECT site_logo, homepage_hero_image
       FROM portal_admin_brokeragesettings WHERE id = 1`,
    );
    const previous = currentSettings.rows[0] || {};

    const updates = [];
    const values = [];
    const appendField = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (Object.hasOwn(data, 'site_name')) appendField('site_name', data.site_name);
    if (siteLogoFile) appendField('site_logo', newSiteLogo);
    else if (data.clear_site_logo) appendField('site_logo', '');
    if (homepageHeroImageFile) appendField('homepage_hero_image', newHomepageHeroImage);
    else if (data.clear_homepage_hero_image) appendField('homepage_hero_image', '');
    for (const column of ['business_name', 'phone', 'email', 'footer_copyright']) {
      if (Object.hasOwn(data, column)) appendField(column, data[column]);
    }
    for (const link of data.social_links || []) {
      const legacyColumn = legacySocialColumns[link.platform];
      if (legacyColumn) appendField(legacyColumn, link.url);
    }
    if (updates.length) {
      await client.query(
        `UPDATE portal_admin_brokeragesettings
         SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        values,
      );
    }
    for (const link of data.social_links || []) {
      await client.query(
        `INSERT INTO portal_admin_socialmedialink
           (brokerage_id, platform, url, is_enabled, display_order, created_at, updated_at)
         VALUES (1, $1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (brokerage_id, platform)
         DO UPDATE SET url = EXCLUDED.url, is_enabled = EXCLUDED.is_enabled,
                       display_order = EXCLUDED.display_order,
                       updated_at = CURRENT_TIMESTAMP`,
        [link.platform, link.url, link.is_enabled, link.display_order],
      );
    }
    return {
      site_logo: previous.site_logo,
      homepage_hero_image: previous.homepage_hero_image,
    };
  });
  } catch (error) {
    await Promise.all(newImages.map((image) => removeImage(image, 'new')));
    throw error;
  }

  const replaced = [
    ['site_logo', replacedImages.site_logo],
    ['homepage_hero_image', replacedImages.homepage_hero_image],
  ];
  await Promise.all(replaced.map(([field, oldImage]) => {
    const currentImage = field === 'site_logo'
      ? (newSiteLogo || (data.clear_site_logo ? '' : oldImage))
      : (newHomepageHeroImage || (data.clear_homepage_hero_image ? '' : oldImage));
    return oldImage && oldImage !== currentImage
      ? removeImage(oldImage, 'old')
      : Promise.resolve();
  }));
  return readManagedBrokerageContact(pool, request);
}

export async function createListingReport(pool, data) {
  const property = await pool.query(
    `SELECT p.id, p.title FROM user_property AS p
     WHERE p.id = $1 AND ${publicPropertyFilter}`,
    [data.property_id],
  );
  if (property.rowCount !== 1) {
    throw new ApiError(400, 'Request validation failed.', {
      property_id: ['Select a published and available property.'],
    });
  }
  const result = await pool.query(
    `INSERT INTO properties_listingreport
       (property_title, reporter_name, reporter_email, reason, details, status,
        moderator_notes, reviewed_at, created_at, property_id, reviewed_by_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', '', NULL, CURRENT_TIMESTAMP, $6, NULL)
     RETURNING id, status, created_at`,
    [
      property.rows[0].title,
      data.reporter_name,
      data.reporter_email,
      data.reason,
      data.details,
      property.rows[0].id,
    ],
  );
  return { ...result.rows[0], id: Number(result.rows[0].id) };
}

export async function listFavorites(pool, request, userId) {
  const favorites = await pool.query(
    `SELECT favorite.id, favorite.property_id, favorite.created_at, property.slug
     FROM favorites_favorite AS favorite
     JOIN user_property AS property ON property.id = favorite.property_id
     WHERE favorite.user_id = $1
     ORDER BY favorite.created_at DESC, favorite.id DESC`,
    [userId],
  );
  const results = await Promise.all(favorites.rows.map(async (favorite) => {
    try {
      const property = await getPublicProperty(pool, request, favorite.slug);
      const {
        description: _description,
        features: _features,
        amenities: _amenities,
        updated_at: _updatedAt,
        ...listProperty
      } = property;
      return {
        id: Number(favorite.id),
        property: listProperty,
        created_at: favorite.created_at,
      };
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }));
  const visibleFavorites = results.filter(Boolean);
  return {
    count: visibleFavorites.length,
    next: null,
    previous: null,
    results: visibleFavorites,
  };
}

export async function createFavorite(pool, request, userId, propertyId) {
  const property = await pool.query(
    `SELECT p.id, p.slug FROM user_property AS p
     WHERE p.id = $1 AND ${publicPropertyFilter}`,
    [propertyId],
  );
  if (property.rowCount !== 1) {
    throw new ApiError(400, 'Request validation failed.', {
      property_id: ['Select a published and available property.'],
    });
  }
  const result = await pool.query(
    `INSERT INTO favorites_favorite (user_id, property_id, created_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, property_id) DO UPDATE SET property_id = EXCLUDED.property_id
     RETURNING id, created_at`,
    [userId, property.rows[0].id],
  );
  return {
    id: Number(result.rows[0].id),
    property: await getPublicProperty(pool, request, property.rows[0].slug),
    created_at: result.rows[0].created_at,
  };
}

export async function deleteFavorite(pool, userId, propertyId) {
  const result = await pool.query(
    `DELETE FROM favorites_favorite WHERE user_id = $1 AND property_id = $2`,
    [userId, propertyId],
  );
  if (result.rowCount === 0) throw new ApiError(404, 'Not found.');
}

export async function listPublicLocations(pool, filters) {
  if (filters.search) {
    const catalog = await pool.query(
      `SELECT id, parent_id, name, name_am, aliases_en, aliases_am
       FROM properties_location WHERE is_active = TRUE`,
    );
    const search = normalizeLocationSearch(filters.search);
    const matchingIds = new Set(catalog.rows.filter((location) => [
      location.name,
      location.name_am,
      ...(location.aliases_en || []),
      ...(location.aliases_am || []),
    ].some((value) => typeof value === 'string'
      && normalizeLocationSearch(value).includes(search))).map((location) => String(location.id)));
    const children = new Map();
    for (const location of catalog.rows) {
      if (location.parent_id === null) continue;
      const parent = String(location.parent_id);
      children.set(parent, [...(children.get(parent) || []), String(location.id)]);
    }
    const matches = new Set(matchingIds);
    const frontier = [...matchingIds];
    while (frontier.length) {
      const parentId = frontier.pop();
      for (const childId of children.get(parentId) || []) {
        if (matches.has(childId)) continue;
        matches.add(childId);
        frontier.push(childId);
      }
    }
    if (!matches.size || !search) return [];
    const result = await pool.query(
      `SELECT ${locationProjection}
       FROM properties_location AS location
       ${locationCityJoin}
       WHERE location.is_active = TRUE AND location.id = ANY($1::bigint[])
       ORDER BY location.display_order, location.name
       LIMIT 20`,
      [[...matches]],
    );
    return result.rows.map(asLocation);
  }
  const values = [];
  const conditions = ['location.is_active = TRUE'];
  if (filters.all !== '1') {
    if (filters.parent_id) {
      values.push(filters.parent_id);
      conditions.push(`location.parent_id = $${values.length}`);
    } else if (!filters.type && !filters.types) {
      conditions.push('location.parent_id IS NULL');
    }
  }
  if (filters.type || filters.types) {
    const types = (filters.types || filters.type).split(',').map((value) => value.trim()).filter(Boolean);
    values.push(types);
    conditions.push(`location.location_type = ANY($${values.length}::varchar[])`);
  }
  const result = await pool.query(
    `SELECT ${locationProjection}
     FROM properties_location AS location
     ${locationCityJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY location.display_order, location.name
     `,
    values,
  );
  return result.rows.map(asLocation);
}

export async function listManagedLocations(pool, userId, filters) {
  const access = await locationAccess(pool, userId);
  const values = [];
  const conditions = ['TRUE'];
  let scope = '';
  if (access.role !== 'administrator') {
    if (access.assignedCityId === null) return [];
    values.push(access.assignedCityId);
    scope = `WITH RECURSIVE allowed_location (id, visited) AS (
      SELECT id, ARRAY[id] FROM properties_location WHERE id = $1
      UNION ALL
      SELECT child.id, allowed_location.visited || child.id
      FROM allowed_location
      JOIN properties_location AS child ON child.parent_id = allowed_location.id
      WHERE NOT child.id = ANY(allowed_location.visited)
    )`;
    conditions.push('location.id IN (SELECT id FROM allowed_location)');
  }
  if (filters.all !== '1') {
    if (filters.parent_id) {
      values.push(filters.parent_id);
      conditions.push(`location.parent_id = $${values.length}`);
    } else {
      conditions.push('location.parent_id IS NULL');
    }
  }
  const result = await pool.query(
    `${scope}
     SELECT ${locationProjection}
     FROM properties_location AS location
     ${locationCityJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY location.display_order, location.name, location.id`,
    values,
  );
  return result.rows.map(asLocation);
}

export async function getManagedLocation(pool, userId, locationId) {
  const access = await locationAccess(pool, userId);
  await assertLocationScope(pool, access, locationId);
  const result = await pool.query(
    `SELECT ${locationProjection}
     FROM properties_location AS location
     ${locationCityJoin}
     WHERE location.id = $1`,
    [locationId],
  );
  if (result.rowCount !== 1) throw new ApiError(404, 'Not found.');
  return asLocation(result.rows[0]);
}

async function ensureEthiopiaCountry(pool) {
  const result = await pool.query(
    `SELECT id, is_active
     FROM properties_location
     WHERE location_type = 'country' AND name ILIKE 'Ethiopia'
     ORDER BY id LIMIT 1`,
  );
  if (result.rowCount) {
    const countryId = Number(result.rows[0].id);
    if (result.rows[0].is_active === false) {
      await pool.query(
        `UPDATE properties_location SET is_active = TRUE WHERE id = $1`,
        [countryId],
      );
    }
    return countryId;
  }
  const created = await pool.query(
    `INSERT INTO properties_location
       (name, name_am, slug, location_type, is_active, display_order,
        latitude, longitude, parent_id, aliases_am, aliases_en)
     VALUES ($1, $2, $3, 'country', TRUE, 0, NULL, NULL, NULL, '[]'::jsonb, '[]'::jsonb)
     RETURNING id`,
    ['Ethiopia', 'ኢትዮጵያ', 'ethiopia'],
  );
  return Number(created.rows[0].id);
}

async function validateLocationWrite(pool, access, data, creating, locationId) {
  assertEditableFields(data, access, creating);
  if (access.role === 'agent' && access.assignedCityId === null) {
    throw new ApiError(400, 'Request validation failed.', {
      parent: ['Ask an administrator to assign a city before managing sub-cities.'],
    });
  }
  const type = access.role === 'agent' ? 'subcity' : data.location_type || 'city';
  let parentId = access.role === 'agent'
    ? access.assignedCityId
    : (Object.hasOwn(data, 'parent') ? data.parent : null);
  if (!creating) return { locationType: type, parentId };
  if (!['city', 'subcity'].includes(type)) {
    throw new ApiError(400, 'Request validation failed.', {
      location_type: ['Administrators can create marketplace cities or sub-cities only.'],
    });
  }
  if (access.role === 'administrator' && type === 'city') {
    const countryId = await ensureEthiopiaCountry(pool);
    if (parentId !== null && Number(parentId) !== countryId) {
      throw new ApiError(400, 'Request validation failed.', {
        parent: ['Marketplace cities must be placed directly under Ethiopia.'],
      });
    }
    parentId = countryId;
  }
  if (parentId === null) {
    throw new ApiError(400, 'Request validation failed.', {
      parent: ['Choose a city or city administration for this sub-city.'],
    });
  }
  const parent = await pool.query(
    `SELECT id, is_active, location_type FROM properties_location WHERE id = $1`,
    [parentId],
  );
  if (!parent.rowCount || !parent.rows[0].is_active) {
    throw new ApiError(400, 'Request validation failed.', {
      parent: ['An active location must have an active parent.'],
    });
  }
  if (
    type === 'subcity'
    && !['city', 'city_administration'].includes(parent.rows[0].location_type)
  ) {
    throw new ApiError(400, 'Request validation failed.', {
      parent: ['Sub-cities must be placed beneath a city or city administration.'],
    });
  }
  if (locationId && Number(parentId) === Number(locationId)) {
    throw new ApiError(400, 'Request validation failed.', {
      parent: ['A location cannot be placed beneath itself or one of its descendants.'],
    });
  }
  return { locationType: type, parentId };
}

function locationError(error) {
  if (error.code === '23505') {
    return new ApiError(400, 'Request validation failed.', {
      slug: ['A location with this slug already exists under the selected parent.'],
    });
  }
  if (error.code === '23503') {
    return new ApiError(400, 'Request validation failed.', {
      parent: ['Select a valid parent location.'],
    });
  }
  if (error.code === '23514') {
    return new ApiError(400, 'Request validation failed.', {
      non_field_errors: ['Location coordinates must be valid and supplied together.'],
    });
  }
  return error;
}

export async function createManagedLocation(pool, userId, data) {
  const access = await locationAccess(pool, userId);
  const { locationType, parentId } = await validateLocationWrite(pool, access, data, true);
  const slug = slugify(data.name);
  if (!slug) {
    throw new ApiError(400, 'Request validation failed.', {
      slug: ['Enter a name that can be converted to a valid location slug.'],
    });
  }
  try {
    const result = await pool.query(
      `INSERT INTO properties_location
         (name, name_am, slug, location_type, is_active, display_order,
          latitude, longitude, parent_id, aliases_am, aliases_en)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, '[]'::jsonb, '[]'::jsonb)
       RETURNING id`,
      [
        data.name,
        data.name_am || '',
        slug,
        locationType,
        data.is_active ?? true,
        data.display_order ?? 0,
        parentId,
      ],
    );
    return getManagedLocation(pool, userId, Number(result.rows[0].id));
  } catch (error) {
    throw locationError(error);
  }
}

export async function updateManagedLocation(pool, userId, locationId, data) {
  const access = await locationAccess(pool, userId);
  await assertLocationScope(pool, access, locationId, { forEdit: true });
  assertEditableFields(data, access, false);
  const currentResult = await pool.query(
    `SELECT id, name, name_am, is_active, display_order
     FROM properties_location WHERE id = $1`,
    [locationId],
  );
  const current = currentResult.rows[0];
  const fields = {
    name: data.name ?? current.name,
    name_am: data.name_am ?? current.name_am,
    is_active: data.is_active ?? current.is_active,
    display_order: data.display_order ?? current.display_order,
  };
  if (current.is_active && fields.is_active === false) {
    const descendants = await pool.query(
      `WITH RECURSIVE descendants (id, visited) AS (
         SELECT id, ARRAY[id] FROM properties_location WHERE parent_id = $1
         UNION ALL
         SELECT child.id, descendants.visited || child.id
         FROM descendants
         JOIN properties_location AS child ON child.parent_id = descendants.id
         WHERE NOT child.id = ANY(descendants.visited)
       )
       SELECT EXISTS (
         SELECT 1 FROM properties_location AS location
         WHERE location.id IN (SELECT id FROM descendants) AND location.is_active = TRUE
       ) AS has_active_descendants`,
      [locationId],
    );
    if (descendants.rows[0].has_active_descendants) {
      throw new ApiError(400, 'Request validation failed.', {
        is_active: ['Deactivate or reassign active child locations first.'],
      });
    }
  }
  try {
    await pool.query(
      `UPDATE properties_location
       SET name = $2, name_am = $3, is_active = $4, display_order = $5
       WHERE id = $1`,
      [locationId, fields.name, fields.name_am, fields.is_active, fields.display_order],
    );
  } catch (error) {
    throw locationError(error);
  }
  return getManagedLocation(pool, userId, locationId);
}

export async function deleteManagedLocation(pool, userId, locationId) {
  const access = await locationAccess(pool, userId);
  await assertLocationScope(pool, access, locationId, { forEdit: true });
  const descendants = await pool.query(
    `WITH RECURSIVE descendants (id, visited) AS (
       SELECT id, ARRAY[id] FROM properties_location WHERE parent_id = $1
       UNION ALL
       SELECT child.id, descendants.visited || child.id
       FROM descendants
       JOIN properties_location AS child ON child.parent_id = descendants.id
       WHERE NOT child.id = ANY(descendants.visited)
     )
     SELECT EXISTS (
       SELECT 1 FROM properties_location AS location
       WHERE location.id IN (SELECT id FROM descendants) AND location.is_active = TRUE
     ) AS has_active_descendants`,
    [locationId],
  );
  if (descendants.rows[0].has_active_descendants) {
    throw new ApiError(400, 'Request validation failed.', {
      is_active: ['Deactivate active child locations before removing this location.'],
    });
  }
  await pool.query(
    `UPDATE properties_location SET is_active = FALSE WHERE id = $1`,
    [locationId],
  );
}
