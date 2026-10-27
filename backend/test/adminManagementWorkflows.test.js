import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { adminManagementWorkflowsRouter } from '../src/routes/adminManagementWorkflows.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  homepageNotePatchSchema,
  managedPropertyPatchSchema,
} from '../src/validators/adminManagementWorkflows.js';

const token = 'api-parity-test-token';
const digest = createHash('sha256').update(token, 'utf8').digest('hex');
const csrf = 'same-origin-csrf-test-token';
let server;
let origin;
const transactionQueries = [];
const managedPropertyInsertQueries = [];
let managedPropertiesToDelete = [];
let propertyImagesToDelete = [];
let propertiesWithViewingRequests = [];
let mediaRoot;
let testAccountRole = 'platform-owner';
let publicPageRowsPresent = true;
const agentAccount = {
  id: 42,
  username: 'managed-agent',
  email: 'agent@example.test',
  first_name: 'Managed',
  last_name: 'Agent',
  is_active: true,
  is_staff: false,
  is_superuser: false,
  date_joined: '2026-01-01T00:00:00.000Z',
  role: 'agent',
  phone: '0911000000',
  assigned_city_id: 7,
  agent_approved: true,
  agent_onboarding_required: false,
  management_permissions: [],
};

const pool = {
  async query(sql, values = []) {
    if (sql.includes('FROM accounts_tabsessiontoken AS session')) {
      assert.equal(values[0], digest);
      return { rowCount: 1, rows: [{ session_id: 1, user_id: 3 }] };
    }
    if (sql.includes('FROM auth_user u LEFT JOIN accounts_profile p')) {
      return {
        rowCount: 1,
        rows: [{
          id: 3,
          username: 'workflow-admin',
          is_active: true,
          is_staff: !['agent', 'approved-agent', 'settings-manager'].includes(testAccountRole),
          is_superuser: testAccountRole === 'platform-owner',
          platform_owner_id: testAccountRole === 'platform-owner' ? 3 : null,
          role: ['agent', 'approved-agent', 'settings-manager'].includes(testAccountRole) ? 'agent' : 'administrator',
          agent_approved: ['approved-agent', 'settings-manager'].includes(testAccountRole),
          management_permissions: testAccountRole === 'settings-manager' ? ['settings.manage'] : [],
          assigned_city_id: testAccountRole === 'approved-agent' ? 7 : null,
        }],
      };
    }
    if (sql.includes('FROM auth_user u JOIN accounts_profile p')) {
      return { rowCount: 1, rows: [{ ...agentAccount }] };
    }
    if (sql.includes('SELECT id FROM auth_user WHERE lower(username)')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM properties_location')) {
      return { rowCount: 1, rows: [{ id: 7 }] };
    }
    if (sql.includes('SELECT phone FROM accounts_profile')) {
      return { rowCount: 1, rows: [{ phone: '0911000000' }] };
    }
    if (sql.includes('FROM user_propertyimage')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM portal_admin_publicinformationpage ORDER BY page')) {
      if (!publicPageRowsPresent) return { rowCount: 0, rows: [] };
      return {
        rowCount: 3,
        rows: ['about', 'contact', 'property-management'].map((page) => ({
          page,
          title_en: page,
          title_am: page,
          introduction_en: 'Introduction',
          introduction_am: 'መግቢያ',
          body_en: '',
          body_am: '',
          updated_at: '2026-01-01T00:00:00.000Z',
        })),
      };
    }
    if (sql.includes('FROM portal_admin_publicinformationpage WHERE page = $1')) {
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  },
  async connect() {
    return {
      async query(sql, values = []) {
        transactionQueries.push({ sql, values });
        if (sql.includes('SELECT id, title, service_type FROM user_property')) {
          const ids = new Set(values[0].map(Number));
          const rows = managedPropertiesToDelete.filter((row) => ids.has(row.id));
          return { rowCount: rows.length, rows };
        }
        if (sql.includes('SELECT DISTINCT property_id FROM user_viewingrequest')) {
          const ids = new Set(values[0].map(Number));
          const rows = propertiesWithViewingRequests
            .filter((id) => ids.has(id))
            .map((property_id) => ({ property_id }));
          return { rowCount: rows.length, rows };
        }
        if (sql.includes('SELECT id, image, original_image FROM user_propertyimage')) {
          const ids = new Set(values[0].map(Number));
          const rows = propertyImagesToDelete.filter((image) => ids.has(image.property_id));
          return { rowCount: rows.length, rows };
        }
        if (sql.includes('FROM auth_user AS u')) {
          return {
            rowCount: 1,
            rows: [{
              id: 3,
              username: 'workflow-admin',
              first_name: '',
              last_name: '',
              email: '',
              is_active: true,
              is_staff: true,
              is_superuser: false,
              role: 'administrator',
              phone: '0911000000',
              agent_approved: false,
              management_permissions: [],
              assigned_city_id: null,
            }],
          };
        }
        if (sql.includes('SELECT id FROM properties_location')) {
          return { rowCount: 1, rows: [{ id: 7 }] };
        }
        if (sql.includes('INSERT INTO user_property')) {
          managedPropertyInsertQueries.push({ sql, values });
          return {
            rowCount: 1,
            rows: [{
              id: 100,
              title: values[0],
              slug: values[1],
              location: values[2],
              administrative_location_id: values[3],
              property_type: values[4],
              listing_type: values[5],
              price: values[6],
              currency: values[7],
              rental_frequency: values[8],
              bedrooms: values[9],
              bathrooms: values[10],
              area_sqft: values[11],
              area_value: values[12],
              area_unit: values[13],
              description: values[14],
              features: values[15],
              status: values[16],
              publication_status: sql.includes("'published'") ? 'published' : 'pending_review',
              is_featured: false,
              submitted_by_id: 3,
              moderation_note: '',
              contact_name: values[18],
              contact_phone: values[19],
              contact_email: values[20],
            }],
          };
        }
        if (sql.includes('INSERT INTO portal_admin_publicinformationpage')) {
          return {
            rowCount: 1,
            rows: [{
              page: values[0],
              title_en: values[1],
              title_am: values[2],
              introduction_en: values[3],
              introduction_am: values[4],
              body_en: values[5],
              body_am: values[6],
              updated_at: '2026-10-23T00:00:00.000Z',
            }],
          };
        }
        if (sql.includes('FROM auth_user u JOIN accounts_profile p')) {
          return { rowCount: 1, rows: [{ ...agentAccount }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
  },
};

before(async () => {
  mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'infinity-house-property-delete-'));
  const mediaConfig = {
    publicRoot: path.join(mediaRoot, 'public'),
    privateRoot: path.join(mediaRoot, 'private'),
  };
  await Promise.all([
    mkdir(mediaConfig.publicRoot, { recursive: true }),
    mkdir(mediaConfig.privateRoot, { recursive: true }),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminManagementWorkflowsRouter({ pool, mediaConfig }));
  app.use(errorHandler({ logger: { error() {} } }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  try {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    await rm(mediaRoot, { recursive: true, force: true });
  }
});

test('management public pages list uses the authenticated workflow route', async () => {
  const response = await fetch(`${origin}/management/public-pages/`, {
    headers: { Authorization: ['Bearer', token].join(' ') },
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.count, 3);
  assert.deepEqual(data.results.map((page) => page.page), ['about', 'contact', 'property-management']);
});

test('management public pages list includes defaults when database rows are missing', async () => {
  publicPageRowsPresent = false;
  try {
    const response = await fetch(`${origin}/management/public-pages/`, {
      headers: { Authorization: ['Bearer', token].join(' ') },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.count, 3);
    assert.deepEqual(data.results.map((page) => page.page), ['about', 'contact', 'property-management']);
    assert.equal(data.results[0].title_en, 'About Infinity House');
  } finally {
    publicPageRowsPresent = true;
  }
});

test('management can load an individual page when its database row is missing', async () => {
  const response = await fetch(`${origin}/management/public-pages/about/`, {
    headers: { Authorization: ['Bearer', token].join(' ') },
  });
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.page, 'about');
  assert.equal(page.title_en, 'About Infinity House');
});

test('management can save a missing public page and create its initial database row', async () => {
  transactionQueries.length = 0;
  const response = await fetch(`${origin}/management/public-pages/contact/`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', token].join(' '),
      Cookie: `csrftoken=${csrf}`,
      'X-CSRFToken': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title_en: 'Contact our team' }),
  });
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.page, 'contact');
  assert.equal(page.title_en, 'Contact our team');
  assert.equal(page.introduction_en, 'Reach Infinity House using the contact options configured below.');
  const insert = transactionQueries.find(({ sql }) => sql.includes('INSERT INTO portal_admin_publicinformationpage'));
  assert.ok(insert);
  assert.match(insert.sql, /ON CONFLICT \(page\) DO UPDATE/);
  assert.deepEqual(insert.values.slice(0, 2), ['contact', 'Contact our team']);
  assert.equal(insert.values[3], 'Reach Infinity House using the contact options configured below.');
});

test('management public pages are available to administrators who are not platform owners', async () => {
  testAccountRole = 'administrator';
  try {
    const response = await fetch(`${origin}/management/public-pages/`, {
      headers: { Authorization: ['Bearer', token].join(' ') },
    });
    assert.equal(response.status, 200);
  } finally {
    testAccountRole = 'platform-owner';
  }
});

test('management public pages are available to approved platform managers', async () => {
  testAccountRole = 'settings-manager';
  try {
    const response = await fetch(`${origin}/management/public-pages/`, {
      headers: { Authorization: ['Bearer', token].join(' ') },
    });
    assert.equal(response.status, 200);
  } finally {
    testAccountRole = 'platform-owner';
  }
});

test('management public pages reject agents', async () => {
  testAccountRole = 'agent';
  try {
    const response = await fetch(`${origin}/management/public-pages/`, {
      headers: { Authorization: ['Bearer', token].join(' ') },
    });
    assert.equal(response.status, 403);
  } finally {
    testAccountRole = 'platform-owner';
  }
});

test('admin-created managed properties are published immediately with private defaults', async () => {
  managedPropertyInsertQueries.length = 0;
  const response = await fetch(`${origin}/management/properties/`, {
    method: 'POST',
    headers: {
      Authorization: ['Bearer', token].join(' '),
      Cookie: `csrftoken=${csrf}`,
      'X-CSRFToken': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Regression property',
      location: 'Addis Ababa',
      administrative_location: 7,
      category: 'house',
      listing_type: 'sale',
      price: '100000',
      currency: 'USD',
      contact_name: 'Property contact',
    }),
  });

  assert.equal(response.status, 201);
  const property = await response.json();
  assert.equal(property.publication_status, 'published');
  assert.equal(property.currency, 'USD');
  const insert = managedPropertyInsertQueries[0];
  assert.ok(insert);
  assert.equal(insert.values[7], 'USD');
  assert.match(insert.sql, /'published',\s*'agent_managed'/);
  assert.match(insert.sql, /advertising_authorized,\s*contact_publicly_visible,\s*exact_location_is_public/);
  assert.match(insert.sql, /'agent_managed',FALSE,\$18,'',FALSE,FALSE,FALSE,\$19/);
});

test('agent-created managed properties remain pending administrator review', async () => {
  testAccountRole = 'approved-agent';
  managedPropertyInsertQueries.length = 0;
  try {
    const response = await fetch(`${origin}/management/properties/`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', token].join(' '),
        Cookie: `csrftoken=${csrf}`,
        'X-CSRFToken': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Agent regression property',
        location: 'Addis Ababa',
        administrative_location: 7,
        category: 'house',
        listing_type: 'sale',
        price: '100000',
        contact_name: 'Property contact',
      }),
    });

    assert.equal(response.status, 201);
    const property = await response.json();
    assert.equal(property.publication_status, 'pending_review');
    const insert = managedPropertyInsertQueries[0];
    assert.ok(insert);
    assert.match(insert.sql, /'pending_review',\s*'agent_managed'/);
  } finally {
    testAccountRole = 'platform-owner';
  }
});

