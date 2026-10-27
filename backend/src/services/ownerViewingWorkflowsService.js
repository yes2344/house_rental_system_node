import { createHash } from 'node:crypto';
import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { requestOrigin } from '../requestOrigin.js';

const activeRequestStatuses = ['pending', 'proposed', 'confirmed', 'declined'];
const terminalRequestStatuses = ['rejected', 'cancelled', 'completed'];
const submissionFields = {
  title: 'p.title',
  location: 'p.location',
  category: 'p.property_type',
  listing_type: 'p.listing_type',
  price: 'p.price',
  currency: 'p.currency',
  bedrooms: 'p.bedrooms',
  bathrooms: 'p.bathrooms',
  area_sqft: 'p.area_sqft',
  area_value: 'p.area_value',
  area_unit: 'p.area_unit',
  rental_frequency: 'p.rental_frequency',
  description: 'p.description',
  features: 'p.features',
  administrative_location: 'p.administrative_location_id',
  owner_contact_name: 'a.owner_contact_name',
  owner_contact_phone: 'a.owner_contact_phone',
  owner_contact_email: 'a.owner_contact_email',
};

const notFound = (message = 'Not found.') => new ApiError(404, message);
const conflict = (message) => new ApiError(409, message);
const forbidden = (message) => new ApiError(403, message);
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
function agreementEndDate(startDate, durationMonths) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const monthIndex = start.getUTCMonth() + durationMonths;
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

async function account(client, userId, lock = false) {
  const result = await client.query(
    `SELECT u.id, u.username, u.first_name, u.last_name, u.email,
            u.is_active, u.is_staff, u.is_superuser, p.role, p.phone,
            p.agent_approved, p.management_permissions, p.assigned_city_id
     FROM auth_user AS u
     LEFT JOIN accounts_profile AS p ON p.user_id = u.id
     WHERE u.id = $1${lock ? ' FOR UPDATE OF u' : ''}`,
    [userId],
  );
  const row = result.rows[0];
  if (!row?.is_active) throw forbidden('An active account is required.');
  return row;
}

function isAdministrator(row) {
  return Boolean(row.is_superuser || (row.is_staff && row.role === 'administrator'));
}
function permissions(row) {
  return Array.isArray(row.management_permissions)
    ? row.management_permissions
    : [];
}
function canSubmit(row) {
  return ['customer', 'owner'].includes(row.role);
}
function canViewRequests(row) {
  return row.role !== 'agent' && !isAdministrator(row);
}
function canManageSubmissions(row, kind) {
  if (kind === 'assign') return Boolean(row.is_superuser || permissions(row).includes('announcements.assign'));
  if (kind === 'delete') return Boolean(row.is_superuser
    || (isAdministrator(row) && permissions(row).includes('announcements.review')));
  return Boolean(row.is_superuser
    || permissions(row).includes('announcements.review')
    || (row.role === 'agent' && row.agent_approved
      && permissions(row).includes('announcements.review_assigned')));
}

function pageResult(request, rows, total, filters) {
  const { page, page_size } = filters;
  const base = requestOrigin(request);
  const url = new URL(request.originalUrl, base);
  const pageUrl = (nextPage) => {
    const next = new URL(url);
    next.searchParams.set('page', String(nextPage));
    next.searchParams.set('page_size', String(page_size));
    return next.toString();
  };
  return {
    count: Number(total),
    next: page * page_size < total ? pageUrl(page + 1) : null,
    previous: page > 1 ? pageUrl(page - 1) : null,
    results: rows,
  };
}

function absoluteImageUrl(request, filename) {
  if (!filename) return null;
  const path = filename.startsWith('/media/')
    ? filename
    : `/media/${filename.split('/').map(encodeURIComponent).join('/')}`;
  return request ? new URL(path, requestOrigin(request)).toString() : path;
}

function propertySubmission(row, request) {
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    location: row.location,
    administrative_location: row.administrative_location_id == null ? null : Number(row.administrative_location_id),
    location_path: row.location_path || [],
    category: row.category,
    listing_type: row.listing_type,
    price: row.price === null ? null : String(row.price),
    currency: row.currency || 'ETB',
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    area_sqft: row.area_sqft,
    area_value: row.area_value,
    area_unit: row.area_unit,
    rental_frequency: row.rental_frequency,
    description: row.description,
    features: row.features,
    status: row.property_status,
    publication_status: row.publication_status,
    is_featured: row.is_featured,
    submitted_by_id: row.submitted_by_id == null ? null : Number(row.submitted_by_id),
    moderation_note: row.moderation_note,
    amenities: row.amenities || [],
    images: (row.images || []).map((image) => ({ ...image, url: absoluteImageUrl(request, image.url) })),
    owner_contact_name: row.owner_contact_name,
    owner_contact_phone: row.owner_contact_phone,
    owner_contact_email: row.owner_contact_email,
    contact_name: row.owner_contact_name,
    contact_phone: row.owner_contact_phone,
    contact_email: row.owner_contact_email,
    submission_status: row.submission_status,
    review_feedback: row.agent_feedback,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    submission_events: row.submission_events || [],
  };
}

const ownerSubmissionSelect = `
  SELECT p.id, a.id AS announcement_id, p.title, p.slug, p.location, p.administrative_location_id,
         p.property_type AS category, p.listing_type, p.price::text AS price, p.currency, p.bedrooms,
         p.bathrooms, p.area_sqft, p.area_value::text AS area_value, p.area_unit,
         p.rental_frequency, p.description, p.features, p.status AS property_status,
         p.publication_status, p.is_featured, p.submitted_by_id, p.moderation_note,
         COALESCE(location_path.path, '[]'::jsonb) AS location_path,
         COALESCE(amenity_data.amenities, '[]'::jsonb) AS amenities,
         COALESCE(image_data.images, '[]'::jsonb) AS images,
         a.owner_contact_name, a.owner_contact_phone,
         a.owner_contact_email, a.status AS submission_status, a.agent_feedback,
         a.submitted_at, a.created_at, a.updated_at, a.reviewed_at, a.reviewed_by_id,
         a.assigned_reviewer_id, a.submitter_id,
         COALESCE(events.items, '[]'::json) AS submission_events
  FROM user_property AS p
  JOIN owner_announcements_ownerannouncement AS a ON a.property_id = p.id
  LEFT JOIN LATERAL (
    WITH RECURSIVE branch AS (
      SELECT location.id, location.parent_id, location.name, location.name_am,
             location.location_type, ARRAY[location.id] AS visited, 0 AS depth
      FROM properties_location AS location
      WHERE location.id = p.administrative_location_id
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.name, parent.name_am,
             parent.location_type, branch.visited || parent.id, branch.depth + 1
      FROM properties_location AS parent
      JOIN branch ON parent.id = branch.parent_id
      WHERE NOT parent.id = ANY(branch.visited)
    )
    SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'name_am', name_am,
      'location_type', location_type) ORDER BY depth DESC) AS path
    FROM branch
  ) AS location_path ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(amenity_id ORDER BY amenity_id) AS amenities
    FROM user_property_amenities WHERE property_id = p.id
  ) AS amenity_data ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', image.id, 'url', NULLIF(image.image, ''),
      'caption', image.caption, 'is_primary', image.is_primary) ORDER BY image.id) AS images
    FROM user_propertyimage AS image WHERE image.property_id = p.id
  ) AS image_data ON TRUE
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'event_type', e.event_type, 'from_status', e.from_status,
      'to_status', e.to_status, 'details', e.details, 'actor_name', actor.username,
      'created_at', e.created_at
    ) ORDER BY e.created_at DESC, e.id DESC) AS items
    FROM owner_announcements_ownerannouncementevent AS e
    LEFT JOIN auth_user AS actor ON actor.id = e.actor_id
    WHERE e.announcement_id = a.id
  ) AS events ON TRUE`;

