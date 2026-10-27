import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listManagedProperties } from '../src/services/managedPropertyService.js';
import { managedPropertyQuerySchema } from '../src/validators/managedProperties.js';

function managedPropertyRow() {
  return {
    id: '42',
    title: 'Sunny apartment',
    slug: 'sunny-apartment',
    location: 'Addis Ababa',
    administrative_location_id: '3',
    category: 'apartment',
    listing_type: 'rent',
    price: '12500.00',
    bedrooms: 2,
    bathrooms: 1,
    area_sqft: 850,
    area_value: '78.97',
    area_unit: 'sqm',
    rental_frequency: 'monthly',
    description: 'A managed property',
    features: 'Balcony',
    status: 'active',
    publication_status: 'published',
    is_featured: false,
    submitted_by_id: '7',
    moderation_note: '',
    contact_name: 'Agent',
    contact_phone: '',
    contact_email: '',
    location_path: [{ id: 3, name: 'Bole', name_am: 'ቦሌ', location_type: 'subcity' }],
    amenities: [2],
    images: [{
      id: '9',
      url: 'property_images/primary.jpg',
      caption: 'Living room',
      is_primary: true,
    }],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };
}

test('managed-property filters validate and apply an agent-owned listing scope', async () => {
  const calls = [];
  const pool = {
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
          }],
          rowCount: 1,
        };
      }
      if (text.includes('COUNT(*)::integer')) return { rows: [{ count: 27 }], rowCount: 1 };
      assert.match(text, /WITH RECURSIVE location_ancestor/);
      return { rows: [managedPropertyRow()], rowCount: 1 };
    },
  };
  const request = {
    originalUrl: '/api/v1/management/properties/?search=Bole',
    protocol: 'https',
    get: () => 'homes.example.test',
  };
  const filters = managedPropertyQuerySchema.parse({
    search: 'Bole% OR 1=1',
    status: 'available',
    page: '2',
    page_size: '12',
  });

  const result = await listManagedProperties(pool, request, 7, filters);

  assert.equal(calls.length, 3);
  assert.equal(calls[1].values[0], 7);
  assert.equal(calls[1].values.length, 4);
  assert.match(calls[1].text, /ESCAPE/);
  assert.ok(!calls.some(({ text }) => text.includes('Bole% OR 1=1')));
  assert.match(calls[1].text, /p\.status IN \('active', 'available'\)/);
  assert.match(calls[2].text, /p\.service_type = 'agent_managed' AND p\.submitted_by_id = \$1/);
  assert.deepEqual(calls[2].values.slice(-2), [12, 12]);
  assert.equal(result.count, 27);
  assert.ok(result.next?.includes('page=3'));
  assert.ok(result.previous?.includes('page=1'));
  assert.equal(result.results[0].status, 'available');
  assert.equal(result.results[0].administrative_location, 3);
  assert.equal(result.results[0].images[0].url, 'https://homes.example.test/media/property_images/primary.jpg');
  assert.deepEqual(result.results[0].amenities, [2]);
});

test('managed-property listing rejects users without management privileges', async () => {
  let listQueries = 0;
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
          }],
          rowCount: 1,
        };
      }
      listQueries += 1;
      return { rows: [], rowCount: 0 };
    },
  };
  const filters = managedPropertyQuerySchema.parse({});

  await assert.rejects(
    listManagedProperties(pool, {}, 7, filters),
    (error) => error.statusCode === 403,
  );
  assert.equal(listQueries, 0);
});

test('managed-property query rejects unsupported status filters', () => {
  assert.equal(managedPropertyQuerySchema.safeParse({ status: 'unknown' }).success, false);
  assert.equal(managedPropertyQuerySchema.safeParse({ page_size: '101' }).success, false);
});
