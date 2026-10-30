import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { requestOrigin } from '../requestOrigin.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireCsrf } from '../middleware/csrf.js';
import { storedMediaPath } from '../services/propertyImageService.js';
import { hashPassword } from '../services/passwordService.js';
import {
  getDefaultPublicInformationPage,
  publicInformationPageDefaults,
} from '../services/publicInformationPageSeedService.js';
import {
  adminPropertyPatchSchema,
  adminUserPatchSchema,
  assignmentSchema,
  delegatedAccountCreateSchema,
  delegatedAccountPatchSchema,
  homepageNotePatchSchema,
  homepageNoteSchema,
  idsSchema,
  managedPropertyCreateSchema,
  managedPropertyPatchSchema,
  positiveId,
  publicAccountCreateSchema,
  publicAccountPatchSchema,
  publicPagePatchSchema,
  publicationSchema,
  reportPatchSchema,
  workflowPaginationSchema,
} from '../validators/adminManagementWorkflows.js';

const permissionNames = new Set([
  'properties.view_all', 'properties.moderate', 'properties.edit_all', 'properties.delete_all',
  'properties.manage_assigned', 'users.manage', 'staff.manage', 'reports.review',
  'audit.view', 'agents.assign', 'settings.manage',
]);
const publicPageNames = ['about', 'contact', 'property-management'];
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, parts: 5 },
}).single('image');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = {};
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || 'non_field_errors';
      details[field] ??= [];
      details[field].push(issue.message);
    }
    throw new ApiError(400, 'Request validation failed.', details);
  }
  return result.data;
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
}

async function access(pool, userId) {
  const result = await pool.query(
    `SELECT u.id, u.username, u.is_active, u.is_staff, u.is_superuser,
            p.role, p.agent_approved, p.management_permissions, p.assigned_city_id,
            COALESCE(
              (SELECT settings.platform_owner_id
               FROM portal_admin_brokeragesettings settings
               JOIN auth_user owner ON owner.id = settings.platform_owner_id
               WHERE settings.id = 1 AND owner.is_active = TRUE AND owner.is_superuser = TRUE),
              (SELECT owner.id FROM auth_user owner
               WHERE owner.is_active = TRUE AND owner.is_superuser = TRUE ORDER BY owner.id LIMIT 1)
            ) AS platform_owner_id
     FROM auth_user u LEFT JOIN accounts_profile p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user?.is_active) throw new ApiError(403, 'This account is not permitted to perform this action.');
  const admin = user.is_superuser || (user.is_staff && user.role === 'administrator');
  const storedPermissions = Array.isArray(user.management_permissions) ? user.management_permissions : [];
  const permissions = admin
    ? [...permissionNames].filter((permission) => permission !== 'settings.manage')
    : user.role === 'agent' && user.agent_approved
      ? [
        'properties.manage_assigned',
        'viewings.manage_assigned',
        'locations.manage_subcities',
        ...['announcements.review_assigned', 'settings.manage'].filter(
          (permission) => storedPermissions.includes(permission),
        ),
      ]
      : [];
  if (user.is_superuser && user.platform_owner_id === user.id) permissions.push('settings.manage');
  return { ...user, admin, permissions };
}

function requirePermission(user, permission) {
  if (!user.permissions.includes(permission)) {
    throw new ApiError(403, 'You are not allowed to perform this action.');
  }
}

function requireAnyPermission(user, permissions) {
  if (!permissions.some((permission) => user.permissions.includes(permission))) {
    throw new ApiError(403, 'You are not allowed to perform this action.');
  }
}

async function requireWorkflowAccess(pool, userId, permission) {
  const user = await access(pool, userId);
  requirePermission(user, permission);
  return user;
}

async function requireAccountAdministrator(pool, userId) {
  const user = await access(pool, userId);
  if (!user.is_superuser && !(user.is_staff && user.role === 'administrator')) {
    throw new ApiError(403, 'Administrator access is required.');
  }
  return user;
}

async function requirePublicPageManager(pool, userId) {
  const user = await access(pool, userId);
  if (
    !user.is_superuser
    && !(user.is_staff && user.role === 'administrator')
    && !user.permissions.includes('settings.manage')
  ) {
    throw new ApiError(403, 'Website page management access is required.');
  }
  return user;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function assertAccountHasNoHistory(client, userId) {
  const dependencies = await client.query(
    `SELECT referencing_namespace.nspname AS schema_name,
            referencing_table.relname AS table_name,
            referencing_column.attname AS column_name
     FROM pg_constraint AS foreign_key_constraint
     JOIN pg_class AS referenced_table
       ON referenced_table.oid = foreign_key_constraint.confrelid
     JOIN LATERAL unnest(foreign_key_constraint.conkey) WITH ORDINALITY AS foreign_key(attnum, ordinality)
       ON TRUE
     JOIN LATERAL unnest(foreign_key_constraint.confkey) WITH ORDINALITY AS referenced_key(attnum, ordinality)
       ON referenced_key.ordinality = foreign_key.ordinality
     JOIN pg_class AS referencing_table
       ON referencing_table.oid = foreign_key_constraint.conrelid
     JOIN pg_namespace AS referencing_namespace
       ON referencing_namespace.oid = referencing_table.relnamespace
     JOIN pg_attribute AS referencing_column
       ON referencing_column.attrelid = referencing_table.oid
      AND referencing_column.attnum = foreign_key.attnum
     JOIN pg_attribute AS referenced_column
       ON referenced_column.attrelid = referenced_table.oid
      AND referenced_column.attnum = referenced_key.attnum
     WHERE foreign_key_constraint.contype = 'f'
       AND referenced_table.oid = to_regclass('auth_user')
       AND referenced_column.attname = 'id'
       AND referencing_namespace.nspname = ANY(current_schemas(false))
       AND referencing_table.oid <> referenced_table.oid`,
  );
  const accountOwnedTables = new Set([
    'accounts_profile',
    'accounts_tabsessiontoken',
    'accounts_userpreferences',
    'accounts_emailverificationtoken',
    'accounts_delegatedaccountinvitation',
    'auth_user_groups',
    'auth_user_user_permissions',
  ]);
  const ownedReferences = [];

  for (const dependency of dependencies.rows) {
    if (accountOwnedTables.has(dependency.table_name)) {
      ownedReferences.push(dependency);
      continue;
    }
    const reference = await client.query(
      `SELECT 1 FROM ${quoteIdentifier(dependency.schema_name)}.${quoteIdentifier(dependency.table_name)}
       WHERE ${quoteIdentifier(dependency.column_name)} = $1
       LIMIT 1`,
      [userId],
    );
    if (reference.rowCount > 0) {
      throw new ApiError(
        409,
        'This account has linked records and cannot be permanently deleted. Deactivate the account instead.',
      );
    }
  }
  return ownedReferences;
}

async function writeAudit(client, user, action, objectType, objectId, changes = {}) {
  await client.query(
    `INSERT INTO portal_admin_adminauditevent
       (actor_id, actor_username, action, object_type, object_id, changes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP)`,
    [user.id, user.username, action, objectType, String(objectId), JSON.stringify(changes)],
  );
}

async function ensureUniqueUsername(pool, username, exceptUserId = null) {
  const result = await pool.query(
    `SELECT id FROM auth_user WHERE lower(username) = lower($1)
     AND ($2::integer IS NULL OR id <> $2) LIMIT 1`,
    [username, exceptUserId],
  );
  if (result.rowCount) {
    throw new ApiError(400, 'A user with this username already exists.', {
      username: ['A user with this username already exists.'],
    });
  }
}

function makePageUrl(request, page) {
  const url = new URL(request.originalUrl, requestOrigin(request));
  url.searchParams.set('page', String(page.page));
  url.searchParams.set('page_size', String(page.page_size));
  return url.toString();
}

function pageResult(request, rows, count, page) {
  const offset = (page.page - 1) * page.page_size;
  return {
    count,
    next: offset + page.page_size < count ? makePageUrl(request, { ...page, page: page.page + 1 }) : null,
    previous: page.page > 1 && count ? makePageUrl(request, { ...page, page: page.page - 1 }) : null,
    results: rows,
  };
}

function mediaUrl(request, storedImage) {
  if (!storedImage) return null;
  return new URL(`/media/${storedImage.split('/').map(encodeURIComponent).join('/')}`,
    requestOrigin(request)).toString();
}

function accountData(row) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone || '',
    role: row.role,
    is_active: Boolean(row.is_active),
    date_joined: row.date_joined,
    ...(row.role === 'agent' ? {
      assigned_city_id: row.assigned_city_id === null ? null : Number(row.assigned_city_id),
      agent_approved: Boolean(row.agent_approved),
      agent_onboarding_required: Boolean(row.agent_onboarding_required),
      management_permissions: effectiveManagementPermissions(row),
    } : {}),
  };
}

function effectiveManagementPermissions(row) {
  if (row.role !== 'agent' || !row.agent_approved) return [];
  const stored = Array.isArray(row.management_permissions) ? row.management_permissions : [];
  return [
    'properties.manage_assigned',
    'viewings.manage_assigned',
    'locations.manage_subcities',
    ...['announcements.review_assigned', 'settings.manage'].filter((permission) => stored.includes(permission)),
  ];
}

const joinedAccount = `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active,
  u.is_staff, u.is_superuser, u.date_joined, p.role, p.phone, p.assigned_city_id,
  p.agent_approved, p.agent_onboarding_required, p.management_permissions
  FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id`;

function queryFilters(request, options = {}) {
  const page = parse(workflowPaginationSchema, request.query);
  const params = [];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (page.search) {
    const pattern = `%${page.search.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(pattern);
    const placeholder = `$${params.length}`;
    where.push(options.searchClause(placeholder));
  }
  const role = page.role ?? page.profile__role;
  const approved = page.agent_approved ?? page.profile__agent_approved;
  if (page.status && options.statusColumn) add(`${options.statusColumn} = ?`, page.status);
  if (page.publication_status && options.publicationStatusColumn) {
    add(`${options.publicationStatusColumn} = ?`, page.publication_status);
  }
  if (page.listing_type && options.listingTypeColumn) add(`${options.listingTypeColumn} = ?`, page.listing_type);
  if (page.property_type && options.propertyTypeColumn) add(`${options.propertyTypeColumn} = ?`, page.property_type);
  if (role && options.roleColumn) add(`${options.roleColumn} = ?`, role);
  if (page.is_active && options.activeColumn) add(`${options.activeColumn} = ?`, page.is_active === 'true');
  else if (options.defaultActive && page.include_inactive !== 'true') {
    add(`${options.activeColumn} = ?`, true);
  }
  if (approved && options.approvedColumn) add(`${options.approvedColumn} = ?`, approved === 'true');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { page, params, whereSql };
}

async function pagedList(pool, request, options) {
  const { page, params, whereSql } = queryFilters(request, options);
  const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${options.table} ${whereSql}`, params);
  const orderBy = options.ordering?.[page.ordering] || options.defaultOrder;
  const rows = await pool.query(
    `SELECT ${options.columns} FROM ${options.table} ${whereSql}
     ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page.page_size, (page.page - 1) * page.page_size],
  );
  return pageResult(request, options.serialize ? rows.rows.map(options.serialize) : rows.rows,
    Number(count.rows[0].count), page);
}