async function addAnnouncementEvent(client, {
  announcementId, actorId, type, fromStatus = '', toStatus = '', details = {},
}) {
  return client.query(
    `INSERT INTO owner_announcements_ownerannouncementevent
       (announcement_id, actor_id, event_type, from_status, to_status, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     RETURNING id`,
    [announcementId, actorId, type, fromStatus, toStatus, JSON.stringify(details)],
  );
}

async function notifyAnnouncement(client, announcementId, recipientId, type, message, key) {
  await client.query(
    `INSERT INTO owner_announcements_inappnotification
       (recipient_id, announcement_id, notification_type, message, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [recipientId, announcementId, type, message.slice(0, 500), key],
  );
}

async function validatePropertyInput(client, input, existing = null) {
  const listingType = input.listing_type ?? existing?.listing_type ?? 'sale';
  const rentalFrequency = input.rental_frequency ?? existing?.rental_frequency ?? '';
  if (listingType === 'rent') {
    if (rentalFrequency === 'weekly' && (!existing || existing.rental_frequency !== 'weekly')) {
      throw new ApiError(400, 'New rental listings must use daily, monthly, or yearly pricing.');
    }
  } else if (rentalFrequency) {
    throw new ApiError(400, 'Rental frequency can only be set for rental listings.');
  }
  const areaValue = Object.hasOwn(input, 'area_value')
    ? input.area_value
    : Object.hasOwn(input, 'area_sqft') ? input.area_sqft || null : existing?.area_value ?? null;
  const areaUnit = Object.hasOwn(input, 'area_unit')
    ? input.area_unit
    : Object.hasOwn(input, 'area_sqft') ? (input.area_sqft ? 'sqft' : '') : existing?.area_unit ?? '';
  if ((areaValue == null) !== !areaUnit) {
    throw new ApiError(400, 'Provide a supported measurement unit together with the property size.');
  }
  const locationId = input.administrative_location;
  const locationSubmitted = Object.hasOwn(input, 'administrative_location');
  if (locationId != null && (locationSubmitted || !existing)) {
    const path = await client.query(
      `WITH RECURSIVE location_path AS (
         SELECT id, parent_id, location_type, is_active, ARRAY[id] AS visited
         FROM properties_location WHERE id = $1
         UNION ALL
         SELECT parent.id, parent.parent_id, parent.location_type, parent.is_active,
                location_path.visited || parent.id
         FROM properties_location parent JOIN location_path ON parent.id = location_path.parent_id
         WHERE NOT parent.id = ANY(location_path.visited)
       )
       SELECT id, location_type, is_active FROM location_path`,
      [locationId],
    );
    if (!path.rowCount) throw new ApiError(400, 'Choose an active location for this listing.');
    if (path.rows.some((entry) => !entry.is_active)) {
      throw new ApiError(400, 'Every level in the selected location path must be active.');
    }
    const types = path.rows.map((entry) => entry.location_type);
    if (!types.some((type) => ['city', 'city_administration'].includes(type))) {
      throw new ApiError(400, 'Select a city or town in the location hierarchy.');
    }
    if (types.includes('city_administration') && !types.includes('subcity')) {
      throw new ApiError(400, 'Select a configured sub-city / Kifle Ketema for this city administration.');
    }
  }
}

async function addAdminAudit(client, user, action, objectId, changes) {
  await client.query(
    `INSERT INTO portal_admin_adminauditevent
     (actor_id, actor_username, action, object_type, object_id, changes, created_at)
     VALUES ($1, $2, $3, 'owner_announcement', $4, $5::jsonb, NOW())`,
    [user.id, user.username, action, String(objectId), JSON.stringify(changes)],
  );
}

async function notifyViewing(client, viewing, eventId, toRequester) {
  const recipients = toRequester
    ? `SELECT requester_id AS id FROM user_viewingrequest
       WHERE id = $1 AND property_id = $2 AND requester_id IS NOT NULL`
    : `SELECT DISTINCT u.id
       FROM auth_user AS u
       JOIN accounts_profile AS profile ON profile.user_id = u.id
       WHERE u.is_active = TRUE AND profile.role = 'agent' AND profile.agent_approved = TRUE
       UNION
       SELECT p.submitted_by_id
       FROM user_property AS p
       JOIN auth_user AS publisher ON publisher.id = p.submitted_by_id
       JOIN accounts_profile AS profile ON profile.user_id = publisher.id
       WHERE p.id = $2 AND p.submitted_by_id IS NOT NULL
         AND (publisher.is_superuser OR (
           publisher.is_staff AND profile.role = 'administrator'
           AND profile.management_permissions ?| ARRAY[
             'properties.view_all', 'properties.moderate', 'properties.edit_all', 'properties.manage_assigned'
           ]
         ))`;
  await client.query(
    `INSERT INTO owner_announcements_inappnotification
       (recipient_id, announcement_id, notification_type, message, idempotency_key, created_at)
     SELECT recipients.id, NULL, 'viewing_request_updated', $3,
            'viewing:' || $1::text || ':event:' || $4::text || ':recipient:' || recipients.id::text,
            NOW()
     FROM (${recipients}) AS recipients
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [viewing.id, viewing.property_id,
      `Viewing request for ${viewing.title}: ${viewing.event_type.replaceAll('_', ' ')}.`, eventId],
  );
}

async function getSubmission(client, submissionId, userId, ownerOnly, lock = false) {
  const result = await client.query(
    `${ownerSubmissionSelect}
     WHERE p.id = $1${ownerOnly ? ' AND a.submitter_id = $2' : ''}
     ${lock ? 'FOR UPDATE OF a, p' : ''}`,
    ownerOnly ? [submissionId, userId] : [submissionId],
  );
  return result.rows[0] || null;
}

