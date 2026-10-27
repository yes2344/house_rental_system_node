import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { test } from 'node:test';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { siteWorkflowsRouter } from '../src/routes/siteWorkflows.js';
import {
  createFavorite,
  createListingReport,
  createManagedLocation,
  deleteManagedLocation,
  deleteFavorite,
  getBrokerageContact,
  getManagedLocation,
  getPublicInformationPage,
  listFavorites,
  listHomepageNotes,
  listManagedLocations,
  listPublicLocations,
  patchBrokerageContact,
  updateManagedLocation,
} from '../src/services/siteWorkflowService.js';
import {
  brokerageContactPatchSchema,
  favoriteCreateSchema,
  listingReportSchema,
  locationPatchSchema,
  locationWriteSchema,
} from '../src/validators/siteWorkflows.js';

test('public information pages return editable defaults when their database row is missing', async () => {
  const pool = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };

  const page = await getPublicInformationPage(pool, 'about');
  assert.equal(page.page, 'about');
  assert.equal(page.title_en, 'About Infinity House');
  assert.equal(page.body_en, '');
  assert.equal(page.updated_at, null);
  await assert.rejects(
    getPublicInformationPage(pool, 'unknown'),
    (error) => error.statusCode === 404,
  );
});

function locationRow() {
  return {
    id: '12',
    name: 'Bole',
    name_am: 'ቦሌ',
    aliases_en: ['Bole'],
    aliases_am: [],
    slug: 'bole',
    location_type: 'subcity',
    parent_id: '3',
    city_id: '3',
    is_active: true,
    display_order: 0,
  };
}

function publicPropertyRow() {
  return {
    id: '19',
    title: 'Sunny home',
    slug: 'sunny-home',
    location: 'Addis Ababa',
    administrative_location_id: null,
    location_name: '',
    category: 'house',
    listing_type: 'sale',
    price: '1000.00',
    bedrooms: 2,
    bathrooms: 1,
    area_sqft: 500,
    area_value: '46.45',
    area_unit: 'sqm',
    rental_frequency: null,
    status: 'available',
    service_type: 'agent_managed',
    public_contact_phone: '',
    public_contact_email: '',
    primary_image: null,
    images: [],
    location_path: [],
    created_at: '2026-10-22T00:00:00.000Z',
    description: 'Description',
    features: 'Features',
    amenities: [],
    updated_at: '2026-10-22T00:00:00.000Z',
  };
}

function administratorRow() {
  return {
    is_active: true,
    is_staff: true,
    is_superuser: false,
    role: 'administrator',
  };
}