async function uploadHomepageImage(request, response, next) {
  fileUpload(request, response, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'Image files must be 10 MB or smaller.'));
    return next(new ApiError(400, 'The homepage note upload is invalid.'));
  });
}

async function saveHomepageImage(file, mediaConfig) {
  if (!file) return null;
  if (!mediaConfig || file.size > 10 * 1024 * 1024) {
    throw new ApiError(413, 'Image files must be 10 MB or smaller.');
  }
  const extensions = new Map([['jpeg', 'jpg'], ['png', 'png'], ['webp', 'webp']]);
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  if (!allowedExtensions.has(path.extname(String(file.originalname || '')).toLowerCase())) {
    throw new ApiError(400, 'Choose a JPEG, PNG, or WebP image.');
  }
  let extension;
  let publicBuffer;
  try {
    const source = sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 });
    const metadata = await source.metadata();
    extension = extensions.get(metadata.format);
    if (!extension || !metadata.width || !metadata.height) throw new Error('Unsupported image format.');
    const converted = sharp(file.buffer).rotate();
    if (metadata.format === 'jpeg') publicBuffer = await converted.jpeg().toBuffer();
    else if (metadata.format === 'png') publicBuffer = await converted.png().toBuffer();
    else publicBuffer = await converted.webp().toBuffer();
  } catch {
    throw new ApiError(400, 'Choose a valid JPEG, PNG, or WebP image.');
  }
  const stored = `homepage-announcements/${randomUUID()}.${extension}`;
  const destination = path.resolve(mediaConfig.publicRoot, stored);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, publicBuffer, { flag: 'wx', mode: 0o644 });
  return stored;
}