export async function listOwnerSubmissions(pool, request, userId, filters) {
  const user = await account(pool, userId);
  if (!canSubmit(user)) throw forbidden('Only customers and property owners can access submissions.');
  const values = [userId];
  let where = 'a.submitter_id = $1';
  if (filters.status) {
    values.push(filters.status);
    where += ` AND a.status = $${values.length}`;
  }
  const order = filters.ordering === 'created_at' ? 'p.created_at ASC, p.id ASC'
    : filters.ordering === '-updated_at' ? 'p.updated_at DESC, p.id DESC'
      : filters.ordering === 'updated_at' ? 'p.updated_at ASC, p.id ASC'
        : 'p.created_at DESC, p.id DESC';
  const count = await pool.query(
    `SELECT COUNT(*)::int AS count FROM user_property p
     JOIN owner_announcements_ownerannouncement a ON a.property_id = p.id WHERE ${where}`,
    values,
  );
  const pageValues = [...values, filters.page_size, (filters.page - 1) * filters.page_size];
  const rows = await pool.query(
    `${ownerSubmissionSelect} WHERE ${where} ORDER BY ${order}
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return pageResult(request, rows.rows.map((row) => propertySubmission(row, request)), count.rows[0].count, filters);
}

export async function createOwnerSubmission(pool, userId, input, request) {
  return withTransaction(pool, async (client) => {
    const user = await account(client, userId, true);
    if (!canSubmit(user)) throw forbidden('Only customers and property owners can submit a property.');
    await validatePropertyInput(client, input);
    const amenityIds = input.amenities || [];
    if (amenityIds.length) {
      const amenities = await client.query(
        'SELECT id FROM properties_amenity WHERE id = ANY($1::bigint[])',
        [amenityIds],
      );
      if (amenities.rowCount !== amenityIds.length) throw new ApiError(400, 'Choose valid property amenities.');
    }
    const hasAreaValue = Object.hasOwn(input, 'area_value');
    const areaValue = hasAreaValue ? input.area_value : input.area_sqft ? input.area_sqft : null;
    const areaUnit = input.area_unit ?? (!hasAreaValue && input.area_sqft ? 'sqft' : '');
    const areaSqft = hasAreaValue ? input.area_sqft ?? 0 : 0;
    const slug = `${input.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'property'}-${Date.now().toString(36)}`;
    const property = await client.query(
      `INSERT INTO user_property
       (title, slug, location, administrative_location_id, property_type, listing_type,
        price, currency, bedrooms, bathrooms, area_sqft, area_value, area_unit, rental_frequency,
        description, features, status, publication_status, is_featured, service_type,
        submitted_by_id, owner_id, advertising_authorized, contact_publicly_visible,
         contact_name, contact_phone, contact_email, exact_location_is_public,
         moderation_note, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         'available', 'pending_review', FALSE, 'owner_announced', $17, $17, TRUE, FALSE,
         '', '', '', FALSE, '', NOW(), NOW())
       RETURNING id`,
      [input.title, slug, input.location, input.administrative_location ?? null,
        input.category, input.listing_type, input.price, input.currency ?? 'ETB', input.bedrooms ?? 0,
        input.bathrooms ?? 0, areaSqft, areaValue, areaUnit,
        input.rental_frequency ?? '', input.description ?? '', input.features ?? '', userId],
    );
    const propertyId = property.rows[0].id;
    for (const amenityId of amenityIds) {
      await client.query(
        'INSERT INTO user_property_amenities (property_id, amenity_id) VALUES ($1, $2)',
        [propertyId, amenityId],
      );
    }
    const announcement = await client.query(
      `INSERT INTO owner_announcements_ownerannouncement
       (property_id, submitter_id, owner_contact_name, owner_contact_phone,
        owner_contact_email, public_contact_name, public_contact_phone, public_contact_email,
        public_contact_visible, authorization_confirmed, terms_accepted_at, status,
        agent_feedback, submitted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '', '', '', FALSE, TRUE, NOW(),
        'pending_review', '', NOW(), NOW(), NOW()) RETURNING id`,
      [propertyId, userId, input.owner_contact_name, input.owner_contact_phone, input.owner_contact_email || ''],
    );
    const event = await addAnnouncementEvent(client, {
      announcementId: announcement.rows[0].id, actorId: userId, type: 'submitted',
      toStatus: 'pending_review',
    });
    await notifyAnnouncement(client, announcement.rows[0].id, userId, 'owner_submission_received',
      `Your property submission "${input.title}" is pending review.`,
      `owner-submission:${announcement.rows[0].id}:received`);
    return propertySubmission(await getSubmission(client, propertyId, userId, true), request);
  });
}

export async function getOwnerSubmission(pool, userId, submissionId, request) {
  const user = await account(pool, userId);
  if (!canSubmit(user)) throw forbidden('Only customers and property owners can access submissions.');
  const row = await getSubmission(pool, submissionId, userId, true);
  if (!row) throw notFound();
  return propertySubmission(row, request);
}

export async function patchOwnerSubmission(pool, userId, submissionId, input, request) {
  return withTransaction(pool, async (client) => {
    const user = await account(client, userId, true);
    if (!canSubmit(user)) throw forbidden('Only customers and property owners can edit submissions.');
    const row = await getSubmission(client, submissionId, userId, true, true);
    if (!row) throw notFound();
    if (row.submission_status !== 'corrections_requested') {
      throw conflict('Only submissions with requested corrections can be edited.');
    }
    const patch = { ...input };
    await validatePropertyInput(client, patch, row);
    if (Object.hasOwn(patch, 'area_sqft') && !Object.hasOwn(patch, 'area_value')) {
      patch.area_value = patch.area_sqft || null;
      patch.area_unit ??= patch.area_sqft ? 'sqft' : '';
      delete patch.area_sqft;
    }
    const amenityIds = patch.amenities;
    if (amenityIds) {
      const amenities = await client.query(
        'SELECT id FROM properties_amenity WHERE id = ANY($1::bigint[])',
        [amenityIds],
      );
      if (amenities.rowCount !== amenityIds.length) throw new ApiError(400, 'Choose valid property amenities.');
    }
    const propertyUpdates = Object.entries(patch)
      .filter(([field]) => Object.hasOwn(submissionFields, field) && !field.startsWith('owner_contact_'));
    const propertySets = propertyUpdates.map(([field], index) => `${submissionFields[field]} = $${index + 1}`);
    const ownerUpdates = ['owner_contact_name', 'owner_contact_phone', 'owner_contact_email']
      .filter((field) => Object.hasOwn(input, field));
    const ownerSets = ownerUpdates.map((field, index) => `${field} = $${propertyUpdates.length + index + 1}`);
    const values = [
      ...propertyUpdates.map(([field, value]) => field === 'administrative_location' ? value : value),
      ...ownerUpdates.map((field) => patch[field]),
      submissionId,
    ];
    const propertyAssignments = propertySets.length
      ? `${propertySets.map((set) => set.replace(/^p\./, '')).join(', ')}, `
      : '';
    const propertyValues = [
      ...propertyUpdates.map(([, value]) => value),
      submissionId,
    ];
    await client.query(
      `UPDATE user_property SET ${propertyAssignments}publication_status = 'pending_review',
       updated_at = NOW() WHERE id = $${propertyValues.length}`,
      propertyValues,
    );
    if (ownerSets.length || patch.authorization_confirmed === true || patch.terms_accepted === true) {
      const sets = [...ownerSets];
      if (patch.authorization_confirmed === true) sets.push('authorization_confirmed = TRUE');
      if (patch.terms_accepted === true) sets.push('terms_accepted_at = NOW()');
      sets.push("status = 'pending_review'", "agent_feedback = ''", 'reviewed_at = NULL', 'reviewed_by_id = NULL', 'updated_at = NOW()');
      await client.query(
        `UPDATE owner_announcements_ownerannouncement SET ${sets.join(', ')} WHERE property_id = $${values.length}`,
        values.slice(0, propertyUpdates.length + ownerUpdates.length).concat(submissionId),
      );
    } else {
      await client.query(
        `UPDATE owner_announcements_ownerannouncement SET status = 'pending_review',
         agent_feedback = '', reviewed_at = NULL, reviewed_by_id = NULL, updated_at = NOW()
         WHERE property_id = $1`,
        [submissionId],
      );
    }
    if (amenityIds) {
      await client.query('DELETE FROM user_property_amenities WHERE property_id = $1', [submissionId]);
      for (const amenityId of amenityIds) {
        await client.query(
          'INSERT INTO user_property_amenities (property_id, amenity_id) VALUES ($1, $2)',
          [submissionId, amenityId],
        );
      }
    }
    const event = await addAnnouncementEvent(client, {
      announcementId: row.announcement_id, actorId: userId, type: 'edited',
      fromStatus: row.submission_status, toStatus: 'pending_review',
    });
    const reviewers = await client.query(
      `SELECT u.id FROM auth_user u JOIN accounts_profile profile ON profile.user_id = u.id
       WHERE u.is_active = TRUE AND profile.role = 'agent' AND profile.agent_approved = TRUE
       AND profile.management_permissions @> '["announcements.review_assigned"]'::jsonb`,
    );
    for (const reviewer of reviewers.rows) {
      await notifyAnnouncement(client, row.announcement_id, reviewer.id, 'owner_submission_pending_review',
        `The property submission "${row.title}" was updated and is pending review.`,
        `owner-submission:${row.announcement_id}:event:${event.rows[0].id}:recipient:${reviewer.id}`);
    }
    return propertySubmission(await getSubmission(client, submissionId, userId, true), request);
  });
}

export async function deleteOwnerSubmissions(pool, userId, ids) {
  return withTransaction(pool, async (client) => {
    const user = await account(client, userId, true);
    if (!canSubmit(user)) throw forbidden('Only customers and property owners can delete submissions.');
    const rows = await client.query(
      `SELECT a.id, a.property_id, a.status, p.title,
       EXISTS (SELECT 1 FROM owner_announcements_ownerannouncementagreement agreement
               WHERE agreement.announcement_id = a.id) AS has_agreement
       FROM owner_announcements_ownerannouncement a
       JOIN user_property p ON p.id = a.property_id
       WHERE a.submitter_id = $1 AND a.property_id = ANY($2::bigint[])
       ORDER BY a.property_id FOR UPDATE OF a, p`,
      [userId, ids],
    );
    if (rows.rowCount !== ids.length) throw notFound('One or more submissions were not found.');
    const disallowed = rows.rows.find((row) => !['pending_review', 'corrections_requested', 'rejected'].includes(row.status)
      || row.has_agreement);
    if (disallowed) throw conflict('Only pending, correction-requested, or rejected submissions can be deleted.');
    for (const row of rows.rows) {
      await addAdminAudit(client, user, 'owner_submission_deleted', row.id, {
        property_title: row.title, submission_status: row.status,
      });
    }
    await client.query('DELETE FROM user_property WHERE id = ANY($1::bigint[])', [rows.rows.map((row) => row.property_id)]);
    return { deleted_count: rows.rowCount };
  });
}

function submissionScope(user) {
  if (isAdministrator(user)) return { clause: 'TRUE', values: [] };
  if (user.role === 'agent' && permissions(user).includes('announcements.review_assigned')) {
    return { clause: 'a.assigned_reviewer_id = $1', values: [user.id] };
  }
  throw forbidden('You are not allowed to review owner submissions.');
}

function reviewSubmission(row, request) {
  return {
    id: Number(row.announcement_id),
    property: {
      ...propertySubmission(row, request),
    },
    owner_contact_name: row.owner_contact_name,
    owner_contact_phone: row.owner_contact_phone,
    owner_contact_email: row.owner_contact_email,
    status: row.submission_status,
    agent_feedback: row.agent_feedback,
    submitted_at: row.submitted_at,
    reviewed_at: row.reviewed_at,
    reviewed_by_id: row.reviewed_by_id == null ? null : Number(row.reviewed_by_id),
    assigned_reviewer_id: row.assigned_reviewer_id == null ? null : Number(row.assigned_reviewer_id),
    assigned_reviewer_name: row.assigned_reviewer_id == null ? null
      : [row.assigned_first_name, row.assigned_last_name].filter(Boolean).join(' ') || row.assigned_username,
    events: row.submission_events || [],
    agreements: row.agreements || [],
  };
}

const reviewSelect = ownerSubmissionSelect.replace(
  'SELECT p.id,',
  'SELECT p.id, reviewer.username AS assigned_username, '
    + 'reviewer.first_name AS assigned_first_name, reviewer.last_name AS assigned_last_name, '
    + "COALESCE(agreements.items, '[]'::json) AS agreements,",
) + `
  LEFT JOIN auth_user reviewer ON reviewer.id = a.assigned_reviewer_id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', agreement.id, 'start_date', agreement.start_date,
      'end_date', agreement.end_date, 'duration_months', agreement.duration_months,
      'terms', agreement.terms, 'status', agreement.status, 'created_at', agreement.created_at)
      ORDER BY agreement.created_at DESC) AS items
    FROM owner_announcements_ownerannouncementagreement agreement
    WHERE agreement.announcement_id = a.id
  ) agreements ON TRUE`;

export async function listManagementSubmissions(pool, request, userId, filters) {
  const user = await account(pool, userId);
  if (!canManageSubmissions(user, 'review')) throw forbidden('You are not allowed to review owner submissions.');
  const scope = submissionScope(user);
  const values = [...scope.values];
  const conditions = [scope.clause];
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`a.status = $${values.length}`);
  }
  const where = conditions.join(' AND ');
  const order = filters.ordering === 'submitted_at' ? 'a.submitted_at ASC, a.id ASC'
    : filters.ordering === '-updated_at' ? 'a.updated_at DESC, a.id DESC'
      : filters.ordering === 'updated_at' ? 'a.updated_at ASC, a.id ASC'
        : 'a.submitted_at DESC, a.id DESC';
  const count = await pool.query(
    `SELECT COUNT(*)::int AS count FROM owner_announcements_ownerannouncement a WHERE ${where}`, values,
  );
  const pageValues = [...values, filters.page_size, (filters.page - 1) * filters.page_size];
  const rows = await pool.query(
    `${reviewSelect} WHERE ${where} ORDER BY ${order}
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return pageResult(request, rows.rows.map((row) => reviewSubmission(row, request)), count.rows[0].count, filters);
}