function startRouter(pool, mediaConfig) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', siteWorkflowsRouter({ pool, mediaConfig }));
  app.use(errorHandler({ logger: { error() {} } }));
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => {
    server.once('listening', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('workflow validators preserve required fields, choices, bounds, and strict payloads', () => {
  assert.equal(favoriteCreateSchema.safeParse({ property_id: '8' }).success, true);
  assert.equal(favoriteCreateSchema.safeParse({ property_id: 0 }).success, false);
  assert.equal(listingReportSchema.safeParse({
    property_id: 8,
    reporter_name: '  Ada  ',
    reporter_email: 'ada@example.test',
    reason: 'fraud',
  }).data.reporter_name, 'Ada');
  assert.equal(listingReportSchema.safeParse({
    property_id: 8,
    reporter_name: 'Ada',
    reporter_email: 'invalid',
    reason: 'other',
  }).success, false);
  assert.equal(locationWriteSchema.safeParse({
    name: 'New City',
    location_type: 'city',
    unexpected: true,
  }).success, false);
  assert.equal(locationPatchSchema.safeParse({ display_order: -1 }).success, false);
});

test('brokerage PATCH validation follows frontend payload fields and nested social-link rules', () => {
  assert.equal(brokerageContactPatchSchema.safeParse({
    business_name: 'Brokerage',
    phone: '+251900000000',
    email: 'contact@example.test',
    footer_copyright: '© Brokerage',
    social_links: [{
      platform: 'instagram',
      url: 'https://example.test/profile',
      is_enabled: true,
      display_order: 0,
    }],
  }).success, true);
  assert.deepEqual(
    brokerageContactPatchSchema.parse({
      site_name: '  New Website  ',
      clear_site_logo: 'true',
      clear_homepage_hero_image: 'false',
    }),
    {
      site_name: 'New Website',
      clear_site_logo: true,
      clear_homepage_hero_image: false,
    },
  );
  assert.equal(brokerageContactPatchSchema.safeParse({ unexpected: 'field' }).success, false);
  assert.equal(brokerageContactPatchSchema.safeParse({
    social_links: [
      { platform: 'facebook', url: 'https://example.test/a' },
      { platform: 'facebook', url: 'https://example.test/b' },
    ],
  }).success, false);
  assert.equal(brokerageContactPatchSchema.safeParse({
    social_links: [{ platform: 'x', url: 'http://example.test/profile' }],
  }).success, false);
});

test('public locations use parameterized search and return the Django location shape', async () => {
  const calls = [];
  const results = await listPublicLocations({
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes('SELECT id, parent_id, name')) {
        return {
          rows: [
            {
              id: '12',
              parent_id: '3',
              name: 'Bole',
              name_am: 'ቦሌ',
              aliases_en: ['Bole'],
              aliases_am: [],
            },
            {
              id: '13',
              parent_id: '12',
              name: 'Bole Michael',
              name_am: '',
              aliases_en: [],
              aliases_am: [],
            },
          ],
          rowCount: 2,
        };
      }
      return { rows: [locationRow()], rowCount: 1 };
    },
  }, { search: "Bole' --" });

  assert.deepEqual(results, [{
    id: 12,
    name: 'Bole',
    name_am: 'ቦሌ',
    aliases_en: ['Bole'],
    aliases_am: [],
    slug: 'bole',
    location_type: 'subcity',
    parent_id: 3,
    city_id: 3,
    is_active: true,
    display_order: 0,
  }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].values.length, 1);
  assert.deepEqual(calls[1].values[0], ['12', '13']);
  assert.ok(!calls.some(({ text }) => text.includes("Bole%' OR TRUE")));
});

test('public location type filters include nested locations when all locations are requested', async () => {
  let query;
  const city = {
    ...locationRow(),
    id: '3',
    name: 'Addis Ababa',
    location_type: 'city',
    parent_id: '2',
    city_id: '3',
  };
  const results = await listPublicLocations({
    async query(text, values) {
      query = { text, values };
      return { rows: [city], rowCount: 1 };
    },
  }, { all: '1', types: 'city' });

  assert.equal(results[0].name, 'Addis Ababa');
  assert.match(query.text, /location\.location_type = ANY\(\$1::varchar\[\]\)/);
  assert.doesNotMatch(query.text, /location\.parent_id IS NULL/);
  assert.deepEqual(query.values, [['city']]);
});

test('public city type filters include registered cities nested under parent locations', async () => {
  let query;
  const city = {
    ...locationRow(),
    id: '3',
    name: 'Addis Ababa',
    location_type: 'city',
    parent_id: '2',
    city_id: '3',
  };
  const results = await listPublicLocations({
    async query(text, values) {
      query = { text, values };
      return { rows: [city], rowCount: 1 };
    },
  }, { types: 'city,city_administration' });

  assert.equal(results[0].name, 'Addis Ababa');
  assert.match(query.text, /location\.location_type = ANY\(\$1::varchar\[\]\)/);
  assert.doesNotMatch(query.text, /location\.parent_id IS NULL/);
  assert.deepEqual(query.values, [['city', 'city_administration']]);
});

test('brokerage PATCH denies active customers without settings permissions', async () => {
  const denied = {
    async query(text) {
      assert.match(text, /effective_platform_owner_id/);
      return {
        rows: [{
          is_active: true,
          is_staff: false,
          is_superuser: false,
          role: 'customer',
          agent_approved: false,
          effective_platform_owner_id: '8',
        }],
        rowCount: 1,
      };
    },
  };
  await assert.rejects(
    patchBrokerageContact(denied, {}, 7, { business_name: 'No access' }),
    (error) => error.statusCode === 403,
  );
});