async function removeHomepageImage(mediaConfig, storedImage, logger) {
  if (!mediaConfig || !storedImage) return;
  try {
    await unlink(storedMediaPath(mediaConfig.publicRoot, storedImage, 'homepage-announcements'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    if (error.statusCode === 404) {
      logger.error('Homepage image path is not safe to remove.', error.statusCode);
      return;
    }
    throw error;
  }
}

async function removeNewHomepageImage(mediaConfig, storedImage, logger) {
  if (!mediaConfig || !storedImage) return;
  try {
    await unlink(path.resolve(mediaConfig.publicRoot, storedImage));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error('Failed to remove homepage image after a database error.', error.code || error.name);
    }
  }
}

async function lookupManagedProperty(pool, user, propertyId, lock = false) {
  const allowedAll = user.permissions.some((item) =>
    ['properties.view_all', 'properties.edit_all', 'properties.moderate', 'properties.delete_all'].includes(item));
  const values = [propertyId];
  let scope = "p.service_type = 'agent_managed'";
  if (!allowedAll) {
    if (!user.permissions.includes('properties.manage_assigned') || user.role !== 'agent' || !user.agent_approved) {
      throw new ApiError(403, 'You are not allowed to manage properties.');
    }
    values.push(user.id);
    scope += ` AND p.submitted_by_id = $${values.length}`;
  }
  const result = await pool.query(
    `SELECT p.* FROM user_property p WHERE p.id = $1 AND ${scope}${lock ? ' FOR UPDATE' : ''}`,
    values,
  );
  if (!result.rowCount) throw new ApiError(404, 'Property not found.');
  return result.rows[0];
}

async function managedPropertyRelationships(pool, request, id) {
  const [images, location] = await Promise.all([
    pool.query(
      `SELECT id, image, caption, is_primary FROM user_propertyimage
       WHERE property_id = $1 ORDER BY is_primary DESC, id`, [id],
    ),
    pool.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, name, name_am, location_type, parent_id, 0 AS depth
              , ARRAY[id] AS visited
         FROM properties_location WHERE id = (SELECT administrative_location_id FROM user_property WHERE id = $1)
         UNION ALL
         SELECT parent.id, parent.name, parent.name_am, parent.location_type, parent.parent_id,
                child.depth + 1, child.visited || parent.id
         FROM properties_location parent JOIN ancestors child ON child.parent_id = parent.id
         WHERE NOT parent.id = ANY(child.visited)
       )
       SELECT id, name, name_am, location_type FROM ancestors ORDER BY depth DESC`, [id],
    ),
  ]);
  return {
    images: images.rows.map((image) => ({
      id: Number(image.id), url: mediaUrl(request, image.image), caption: image.caption,
      is_primary: Boolean(image.is_primary),
    })),
    location_path: location.rows.map((item) => ({
      id: Number(item.id), name: item.name, name_am: item.name_am, location_type: item.location_type,
    })),
  };
}

function serializeManagedProperty(row) {
  return {
    id: Number(row.id), title: row.title, slug: row.slug, location: row.location,
    administrative_location: row.administrative_location_id === null ? null : Number(row.administrative_location_id),
    category: row.property_type, listing_type: row.listing_type,
    price: row.price === null ? null : String(row.price), currency: row.currency || 'ETB',
    bedrooms: row.bedrooms, bathrooms: row.bathrooms, area_sqft: row.area_sqft,
    area_value: row.area_value === null ? null : String(row.area_value), area_unit: row.area_unit,
    rental_frequency: row.rental_frequency, description: row.description, features: row.features,
    status: row.status === 'active' ? 'available' : row.status, publication_status: row.publication_status,
    is_featured: row.is_featured, submitted_by_id: row.submitted_by_id === null ? null : Number(row.submitted_by_id),
    moderation_note: row.moderation_note, contact_name: row.contact_name, contact_phone: row.contact_phone,
    contact_email: row.contact_email, created_at: row.created_at, updated_at: row.updated_at,
    location_path: [],
  };
}

async function getPropertyAmenities(pool, id) {
  const result = await pool.query(
    'SELECT amenity_id FROM user_property_amenities WHERE property_id = $1 ORDER BY amenity_id',
    [id],
  );
  return result.rows.map((row) => Number(row.amenity_id));
}

export function adminManagementWorkflowsRouter({ pool, mediaConfig, logger = console }) {
  const router = Router();
  const deleteManagedProperties = async (ids, user, ownerId = null) => {
    const deleted = await withTransaction(pool, async (client) => {
      const values = ownerId === null ? [ids] : [ids, ownerId];
      const rows = await client.query(
        `SELECT id, title, service_type FROM user_property
         WHERE id = ANY($1::bigint[]) AND service_type = 'agent_managed'
         ${ownerId === null ? '' : 'AND submitted_by_id = $2'} ORDER BY id FOR UPDATE`,
        values,
      );
      if (rows.rowCount !== ids.length) {
        throw new ApiError(404, 'One or more selected listings are unavailable.');
      }

      const viewingRequests = await client.query(
        `SELECT DISTINCT property_id FROM user_viewingrequest
         WHERE property_id = ANY($1::bigint[])`,
        [ids],
      );
      if (viewingRequests.rowCount) {
        throw new ApiError(
          409,
          'Listings with viewing requests cannot be permanently deleted. Mark them inactive instead.',
        );
      }

      const images = await client.query(
        `SELECT id, image, original_image FROM user_propertyimage
         WHERE property_id = ANY($1::bigint[]) ORDER BY id`,
        [ids],
      );
      if (images.rowCount && !mediaConfig) {
        throw new Error('Media storage is required to delete property images.');
      }
      const imagePaths = images.rows.flatMap((image) => [
        storedMediaPath(mediaConfig.publicRoot, image.image, 'property_images'),
        storedMediaPath(mediaConfig.privateRoot, image.original_image, 'private_property_images'),
      ]);

      for (const row of rows.rows) {
        await writeAudit(client, user, 'property_deleted', 'property', row.id,
          { title: row.title, service_type: row.service_type });
      }
      await client.query(
        'UPDATE properties_listingreport SET property_id = NULL WHERE property_id = ANY($1::bigint[])',
        [ids],
      );
      await client.query('DELETE FROM favorites_favorite WHERE property_id = ANY($1::bigint[])', [ids]);
      await client.query(
        'DELETE FROM properties_propertyagentassignment WHERE property_id = ANY($1::bigint[])',
        [ids],
      );
      await client.query('DELETE FROM user_property_amenities WHERE property_id = ANY($1::bigint[])', [ids]);
      await client.query('DELETE FROM user_propertyimage WHERE property_id = ANY($1::bigint[])', [ids]);
      await client.query(
        `DELETE FROM user_property WHERE id = ANY($1::bigint[]) AND service_type = 'agent_managed'
         ${ownerId === null ? '' : 'AND submitted_by_id = $2'}`,
        values,
      );
      return { count: rows.rowCount, images: images.rows, imagePaths };
    });

    await Promise.all(deleted.imagePaths.map(async (imagePath, index) => {
      try {
        await unlink(imagePath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error('Failed to remove property image after listing deletion.', {
            imageId: deleted.images[Math.floor(index / 2)].id,
            code: error.code || error.name,
          });
        }
      }
    }));
    return deleted.count;
  };
  const requireMutationCsrf = (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    return requireCsrf(request, response, next);
  };
  router.use(['/management', '/admin'], authenticate({ pool }));
  router.use(['/management', '/admin'], requireMutationCsrf);

  router.get('/management/homepage-notes/', asyncRoute(async (req, res) => {
    await requireWorkflowAccess(pool, req.userId, 'settings.manage');
    const result = await pagedList(pool, req, {
      table: 'portal_admin_homepagenote',
      columns: 'id, title, text, image, is_published, display_order, created_at, updated_at',
      searchClause: (p) => `(title ILIKE ${p} OR text ILIKE ${p})`,
      defaultOrder: 'display_order ASC, created_at DESC, id DESC',
      serialize: (row) => ({ ...row, id: Number(row.id), image: mediaUrl(req, row.image) }),
    });
    res.json(result);
  }));

  router.post('/management/homepage-notes/', uploadHomepageImage, asyncRoute(async (req, res) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'settings.manage');
    const input = parse(homepageNoteSchema, {
      ...req.body,
      is_published: typeof req.body.is_published === 'string' ? req.body.is_published === 'true' : req.body.is_published,
      display_order: req.body.display_order === undefined ? undefined : Number(req.body.display_order),
    });
    const image = await saveHomepageImage(req.file, mediaConfig);
    try {
      const result = await withTransaction(pool, async (client) => {
        const created = await client.query(
          `INSERT INTO portal_admin_homepagenote
             (title, text, image, is_published, display_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, title, text, image, is_published, display_order, created_at, updated_at`,
          [input.title, input.text, image || '', input.is_published, input.display_order],
        );
        await writeAudit(client, user, 'homepage_note_created', 'homepage_note', created.rows[0].id,
          { is_published: input.is_published });
        return created.rows[0];
      });
      res.status(201).json({ ...result, id: Number(result.id), image: mediaUrl(req, result.image) });
    } catch (error) {
      await removeNewHomepageImage(mediaConfig, image, logger);
      throw error;
    }
  }));

  router.route('/management/homepage-notes/:id/').all(asyncRoute(async (req, res, next) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'settings.manage');
    const id = parse(positiveId, req.params.id);
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT id, title, text, image, is_published, display_order, created_at, updated_at
         FROM portal_admin_homepagenote WHERE id = $1`, [id],
      );
      if (!result.rowCount) throw new ApiError(404, 'Homepage note not found.');
      const row = result.rows[0];
      res.json({ ...row, id: Number(row.id), image: mediaUrl(req, row.image) });
      return;
    }
    if (req.method === 'PATCH') {
      await new Promise((resolve, reject) => uploadHomepageImage(req, res, (error) => error ? reject(error) : resolve()));
      const raw = { ...req.body };
      if (typeof raw.is_published === 'string') raw.is_published = raw.is_published === 'true';
      if (typeof raw.display_order === 'string') raw.display_order = Number(raw.display_order);
      let input = parse(homepageNotePatchSchema, raw);
      const image = await saveHomepageImage(req.file, mediaConfig);
      if (image) input = { ...input, image };
      if (!Object.keys(input).length) throw new ApiError(400, 'At least one field is required.');
      const fields = Object.keys(input);
      const cols = { title: 'title', text: 'text', is_published: 'is_published', display_order: 'display_order', image: 'image' };
      let result;
      try {
        result = await withTransaction(pool, async (client) => {
          const old = await client.query('SELECT image FROM portal_admin_homepagenote WHERE id = $1 FOR UPDATE', [id]);
          if (!old.rowCount) throw new ApiError(404, 'Homepage note not found.');
          const values = fields.map((field) => input[field]);
          values.push(id);
          const updated = await client.query(
            `UPDATE portal_admin_homepagenote SET ${fields.map((field, i) => `${cols[field]} = $${i + 1}`).join(', ')},
               updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length}
             RETURNING id, title, text, image, is_published, display_order, created_at, updated_at`,
            values,
          );
          await writeAudit(client, user, 'homepage_note_updated', 'homepage_note', id, { fields });
          return { oldImage: old.rows[0].image, row: updated.rows[0] };
        });
      } catch (error) {
        await removeNewHomepageImage(mediaConfig, image, logger);
        throw error;
      }
      if (image && result.oldImage !== image) await removeHomepageImage(mediaConfig, result.oldImage, logger);
      res.json({ ...result.row, id: Number(result.row.id), image: mediaUrl(req, result.row.image) });
      return;
    }
    if (req.method === 'DELETE') {
      const deleted = await withTransaction(pool, async (client) => {
        const row = await client.query(
          'DELETE FROM portal_admin_homepagenote WHERE id = $1 RETURNING image, is_published', [id],
        );
        if (!row.rowCount) throw new ApiError(404, 'Homepage note not found.');
        await writeAudit(client, user, 'homepage_note_deleted', 'homepage_note', id, { is_published: row.rows[0].is_published });
        return row.rows[0];
      });
      await removeHomepageImage(mediaConfig, deleted.image, logger);
      res.status(204).end();
      return;
    }
    next();
  }));

  router.get('/management/public-pages/', asyncRoute(async (req, res) => {
    await requirePublicPageManager(pool, req.userId);
    const result = await pool.query(
      `SELECT page, title_en, title_am, introduction_en, introduction_am, body_en, body_am, updated_at
       FROM portal_admin_publicinformationpage ORDER BY page`,
    );
    const existingPages = new Map(result.rows.map((page) => [page.page, page]));
    const pages = publicInformationPageDefaults.map(({ page }) => (
      existingPages.get(page) || getDefaultPublicInformationPage(page)
    ));
    res.json({ count: pages.length, next: null, previous: null, results: pages });
  }));

  router.route('/management/public-pages/:page/').all(asyncRoute(async (req, res, next) => {
    const user = await requirePublicPageManager(pool, req.userId);
    if (!publicPageNames.includes(req.params.page)) throw new ApiError(404, 'Public information page not found.');
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT page, title_en, title_am, introduction_en, introduction_am, body_en, body_am, updated_at
         FROM portal_admin_publicinformationpage WHERE page = $1`, [req.params.page],
      );
      res.json(result.rows[0] || getDefaultPublicInformationPage(req.params.page));
      return;
    }
    if (req.method === 'PATCH') {
      const input = parse(publicPagePatchSchema, req.body);
      const fields = Object.keys(input);
      const defaults = getDefaultPublicInformationPage(req.params.page);
      const content = { ...defaults, ...input };
      const columns = [
        'title_en', 'title_am', 'introduction_en', 'introduction_am', 'body_en', 'body_am',
      ];
      const insertValues = [
        req.params.page,
        ...columns.map((field) => content[field]),
      ];
      const conflictUpdates = fields.map((field) =>
        `${field} = EXCLUDED.${field}`).concat('updated_at = CURRENT_TIMESTAMP');
      const result = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `INSERT INTO portal_admin_publicinformationpage
             (page, ${columns.join(', ')}, updated_at)
           VALUES ($1, ${columns.map((_, index) => `$${index + 2}`).join(', ')}, CURRENT_TIMESTAMP)
           ON CONFLICT (page) DO UPDATE SET ${conflictUpdates.join(', ')}
           RETURNING page, title_en, title_am, introduction_en, introduction_am, body_en, body_am, updated_at`,
          insertValues,
        );
        if (updated.rowCount !== 1) throw new Error('Could not save the public information page.');
        await writeAudit(client, user, 'public_information_page_updated', 'public_information_page',
          req.params.page, { fields });
        return updated.rows[0];
      });
      res.json(result);
      return;
    }
    next();
  }));

  router.get('/admin/users/', asyncRoute(async (req, res) => {
    await requireWorkflowAccess(pool, req.userId, 'users.manage');
    const search = queryFilters(req, {
      table: '(SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active, u.is_staff, u.is_superuser, u.date_joined, p.role, p.phone, p.agent_approved, p.agent_onboarding_required, p.management_permissions, p.assigned_city_id FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id) AS users',
      searchClause: (p) => `(username ILIKE ${p} OR email ILIKE ${p} OR first_name ILIKE ${p} OR last_name ILIKE ${p})`,
      roleColumn: 'role', activeColumn: 'is_active', approvedColumn: 'agent_approved',
    });
    const page = search.page;
    const filters = ["role = 'agent'", 'is_staff = FALSE', 'is_superuser = FALSE', search.whereSql.replace(/^WHERE\s*/i, '')].filter(Boolean).join(' AND ');
    const whereSql = `WHERE ${filters}`;
    const adminUsers = `(SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active,
      u.is_staff, u.is_superuser, u.date_joined, p.role, p.phone, p.agent_approved,
      p.agent_onboarding_required, p.management_permissions, p.assigned_city_id
      FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id) users`;
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${adminUsers} ${whereSql}`, search.params);
    const rows = await pool.query(
      `SELECT id, username, email, first_name, last_name, is_active, is_staff, is_superuser, date_joined,
              role, phone, agent_approved, agent_onboarding_required, management_permissions, assigned_city_id
       FROM (SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active, u.is_staff, u.is_superuser,
                    u.date_joined, p.role, p.phone, p.agent_approved, p.agent_onboarding_required,
                    p.management_permissions, p.assigned_city_id
             FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id) users
       ${whereSql} ORDER BY ${page.ordering === 'username' ? 'username ASC' : 'date_joined DESC'}
       LIMIT $${search.params.length + 1} OFFSET $${search.params.length + 2}`,
      [...search.params, page.page_size, (page.page - 1) * page.page_size],
    );
    res.json(pageResult(req, rows.rows.map((row) => ({
      id: Number(row.id), username: row.username, email: row.email, first_name: row.first_name, last_name: row.last_name,
      is_active: row.is_active, is_staff: row.is_staff, is_superuser: row.is_superuser, role: row.role,
      agent_approved: row.agent_approved, management_permissions: effectiveManagementPermissions(row), date_joined: row.date_joined,
    })), Number(count.rows[0].count), page));
  }));

  router.route('/admin/users/:id/').all(asyncRoute(async (req, res, next) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'users.manage');
    const id = parse(positiveId, req.params.id);
    const current = await pool.query(
      `${joinedAccount} WHERE u.id = $1 AND u.is_staff = FALSE AND u.is_superuser = FALSE AND p.role = 'agent'`, [id],
    );
    if (!current.rowCount) throw new ApiError(404, 'User not found.');
    if (req.method === 'GET') {
      const row = current.rows[0];
      res.json({ id: Number(row.id), username: row.username, email: row.email, first_name: row.first_name,
        last_name: row.last_name, is_active: row.is_active, is_staff: row.is_staff, is_superuser: row.is_superuser,
        role: row.role, agent_approved: row.agent_approved, management_permissions: effectiveManagementPermissions(row),
        date_joined: row.date_joined });
      return;
    }
    if (req.method === 'PATCH') {
      const input = parse(adminUserPatchSchema, req.body);
      const fields = Object.keys(input);
      const values = fields.map((field) => input[field]);
      values.push(id);
      const updated = await withTransaction(pool, async (client) => {
        await client.query(`UPDATE auth_user SET ${fields.map((field, i) => `${field} = $${i + 1}`).join(', ')} WHERE id = $${values.length}`, values);
        await writeAudit(client, user, 'user_updated', 'user', id,
          Object.fromEntries(fields.map((field) => [field, field === 'email' || field === 'first_name' || field === 'last_name' ? 'updated' : { from: current.rows[0][field], to: input[field] }])));
        return client.query(`${joinedAccount} WHERE u.id = $1`, [id]);
      });
      const row = updated.rows[0];
      res.json({ id: Number(row.id), username: row.username, email: row.email, first_name: row.first_name,
        last_name: row.last_name, is_active: row.is_active, is_staff: row.is_staff, is_superuser: row.is_superuser,
        role: row.role, agent_approved: row.agent_approved, management_permissions: effectiveManagementPermissions(row),
        date_joined: row.date_joined });
      return;
    }
    next();
  }));

  function accountCollection({ pathName, roles, delegated = false }) {
    router.get(pathName, asyncRoute(async (req, res) => {
      await requireAccountAdministrator(pool, req.userId);
      const result = await pagedList(pool, req, {
        table: `(SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active, u.date_joined,
                       p.role, p.phone, p.assigned_city_id, p.agent_approved, p.agent_onboarding_required,
                       p.management_permissions
                FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id
                WHERE u.is_staff = FALSE AND u.is_superuser = FALSE AND p.role IN (${roles.map((r) => `'${r}'`).join(',')})) accounts`,
        columns: 'id, username, email, first_name, last_name, is_active, date_joined, role, phone, assigned_city_id, agent_approved, agent_onboarding_required, management_permissions',
        searchClause: (p) => `(username ILIKE ${p} OR email ILIKE ${p} OR first_name ILIKE ${p} OR last_name ILIKE ${p})`,
        defaultOrder: 'date_joined DESC, id DESC',
        ordering: { username: 'username ASC, id ASC', '-date_joined': 'date_joined DESC, id DESC' },
        activeColumn: 'is_active',
        defaultActive: !delegated,
        serialize: accountData,
      });
      res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache').json(result);
    }));

    router.post(pathName, asyncRoute(async (req, res) => {
      const actor = await requireAccountAdministrator(pool, req.userId);
      const input = parse(delegated ? delegatedAccountCreateSchema : publicAccountCreateSchema, req.body);
      await ensureUniqueUsername(pool, input.username);
      if (delegated) {
        const city = await pool.query(
          "SELECT id FROM properties_location WHERE id = $1 AND location_type = 'city' AND is_active = TRUE", [input.assigned_city_id],
        );
        if (!city.rowCount) throw new ApiError(400, 'Choose an active city.');
      }
      const hash = await hashPassword(input.password);
      const created = await withTransaction(pool, async (client) => {
        const role = delegated ? 'agent' : input.role;
        const account = await client.query(
          `INSERT INTO auth_user
             (username, email, first_name, last_name, password, is_active, is_staff, is_superuser, date_joined)
           VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, FALSE, CURRENT_TIMESTAMP)
           RETURNING id`,
          [input.username, input.email || '', input.first_name || '', input.last_name || '', hash],
        );
        await client.query(
          `INSERT INTO accounts_profile
             (user_id, role, phone, agent_approved, created_at, updated_at, management_permissions,
              agent_onboarding_required, agent_password_changed, assigned_city_id)
           VALUES ($1, $2, $3, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4::jsonb, $5, $6, $7)`,
          [account.rows[0].id, role, input.phone || '',
            JSON.stringify(delegated ? [
              'properties.manage_assigned', 'viewings.manage_assigned', 'locations.manage_subcities',
            ] : []),
            delegated, !delegated, delegated ? input.assigned_city_id : null],
        );
        await writeAudit(client, actor, delegated ? 'delegated_account_created' : 'public_account_created',
          'user', account.rows[0].id, { role, is_active: true });
        return client.query(`${joinedAccount} WHERE u.id = $1`, [account.rows[0].id]);
      });
      res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache').status(201).json(accountData(created.rows[0]));
    }));

    router.route(`${pathName}:id/`).all(asyncRoute(async (req, res, next) => {
      const actor = await requireAccountAdministrator(pool, req.userId);
      const id = parse(positiveId, req.params.id);
      const current = await pool.query(
        `${joinedAccount} WHERE u.id = $1 AND u.is_staff = FALSE AND u.is_superuser = FALSE AND p.role IN (${roles.map((r) => `'${r}'`).join(',')})`,
        [id],
      );
      if (!current.rowCount) throw new ApiError(404, 'Account not found.');
      const row = current.rows[0];
      if (req.method === 'GET') {
        res.json(accountData(row));
        return;
      }
      if (req.method === 'PATCH') {
        const input = parse(delegated ? delegatedAccountPatchSchema : publicAccountPatchSchema, req.body);
        if (input.username) await ensureUniqueUsername(pool, input.username, id);
        if (delegated && input.assigned_city_id) {
          const city = await pool.query(
            "SELECT id FROM properties_location WHERE id = $1 AND location_type = 'city' AND is_active = TRUE",
            [input.assigned_city_id],
          );
          if (!city.rowCount) throw new ApiError(400, 'Choose an active city.');
        }
        const accountFields = ['username', 'email', 'first_name', 'last_name', 'is_active'];
        const profileFields = delegated
          ? ['phone', 'role', 'assigned_city_id', 'management_permissions']
          : ['phone', 'role'];
        const hash = input.password || input.initial_password ? await hashPassword(input.password || input.initial_password) : null;
        const result = await withTransaction(pool, async (client) => {
          const userChanges = Object.keys(input).filter((key) => accountFields.includes(key));
          const userValues = userChanges.map((key) => input[key]);
          if (hash) { userChanges.push('password'); userValues.push(hash); }
          if (userChanges.length) {
            userValues.push(id);
            await client.query(
              `UPDATE auth_user SET ${userChanges.map((key, index) => `${key} = $${index + 1}`).join(', ')} WHERE id = $${userValues.length}`,
              userValues,
            );
          }
          const profileChanges = Object.keys(input).filter((key) => profileFields.includes(key));
          if (profileChanges.length) {
            const profileValues = profileChanges.map((key) => key === 'management_permissions'
              ? JSON.stringify(input[key])
              : input[key]);
            profileValues.push(id);
            const profileAssignments = profileChanges.map((key, index) =>
              `${key} = $${index + 1}${key === 'management_permissions' ? '::jsonb' : ''}`).join(', ');
            await client.query(
              `UPDATE accounts_profile SET ${profileAssignments},
                 updated_at = CURRENT_TIMESTAMP WHERE user_id = $${profileValues.length}`,
              profileValues,
            );
          }
          if (delegated && hash) {
            await client.query('UPDATE accounts_profile SET agent_onboarding_required = TRUE, agent_password_changed = FALSE WHERE user_id = $1', [id]);
          }
          if (input.is_active === false) {
            await client.query(
              'UPDATE accounts_tabsessiontoken SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL', [id],
            );
          }
          await writeAudit(client, actor, delegated ? 'delegated_account_updated' : 'public_account_updated',
            'user', id, { fields: Object.keys(input) });
          return client.query(`${joinedAccount} WHERE u.id = $1`, [id]);
        });
        res.json(accountData(result.rows[0]));
        return;
      }
      if (req.method === 'DELETE') {
        await withTransaction(pool, async (client) => {
          const locked = await client.query(
            'SELECT id FROM auth_user WHERE id = $1 FOR UPDATE',
            [id],
          );
          if (!locked.rowCount) throw new ApiError(404, 'Account not found.');
          const ownedReferences = await assertAccountHasNoHistory(client, id);
          for (const reference of ownedReferences) {
            await client.query(
              `DELETE FROM ${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)}
               WHERE ${quoteIdentifier(reference.column_name)} = $1`,
              [id],
            );
          }
          await client.query('DELETE FROM auth_user WHERE id = $1', [id]);
          await writeAudit(client, actor, delegated ? 'delegated_account_deleted' : 'public_account_deleted',
            'user', id, { username: row.username, role: row.role });
        });
        res.status(204).end();
        return;
      }
      next();
    }));
  }

  accountCollection({ pathName: '/admin/public-accounts/', roles: ['customer', 'owner'] });
  accountCollection({ pathName: '/admin/delegated-accounts/', roles: ['agent'], delegated: true });

  router.post('/management/properties/', asyncRoute(async (req, res) => {
    const user = await access(pool, req.userId);
    const canCreateAsAgent = user.role === 'agent' && user.agent_approved
      && user.permissions.includes('properties.manage_assigned') && Boolean(user.assigned_city_id);
    const canCreate = user.admin || canCreateAsAgent;
    if (!canCreate) throw new ApiError(403, 'You are not allowed to create properties.');
    const initialPublicationStatus = user.admin ? 'published' : 'pending_review';
    const input = parse(managedPropertyCreateSchema, req.body);
    if (!input.contact_phone.trim()) {
      const profile = await pool.query('SELECT phone FROM accounts_profile WHERE user_id = $1', [req.userId]);
      input.contact_phone = profile.rows[0]?.phone?.trim() || '';
    }
    if ((input.listing_type === 'sale' && input.status === 'rented')
      || (input.listing_type === 'rent' && input.status === 'sold')) {
      throw new ApiError(400, 'The listing status does not match the listing type.');
    }
    if (input.listing_type !== 'rent' && input.rental_frequency) {
      throw new ApiError(400, 'Rental frequency is only valid for rental listings.');
    }
    if ((input.area_value === null) !== (input.area_unit === '')) {
      throw new ApiError(400, 'Provide a supported measurement unit together with the property size.', {
        area_unit: ['Provide a supported measurement unit together with the property size.'],
      });
    }
    const created = await withTransaction(pool, async (client) => {
      if (input.administrative_location !== null) {
        const location = await client.query('SELECT id FROM properties_location WHERE id = $1 AND is_active = TRUE', [input.administrative_location]);
        if (!location.rowCount) throw new ApiError(400, 'Choose an active administrative location.');
      }
      if (input.amenities.length) {
        const amenities = await client.query('SELECT id FROM properties_amenity WHERE id = ANY($1::bigint[])', [input.amenities]);
        if (amenities.rowCount !== input.amenities.length) throw new ApiError(400, 'One or more amenities are unavailable.');
      }
      const base = input.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 41) || 'property';
      const slug = `${base}-${randomUUID().slice(0, 8)}`;
      const inserted = await client.query(
        `INSERT INTO user_property
           (title, slug, location, administrative_location_id, property_type, listing_type, price, currency,
            rental_frequency, bedrooms, bathrooms, area_sqft, area_value, area_unit, description, features,
            status, publication_status, service_type, is_featured, submitted_by_id, moderation_note,
              advertising_authorized, contact_publicly_visible, exact_location_is_public,
              contact_name, contact_phone, contact_email, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'${initialPublicationStatus}',
                   'agent_managed',FALSE,$18,'',FALSE,FALSE,FALSE,$19,$20,$21,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         RETURNING *`,
        [input.title, slug, input.location, input.administrative_location, input.category, input.listing_type,
          input.price, input.currency, input.rental_frequency, input.bedrooms, input.bathrooms, input.area_sqft, input.area_value,
          input.area_unit, input.description, input.features, input.status, req.userId, input.contact_name,
          input.contact_phone, input.contact_email],
      );
      for (const amenityId of input.amenities) {
        await client.query('INSERT INTO user_property_amenities (property_id, amenity_id) VALUES ($1, $2)', [inserted.rows[0].id, amenityId]);
      }
      await writeAudit(client, user, 'property_created', 'property', inserted.rows[0].id,
        { publication_status: initialPublicationStatus });
      return inserted.rows[0];
    });
    const relationships = await managedPropertyRelationships(pool, req, created.id);
    res.status(201).json({ ...serializeManagedProperty(created), ...relationships, amenities: input.amenities });
  }));

  router.post('/management/properties/bulk-delete/', asyncRoute(async (req, res) => {
    const user = await access(pool, req.userId);
    const canDeleteAll = user.permissions.includes('properties.delete_all')
      || user.permissions.includes('properties.edit_all');
    const canDeleteOwn = user.role === 'agent' && user.agent_approved
      && user.permissions.includes('properties.manage_assigned');
    if (!canDeleteAll && !canDeleteOwn) throw new ApiError(403, 'You are not allowed to delete properties.');
    const { ids } = parse(idsSchema, req.body);
    const removed = await deleteManagedProperties(ids, user, canDeleteAll ? null : user.id);
    res.json({ deleted_count: removed });
  }));

  router.route('/management/properties/:id/').all(asyncRoute(async (req, res, next) => {
    const user = await access(pool, req.userId);
    const id = parse(positiveId, req.params.id);
    const row = await lookupManagedProperty(pool, user, id, req.method === 'PATCH' || req.method === 'DELETE');
    if (req.method === 'GET') {
      const [amenities, relationships] = await Promise.all([
        getPropertyAmenities(pool, id), managedPropertyRelationships(pool, req, id),
      ]);
      res.json({ ...serializeManagedProperty(row), ...relationships, amenities });
      return;
    }
    if (req.method === 'PATCH') {
      if (!user.permissions.includes('properties.edit_all')
        && !(user.role === 'agent' && user.permissions.includes('properties.manage_assigned') && Number(row.submitted_by_id) === Number(user.id))) {
        throw new ApiError(403, 'You are not allowed to edit this property.');
      }
      const input = parse(managedPropertyPatchSchema, req.body);
      const allowed = new Set(['title', 'location', 'administrative_location', 'category', 'listing_type', 'price', 'currency',
        'bedrooms', 'bathrooms', 'area_sqft', 'area_value', 'area_unit', 'rental_frequency', 'description',
        'features', 'status', 'amenities', 'contact_name', 'contact_phone', 'contact_email']);
      const fields = Object.keys(input).filter((field) => allowed.has(field));
      if (!fields.length) throw new ApiError(400, 'At least one field is required.');
      const updatedListingType = input.listing_type ?? row.listing_type;
      const updatedStatus = input.status ?? row.status;
      const updatedRentalFrequency = input.rental_frequency ?? row.rental_frequency;
      const updatedAreaValue = input.area_value === undefined ? row.area_value : input.area_value;
      const updatedAreaUnit = input.area_unit ?? row.area_unit;
      if ((updatedStatus === 'rented' && updatedListingType !== 'rent')
        || (updatedStatus === 'sold' && updatedListingType !== 'sale')) {
        throw new ApiError(400, 'The listing status does not match the listing type.');
      }
      if (updatedListingType !== 'rent' && updatedRentalFrequency) {
        throw new ApiError(400, 'Rental frequency is only valid for rental listings.');
      }
      if ((updatedAreaValue === null) !== (updatedAreaUnit === '')) {
        throw new ApiError(400, 'Provide a supported measurement unit together with the property size.');
      }
      if (input.amenities) {
        const amenities = await pool.query('SELECT id FROM properties_amenity WHERE id = ANY($1::bigint[])', [input.amenities]);
        if (amenities.rowCount !== input.amenities.length) throw new ApiError(400, 'One or more amenities are unavailable.');
      }
      const columns = { ...Object.fromEntries(fields.map((field) => [field, field === 'category' ? 'property_type' : field])),
        ...(input.administrative_location !== undefined ? { administrative_location: 'administrative_location_id' } : {}) };
      const sqlFields = fields.filter((field) => field !== 'amenities');
      const update = await withTransaction(pool, async (client) => {
        const current = await lookupManagedProperty(client, user, id, true);
        const currentListingType = input.listing_type ?? current.listing_type;
        const currentStatus = input.status ?? current.status;
        const currentAreaValue = input.area_value === undefined ? current.area_value : input.area_value;
        const currentAreaUnit = input.area_unit ?? current.area_unit;
        if ((currentStatus === 'rented' && currentListingType !== 'rent')
          || (currentStatus === 'sold' && currentListingType !== 'sale')) {
          throw new ApiError(400, 'The listing status does not match the listing type.');
        }
        if ((currentAreaValue === null) !== (currentAreaUnit === '')) {
          throw new ApiError(400, 'Provide a supported measurement unit together with the property size.');
        }
        if (sqlFields.length) {
          const values = sqlFields.map((field) => input[field]);
          values.push(id);
          await client.query(
            `UPDATE user_property SET ${sqlFields.map((field, i) => `${columns[field]} = $${i + 1}`).join(', ')},
             updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length}`, values,
          );
        }
        if (input.amenities) {
          await client.query('DELETE FROM user_property_amenities WHERE property_id = $1', [id]);
          for (const amenityId of input.amenities) {
            await client.query('INSERT INTO user_property_amenities (property_id, amenity_id) VALUES ($1, $2)', [id, amenityId]);
          }
        }
        await writeAudit(client, user, 'property_updated', 'property', id, { fields });
        return client.query('SELECT * FROM user_property WHERE id = $1', [id]);
      });
      const relationships = await managedPropertyRelationships(pool, req, id);
      res.json({ ...serializeManagedProperty(update.rows[0]), ...relationships,
        amenities: input.amenities ?? await getPropertyAmenities(pool, id) });
      return;
    }
    if (req.method === 'DELETE') {
      const canDeleteAll = user.permissions.includes('properties.delete_all')
        || user.permissions.includes('properties.edit_all');
      const canDeleteOwn = user.role === 'agent' && user.agent_approved
        && user.permissions.includes('properties.manage_assigned')
        && Number(row.submitted_by_id) === Number(user.id);
      if (!canDeleteAll && !canDeleteOwn) throw new ApiError(403, 'You are not allowed to delete this property.');
      await deleteManagedProperties([id], user, canDeleteAll ? null : user.id);
      res.status(204).end();
      return;
    }
    next();
  }));

  router.post('/management/properties/:id/publication/', asyncRoute(async (req, res) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'properties.moderate');
    const id = parse(positiveId, req.params.id);
    const { publication_status } = parse(publicationSchema, req.body);
    const updated = await withTransaction(pool, async (client) => {
      const current = await lookupManagedProperty(client, user, id, true);
      if (publication_status === 'published' && !['available', 'active'].includes(current.status)) {
        throw new ApiError(400, 'Only available properties can be published.');
      }
      const result = await client.query(
        `UPDATE user_property SET publication_status = $1, moderation_note = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [publication_status, publication_status === 'published' ? '' : current.moderation_note, id],
      );
      if (current.publication_status !== publication_status) {
        await writeAudit(client, user, 'property_publication_changed', 'property', id,
          { publication_status: { from: current.publication_status, to: publication_status } });
      }
      return result.rows[0];
    });
    const [amenities, relationships] = await Promise.all([
      getPropertyAmenities(pool, id), managedPropertyRelationships(pool, req, id),
    ]);
    res.json({ ...serializeManagedProperty(updated), ...relationships, amenities });
  }));

  router.get('/admin/properties/', asyncRoute(async (req, res) => {
    const user = await access(pool, req.userId);
    requireAnyPermission(user, ['properties.view_all', 'properties.moderate']);
    const filters = queryFilters(req, {
      table: 'user_property p',
      searchClause: (p) => `(p.title ILIKE ${p} OR p.location ILIKE ${p}
        OR EXISTS (SELECT 1 FROM auth_user owner WHERE owner.id = p.owner_id AND owner.username ILIKE ${p})
        OR EXISTS (SELECT 1 FROM auth_user submitter WHERE submitter.id = p.submitted_by_id AND submitter.username ILIKE ${p}))`,
      statusColumn: 'p.status',
      publicationStatusColumn: 'p.publication_status',
      listingTypeColumn: 'p.listing_type',
      propertyTypeColumn: 'p.property_type',
    });
    const page = filters.page;
    const base = "p.service_type = 'agent_managed'";
    const whereSql = filters.whereSql ? `WHERE ${base} AND ${filters.whereSql.slice(6)}` : `WHERE ${base}`;
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM user_property p ${whereSql}`, filters.params);
    const orderBy = ({
      created_at: 'p.created_at ASC, p.id ASC',
      '-created_at': 'p.created_at DESC, p.id DESC',
      updated_at: 'p.updated_at ASC, p.id ASC',
      '-updated_at': 'p.updated_at DESC, p.id DESC',
      price: 'p.price ASC, p.id ASC',
      '-price': 'p.price DESC, p.id DESC',
    })[page.ordering] || 'p.created_at DESC, p.id DESC';
    const rows = await pool.query(
      `SELECT p.id, p.title, p.slug, p.location, p.property_type, p.listing_type, p.price::text AS price, p.currency,
              p.status, p.publication_status, p.is_featured, p.owner_id, p.submitted_by_id,
              p.created_at, p.updated_at
       FROM user_property p ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${filters.params.length + 1} OFFSET $${filters.params.length + 2}`,
      [...filters.params, page.page_size, (page.page - 1) * page.page_size],
    );
    res.json(pageResult(req, rows.rows.map((row) => ({ ...row, id: Number(row.id),
      owner_id: row.owner_id === null ? null : Number(row.owner_id),
      submitted_by_id: row.submitted_by_id === null ? null : Number(row.submitted_by_id) })),
    Number(count.rows[0].count), page));
  }));

  router.route('/admin/properties/:id/').all(asyncRoute(async (req, res, next) => {
    const user = await access(pool, req.userId);
    if (req.method === 'PATCH') requirePermission(user, 'properties.moderate');
    else requireAnyPermission(user, ['properties.view_all', 'properties.moderate']);
    const id = parse(positiveId, req.params.id);
    const result = await pool.query(
      `SELECT id, title, slug, location, property_type, listing_type, price::text AS price, currency, status,
              publication_status, is_featured, owner_id, submitted_by_id, moderation_note, created_at, updated_at
       FROM user_property WHERE id = $1 AND service_type = 'agent_managed'`, [id],
    );
    if (!result.rowCount) throw new ApiError(404, 'Property not found.');
    if (req.method === 'GET') {
      const { moderation_note: _moderationNote, ...row } = result.rows[0];
      res.json({ ...row, id: Number(row.id), owner_id: row.owner_id === null ? null : Number(row.owner_id),
        submitted_by_id: row.submitted_by_id === null ? null : Number(row.submitted_by_id) });
      return;
    }
    if (req.method === 'PATCH') {
      const input = parse(adminPropertyPatchSchema, req.body);
      const status = input.status ?? result.rows[0].status;
      const listingType = result.rows[0].listing_type;
      if (input.publication_status === 'published' && !['available', 'active'].includes(status)) {
        throw new ApiError(400, 'Only available properties can be published.');
      }
      if ((status === 'rented' && listingType !== 'rent') || (status === 'sold' && listingType !== 'sale')) {
        throw new ApiError(400, 'The listing status does not match the listing type.');
      }
      if (['rejected', 'suspended'].includes(input.publication_status) && !input.moderation_note?.trim()) {
        throw new ApiError(400, 'A reason is required when rejecting or suspending a listing.', { moderation_note: ['A reason is required when rejecting or suspending a listing.'] });
      }
      const fields = Object.keys(input);
      const updated = await withTransaction(pool, async (client) => {
        const nextPublication = input.publication_status ?? result.rows[0].publication_status;
        const moderationNote = input.moderation_note ?? (
          ['rejected', 'suspended'].includes(nextPublication) ? result.rows[0].moderation_note : ''
        );
        const fieldsToWrite = { ...input, moderation_note: moderationNote };
        const writeFields = Object.keys(fieldsToWrite);
        const writeValues = writeFields.map((field) => fieldsToWrite[field]);
        writeValues.push(id);
        const row = await client.query(
          `UPDATE user_property SET ${writeFields.map((field, i) => `${field} = $${i + 1}`).join(', ')},
             updated_at = CURRENT_TIMESTAMP WHERE id = $${writeValues.length} RETURNING
             id, title, slug, location, property_type, listing_type, price::text AS price, currency, status,
             publication_status, is_featured, owner_id, submitted_by_id, created_at, updated_at`,
          writeValues,
        );
        const changes = {};
        for (const field of ['publication_status', 'status', 'is_featured']) {
          const next = fieldsToWrite[field] ?? result.rows[0][field];
          if (next !== result.rows[0][field]) changes[field] = { from: result.rows[0][field], to: next };
        }
        if (moderationNote) changes.moderation_note = moderationNote;
        if (Object.keys(changes).length) {
          await writeAudit(client, user, 'property_moderated', 'property', id, changes);
        }
        return row.rows[0];
      });
      res.json({ ...updated, id: Number(updated.id), owner_id: updated.owner_id === null ? null : Number(updated.owner_id),
        submitted_by_id: updated.submitted_by_id === null ? null : Number(updated.submitted_by_id) });
      return;
    }
    next();
  }));

  router.route('/admin/properties/:id/agents/').all(asyncRoute(async (req, res, next) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'agents.assign');
    const propertyId = parse(positiveId, req.params.id);
    const property = await pool.query("SELECT id FROM user_property WHERE id = $1 AND service_type = 'agent_managed'", [propertyId]);
    if (!property.rowCount) throw new ApiError(404, 'Property not found.');
    if (req.method === 'GET') {
      const page = parse(workflowPaginationSchema, req.query);
      const count = await pool.query(
        'SELECT COUNT(*)::int AS count FROM properties_propertyagentassignment WHERE property_id = $1',
        [propertyId],
      );
      const result = await pool.query(
        `SELECT a.id, a.agent_id, u.username AS agent_username, granted.username AS granted_by_username, a.granted_at
         FROM properties_propertyagentassignment a JOIN auth_user u ON u.id = a.agent_id
         LEFT JOIN auth_user granted ON granted.id = a.granted_by_id
         WHERE a.property_id = $1 ORDER BY a.granted_at, a.id
         LIMIT $2 OFFSET $3`, [propertyId, page.page_size, (page.page - 1) * page.page_size],
      );
      res.json(pageResult(req, result.rows.map((row) => ({ ...row, id: Number(row.id), agent_id: Number(row.agent_id) })),
        Number(count.rows[0].count), page));
      return;
    }
    if (req.method === 'POST') {
      const { agent_id } = parse(assignmentSchema, req.body);
      const result = await withTransaction(pool, async (client) => {
        const agent = await client.query(
          `SELECT u.username FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id
           WHERE u.id = $1 AND u.is_active = TRUE AND p.role = 'agent' AND p.agent_approved = TRUE`,
          [agent_id],
        );
        if (!agent.rowCount) throw new ApiError(400, 'Choose an active approved agent.');
        const inserted = await client.query(
          `INSERT INTO properties_propertyagentassignment (property_id, agent_id, granted_by_id, granted_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT (property_id, agent_id) DO NOTHING
           RETURNING id, agent_id, granted_at`, [propertyId, agent_id, user.id],
        );
        if (inserted.rowCount) await writeAudit(client, user, 'property_agent_assigned', 'property', propertyId, { agent_id });
        const assignment = inserted.rowCount ? inserted.rows[0] : (await client.query(
          'SELECT id, agent_id, granted_at FROM properties_propertyagentassignment WHERE property_id = $1 AND agent_id = $2',
          [propertyId, agent_id],
        )).rows[0];
        return { ...assignment, agent_username: agent.rows[0].username, granted_by_username: user.username };
      });
      res.status(201).json({ ...result, id: Number(result.id), agent_id: Number(result.agent_id) });
      return;
    }
    next();
  }));

  router.delete('/admin/properties/:id/agents/:agentId/', asyncRoute(async (req, res) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'agents.assign');
    const propertyId = parse(positiveId, req.params.id);
    const agentId = parse(positiveId, req.params.agentId);
    await withTransaction(pool, async (client) => {
      const property = await client.query(
        "SELECT id FROM user_property WHERE id = $1 AND service_type = 'agent_managed'", [propertyId],
      );
      if (!property.rowCount) throw new ApiError(404, 'Property not found.');
      const deleted = await client.query(
        'DELETE FROM properties_propertyagentassignment WHERE property_id = $1 AND agent_id = $2 RETURNING id',
        [propertyId, agentId],
      );
      if (!deleted.rowCount) throw new ApiError(404, 'Agent assignment not found.');
      await writeAudit(client, user, 'property_agent_unassigned', 'property', propertyId, { agent_id: agentId });
    });
    res.status(204).end();
  }));

  router.get('/admin/reports/', asyncRoute(async (req, res) => {
    await requireWorkflowAccess(pool, req.userId, 'reports.review');
    res.json(await pagedList(pool, req, {
      table: 'properties_listingreport',
      columns: 'id, property_id AS property, property_title, reporter_name, reporter_email, reason, details, status, moderator_notes, reviewed_by_id AS reviewed_by, reviewed_at, created_at',
      searchClause: (p) => `(property_title ILIKE ${p} OR reporter_name ILIKE ${p} OR reporter_email ILIKE ${p} OR details ILIKE ${p})`,
      statusColumn: 'status',
      defaultOrder: 'created_at DESC, id DESC',
      ordering: { '-created_at': 'created_at DESC, id DESC', created_at: 'created_at ASC, id ASC' },
      serialize: (row) => ({ ...row, id: Number(row.id),
        property: row.property === null ? null : Number(row.property),
        reviewed_by: row.reviewed_by === null ? null : Number(row.reviewed_by) }),
    }));
  }));

  router.route('/admin/reports/:id/').all(asyncRoute(async (req, res, next) => {
    const user = await requireWorkflowAccess(pool, req.userId, 'reports.review');
    const id = parse(positiveId, req.params.id);
    const columns = `id, property_id AS property, property_title, reporter_name, reporter_email,
      reason, details, status, moderator_notes, reviewed_by_id AS reviewed_by, reviewed_at, created_at`;
    const current = await pool.query(`SELECT ${columns} FROM properties_listingreport WHERE id = $1`, [id]);
    if (!current.rowCount) throw new ApiError(404, 'Listing report not found.');
    if (req.method === 'GET') {
      const row = current.rows[0];
      res.json({ ...row, id: Number(row.id), property: row.property === null ? null : Number(row.property),
        reviewed_by: row.reviewed_by === null ? null : Number(row.reviewed_by) });
      return;
    }
    if (req.method === 'PATCH') {
      const input = parse(reportPatchSchema, req.body);
      const updated = await withTransaction(pool, async (client) => {
        const fields = Object.keys(input);
        const values = fields.map((field) => input[field]);
        const isPending = (input.status ?? current.rows[0].status) === 'pending';
        const assignments = fields.map((field, i) => `${field} = $${i + 1}`);
        if (isPending) assignments.push('reviewed_by_id = NULL', 'reviewed_at = NULL');
        else {
          values.push(user.id);
          assignments.push(`reviewed_by_id = $${values.length}`);
          assignments.push('reviewed_at = CURRENT_TIMESTAMP');
        }
        values.push(id);
        const result = await client.query(
          `UPDATE properties_listingreport SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING ${columns}`,
          values,
        );
        await writeAudit(client, user, 'listing_report_updated', 'listing_report', id, { fields });
        return result.rows[0];
      });
      res.json({ ...updated, id: Number(updated.id), property: updated.property === null ? null : Number(updated.property),
        reviewed_by: updated.reviewed_by === null ? null : Number(updated.reviewed_by) });
      return;
    }
    next();
  }));

  router.get('/admin/audit-events/', asyncRoute(async (req, res) => {
    await requireWorkflowAccess(pool, req.userId, 'audit.view');
    const filter = queryFilters(req, {
      table: 'portal_admin_adminauditevent',
      searchClause: (p) => `(actor_username ILIKE ${p} OR action ILIKE ${p} OR object_type ILIKE ${p} OR object_id ILIKE ${p})`,
    });
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM portal_admin_adminauditevent ${filter.whereSql}`, filter.params);
    const rows = await pool.query(
      `SELECT id, actor_username, action, object_type, object_id, changes, created_at
       FROM portal_admin_adminauditevent ${filter.whereSql}
       ORDER BY created_at DESC, id DESC LIMIT $${filter.params.length + 1} OFFSET $${filter.params.length + 2}`,
      [...filter.params, filter.page.page_size, (filter.page.page - 1) * filter.page.page_size],
    );
    res.json(pageResult(req, rows.rows.map((row) => ({ ...row, id: Number(row.id) })),
      Number(count.rows[0].count), filter.page));
  }));

  return router;
}