export async function getManagementSubmission(pool, userId, submissionId, request) {
  const user = await account(pool, userId);
  if (!canManageSubmissions(user, 'review')) throw forbidden('You are not allowed to review owner submissions.');
  const scope = submissionScope(user);
  const values = [...scope.values, submissionId];
  const row = await pool.query(`${reviewSelect} WHERE ${scope.clause === 'TRUE' ? '' : `${scope.clause} AND `}p.id = $${values.length}`, values);
  if (!row.rows[0]) throw notFound();
  return reviewSubmission(row.rows[0], request);
}

export async function listSubmissionReviewers(pool, userId) {
  const user = await account(pool, userId);
  if (!canManageSubmissions(user, 'assign')) throw forbidden('You are not allowed to assign owner submissions.');
  const rows = await pool.query(
    `SELECT u.id, u.username, u.first_name, u.last_name
     FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id
     WHERE u.is_active = TRUE AND p.role = 'agent' AND p.agent_approved = TRUE
     AND p.management_permissions @> '["announcements.review_assigned"]'::jsonb
     ORDER BY u.username`,
  );
  return rows.rows.map((row) => ({
    id: Number(row.id), username: row.username,
    display_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username,
  }));
}

export async function assignSubmission(pool, userId, submissionId, reviewerId, request) {
  return withTransaction(pool, async (client) => {
    const user = await account(client, userId, true);
    if (!canManageSubmissions(user, 'assign')) throw forbidden('You are not allowed to assign owner submissions.');
    const result = await client.query(
      `SELECT a.*, p.title FROM owner_announcements_ownerannouncement a
       JOIN user_property p ON p.id = a.property_id WHERE a.property_id = $1 FOR UPDATE OF a`,
      [submissionId],
    );
    const announcement = result.rows[0];
    if (!announcement) throw notFound();
    if (!['pending_review', 'corrections_requested'].includes(announcement.status)) {
      throw conflict('Only pending or correction-requested submissions can be assigned.');
    }
    if (Number(announcement.assigned_reviewer_id) === Number(reviewerId)
        || announcement.assigned_reviewer_id == null && reviewerId === null) {
      const details = await client.query(`${reviewSelect} WHERE p.id = $1`, [submissionId]);
      return reviewSubmission(details.rows[0], request);
    }
    if (reviewerId !== null) {
      const reviewer = await client.query(
        `SELECT u.id FROM auth_user u JOIN accounts_profile p ON p.user_id = u.id
         WHERE u.id = $1 AND u.is_active = TRUE AND p.role = 'agent'
         AND p.agent_approved = TRUE AND p.management_permissions @> '["announcements.review_assigned"]'::jsonb`,
        [reviewerId],
      );
      if (!reviewer.rowCount) throw new ApiError(400, 'Choose an active approved submission reviewer.');
    }
    await client.query(
      'UPDATE owner_announcements_ownerannouncement SET assigned_reviewer_id = $1, updated_at = NOW() WHERE id = $2',
      [reviewerId, announcement.id],
    );
    const event = await addAnnouncementEvent(client, {
      announcementId: announcement.id, actorId: userId,
      type: reviewerId === null ? 'unassigned' : 'assigned',
      fromStatus: announcement.status, toStatus: announcement.status,
      details: { assigned_reviewer_id: reviewerId },
    });
    if (reviewerId) await notifyAnnouncement(client, announcement.id, reviewerId, 'owner_submission_assigned',
      `The submission "${announcement.title}" was assigned to you.`,
      `owner-submission:${announcement.id}:event:${event.rows[0].id}:recipient:${reviewerId}`);
    const details = await client.query(`${reviewSelect} WHERE p.id = $1`, [submissionId]);
    return reviewSubmission(details.rows[0], request);
  });
}