test('admin bulk deletion removes property associations and preserves listing reports', async () => {
  transactionQueries.length = 0;
  managedPropertiesToDelete = [{ id: 103, title: 'Published property', service_type: 'agent_managed' }];
  propertyImagesToDelete = [{
    id: 501,
    property_id: 103,
    image: 'property_images/published.jpg',
    original_image: 'private_property_images/published.jpg',
  }];
  propertiesWithViewingRequests = [];
  try {
    const publicImage = path.join(mediaRoot, 'public', propertyImagesToDelete[0].image);
    const privateImage = path.join(mediaRoot, 'private', propertyImagesToDelete[0].original_image);
    await Promise.all([
      mkdir(path.dirname(publicImage), { recursive: true }),
      mkdir(path.dirname(privateImage), { recursive: true }),
    ]);
    await Promise.all([writeFile(publicImage, 'public image'), writeFile(privateImage, 'private image')]);
    const response = await fetch(`${origin}/management/properties/bulk-delete/`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', token].join(' '),
        Cookie: `csrftoken=${csrf}`,
        'X-CSRFToken': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [103] }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted_count: 1 });
    const sql = transactionQueries.map(({ sql: query }) => query);
    assert.ok(sql.some((query) => query.includes('UPDATE properties_listingreport SET property_id = NULL')));
    assert.ok(sql.some((query) => query.includes('DELETE FROM favorites_favorite')));
    assert.ok(sql.some((query) => query.includes('DELETE FROM properties_propertyagentassignment')));
    assert.ok(sql.some((query) => query.includes('DELETE FROM user_property_amenities')));
    assert.ok(sql.some((query) => query.includes('DELETE FROM user_propertyimage')));
    assert.ok(sql.some((query) => query.includes('DELETE FROM user_property WHERE id = ANY')));
    await assert.rejects(stat(publicImage), { code: 'ENOENT' });
    await assert.rejects(stat(privateImage), { code: 'ENOENT' });
  } finally {
    managedPropertiesToDelete = [];
    propertyImagesToDelete = [];
    propertiesWithViewingRequests = [];
  }
});

