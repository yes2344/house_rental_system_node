import { ApiError } from '../errors.js';
import { requestOrigin } from '../requestOrigin.js';

const publicEligibility = `p.publication_status = 'published'
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

function escapedPattern(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

async function validateLocationFilters(pool, filters) {
  if (filters.city_id !== undefined) {
    const city = await pool.query(
      `SELECT id, location_type FROM properties_location
       WHERE id = $1 AND is_active = TRUE`,
      [filters.city_id],
    );
    if (
      city.rowCount !== 1
      || !['city', 'city_administration'].includes(city.rows[0].location_type)
    ) {
      throw new ApiError(400, 'Request validation failed.', {
        city_id: ['Choose an active city or city administration.'],
      });
    }
  }
  if (filters.location_id !== undefined) {
    const location = await pool.query(
      'SELECT id FROM properties_location WHERE id = $1 AND is_active = TRUE',
      [filters.location_id],
    );
    if (location.rowCount !== 1) {
      throw new ApiError(400, 'Request validation failed.', {
        location_id: ['Choose an active location.'],
      });
    }
    if (filters.city_id !== undefined) {
      const withinCity = await pool.query(
        `WITH RECURSIVE location_ancestor (location_id, ancestor_id, visited) AS (
           SELECT id, id, ARRAY[id] FROM properties_location WHERE is_active = TRUE
           UNION ALL
           SELECT branch.location_id, parent.parent_id, branch.visited || parent.parent_id
           FROM location_ancestor AS branch
           JOIN properties_location AS parent ON parent.id = branch.ancestor_id
           WHERE parent.parent_id IS NOT NULL AND parent.is_active = TRUE
             AND NOT parent.parent_id = ANY(branch.visited)
         )
         SELECT 1 FROM location_ancestor
         WHERE location_id = $1 AND ancestor_id = $2
         LIMIT 1`,
        [filters.location_id, filters.city_id],
      );
      if (!withinCity.rowCount) {
        throw new ApiError(400, 'Request validation failed.', {
          location_id: ['Choose a location within the selected city.'],
        });
      }
    }
  }
}

function propertyConditions(filters) {
  const values = [];
  const conditions = [publicEligibility];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };

  for (const [field, column] of [
    ['listing_type', 'p.listing_type'],
    ['property_type', 'p.property_type'],
    ['status', 'p.status'],
  ]) {
    if (filters[field] !== undefined) add(`${column} = ?`, filters[field]);
  }
  for (const [field, operator, column] of [
    ['min_price', '>=', 'p.price'],
    ['max_price', '<=', 'p.price'],
    ['min_bedrooms', '>=', 'p.bedrooms'],
    ['max_bedrooms', '<=', 'p.bedrooms'],
    ['min_bathrooms', '>=', 'p.bathrooms'],
    ['max_bathrooms', '<=', 'p.bathrooms'],
    ['min_size', '>=', 'p.area_sqft'],
    ['max_size', '<=', 'p.area_sqft'],
  ]) {
    if (filters[field] !== undefined) add(`${column} ${operator} ?`, filters[field]);
  }

  const amenitySlugs = [...new Set(
    (filters.amenities || '').split(',').map((slug) => slug.trim()).filter(Boolean),
  )];
  if (amenitySlugs.length) {
    values.push(amenitySlugs);
    conditions.push(`p.id IN (
      SELECT property_id FROM user_property_amenities AS property_amenity
      JOIN properties_amenity AS amenity ON amenity.id = property_amenity.amenity_id
      WHERE amenity.slug = ANY($${values.length}::varchar[])
      GROUP BY property_id
      HAVING COUNT(DISTINCT amenity.slug) = cardinality($${values.length}::varchar[])
    )`);
  }
  if (filters.city_id !== undefined) {
    values.push(filters.city_id);
    conditions.push(`EXISTS (
      SELECT 1 FROM location_ancestor AS location_match
      WHERE location_match.location_id = p.administrative_location_id
        AND location_match.ancestor_id = $${values.length}
    )`);
  }
  if (filters.location_id !== undefined) {
    values.push(filters.location_id);
    conditions.push(`EXISTS (
      SELECT 1 FROM location_ancestor AS location_match
      WHERE location_match.location_id = p.administrative_location_id
        AND location_match.ancestor_id = $${values.length}
    )`);
  }
  if (filters.location) {
    values.push(escapedPattern(filters.location));
    conditions.push(`(
      p.location ILIKE $${values.length} ESCAPE E'\\\\'
      OR EXISTS (
        SELECT 1 FROM location_ancestor AS location_match
        JOIN properties_location AS location ON location.id = location_match.ancestor_id
        WHERE location_match.location_id = p.administrative_location_id
          AND (
            location.name ILIKE $${values.length} ESCAPE E'\\\\'
            OR location.name_am ILIKE $${values.length} ESCAPE E'\\\\'
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(location.aliases_en) AS alias(value)
              WHERE alias.value ILIKE $${values.length} ESCAPE E'\\\\'
            )
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(location.aliases_am) AS alias(value)
              WHERE alias.value ILIKE $${values.length} ESCAPE E'\\\\'
            )
          )
      )
    )`);
  }
  if (filters.search) {
    const terms = filters.search.normalize('NFC').trim().split(/\s+/).filter(Boolean);
    for (const term of terms) {
      values.push(escapedPattern(term));
      const parameter = `$${values.length}`;
      conditions.push(`(
        p.title ILIKE ${parameter} ESCAPE E'\\\\'
        OR p.location ILIKE ${parameter} ESCAPE E'\\\\'
        OR p.description ILIKE ${parameter} ESCAPE E'\\\\'
        OR p.features ILIKE ${parameter} ESCAPE E'\\\\'
        OR EXISTS (
          SELECT 1 FROM user_property_amenities AS property_amenity
          JOIN properties_amenity AS amenity ON amenity.id = property_amenity.amenity_id
          WHERE property_amenity.property_id = p.id
            AND (amenity.name ILIKE ${parameter} ESCAPE E'\\\\'
                 OR amenity.name_am ILIKE ${parameter} ESCAPE E'\\\\')
        )
        OR EXISTS (
          SELECT 1 FROM location_ancestor AS location_match
          JOIN properties_location AS location ON location.id = location_match.ancestor_id
          WHERE location_match.location_id = p.administrative_location_id
            AND (location.name ILIKE ${parameter} ESCAPE E'\\\\'
                 OR location.name_am ILIKE ${parameter} ESCAPE E'\\\\')
        )
      )`);
    }
  }
  return { values, where: conditions.join(' AND ') };
}

const locationCte = `WITH RECURSIVE location_ancestor (location_id, ancestor_id, visited) AS (
  SELECT id, id, ARRAY[id] FROM properties_location WHERE is_active = TRUE
  UNION ALL
  SELECT branch.location_id, parent.parent_id, branch.visited || parent.parent_id
  FROM location_ancestor AS branch
  JOIN properties_location AS parent ON parent.id = branch.ancestor_id
  WHERE parent.parent_id IS NOT NULL AND parent.is_active = TRUE
    AND NOT parent.parent_id = ANY(branch.visited)
)`;

function orderBy(ordering) {
  if (ordering === 'price' || ordering === '-price') {
    return `CASE
      WHEN p.listing_type = 'sale' THEN 0
      WHEN p.rental_frequency = 'daily' THEN 1
      WHEN p.rental_frequency = 'weekly' THEN 2
      WHEN p.rental_frequency = 'monthly' THEN 3
      WHEN p.rental_frequency = 'yearly' THEN 4
      ELSE 5
    END, p.currency ASC, p.price ${ordering === 'price' ? 'ASC' : 'DESC'}, p.id ASC`;
  }
  return `p.created_at ${ordering === 'created_at' ? 'ASC' : 'DESC'}, p.id ${ordering === 'created_at' ? 'ASC' : 'DESC'}`;
}

function absoluteMediaUrl(request, filename) {
  if (!filename) return null;
  const path = `/media/${filename.split('/').map(encodeURIComponent).join('/')}`;
  return new URL(path, requestOrigin(request)).toString();
}

function propertySelection(detail) {
  return `p.id, p.title, p.slug, p.location, p.administrative_location_id,
    location.name AS location_name, p.property_type AS category, p.listing_type,
    p.price::text AS price, p.currency, p.bedrooms, p.bathrooms, p.area_sqft,
    p.area_value::text AS area_value, p.area_unit, p.rental_frequency,
    CASE WHEN p.status = 'active' THEN 'available' ELSE p.status END AS status,
    p.service_type,
    CASE WHEN p.service_type = 'owner_announced'
      THEN COALESCE(announcement.owner_contact_phone, '')
      ELSE p.contact_phone END AS public_contact_phone,
    CASE WHEN p.service_type = 'agent_managed'
          AND submitter.is_active = TRUE
          AND submitter_profile.role = 'agent'
          AND submitter_profile.agent_approved = TRUE
          AND EXISTS (
            SELECT 1 FROM properties_propertyagentassignment AS assignment
            WHERE assignment.property_id = p.id AND assignment.agent_id = submitter.id
          )
      THEN p.contact_email ELSE '' END AS public_contact_email,
    image_data.images, image_data.primary_image,
    location_path.path AS location_path,
    p.created_at${detail ? ', p.description, p.features, p.updated_at, amenity_data.amenities' : ''}`;
}

function propertyJoins(detail) {
  return `LEFT JOIN properties_location AS location ON location.id = p.administrative_location_id
    LEFT JOIN auth_user AS submitter ON submitter.id = p.submitted_by_id
    LEFT JOIN accounts_profile AS submitter_profile ON submitter_profile.user_id = submitter.id
    LEFT JOIN owner_announcements_ownerannouncement AS announcement ON announcement.property_id = p.id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', image.id,
                 'url', CASE WHEN image.image = '' THEN NULL
                   ELSE '/media/' || image.image END,
                 'caption', image.caption,
                 'is_primary', image.is_primary
               ) ORDER BY image.id
             ) AS images,
             (array_agg(image.image ORDER BY image.is_primary DESC, image.id))[1] AS primary_image
      FROM user_propertyimage AS image
      WHERE image.property_id = p.id
    ) AS image_data ON TRUE
    LEFT JOIN LATERAL (
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, name_am, location_type, 0 AS depth
        FROM properties_location WHERE id = p.administrative_location_id
        UNION ALL
        SELECT parent.id, parent.parent_id, parent.name, parent.name_am,
               parent.location_type, child.depth + 1
        FROM properties_location AS parent
        JOIN ancestors AS child ON child.parent_id = parent.id
        WHERE child.depth < 8
      )
      SELECT jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'name_am', name_am,
                           'location_type', location_type)
        ORDER BY depth DESC
      ) AS path
      FROM ancestors
    ) AS location_path ON TRUE
    ${detail ? `LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('id', amenity.id, 'name', amenity.name,
                           'name_am', amenity.name_am, 'slug', amenity.slug)
        ORDER BY amenity.name
      ) AS amenities
      FROM user_property_amenities AS link
      JOIN properties_amenity AS amenity ON amenity.id = link.amenity_id
      WHERE link.property_id = p.id
    ) AS amenity_data ON TRUE` : ''}`;
}

function serializeProperty(row, request, detail) {
  const images = (row.images || []).map((image) => ({
    ...image,
    id: Number(image.id),
    url: absoluteMediaUrl(request, image.url?.replace(/^\/media\//, '') || ''),
  }));
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    location: row.location,
    administrative_location: row.administrative_location_id === null
      ? null
      : Number(row.administrative_location_id),
    location_name: row.location_name || '',
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
    status: row.status,
    service_type: row.service_type,
    public_contact_name: '',
    public_contact_phone: row.public_contact_phone,
    public_contact_email: row.public_contact_email,
    primary_image: row.primary_image ? absoluteMediaUrl(request, row.primary_image) : null,
    images,
    created_at: row.created_at,
    ...(detail ? {
      description: row.description,
      features: row.features,
      amenities: row.amenities || [],
      updated_at: row.updated_at,
    } : {}),
  };
}

function paginationUrl(request, page, pageSize) {
  const url = new URL(request.originalUrl, requestOrigin(request));
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(pageSize));
  return url.toString();
}

export async function listPublicProperties(pool, request, filters) {
  await validateLocationFilters(pool, filters);
  const { values, where } = propertyConditions(filters);
  const count = await pool.query(
    `${locationCte}
     SELECT COUNT(DISTINCT p.id)::integer AS count
     FROM user_property AS p
     WHERE ${where}`,
    values,
  );
  const total = count.rows[0]?.count ?? 0;
  const offset = (filters.page - 1) * filters.page_size;
  const rows = await pool.query(
    `${locationCte}
     SELECT ${propertySelection(false)}
     FROM user_property AS p
     ${propertyJoins(false)}
     WHERE ${where}
     ORDER BY ${orderBy(filters.ordering)}
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
    results: rows.rows.map((row) => serializeProperty(row, request, false)),
  };
}

export async function getPublicProperty(pool, request, slug) {
  const result = await pool.query(
    `${locationCte}
     SELECT ${propertySelection(true)}
     FROM user_property AS p
     ${propertyJoins(true)}
     WHERE p.slug = $1 AND ${publicEligibility}
     LIMIT 1`,
    [slug],
  );
  if (result.rowCount !== 1) throw new ApiError(404, 'Not found.');
  return serializeProperty(result.rows[0], request, true);
}

export async function listPublicAmenities(pool) {
  const result = await pool.query(
    'SELECT id, name, name_am, slug FROM properties_amenity ORDER BY name',
  );
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function publicPropertyTypes() {
  return [
    ['house', 'House'],
    ['villa', 'Villa'],
    ['apartment', 'Apartment'],
    ['condominium', 'Condominium'],
    ['land', 'Land'],
    ['office', 'Office'],
    ['shop', 'Shop'],
    ['warehouse', 'Warehouse'],
    ['commercial', 'Commercial'],
    ['other', 'Other'],
  ].map(([value, label]) => ({ value, label }));
}