export async function decideSubmission(pool, userId, submissionId, input, request) {
  return withTransaction(pool, async (client) => {
    const user = await account(client, userId, true);
    if (!canManageSubmissions(user, 'review')) throw forbidden('You are not allowed to review owner submissions.');
    const scope = submissionScope(user);
    const args = scope.values;
    const target = args.length ? '$2' : '$1';
    const params = [...args, submissionId];
    const result = await client.query(
      `SELECT a.*, p.title, p.status AS property_status, p.listing_type
       FROM owner_announcements_ownerannouncement a JOIN user_property p ON p.id = a.property_id
       WHERE ${scope.clause === 'TRUE' ? '' : `${scope.clause} AND `}a.property_id = ${target}
       FOR UPDATE OF a, p`,
      params,
    );
    const announcement = result.rows[0];
    if (!announcement) throw notFound();
    if (announcement.submitter_id === userId) throw forbidden('You cannot review your own submission.');
    if (!['pending_review', 'corrections_requested'].includes(announcement.status)) {
      throw conflict('This submission is not awaiting review.');
    }
    const feedback = (input.feedback || '').trim();
    if (['reject', 'request_corrections'].includes(input.action) && !feedback) {
      throw new ApiError(400, 'An explanation is required for rejection or correction requests.');
    }
    const nextStatus = {
      approve: 'approved', reject: 'rejected', request_corrections: 'corrections_requested',
    }[input.action];
    if (input.action === 'approve') {
      if (!['available', 'active'].includes(announcement.property_status)) {
        throw conflict('Only available properties can be approved.');
      }
      if (!input.agreement_start_date || !validDate(input.agreement_start_date)
          || !input.agreement_duration_months || !input.agreement_terms?.trim()) {
        throw new ApiError(400, 'Approval requires a valid agreement start date, duration, and terms.');
      }
      const endDate = agreementEndDate(input.agreement_start_date, input.agreement_duration_months);
      await client.query(
        `UPDATE owner_announcements_ownerannouncementagreement
         SET status = 'superseded' WHERE announcement_id = $1 AND status = 'active'`,
        [announcement.id],
      );
      await client.query(
        `INSERT INTO owner_announcements_ownerannouncementagreement
         (announcement_id, start_date, end_date, duration_months, terms, renewal_conditions,
          public_contact_visible, status, approved_by_id, created_at)
         VALUES ($1, $2::date, $3::date, $4, $5, '', FALSE, 'active', $6, NOW())`,
        [announcement.id, input.agreement_start_date, endDate,
          input.agreement_duration_months, input.agreement_terms.trim(), userId],
      );
      await client.query(
        `UPDATE user_property SET publication_status = 'published', moderation_note = '',
         contact_publicly_visible = FALSE, updated_at = NOW()
         WHERE id = $1`,
        [announcement.property_id],
      );
    } else if (input.action === 'reject') {
      await client.query(
        `UPDATE user_property SET publication_status = 'rejected', moderation_note = $1, updated_at = NOW()
         WHERE id = $2`,
        [feedback, announcement.property_id],
      );
    } else {
      await client.query(
        `UPDATE user_property SET publication_status = 'pending_review', moderation_note = $1, updated_at = NOW()
         WHERE id = $2`,
        [feedback, announcement.property_id],
      );
    }
    await client.query(
      `UPDATE owner_announcements_ownerannouncement
       SET status = $1, agent_feedback = $2, reviewed_at = NOW(), reviewed_by_id = $3, updated_at = NOW()
       WHERE id = $4`,
      [nextStatus, feedback, userId, announcement.id],
    );
    const decisionDetails = input.action === 'approve'
      ? {
        agreement_start_date: input.agreement_start_date,
        agreement_end_date: agreementEndDate(input.agreement_start_date, input.agreement_duration_months),
        agreement_duration_months: input.agreement_duration_months,
        public_contact_visible: false,
      }
      : {};
    if (feedback) decisionDetails.feedback = feedback;
    const event = await addAnnouncementEvent(client, {
      announcementId: announcement.id, actorId: userId,
      type: { approve: 'approved', reject: 'rejected', request_corrections: 'corrections_requested' }[input.action],
      fromStatus: announcement.status, toStatus: nextStatus, details: decisionDetails,
    });
    await notifyAnnouncement(client, announcement.id, announcement.submitter_id,
      `owner_submission_${nextStatus}`,
      `Your property submission "${announcement.title}" is ${nextStatus.replaceAll('_', ' ')}.${feedback ? ` ${feedback}` : ''}`,
      `owner-submission:${announcement.id}:event:${event.rows[0].id}`);
    await addAdminAudit(client, user, 'owner_submission_reviewed', announcement.id, {
      status: { from: announcement.status, to: nextStatus },
      ...(feedback ? { feedback } : {}),
    });
    return getManagementSubmission(client, userId, submissionId, request);
  });
}

export async function deleteManagementSubmissions(pool, userId, ids) {
  return withTransaction(pool, async (client) => {
    const user = await account(client, userId, true);
    if (!canManageSubmissions(user, 'delete')) throw forbidden('Only administrators can delete owner submissions.');
    const rows = await client.query(
      `SELECT a.id, a.property_id, a.status, p.title
       FROM owner_announcements_ownerannouncement a
       JOIN user_property p ON p.id = a.property_id
       WHERE a.property_id = ANY($1::bigint[]) ORDER BY a.property_id
       FOR UPDATE OF a, p`,
      [ids],
    );
    if (rows.rowCount !== ids.length) throw notFound('One or more submissions were not found.');
    const propertyIds = rows.rows.map((row) => row.property_id);
    for (const row of rows.rows) {
      await addAdminAudit(client, user, 'owner_submission_deleted', row.id, {
        property_title: row.title, submission_status: row.status,
      });
    }
    await client.query('DELETE FROM user_property WHERE id = ANY($1::bigint[])', [propertyIds]);
    return { deleted_count: rows.rowCount };
  });
}