test('admin cannot permanently delete listings with viewing history', async () => {
  transactionQueries.length = 0;
  managedPropertiesToDelete = [{ id: 104, title: 'Property with viewings', service_type: 'agent_managed' }];
  propertyImagesToDelete = [];
  propertiesWithViewingRequests = [104];
  try {
    const response = await fetch(`${origin}/management/properties/bulk-delete/`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', token].join(' '),
        Cookie: `csrftoken=${csrf}`,
        'X-CSRFToken': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [104] }),
    });

    assert.equal(response.status, 409);
    assert.match((await response.json()).error.message, /viewing requests/i);
    assert.equal(
      transactionQueries.some(({ sql }) => sql.includes('DELETE FROM user_property WHERE id = ANY')),
      false,
    );
  } finally {
    managedPropertiesToDelete = [];
    propertyImagesToDelete = [];
    propertiesWithViewingRequests = [];
  }
});

test('management homepage note creation rejects invalid content before database writes', async () => {
  const response = await fetch(`${origin}/management/homepage-notes/`, {
    method: 'POST',
    headers: {
      Authorization: ['Bearer', token].join(' '),
      Cookie: `csrftoken=${csrf}`,
      'X-CSRFToken': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: '  ' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /validation/i);
});

test('saving a managed agent serializes management permissions as JSONB', async () => {
  transactionQueries.length = 0;
  const response = await fetch(`${origin}/admin/delegated-accounts/42/`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', token].join(' '),
      Cookie: `csrftoken=${csrf}`,
      'X-CSRFToken': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: 'managed-agent',
      email: 'agent@example.test',
      first_name: 'Managed',
      last_name: 'Agent',
      phone: '0911000000',
      is_active: true,
      assigned_city_id: 7,
      management_permissions: ['announcements.review_assigned'],
    }),
  });

  assert.equal(response.status, 200);
  const profileUpdate = transactionQueries.find(({ sql }) =>
    sql.includes('UPDATE accounts_profile SET') && sql.includes('management_permissions ='));
  assert.ok(profileUpdate);
  assert.match(profileUpdate.sql, /management_permissions = \$3::jsonb/);
  assert.equal(profileUpdate.values[2], '["announcements.review_assigned"]');
});

test('admin management workflow router requires an authenticated account', async () => {
  const response = await fetch(`${origin}/management/public-pages/`);
  assert.equal(response.status, 401);
});

test('partial update schemas preserve omitted fields and reject unsupported fields', () => {
  assert.deepEqual(managedPropertyPatchSchema.parse({ status: 'inactive' }), { status: 'inactive' });
  assert.deepEqual(managedPropertyPatchSchema.parse({ currency: 'USD' }), { currency: 'USD' });
  assert.equal(managedPropertyPatchSchema.safeParse({ currency: 'CAD' }).success, false);
  assert.deepEqual(homepageNotePatchSchema.parse({ title: 'Updated' }), { title: 'Updated' });
  assert.equal(managedPropertyPatchSchema.safeParse({ is_featured: true }).success, false);
});
