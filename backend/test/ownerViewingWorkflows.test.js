import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { notFound } from '../src/middleware/notFound.js';
import { ownerViewingWorkflowsRouter } from '../src/routes/ownerViewingWorkflows.js';
import {
  actOnManagementViewingRequest,
  createOwnerSubmission,
  createViewingRequest,
  deleteCustomerViewingRequest,
  patchCustomerViewingRequest,
  listManagementSubmissions,
  listOwnerSubmissions,
  readNotification,
  accessViewingReceipt,
} from '../src/services/ownerViewingWorkflowsService.js';
import {
  decisionSchema,
  submissionCreateSchema,
  submissionPatchSchema,
  viewingCreateSchema,
  viewingManagerPatchSchema,
} from '../src/validators/ownerViewingWorkflows.js';

const customer = {
  id: 12, is_active: true, is_staff: false, is_superuser: false,
  role: 'customer', agent_approved: false, management_permissions: [],
};

function createPool({ account = customer, duplicate = false } = {}) {
  const calls = [];
  const transactionCalls = [];
  const pool = {
    calls,
    transactionCalls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM auth_user AS u')) return { rows: [account], rowCount: 1 };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          transactionCalls.push({ sql, values });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
          if (sql.includes('FROM auth_user AS u')) return { rows: [account], rowCount: 1 };
          if (sql.includes('FROM user_property') && sql.includes('publication_status =')) {
            return { rows: [{ id: 44, title: 'Test house', status: 'available' }], rowCount: 1 };
          }
          if (sql.includes('FROM user_viewingrequest') && sql.includes('requester_id = $2')) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes('INSERT INTO user_viewingrequest')) {
            if (duplicate) throw Object.assign(new Error('duplicate key'), { code: '23505' });
            return { rows: [{ id: 71, status: 'pending', created_at: '2026-01-01T00:00:00Z' }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO viewings_viewingrequestevent')) {
            return { rows: [{ id: 88 }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO owner_announcements_inappnotification')) {
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
        release() {},
      };
    },
  };
  return pool;
}

test('workflow validators reject protected fields and malformed decisions', () => {
  const validSubmission = {
    title: 'Sunny home', location: 'Addis Ababa', category: 'house',
    listing_type: 'sale', price: 1000, currency: 'USD', owner_contact_name: 'Owner',
    owner_contact_phone: '+251900000000', authorization_confirmed: true, terms_accepted: true,
    administrative_location: 1,
  };
  assert.equal(submissionCreateSchema.safeParse(validSubmission).success, true);
  assert.equal(submissionCreateSchema.safeParse({ ...validSubmission, status: 'approved' }).success, false);
  assert.equal(submissionPatchSchema.safeParse({ status: 'approved' }).success, false);
  assert.equal(viewingCreateSchema.safeParse({
    property_id: 1, full_name: 'Customer', email: 'user@example.com', phone: '1',
    preferred_date: '2026-12-01',
  }).success, true);
  assert.equal(decisionSchema.safeParse({ action: 'publish' }).success, false);
  assert.equal(viewingManagerPatchSchema.safeParse({ status: 'confirmed' }).success, false);
});

test('viewing creation is transactional and uses bound values for user-provided fields', async () => {
  const pool = createPool();
  const result = await createViewingRequest(pool, 12, {
    property_id: 44,
    full_name: "Owner'; DROP TABLE auth_user; --",
    email: 'person@example.com',
    phone: '123',
    preferred_date: '2099-12-30',
    preferred_time: '10:00',
    message: 'Please call.',
  });
  assert.equal(result.id, 71);
  assert.equal(result.status, 'pending');
  const insert = pool.transactionCalls.find(({ sql }) => sql.includes('INSERT INTO user_viewingrequest'));
  assert.ok(insert);
  assert.ok(insert.sql.includes('$3'));
  assert.ok(insert.values.includes("Owner'; DROP TABLE auth_user; --"));
  assert.deepEqual(pool.transactionCalls.slice(0, 1).map(({ sql }) => sql), ['BEGIN']);
  assert.ok(pool.transactionCalls.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(pool.transactionCalls.some(({ sql }) => sql.includes('INSERT INTO viewings_viewingrequestevent')));
});

test('active duplicate viewing conflict rolls the whole transaction back', async () => {
  const pool = createPool({ duplicate: true });
  await assert.rejects(
    createViewingRequest(pool, 12, {
      property_id: 44, full_name: 'Customer', email: 'person@example.com', phone: '123',
      preferred_date: '2099-12-30',
    }),
    (error) => error.statusCode === 409,
  );
  assert.ok(pool.transactionCalls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(pool.transactionCalls.some(({ sql }) => sql.includes('INSERT INTO viewings_viewingrequestevent')), false);
});

test('owner submission creation writes the property, agreement proof, event, and in-app receipt atomically', async () => {
  const calls = [];
  const row = {
    id: 44, announcement_id: 61, title: 'Sunny home', slug: 'sunny-home-abcd',
    location: 'Addis Ababa', administrative_location_id: 2, category: 'house',
    listing_type: 'sale', price: '1000.00', bedrooms: 0, bathrooms: 0,
    currency: 'USD',
    area_sqft: 0, area_value: null, area_unit: '', rental_frequency: '',
    description: '', features: '', property_status: 'available',
    publication_status: 'pending_review', is_featured: false, submitted_by_id: 12,
    moderation_note: '', location_path: [], amenities: [], images: [],
    owner_contact_name: 'Owner', owner_contact_phone: '123', owner_contact_email: '',
    submission_status: 'pending_review', agent_feedback: '', submitted_at: '2026-01-01',
    created_at: '2026-01-01', updated_at: '2026-01-01', reviewed_at: null,
    reviewed_by_id: null, assigned_reviewer_id: null, submitter_id: 12, submission_events: [],
  };
  const pool = {
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql, values });
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes('FROM auth_user AS u')) return { rows: [customer], rowCount: 1 };
          if (sql.includes('WITH RECURSIVE location_path')) {
            return { rows: [{ id: 2, location_type: 'city', is_active: true }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO user_property')) return { rows: [{ id: 44 }], rowCount: 1 };
          if (sql.includes('INSERT INTO owner_announcements_ownerannouncement\n')) {
            return { rows: [{ id: 61 }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO owner_announcements_ownerannouncementevent')) {
            return { rows: [{ id: 70 }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO owner_announcements_inappnotification')) return { rows: [], rowCount: 1 };
          if (sql.includes('FROM user_property AS p') && sql.includes('WHERE p.id = $1')) {
            return { rows: [row], rowCount: 1 };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        release() {},
      };
    },
  };
  const result = await createOwnerSubmission(pool, 12, {
    title: 'Sunny home', location: 'Addis Ababa', administrative_location: 2,
    category: 'house', listing_type: 'sale', price: 1000,
    currency: 'USD',
    owner_contact_name: 'Owner', owner_contact_phone: '123',
    authorization_confirmed: true, terms_accepted: true,
  });
  assert.equal(result.id, 44);
  assert.equal(result.currency, 'USD');
  const propertyInsert = calls.find(({ sql }) => sql.includes('INSERT INTO user_property'));
  assert.equal(propertyInsert.values[7], 'USD');
  assert.ok(propertyInsert.sql.includes('owner_id'));
  assert.ok(propertyInsert.sql.includes("'owner_announced'"));
  assert.equal(propertyInsert.values.at(-1), 12);
  assert.ok(calls.some(({ sql, values }) => sql.includes('authorization_confirmed') && values.includes('123')));
  assert.ok(calls.some(({ sql }) => sql.includes('event_type, from_status, to_status')));
  assert.ok(calls.some(({ values }) => values.includes('owner_submission_received')));
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
});

test('owner and reviewer queue SQL is scoped to the authenticated account', async () => {
  const ownerPool = createPool();
  ownerPool.query = async (sql, values = []) => {
    ownerPool.calls.push({ sql, values });
    if (sql.includes('FROM auth_user AS u')) return { rows: [customer], rowCount: 1 };
    if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const request = { originalUrl: '/submissions/', protocol: 'http', get: () => 'localhost' };
  const filters = { status: 'pending_review', ordering: '-created_at', page: 1, page_size: 12 };
  await listOwnerSubmissions(ownerPool, request, 12, filters);
  const ownerRows = ownerPool.calls.find(({ sql }) => sql.includes('COALESCE(events.items'));
  assert.ok(ownerRows.sql.includes('a.submitter_id = $1'));
  assert.equal(ownerRows.values[0], 12);

  const reviewer = {
    ...customer, role: 'agent', agent_approved: true,
    management_permissions: ['announcements.review_assigned'],
  };
  const reviewPool = createPool({ account: reviewer });
  reviewPool.query = async (sql, values = []) => {
    reviewPool.calls.push({ sql, values });
    if (sql.includes('FROM auth_user AS u')) return { rows: [reviewer], rowCount: 1 };
    if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  await listManagementSubmissions(reviewPool, request, 12, {
    ordering: '-submitted_at', page: 1, page_size: 12,
  });
  const scopedReview = reviewPool.calls.find(({ sql }) => sql.includes('COALESCE(events.items'));
  assert.ok(scopedReview.sql.includes('a.assigned_reviewer_id = $1'));
  assert.equal(scopedReview.values[0], 12);
});

test('notification reads always include recipient scope in the update', async () => {
  const calls = [];
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM auth_user AS u')) return { rows: [customer], rowCount: 1 };
      if (sql.includes('UPDATE owner_announcements_inappnotification')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(readNotification(pool, 12, 90), (error) => error.statusCode === 404);
  const update = calls.find(({ sql }) => sql.includes('UPDATE owner_announcements_inappnotification'));
  assert.ok(update.sql.includes('id = $1 AND recipient_id = $2'));
  assert.deepEqual(update.values, [90, 12]);
});

test('customer viewing PATCH records edits and DELETE soft-hides the request', async () => {
  const calls = [];
  const requestRow = {
    id: 71, property_id: 44, requester_id: 12, requester_deleted_at: null,
    title: 'Test house', slug: 'test-house', location: 'Addis Ababa',
    listing_type: 'sale', property_status: 'available',
    full_name: 'Customer', email: 'person@example.com', phone: '123',
    preferred_date: '2099-12-30', preferred_time: null, proposed_date: null,
    proposed_time: null, scheduled_date: null, scheduled_time: null,
    status: 'pending', message: '', agent_notes: 'private', events: [],
    created_at: '2026-01-01T00:00:00Z',
  };
  const row = { ...requestRow };
  const pool = {
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql, values });
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes('FROM auth_user AS u')) return { rows: [customer], rowCount: 1 };
          if (sql.includes('SELECT r.*, p.title')) return { rows: [{ ...row }], rowCount: 1 };
          if (sql.startsWith('UPDATE user_viewingrequest SET preferred_date')) {
            row.preferred_date = values[0];
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE user_viewingrequest SET status = $1')) {
            row.status = values[0];
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO viewings_viewingrequestevent')) return { rows: [{ id: 88 }], rowCount: 1 };
          if (sql.includes('INSERT INTO owner_announcements_inappnotification')) return { rows: [], rowCount: 0 };
          if (sql.startsWith('UPDATE user_viewingrequest SET requester_deleted_at')) {
            row.requester_deleted_at = '2026-01-02T00:00:00Z';
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
        release() {},
      };
    },
  };
  const updated = await patchCustomerViewingRequest(pool, 12, 71, { preferred_date: '2099-12-31' });
  assert.equal(updated.preferred_date, '2099-12-31');
  assert.equal(Object.hasOwn(updated, 'agent_notes'), false);
  const event = calls.find(({ sql }) => sql.includes('INSERT INTO viewings_viewingrequestevent'));
  assert.ok(event.sql.includes('event_type'));
  assert.ok(event.values.includes('request_updated'));
  await deleteCustomerViewingRequest(pool, 12, 71);
  assert.ok(row.requester_deleted_at);
  assert.ok(calls.some(({ sql }) => sql.includes('requester_deleted_at IS NULL')));
});

test('receipt POST accepts a live proposal and stores the confirmed schedule', async () => {
  const { createHash } = await import('node:crypto');
  const token = 'valid-private-token';
  const digest = createHash('sha256').update(token).digest('hex');
  const calls = [];
  const row = {
    id: 71, property_id: 44, requester_id: 12, title: 'Test house',
    proposed_date: '2099-12-30', proposed_time: '10:00:00',
    scheduled_date: null, scheduled_time: null, preferred_date: '2099-12-29',
    preferred_time: null, status: 'proposed', created_at: '2026-01-01T00:00:00Z',
    events: [],
  };
  const pool = {
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql, values });
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes('SELECT id FROM user_viewingrequest WHERE receipt_token_digest')) {
            assert.equal(values[0], digest);
            return { rows: [{ id: 71 }], rowCount: 1 };
          }
          if (sql.includes('SELECT r.*, p.title')) return { rows: [{ ...row }], rowCount: 1 };
          if (sql.startsWith('UPDATE user_viewingrequest SET status = $1')) {
            row.status = values[0];
            row.scheduled_date = values[1];
            row.scheduled_time = values[2];
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO viewings_viewingrequestevent')) return { rows: [{ id: 88 }], rowCount: 1 };
          if (sql.includes('INSERT INTO owner_announcements_inappnotification')) return { rows: [], rowCount: 0 };
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
        release() {},
      };
    },
  };
  const result = await accessViewingReceipt(pool, token, 'accept');
  assert.equal(result.status, 'confirmed');
  assert.equal(result.scheduled_date, '2099-12-30');
  assert.equal(row.scheduled_time, '10:00:00');
});

test('admin confirmation writes a requester notification with contiguous SQL parameters', async () => {
  const admin = {
    id: 3, is_active: true, is_staff: true, is_superuser: true,
    role: 'administrator', agent_approved: false, management_permissions: [],
  };
  const row = {
    id: 71, requester_id: 12, property_id: 44, full_name: 'Viewer',
    email: 'viewer@example.test', phone: '123', preferred_date: '2099-12-30',
    preferred_time: '10:00:00', proposed_date: null, proposed_time: null,
    scheduled_date: null, scheduled_time: null, status: 'pending', message: '',
    agent_notes: '', title: 'Test house', slug: 'test-house', location: 'Addis Ababa',
    listing_type: 'sale', property_status: 'available', events: [],
  };
  const notificationQueries = [];
  const pool = {
    async connect() {
      return {
        async query(sql, values = []) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes('FROM auth_user AS u')) return { rows: [admin], rowCount: 1 };
          if (sql.includes('SELECT r.*, p.title')) return { rows: [{ ...row }], rowCount: 1 };
          if (sql.includes("UPDATE user_viewingrequest SET status = 'confirmed'")) {
            row.status = 'confirmed';
            row.scheduled_date = row.preferred_date;
            row.scheduled_time = row.preferred_time;
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO viewings_viewingrequestevent')) return { rows: [{ id: 91 }], rowCount: 1 };
          if (sql.includes('INSERT INTO owner_announcements_inappnotification')) {
            notificationQueries.push({ sql, values });
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
        release() {},
      };
    },
  };

  const result = await actOnManagementViewingRequest(pool, admin.id, row.id, 'confirm_requested');

  assert.equal(result.status, 'confirmed');
  assert.equal(result.scheduled_date, row.preferred_date);
  assert.equal(result.scheduled_time, row.preferred_time);
  assert.equal(notificationQueries.length, 1);
  const [notification] = notificationQueries;
  assert.deepEqual(notification.values, [
    row.id, row.property_id, 'Viewing request for Test house: request confirmed.', 91,
  ]);
  assert.match(notification.sql, /property_id = \$2/);
  const parameterNumbers = [...new Set([...notification.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))];
  assert.deepEqual(parameterNumbers.sort(), [1, 2, 3, 4]);
});

test('frontend PATCH/DELETE detail methods and receipt POST are registered', async (t) => {
  const pool = {
    async query(sql) {
      if (sql.includes('accounts_tabsessiontoken')) return { rows: [], rowCount: 0 };
      if (sql.includes('receipt_token_digest')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes('receipt_token_digest')) return { rows: [], rowCount: 0 };
          throw new Error(`Unexpected transaction query: ${sql}`);
        },
        release() {},
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(ownerViewingWorkflowsRouter({ pool }));
  app.use(notFound);
  app.use(errorHandler({ logger: { error() {} } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}`;

  const patch = await fetch(`${base}/viewing-requests/mine/71/`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ preferred_date: '2099-12-30' }),
  });
  assert.equal(patch.status, 401);

  const remove = await fetch(`${base}/viewing-requests/mine/71/`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer invalid' },
  });
  assert.equal(remove.status, 401);

  const receipt = await fetch(`${base}/viewing-requests/receipt/`, {
    method: 'POST',
    headers: {
      cookie: 'csrftoken=csrf-token',
      'x-csrftoken': 'csrf-token',
      'x-viewing-receipt': 'private-receipt',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision: 'accept' }),
  });
  const receiptBody = await receipt.text();
  assert.equal(receipt.status, 404, receiptBody);
  assert.equal(receipt.headers.get('cache-control'), 'no-store');
  assert.equal(receipt.headers.get('referrer-policy'), 'no-referrer');
});