async function viewingRow(client, requestId, userId, scope, lock = false, managementScope = { clause: 'TRUE', values: [] }) {
  const ownerClause = scope === 'customer'
    ? 'r.requester_id = $2 AND r.requester_deleted_at IS NULL'
    : scope === 'receipt'
      ? 'r.receipt_token_digest = $2'
      : scope === 'management'
        ? managementScope.clause
        : 'TRUE';
  const sql = `SELECT r.*, p.title, p.slug, p.location, p.listing_type, p.status AS property_status,
      COALESCE(events.items, '[]'::json) AS events
    FROM user_viewingrequest r JOIN user_property p ON p.id = r.property_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('event_type', e.event_type, 'from_status', e.from_status,
        'to_status', e.to_status, 'proposed_date', e.proposed_date,
        'proposed_time', e.proposed_time, 'message', e.message,
        'actor_name', actor.username, 'created_at', e.created_at)
        ORDER BY e.created_at, e.id) AS items
      FROM viewings_viewingrequestevent e LEFT JOIN auth_user actor ON actor.id = e.actor_id
      WHERE e.viewing_request_id = r.id
    ) events ON TRUE
    WHERE r.id = $1 AND ${ownerClause}${lock ? ' FOR UPDATE OF r' : ''}`;
  const result = await client.query(sql, scope === 'customer' || scope === 'receipt'
    ? [requestId, userId]
    : scope === 'management'
      ? [requestId, ...managementScope.values]
      : [requestId]);
  return result.rows[0] || null;
}

function viewingJson(row, managed = false) {
  const property = managed
    ? { id: Number(row.property_id), title: row.title, slug: row.slug, location: row.location }
    : { id: Number(row.property_id), title: row.title, slug: row.slug, location: row.location,
      listing_type: row.listing_type, status: row.property_status };
  return {
    id: Number(row.id),
    property,
    full_name: row.full_name, email: row.email, phone: row.phone,
    preferred_date: row.preferred_date, preferred_time: row.preferred_time,
    proposed_date: row.proposed_date, proposed_time: row.proposed_time,
    scheduled_date: row.scheduled_date, scheduled_time: row.scheduled_time,
    status: row.status, message: row.message,
    ...(managed ? { agent_notes: row.agent_notes } : {}),
    appointment_timezone: 'Africa/Addis_Ababa', events: row.events || [], created_at: row.created_at,
  };
}

async function addViewingEvent(client, row, actorId, eventType, fromStatus, toStatus, dateValue, timeValue, message = '') {
  const event = await client.query(
    `INSERT INTO viewings_viewingrequestevent
     (viewing_request_id, actor_id, event_type, from_status, to_status,
      proposed_date, proposed_time, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
    [row.id, actorId, eventType, fromStatus || '', toStatus || '',
      dateValue ?? null, timeValue ?? null, message],
  );
  await notifyViewing(client, { ...row, event_type: eventType }, event.rows[0].id, Boolean(row.requester_id) && actorId !== row.requester_id);
  return event.rows[0].id;
}

async function requireCustomer(client, userId) {
  const user = await account(client, userId, true);
  if (!canViewRequests(user)) throw forbidden('Agents and administrators cannot submit customer viewing requests.');
  return user;
}

export async function createViewingRequest(pool, userId, input) {
  return withTransaction(pool, async (client) => {
    await requireCustomer(client, userId);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    if (!validDate(input.preferred_date) || input.preferred_date < today) {
      throw new ApiError(400, 'Preferred date cannot be in the past.');
    }
    const property = await client.query(
      `SELECT id, title, status, publication_status FROM user_property
       WHERE id = $1 AND publication_status = 'published' FOR UPDATE`,
      [input.property_id],
    );
    if (!property.rowCount || !['available', 'active'].includes(property.rows[0].status)) {
      throw notFound('This property is not currently available for viewing requests.');
    }
    if (input.preferred_time && isAppointmentInPast(input.preferred_date, input.preferred_time)) {
      throw new ApiError(400, 'Preferred time cannot be in the past.');
    }
    const existingRequest = await client.query(
      `SELECT 1 FROM user_viewingrequest
       WHERE property_id = $1 AND requester_id = $2
         AND status = ANY($3::varchar[]) LIMIT 1`,
      [input.property_id, userId, activeRequestStatuses],
    );
    if (existingRequest.rowCount) {
      throw conflict('You already have an active viewing request for this property.');
    }
    const inserted = await client.query(
      `INSERT INTO user_viewingrequest
       (property_id, requester_id, full_name, email, phone, preferred_date, preferred_time,
        message, agent_notes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::time, $8, '', 'pending', NOW())
       RETURNING id, status, created_at`,
      [input.property_id, userId, input.full_name, input.email, input.phone,
        input.preferred_date, input.preferred_time ?? null, input.message ?? ''],
    ).catch((error) => {
      if (error.code === '23505') throw conflict('You already have an active viewing request for this property.');
      throw error;
    });
    const row = { id: inserted.rows[0].id, property_id: input.property_id, title: property.rows[0].title, requester_id: userId };
    await addViewingEvent(client, row, userId, 'submitted', '', 'pending', input.preferred_date, input.preferred_time ?? null, input.message ?? '');
    return { id: Number(inserted.rows[0].id), status: inserted.rows[0].status, created_at: inserted.rows[0].created_at };
  });
}

export async function listCustomerViewingRequests(pool, request, userId, filters) {
  await requireCustomer(pool, userId);
  const values = [userId];
  let where = 'r.requester_id = $1 AND r.requester_deleted_at IS NULL';
  if (filters.status) {
    values.push(filters.status);
    where += ` AND r.status = $${values.length}`;
  }
  const count = await pool.query(`SELECT COUNT(*)::int AS count FROM user_viewingrequest r WHERE ${where}`, values);
  const orderKey = filters.ordering.replace('-', '');
  const direction = filters.ordering.startsWith('-') ? 'DESC' : 'ASC';
  const order = `r.${orderKey} ${direction}, r.id DESC`;
  const paging = [...values, filters.page_size, (filters.page - 1) * filters.page_size];
  const rows = await pool.query(
    `SELECT r.id FROM user_viewingrequest r WHERE ${where} ORDER BY ${order}
     LIMIT $${paging.length - 1} OFFSET $${paging.length}`, paging,
  );
  const details = [];
  for (const item of rows.rows) {
    const row = await viewingRow(pool, item.id, userId, 'customer');
    if (row) details.push(viewingJson(row));
  }
  return pageResult(request, details, count.rows[0].count, filters);
}

export async function getCustomerViewingRequest(pool, userId, requestId) {
  await requireCustomer(pool, userId);
  const row = await viewingRow(pool, requestId, userId, 'customer');
  if (!row) throw notFound();
  return viewingJson(row);
}

export async function patchCustomerViewingRequest(pool, userId, requestId, input) {
  return withTransaction(pool, async (client) => {
    await requireCustomer(client, userId);
    const row = await viewingRow(client, requestId, userId, 'customer', true);
    if (!row) throw notFound();
    if (row.status !== 'pending') throw conflict('Only pending viewing requests can be edited.');
    if (input.preferred_date) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      if (!validDate(input.preferred_date) || input.preferred_date < today) {
        throw new ApiError(400, 'Preferred date cannot be in the past.');
      }
    }
    const preferredDate = input.preferred_date ?? row.preferred_date;
    const preferredTime = Object.hasOwn(input, 'preferred_time') ? input.preferred_time : row.preferred_time;
    if (isAppointmentInPast(preferredDate, preferredTime)) {
      throw new ApiError(400, 'Preferred appointment time cannot be in the past.');
    }
    const fields = ['full_name', 'email', 'phone', 'preferred_date', 'preferred_time', 'message']
      .filter((field) => Object.hasOwn(input, field));
    if (fields.some((field) => input[field] !== row[field])) {
      const values = fields.map((field) => input[field]);
      const sets = fields.map((field, index) => `${field} = $${index + 1}`);
      values.push(requestId);
      await client.query(`UPDATE user_viewingrequest SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
      const changed = { ...row, ...input };
      await addViewingEvent(client, changed, userId, 'request_updated', row.status, row.status,
        changed.preferred_date, changed.preferred_time, changed.message || '');
    }
    return viewingJson(await viewingRow(client, requestId, userId, 'customer'));
  });
}

