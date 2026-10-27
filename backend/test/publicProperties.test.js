import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPublicProperty, listPublicProperties } from '../src/services/publicPropertyService.js';
import { publicPropertyQuerySchema } from '../src/validators/publicProperties.js';

function propertyRow() {
  return {
    id: '42',
    title: 'Sunny apartment',
    slug: 'sunny-apartment',
    location: 'Addis Ababa',
    administrative_location_id: '3',
    location_name: 'Bole',
    category: 'apartment',
    listing_type: 'rent',
    currency: 'USD',
    price: '12500.00',
    bedrooms: 2,
    bathrooms: 1,
    area_sqft: 850,
    area_value: '78.97',
    area_unit: 'sqm',
    rental_frequency: 'monthly',
    status: 'available',
    service_type: 'agent_managed',
    public_contact_phone: '',
    public_contact_email: '',
    images: [{
      id: '9',
      url: '/media/property_images/primary.jpg',
      caption: 'Living room',
      is_primary: true,
    }],
    primary_image: 'property_images/primary.jpg',
    location_path: [{
      id: 3,
      name: 'Bole',
      name_am: 'ቦሌ',
      location_type: 'subcity',
    }],
    created_at: '2026-01-01T00:00:00.000Z',
    description: 'A real property record',
    features: 'Balcony',
    updated_at: '2026-01-02T00:00:00.000Z',
    amenities: [{ id: 2, name: 'Balcony', name_am: 'በረንዳ', slug: 'balcony' }],
  };
}

test('public property filters are bounded and reject invalid sort or ranges', () => {
  assert.equal(publicPropertyQuerySchema.parse({}).page_size, 12);
  assert.equal(publicPropertyQuerySchema.safeParse({ ordering: 'random' }).success, false);
  assert.equal(publicPropertyQuerySchema.safeParse({
    min_price: '100',
    max_price: '10',
  }).success, false);
  assert.equal(publicPropertyQuerySchema.safeParse({ page_size: '101' }).success, false);
});

test('public listing search parameterizes search, filters, and pagination', async () => {
  const calls = [];
  const pool = {
    query: async (text, values = []) => {
      calls.push({ text, values });
      if (text.includes('COUNT(DISTINCT p.id)')) return { rows: [{ count: 27 }], rowCount: 1 };
      return { rows: [propertyRow()], rowCount: 1 };
    },
  };
  const request = {
    originalUrl: '/api/v1/properties/?search=rent%20in%20Bole',
    protocol: 'http',
    get: () => 'localhost:3000',
  };
  const filters = publicPropertyQuerySchema.parse({
    search: 'Bole; DROP TABLE auth_user',
    listing_type: 'rent',
    min_price: '100',
    ordering: 'price',
    page: '2',
    page_size: '12',
  });

  const result = await listPublicProperties(pool, request, filters);

  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ text }) => !text.includes('DROP TABLE')));
  assert.ok(calls.some(({ values }) => values.includes('%Bole;%')));
  assert.equal(result.count, 27);
  assert.equal(result.results[0].id, 42);
  assert.equal(result.results[0].currency, 'USD');
  assert.equal(result.results[0].primary_image, 'http://localhost:3000/media/property_images/primary.jpg');
  assert.equal(result.results[0].public_contact_email, '');
  assert.ok(result.next?.includes('page=3'));
  assert.ok(result.previous?.includes('page=1'));
});

test('public property detail hides unpublished or unavailable records and maps details', async () => {
  const pool = {
    query: async (_text, values) => {
      assert.deepEqual(values, ['sunny-apartment']);
      return { rows: [propertyRow()], rowCount: 1 };
    },
  };
  const request = { protocol: 'https', get: () => 'homes.example.test' };

  const result = await getPublicProperty(pool, request, 'sunny-apartment');

  assert.equal(result.description, 'A real property record');
  assert.equal(result.amenities[0].slug, 'balcony');
  assert.equal(result.primary_image, 'https://homes.example.test/media/property_images/primary.jpg');
  assert.equal(result.images[0].url, result.primary_image);
});

test('public property detail returns 404 when the record is not public', async () => {
  await assert.rejects(
    getPublicProperty({ query: async () => ({ rows: [], rowCount: 0 }) }, {}, 'private-property'),
    (error) => error.statusCode === 404,
  );
});