test('non-owner superuser brokerage PATCH persists fields and returns serializer shape', async () => {
  const calls = [];
  const responseRow = {
    site_name: 'Infinity House',
    footer_copyright: '© Brokerage',
    site_logo: '',
    homepage_hero_image: '',
    business_name: 'Brokerage',
    phone: '+251900000000',
    whatsapp_url: 'https://example.test/wa',
    telegram_url: '',
    email: 'contact@example.test',
    facebook_url: '',
    instagram_url: 'https://example.test/profile',
    tiktok_url: '',
    youtube_url: '',
    linkedin_url: '',
  };
  const pool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('effective_platform_owner_id')) {
        return {
          rows: [{
            is_active: true,
            is_staff: false,
            is_superuser: true,
            role: null,
            agent_approved: false,
            effective_platform_owner_id: '8',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM portal_admin_brokeragesettings WHERE id = 1')) {
        return { rows: [responseRow], rowCount: 1 };
      }
      if (text.includes('FROM portal_admin_socialmedialink')) {
        return {
          rows: [{
            platform: 'instagram',
            url: 'https://example.test/profile',
            is_enabled: true,
            display_order: 0,
          }],
          rowCount: 1,
        };
      }
      assert.fail(`Unexpected pool query: ${text}`);
    },
    async connect() {
      return {
        async query(text, values = []) {
          calls.push({ text, values });
          if (text.includes('SELECT platform_owner_id FROM portal_admin_brokeragesettings')) {
            return { rows: [{ platform_owner_id: 7 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const data = {
    business_name: 'Brokerage',
    phone: '+251900000000',
    email: 'contact@example.test',
    footer_copyright: '© Brokerage',
    social_links: [{
      platform: 'instagram',
      url: 'https://example.test/profile',
      is_enabled: true,
      display_order: 0,
    }],
  };

  const result = await patchBrokerageContact(
    pool,
    { protocol: 'https', get: () => 'homes.example.test' },
    7,
    data,
  );

  assert.equal(result.business_name, 'Brokerage');
  assert.equal(result.instagram_url, 'https://example.test/profile');
  assert.deepEqual(result.social_links[0], data.social_links[0]);
  assert.ok(calls.some(({ text, values }) => text.includes('UPDATE portal_admin_brokeragesettings')
    && values.includes('Brokerage')));
  assert.ok(calls.some(({ text, values }) => text.includes('INSERT INTO portal_admin_socialmedialink')
    && values[0] === 'instagram'));
  assert.ok(calls.some(({ text }) => text === 'COMMIT'));
});

test('homepage notes and brokerage contact expose only their public serializer fields', async () => {
  let callCount = 0;
  const pool = {
    async query(text) {
      callCount += 1;
      if (text.includes('portal_admin_homepagenote')) {
        return {
          rows: [{
            id: '4',
            title: 'Update',
            text: 'Public note',
            image: 'notes/update.jpg',
            is_published: true,
            display_order: 2,
            created_at: '2026-10-22T00:00:00.000Z',
            updated_at: '2026-10-22T00:00:00.000Z',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('portal_admin_brokeragesettings')) {
        return {
          rows: [{
            site_name: 'Habesha Home Center',
            footer_copyright: '© public',
            site_logo: '',
            homepage_hero_image: 'site-branding/hero.webp',
            business_name: 'Brokerage',
            phone: '555-0100',
            email: 'contact@example.test',
          }],
          rowCount: 1,
        };
      }
      return {
        rows: [{
          platform: 'instagram',
          url: 'https://example.test/profile',
          is_enabled: true,
          display_order: 1,
        }],
        rowCount: 1,
      };
    },
  };
  const request = { protocol: 'https', get: () => 'homes.example.test' };
  const notes = await listHomepageNotes(pool, request);
  const contact = await getBrokerageContact(pool, request);

  assert.deepEqual(Object.keys(notes), ['count', 'next', 'previous', 'results']);
  assert.equal(notes.count, 1);
  assert.equal(notes.next, null);
  assert.equal(notes.previous, null);
  assert.equal(notes.results[0].image, 'https://homes.example.test/media/notes/update.jpg');
  assert.equal(notes.results[0].id, 4);
  assert.equal(contact.site_name, 'Infinity House');
  assert.equal(contact.homepage_hero_image, 'https://homes.example.test/media/site-branding/hero.webp');
  assert.deepEqual(contact.social_links, [{
    platform: 'instagram',
    url: 'https://example.test/profile',
    is_enabled: true,
    display_order: 1,
  }]);
  assert.equal(callCount, 3);
});

test('brokerage media URLs use HTTPS when TLS terminates at the hosting proxy', async () => {
  const pool = {
    async query(text) {
      if (text.includes('portal_admin_brokeragesettings')) {
        return {
          rows: [{
            site_name: 'Infinity House',
            footer_copyright: '',
            site_logo: 'site-branding/logo.webp',
            homepage_hero_image: 'site-branding/hero.webp',
            business_name: '',
            phone: '',
            email: '',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const request = {
    protocol: 'http',
    get: (name) => name === 'x-forwarded-proto' ? 'https' : 'infinityhouseproperty.com',
  };

  const contact = await getBrokerageContact(pool, request);

  assert.equal(
    contact.site_logo,
    'https://infinityhouseproperty.com/media/site-branding/logo.webp',
  );
  assert.equal(
    contact.homepage_hero_image,
    'https://infinityhouseproperty.com/media/site-branding/hero.webp',
  );
});

test('report creation checks public eligibility and persists only parameterized input', async () => {
  const calls = [];
  const pool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('FROM user_property AS p')) {
        return { rows: [{ id: '19', title: 'Sunny home' }], rowCount: 1 };
      }
      return {
        rows: [{ id: '51', status: 'pending', created_at: '2026-10-22T00:00:00.000Z' }],
        rowCount: 1,
      };
    },
  };
  const report = await createListingReport(pool, {
    property_id: 19,
    reporter_name: "R'; SELECT pg_sleep(10);--",
    reporter_email: 'reporter@example.test',
    reason: 'inaccurate',
    details: 'Please review',
  });

  assert.equal(report.id, 51);
  assert.equal(report.status, 'pending');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].values[0], 19);
  assert.equal(calls[1].values[1], "R'; SELECT pg_sleep(10);--");
  assert.ok(!calls.some(({ text }) => text.includes('pg_sleep')));
  assert.match(calls[0].text, /publication_status = 'published'/);
  assert.match(calls[1].text, /RETURNING id, status, created_at/);
});

test('favorite deletion is scoped to the authenticated user and property', async () => {
  let call;
  await deleteFavorite({
    async query(text, values) {
      call = { text, values };
      return { rowCount: 1, rows: [] };
    },
  }, 7, 19);
  assert.match(call.text, /WHERE user_id = \$1 AND property_id = \$2/);
  assert.deepEqual(call.values, [7, 19]);
});

test('favorite creation is idempotent and favorites return the public property list shape', async () => {
  const queries = [];
  const pool = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes('WITH RECURSIVE location_ancestor')) {
        return { rows: [publicPropertyRow()], rowCount: 1 };
      }
      if (text.includes('FROM user_property AS p')) {
        return { rows: [{ id: '19', slug: 'sunny-home' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO favorites_favorite')) {
        return { rows: [{ id: '22', created_at: '2026-10-22T00:00:00.000Z' }], rowCount: 1 };
      }
      if (text.includes('FROM favorites_favorite AS favorite')) {
        return {
          rows: [{
            id: '22',
            property_id: '19',
            created_at: '2026-10-22T00:00:00.000Z',
            slug: 'sunny-home',
          }],
          rowCount: 1,
        };
      }
      assert.fail(`Unexpected query: ${text}`);
    },
  };
  const request = { protocol: 'https', get: () => 'homes.example.test' };
  const created = await createFavorite(pool, request, 7, 19);
  const listed = await listFavorites(pool, request, 7);

  assert.equal(created.id, 22);
  assert.match(queries.find(({ text }) => text.includes('INSERT INTO favorites_favorite')).text, /ON CONFLICT/);
  assert.deepEqual(Object.keys(listed), ['count', 'next', 'previous', 'results']);
  assert.equal(listed.count, 1);
  assert.equal(listed.next, null);
  assert.equal(listed.previous, null);
  assert.equal(listed.results.length, 1);
  assert.equal(listed.results[0].property.title, 'Sunny home');
  assert.equal('description' in listed.results[0].property, false);
  assert.equal('amenities' in listed.results[0].property, false);
  assert.ok(queries.every(({ values }) => values.length > 0));
});

test('management location queries verify permission before listing any locations', async () => {
  let listingQueries = 0;
  const pool = {
    async query(text) {
      if (text.includes('FROM auth_user AS account')) {
        return {
          rows: [{
            is_active: true,
            is_staff: false,
            is_superuser: false,
            role: 'agent',
            agent_approved: false,
            management_permissions: [],
            assigned_city_id: '3',
          }],
          rowCount: 1,
        };
      }
      listingQueries += 1;
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(
    listManagedLocations(pool, 7, { all: '1' }),
    (error) => error.statusCode === 403,
  );
  assert.equal(listingQueries, 0);
});

test('approved agents receive assigned-city location access without a separate grant', async () => {
  const calls = [];
  const locations = await listManagedLocations({
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('FROM auth_user AS account')) {
        return {
          rows: [{
            is_active: true,
            is_staff: false,
            is_superuser: false,
            role: 'agent',
            agent_approved: true,
            assigned_city_id: '3',
          }],
          rowCount: 1,
        };
      }
      return { rows: [locationRow()], rowCount: 1 };
    },
  }, 7, { all: '1' });

  assert.equal(locations[0].id, 12);
  assert.ok(calls[1].text.includes('WITH RECURSIVE allowed_location'));
  assert.deepEqual(calls[1].values, [3]);
});

test('management location create, item read, patch, and delete enforce scope and persist by id', async () => {
  const calls = [];
  const pool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('FROM auth_user AS account')) {
        return { rows: [administratorRow()], rowCount: 1 };
      }
      if (text.includes("location_type = 'country'")) {
        return { rows: [{ id: '1' }], rowCount: 1 };
      }
      if (text.includes('SELECT id, is_active, location_type FROM properties_location')) {
        return { rows: [{ id: '1', is_active: true, location_type: 'country' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO properties_location')) {
        return { rows: [{ id: '12' }], rowCount: 1 };
      }
      if (text.includes('SELECT location.id FROM properties_location AS location')) {
        return { rows: [{ id: '12' }], rowCount: 1 };
      }
      if (text.includes('LEFT JOIN LATERAL')) {
        return { rows: [locationRow()], rowCount: 1 };
      }
      if (text.includes('SELECT id, name, name_am, is_active, display_order')) {
        return {
          rows: [{
            id: '12',
            name: 'Bole',
            name_am: 'ቦሌ',
            is_active: true,
            display_order: 0,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('WITH RECURSIVE descendants')) {
        return { rows: [{ has_active_descendants: false }], rowCount: 1 };
      }
      if (text.includes('UPDATE properties_location')) return { rows: [], rowCount: 1 };
      assert.fail(`Unexpected query: ${text}`);
    },
  };

  const created = await createManagedLocation(pool, 7, {
    name: 'Bole',
    location_type: 'city',
  });
  assert.equal(created.id, 12);
  assert.equal((await getManagedLocation(pool, 7, 12)).name, 'Bole');
  assert.equal((await updateManagedLocation(pool, 7, 12, { name: 'Bole Updated' })).name, 'Bole');
  await deleteManagedLocation(pool, 7, 12);

  const insert = calls.find(({ text }) => text.includes('INSERT INTO properties_location'));
  assert.equal(insert.values[2], 'bole');
  const update = calls.find(({ text }) => text.includes('UPDATE properties_location'));
  assert.deepEqual(update.values, [12, 'Bole Updated', 'ቦሌ', true, 0]);
  assert.ok(calls.filter(({ text }) => text.includes('FROM auth_user AS account')).length >= 4);
  assert.ok(calls.some(({ text }) =>
    text.includes('UPDATE properties_location SET is_active = FALSE WHERE id = $1')));
});

test('dedicated router exposes the public information endpoint and protects management routes', async () => {
  const token = 'test-session-token';
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  const pool = {
    async query(text, values = []) {
      if (text.includes('FROM accounts_tabsessiontoken AS session')) {
        assert.equal(values[0], digest);
        return { rows: [{ session_id: 1, user_id: 7 }], rowCount: 1 };
      }
      if (text.includes('portal_admin_publicinformationpage')) {
        return {
          rows: [{
            page: 'about',
            title_en: 'About',
            title_am: 'ስለ',
            introduction_en: '',
            introduction_am: '',
            body_en: 'Content',
            body_am: '',
            updated_at: '2026-10-22T00:00:00.000Z',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM auth_user AS account')) {
        return {
          rows: [{
            is_active: true,
            is_staff: false,
            is_superuser: false,
            role: 'customer',
            agent_approved: false,
            management_permissions: [],
            assigned_city_id: null,
          }],
          rowCount: 1,
        };
      }
      assert.fail(`Unexpected query: ${text}`);
    },
  };
  const server = await startRouter(pool);
  try {
    const publicResponse = await fetch(`${server.baseUrl}/public-pages/about/`);
    assert.equal(publicResponse.status, 200);
    assert.equal((await publicResponse.json()).body_en, 'Content');

    const denied = await fetch(`${server.baseUrl}/management/locations/`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(denied.status, 403);

    const unauthenticated = await fetch(`${server.baseUrl}/favorites/`);
    assert.equal(unauthenticated.status, 401);
  } finally {
    await server.close();
  }
});

test('brokerage contact PATCH is mounted behind bearer authentication and returns updated settings', async () => {
  const token = 'brokerage-patch-token';
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  const brandingUpdates = [];
  const mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'site-branding-test-'));
  const pool = {
    async query(text, values = []) {
      if (text.includes('FROM accounts_tabsessiontoken AS session')) {
        assert.equal(values[0], digest);
        return { rows: [{ session_id: 1, user_id: 7 }], rowCount: 1 };
      }
      if (text.includes('effective_platform_owner_id')) {
        return {
          rows: [{
            is_active: true,
            is_superuser: true,
            role: 'administrator',
            agent_approved: false,
            effective_platform_owner_id: '7',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM portal_admin_brokeragesettings WHERE id = 1')) {
        return {
          rows: [{
            site_name: 'Infinity House',
            footer_copyright: '',
            site_logo: '',
            homepage_hero_image: '',
            business_name: 'Updated Brokerage',
            phone: '',
            whatsapp_url: '',
            telegram_url: '',
            email: '',
            facebook_url: '',
            instagram_url: '',
            tiktok_url: '',
            youtube_url: '',
            linkedin_url: '',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM portal_admin_socialmedialink')) {
        return { rows: [], rowCount: 0 };
      }
      assert.fail(`Unexpected query: ${text}`);
    },
    async connect() {
      return {
        async query(text, values = []) {
          if (text.includes('SELECT platform_owner_id FROM portal_admin_brokeragesettings')) {
            return { rows: [{ platform_owner_id: 7 }], rowCount: 1 };
          }
          if (text.includes('UPDATE portal_admin_brokeragesettings')) {
            brandingUpdates.push({ text, values });
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const server = await startRouter(pool, { publicRoot: mediaRoot });
  try {
    const response = await fetch(`${server.baseUrl}/brokerage/contact/`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ business_name: 'Updated Brokerage' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).business_name, 'Updated Brokerage');

    const branding = new FormData();
    branding.append('site_name', 'New Website Name');
    const logoBuffer = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#345678',
      },
    }).png().toBuffer();
    branding.append('site_logo', new Blob([logoBuffer], { type: 'image/png' }), 'logo.png');
    const brandingResponse = await fetch(`${server.baseUrl}/brokerage/contact/`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: branding,
    });
    assert.equal(brandingResponse.status, 200);
    assert.ok(brandingUpdates.some(({ text, values }) =>
      text.includes('SET site_name = $1') && values.includes('New Website Name')));
    const storedLogo = brandingUpdates
      .flatMap(({ values }) => values)
      .find((value) => typeof value === 'string' && /^site-branding\/[a-f\d-]+\.png$/.test(value));
    assert.ok(storedLogo);
    await access(path.join(mediaRoot, storedLogo));

    const denied = await fetch(`${server.baseUrl}/brokerage/contact/`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business_name: 'No access' }),
    });
    assert.equal(denied.status, 401);
  } finally {
    await server.close();
    await rm(mediaRoot, { recursive: true, force: true });
  }
});