async function respondToViewingRequest(client, row, userId, decision, message = '') {
  if (row.status !== 'proposed') throw conflict('There is no pending appointment proposal to decide.');
  if (!row.proposed_date || !row.proposed_time
      || isAppointmentInPast(row.proposed_date, row.proposed_time)) {
    throw conflict('This appointment proposal has expired. Contact the property manager.');
  }
  const accepted = decision === 'accept';
  const status = accepted ? 'confirmed' : 'declined';
  await client.query(
    `UPDATE user_viewingrequest SET status = $1, scheduled_date = $2, scheduled_time = $3,
     guest_responded_at = NOW() WHERE id = $4`,
    [status, accepted ? row.proposed_date : row.scheduled_date,
      accepted ? row.proposed_time : row.scheduled_time, row.id],
  );
  await addViewingEvent(client, row, userId, accepted ? 'proposal_accepted' : 'proposal_declined',
    row.status, status, row.proposed_date, row.proposed_time, message);
}

export async function respondCustomerViewingRequest(pool, userId, requestId, decision, message = '') {
  return withTransaction(pool, async (client) => {
    await requireCustomer(client, userId);
    const row = await viewingRow(client, requestId, userId, 'customer', true);
    if (!row) throw notFound();
    await respondToViewingRequest(client, row, userId, decision, message);
    return viewingJson(await viewingRow(client, requestId, userId, 'customer'));
  });
}

export async function cancelCustomerViewingRequest(pool, userId, requestId, message = '') {
  return withTransaction(pool, async (client) => {
    await requireCustomer(client, userId);
    const row = await viewingRow(client, requestId, userId, 'customer', true);
    if (!row) throw notFound();
    if (!activeRequestStatuses.includes(row.status)) {
      throw conflict('This viewing request is already closed.');
    }
    await client.query('UPDATE user_viewingrequest SET status = $1 WHERE id = $2', ['cancelled', requestId]);
    await addViewingEvent(client, row, userId, 'cancelled', row.status, 'cancelled', null, null, message);
    return viewingJson(await viewingRow(client, requestId, userId, 'customer'));
  });
}

export async function deleteCustomerViewingRequest(pool, userId, requestId) {
  return withTransaction(pool, async (client) => {
    await requireCustomer(client, userId);
    const row = await viewingRow(client, requestId, userId, 'customer', true);
    if (!row) throw notFound();
    if (activeRequestStatuses.includes(row.status)) {
      await client.query('UPDATE user_viewingrequest SET status = $1 WHERE id = $2', ['cancelled', requestId]);
      await addViewingEvent(client, row, userId, 'cancelled', row.status, 'cancelled');
    }
    await client.query('UPDATE user_viewingrequest SET requester_deleted_at = NOW() WHERE id = $1', [requestId]);
    return null;
  });
}

async function manageViewingScope(client, user) {
  const allPermissions = permissions(user);
  if (isAdministrator(user) && (user.is_superuser
      || allPermissions.some((permission) => ['viewings.view_all', 'viewings.manage_all'].includes(permission)))) {
    return { clause: 'TRUE', values: [] };
  }
  if (user.role !== 'agent' || !user.agent_approved) {
    throw forbidden('You are not allowed to manage viewing requests.');
  }
  if (allPermissions.some((permission) => ['viewings.view_all', 'viewings.manage_all'].includes(permission))) {
    return { clause: 'TRUE', values: [] };
  }
  if (isAdministrator(user) && allPermissions.some((permission) => [
    'properties.view_all', 'properties.moderate', 'properties.edit_all', 'properties.manage_assigned',
  ].includes(permission))) {
    return {
      clause: 'r.property_id IN (SELECT id FROM user_property WHERE submitted_by_id = $2)',
      values: [user.id],
    };
  }
  if (!allPermissions.includes('viewings.manage_assigned') || user.assigned_city_id == null) {
    throw forbidden('You are not allowed to manage viewing requests.');
  }
  const locations = await client.query(
    `WITH RECURSIVE city_locations(id, visited) AS (
       SELECT id, ARRAY[id] FROM properties_location WHERE id = $1
       UNION ALL
       SELECT location.id, city_locations.visited || location.id
       FROM properties_location location
       JOIN city_locations ON location.parent_id = city_locations.id
       WHERE NOT location.id = ANY(city_locations.visited)
     )
     SELECT id FROM city_locations`,
    [user.assigned_city_id],
  );
  const locationIds = locations.rows.map((row) => Number(row.id));
  if (!locationIds.length) throw forbidden('Your assigned viewing area is not configured.');
  return {
    clause: `EXISTS (
      SELECT 1 FROM properties_propertyagentassignment assignment
      JOIN user_property managed_property ON managed_property.id = assignment.property_id
      WHERE assignment.property_id = r.property_id AND assignment.agent_id = $2
        AND managed_property.administrative_location_id = ANY($3::bigint[])
    )`,
    values: [user.id, locationIds],
  };
}

export async function listManagementViewingRequests(pool, request, userId, filters) {
  const user = await account(pool, userId);
  const scope = await manageViewingScope(pool, user);
  const values = [...scope.values];
  let where = shiftSqlParameters(scope.clause, -1);
  if (filters.status) {
    values.push(filters.status);
    where += ` AND r.status = $${values.length}`;
  }
  const count = await pool.query(`SELECT COUNT(*)::int AS count FROM user_viewingrequest r WHERE ${where}`, values);
  const field = filters.ordering.replace('-', '');
  const direction = filters.ordering.startsWith('-') ? 'DESC' : 'ASC';
  const paging = [...values, filters.page_size, (filters.page - 1) * filters.page_size];
  const rows = await pool.query(
    `SELECT r.id FROM user_viewingrequest r WHERE ${where} ORDER BY r.${field} ${direction}, r.id DESC
     LIMIT $${paging.length - 1} OFFSET $${paging.length}`, paging,
  );
  const result = [];
  for (const entry of rows.rows) {
    const row = await viewingRow(pool, entry.id, undefined, 'management', false, scope);
    if (row) result.push(viewingJson(row));
  }
  return pageResult(request, result, count.rows[0].count, filters);
}

export async function getManagementViewingRequest(pool, userId, requestId) {
  const user = await account(pool, userId);
  const scope = await manageViewingScope(pool, user);
  const row = await viewingRow(pool, requestId, undefined, 'management', false, scope);
  if (!row) throw notFound();
  return viewingJson(row, true);
}

