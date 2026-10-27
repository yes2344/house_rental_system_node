import { ApiError } from '../errors.js';
import { requestOrigin } from '../requestOrigin.js';

function escapedPattern(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function absoluteMediaUrl(request, filename) {
  if (!filename) return null;
  const path = `/media/${filename.split('/').map(encodeURIComponent).join('/')}`;
  return new URL(path, requestOrigin(request)).toString();
}

function paginationUrl(request, page, pageSize) {
  const url = new URL(request.originalUrl, requestOrigin(request));
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(pageSize));
  return url.toString();
}

function serializeProperty(row, request) {
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    location: row.location,
    administrative_location: row.administrative_location_id === null
      ? null
      : Number(row.administrative_location_id),
    location_path: row.location_path || [],
    category: row.category,
    listing_type: row.listing_type,
    price: row.price,
    currency: row.currency || 'ETB',
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    area_sqft: row.area_sqft,
    area_value: row.area_value,
    area_unit: row.area_unit,
    rental_frequency: row.rental_frequency,
    description: row.description,
    features: row.features,
    status: row.status === 'active' ? 'available' : row.status,
    publication_status: row.publication_status,
    is_featured: row.is_featured,
    submitted_by_id: row.submitted_by_id === null ? null : Number(row.submitted_by_id),
    moderation_note: row.moderation_note,
    amenities: row.amenities || [],
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    contact_email: row.contact_email,
    images: (row.images || []).map((image) => ({
      ...image,
      id: Number(image.id),
      url: absoluteMediaUrl(request, image.url),
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getManagementScope(pool, userId) {
  const result = await pool.query(
    `SELECT account.is_active, account.is_staff, account.is_superuser,
            profile.role, profile.agent_approved
     FROM auth_user AS account
     LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
     WHERE account.id = $1`,
    [userId],
  );
  const account = result.rows[0];
  if (!account?.is_active) throw new ApiError(403, 'You are not allowed to manage properties.');

  const isAdministrator = account.is_superuser
    || (account.is_staff && account.role === 'administrator');
  if (isAdministrator) return { allProperties: true };

  if (account.role === 'agent' && account.agent_approved) {
    return { allProperties: false };
  }
  throw new ApiError(403, 'You are not allowed to manage properties.');
}

export async function listManagedProperties(pool, request, userId, filters) {
  const scope = await getManagementScope(pool, userId);
  const values = [];
  const conditions = [];
  const addCondition = (condition, value) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };

  if (scope.allProperties) {
    conditions.push('TRUE');
  } else {
    addCondition(
      "p.service_type = 'agent_managed' AND p.submitted_by_id = ?",
      userId,
    );
  }

  if (filters.status === 'available') {
    conditions.push("p.status IN ('active', 'available')");
  } else if (filters.status) {
    addCondition('p.status = ?', filters.status);
  }
  if (filters.publication_status) {
    addCondition('p.publication_status = ?', filters.publication_status);
  }
  if (filters.search) {
    for (const term of filters.search.normalize('NFC').trim().split(/\s+/).filter(Boolean)) {
      values.push(escapedPattern(term));
      const parameter = `$${values.length}`;
      conditions.push(`(
        p.title ILIKE ${parameter} ESCAPE E'\\\\'
        OR p.location ILIKE ${parameter} ESCAPE E'\\\\'
        OR p.description ILIKE ${parameter} ESCAPE E'\\\\'
        OR p.features ILIKE ${parameter} ESCAPE E'\\\\'
      )`);
    }
  }

  const where = conditions.join(' AND ');
  const count = await pool.query(
    `SELECT COUNT(*)::integer AS count
     FROM user_property AS p
     WHERE ${where}`,
    values,
  );
  const total = count.rows[0]?.count ?? 0;
  const offset = (filters.page - 1) * filters.page_size;
  const ordering = filters.ordering === 'created_at'
    ? 'p.created_at ASC, p.id ASC'
    : filters.ordering === 'price'
      ? 'p.price ASC, p.id ASC'
      : filters.ordering === '-price'
        ? 'p.price DESC, p.id ASC'
        : 'p.created_at DESC, p.id DESC';
  const rows = await pool.query(
    `WITH RECURSIVE location_ancestor (location_id, ancestor_id, visited, depth) AS (
       SELECT id, id, ARRAY[id], 0 FROM properties_location WHERE is_active = TRUE
       UNION ALL
       SELECT branch.location_id, parent.parent_id, branch.visited || parent.parent_id,
              branch.depth + 1
       FROM location_ancestor AS branch
       JOIN properties_location AS parent ON parent.id = branch.ancestor_id
       WHERE parent.parent_id IS NOT NULL AND parent.is_active = TRUE
         AND NOT parent.parent_id = ANY(branch.visited)
     )
     SELECT p.id, p.title, p.slug, p.location, p.administrative_location_id,
            p.property_type AS category, p.listing_type, p.price::text AS price, p.currency,
            p.bedrooms, p.bathrooms, p.area_sqft, p.area_value::text AS area_value,
            p.area_unit, p.rental_frequency, p.description, p.features, p.status,
            p.publication_status, p.is_featured, p.submitted_by_id, p.moderation_note,
            p.contact_name, p.contact_phone, p.contact_email, p.created_at, p.updated_at,
            COALESCE(location_path.path, '[]'::jsonb) AS location_path,
            COALESCE(amenity_data.amenities, '[]'::jsonb) AS amenities,
            COALESCE(image_data.images, '[]'::jsonb) AS images
     FROM user_property AS p
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object('id', id, 'name', name, 'name_am', name_am,
                            'location_type', location_type)
         ORDER BY depth DESC
       ) AS path
       FROM (
         SELECT id, name, name_am, location_type, depth
         FROM location_ancestor
         JOIN properties_location ON properties_location.id = location_ancestor.ancestor_id
         WHERE location_ancestor.location_id = p.administrative_location_id
       ) AS ancestors
     ) AS location_path ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(amenity_id ORDER BY amenity_id) AS amenities
       FROM user_property_amenities
       WHERE property_id = p.id
     ) AS amenity_data ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', image.id,
           'url', NULLIF(image.image, ''),
           'caption', image.caption,
           'is_primary', image.is_primary
         ) ORDER BY image.id
       ) AS images
       FROM user_propertyimage AS image
       WHERE image.property_id = p.id
     ) AS image_data ON TRUE
     WHERE ${where}
     ORDER BY ${ordering}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.page_size, offset],
  );

  return {
    count: total,
    next: offset + filters.page_size < total
      ? paginationUrl(request, filters.page + 1, filters.page_size)
      : null,
    previous: filters.page > 1 && total > 0
      ? paginationUrl(request, filters.page - 1, filters.page_size)
      : null,
    results: rows.rows.map((row) => serializeProperty(row, request)),
  };
}