export async function patchManagementViewingRequest(pool, userId, requestId, input) {
  return withTransaction(pool, async (client) => {
    const scope = await manageViewingScope(client, await account(client, userId, true));
    const row = await viewingRow(client, requestId, undefined, 'management', true, scope);
    if (!row) throw notFound();
    if (!['pending', 'proposed', 'declined'].includes(row.status)) {
      throw conflict('This viewing request is not open for agent review.');
    }
    if (input.status === 'confirmed') throw new ApiError(400, 'Only the visitor can confirm a proposed appointment.');
    const dateValue = Object.hasOwn(input, 'proposed_date') ? input.proposed_date : row.proposed_date;
    const timeValue = Object.hasOwn(input, 'proposed_time') ? input.proposed_time : row.proposed_time;
    if (dateValue && !validDate(dateValue)) throw new ApiError(400, 'Choose a valid proposed date.');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    if (dateValue && dateValue < today) throw new ApiError(400, 'Proposed date cannot be in the past.');
    const proposalChanged = (Object.hasOwn(input, 'proposed_date') && input.proposed_date !== row.proposed_date)
      || (Object.hasOwn(input, 'proposed_time') && input.proposed_time !== row.proposed_time);
    if (proposalChanged && (!dateValue || !timeValue)) {
      throw new ApiError(400, 'An appointment proposal requires both a date and a time.');
    }
    if (proposalChanged && !['pending', 'proposed', 'declined'].includes(row.status)) {
      throw new ApiError(400, 'A closed or confirmed request cannot receive a new proposal.');
    }
    if (proposalChanged && isAppointmentInPast(dateValue, timeValue)) {
      throw new ApiError(400, 'Proposed appointment time cannot be in the past.');
    }
    if (proposalChanged && input.status === 'rejected') {
      throw new ApiError(400, 'A proposal cannot be sent and rejected in the same update.');
    }
    let nextStatus = row.status;
    if (input.status === 'rejected') {
      if (!['pending', 'proposed'].includes(row.status)) throw conflict('Only pending requests or open proposals can be rejected.');
      nextStatus = 'rejected';
    } else if (proposalChanged) {
      nextStatus = 'proposed';
    }
    const values = [nextStatus, dateValue ?? null, timeValue ?? null,
      Object.hasOwn(input, 'agent_notes') ? input.agent_notes : row.agent_notes,
      requestId];
    await client.query(
      `UPDATE user_viewingrequest SET status = $1, proposed_date = $2, proposed_time = $3,
       agent_notes = $4 WHERE id = $5`, values,
    );
    if (proposalChanged || nextStatus !== row.status) {
      const eventType = nextStatus === 'rejected' ? 'rejected'
        : row.status === 'proposed' ? 'proposal_revised' : 'proposal_sent';
      await addViewingEvent(client, row, userId, eventType, row.status, nextStatus,
        nextStatus === 'rejected' ? null : dateValue,
        nextStatus === 'rejected' ? null : timeValue);
    }
    return viewingJson(await viewingRow(client, requestId), true);
  });
}

export async function actOnManagementViewingRequest(pool, userId, requestId, action, message = '') {
  return withTransaction(pool, async (client) => {
    const scope = await manageViewingScope(client, await account(client, userId, true));
    const row = await viewingRow(client, requestId, undefined, 'management', true, scope);
    if (!row) throw notFound();
    const transitions = {
      confirm_requested: [['pending', 'declined'].includes(row.status) ? row.status : null, 'confirmed', 'request_confirmed'],
      cancel: [['pending', 'proposed', 'confirmed', 'declined'].includes(row.status) ? row.status : null, 'cancelled', 'cancelled'],
      complete: ['confirmed', 'completed', 'completed'],
    };
    const transition = transitions[action];
    if (!transition || row.status !== transition[0]) throw conflict('This viewing request cannot perform that action.');
    if (action === 'confirm_requested') {
      if (!row.preferred_time || isAppointmentInPast(row.preferred_date, row.preferred_time)) {
        throw conflict('The requested appointment time is unavailable or has passed.');
      }
      await client.query(
        `UPDATE user_viewingrequest SET status = 'confirmed', scheduled_date = preferred_date,
         scheduled_time = preferred_time WHERE id = $1`, [requestId],
      );
    } else {
      if (action === 'complete') {
        const scheduled = row.scheduled_date && row.scheduled_time
          ? new Date(`${row.scheduled_date}T${row.scheduled_time}Z`) : null;
        if (!scheduled || scheduled > new Date()) throw conflict('A viewing cannot be completed before its scheduled time.');
      }
      await client.query('UPDATE user_viewingrequest SET status = $1 WHERE id = $2', [transition[1], requestId]);
    }
    const eventDate = action === 'confirm_requested' ? row.preferred_date : row.scheduled_date;
    const eventTime = action === 'confirm_requested' ? row.preferred_time : row.scheduled_time;
    await addViewingEvent(client, row, userId, transition[2], row.status, transition[1],
      eventDate, eventTime, message);
    return viewingJson(await viewingRow(client, requestId), true);
  });
}

function isAppointmentInPast(dateValue, timeValue) {
  return Boolean(dateValue && timeValue
    && new Date(`${dateValue}T${timeValue}+03:00`) <= new Date());
}

function shiftSqlParameters(statement, offset) {
  return statement.replace(/\$(\d+)/g, (_match, number) => `$${Number(number) + offset}`);
}

function receiptDigest(token) {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  return createHash('sha256').update(token).digest('hex');
}

export async function accessViewingReceipt(pool, token, decision) {
  const digest = receiptDigest(token);
  if (!digest) throw notFound();
  if (!decision) {
    const result = await pool.query(
      `SELECT r.id FROM user_viewingrequest r WHERE r.receipt_token_digest = $1`, [digest],
    );
    if (!result.rowCount) throw notFound();
    const row = await viewingRow(pool, result.rows[0].id, digest, 'receipt');
    return {
      id: Number(row.id), property_title: row.title, status: row.status,
      preferred_date: row.preferred_date, preferred_time: row.preferred_time,
      proposed_date: row.proposed_date, proposed_time: row.proposed_time,
      scheduled_date: row.scheduled_date, scheduled_time: row.scheduled_time,
      appointment_timezone: 'Africa/Addis_Ababa', created_at: row.created_at,
    };
  }
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT id FROM user_viewingrequest WHERE receipt_token_digest = $1 FOR UPDATE`, [digest],
    );
    if (!result.rowCount) throw notFound();
    const row = await viewingRow(client, result.rows[0].id, digest, 'receipt');
    await respondToViewingRequest(client, row, row.requester_id, decision);
    const updated = await viewingRow(client, result.rows[0].id, digest, 'receipt');
    return {
      id: Number(updated.id), property_title: updated.title, status: updated.status,
      preferred_date: updated.preferred_date, preferred_time: updated.preferred_time,
      proposed_date: updated.proposed_date, proposed_time: updated.proposed_time,
      scheduled_date: updated.scheduled_date, scheduled_time: updated.scheduled_time,
      appointment_timezone: 'Africa/Addis_Ababa', created_at: updated.created_at,
    };
  });
}

export async function listNotifications(pool, request, userId, filters) {
  await account(pool, userId);
  const values = [userId];
  let where = 'recipient_id = $1';
  if (filters.unread === 'true') where += ' AND read_at IS NULL';
  if (filters.unread === 'false') where += ' AND read_at IS NOT NULL';
  const count = await pool.query(`SELECT COUNT(*)::int AS count FROM owner_announcements_inappnotification WHERE ${where}`, values);
  const paging = [...values, filters.page_size, (filters.page - 1) * filters.page_size];
  const ordering = filters.ordering === 'created_at' ? 'ASC' : 'DESC';
  const rows = await pool.query(
    `SELECT id, notification_type, message, announcement_id, read_at, created_at
     FROM owner_announcements_inappnotification WHERE ${where} ORDER BY created_at ${ordering}, id ${ordering}
     LIMIT $2 OFFSET $3`, paging,
  );
  return pageResult(request, rows.rows.map((row) => ({ ...row, id: Number(row.id),
    announcement_id: row.announcement_id == null ? null : Number(row.announcement_id) })), count.rows[0].count, filters);
}

export async function readNotification(pool, userId, notificationId) {
  await account(pool, userId);
  const result = await pool.query(
    `UPDATE owner_announcements_inappnotification SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND recipient_id = $2
     RETURNING id, notification_type, message, announcement_id, read_at, created_at`,
    [notificationId, userId],
  );
  if (!result.rowCount) throw notFound();
  const row = result.rows[0];
  return { ...row, id: Number(row.id), announcement_id: row.announcement_id == null ? null : Number(row.announcement_id) };
}
