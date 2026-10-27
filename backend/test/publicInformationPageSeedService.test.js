import assert from 'node:assert/strict';
import test from 'node:test';

import { seedMissingPublicInformationPages } from '../src/services/publicInformationPageSeedService.js';

function createSeedClient(existingPages = []) {
  const pages = [...existingPages];
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'BEGIN READ ONLY' || sql === 'COMMIT' || sql === 'ROLLBACK'
        || sql.startsWith('SELECT pg_advisory_xact_lock')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('to_regclass')) return { rows: [{ exists: true }], rowCount: 1 };
      if (sql.includes('GROUP BY page')) {
        const pageCounts = new Map();
        for (const { page } of pages) {
          if (values[0].includes(page)) pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1);
        }
        const duplicates = [...pageCounts].filter(([, count]) => count > 1).map(([page]) => page);
        return { rows: duplicates.map((page) => ({ page })), rowCount: duplicates.length };
      }
      if (sql.includes('SELECT page FROM public.portal_admin_publicinformationpage')) {
        return {
          rows: pages.filter(({ page }) => values[0].includes(page)).map(({ page }) => ({ page })),
          rowCount: pages.length,
        };
      }
      if (sql.includes('INSERT INTO public.portal_admin_publicinformationpage')) {
        const [page, title_en, title_am, introduction_en, introduction_am] = values;
        pages.push({
          page,
          title_en,
          title_am,
          introduction_en,
          introduction_am,
          body_en: '',
          body_am: '',
        });
        return { rows: [{ page }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL query: ${sql}`);
    },
  };
  return { client, pages, queries };
}

test('public information page seed dry-run reports missing rows without inserting', async () => {
  const { client, pages, queries } = createSeedClient([{ page: 'about' }]);

  const result = await seedMissingPublicInformationPages(client);

  assert.deepEqual(result, {
    existing: ['about'],
    missing: ['contact', 'property-management'],
    inserted: [],
  });
  assert.equal(pages.length, 1);
  assert.ok(queries.includes('BEGIN READ ONLY'));
  assert.ok(!queries.some((query) => query.startsWith('INSERT')));
});

test('public information page seed inserts only missing rows and preserves existing content', async () => {
  const originalAbout = { page: 'about', title_en: 'Custom About title' };
  const { client, pages, queries } = createSeedClient([originalAbout]);

  const result = await seedMissingPublicInformationPages(client, { apply: true });

  assert.deepEqual(result, {
    existing: ['about'],
    missing: ['contact', 'property-management'],
    inserted: ['contact', 'property-management'],
  });
  assert.equal(pages.length, 3);
  assert.equal(pages[0], originalAbout);
  assert.equal(pages.find(({ page }) => page === 'contact').title_en, 'Contact');
  assert.equal(pages.find(({ page }) => page === 'contact').body_en, '');
  assert.ok(queries.includes('BEGIN'));
  assert.ok(queries.some((query) => query.startsWith('SELECT pg_advisory_xact_lock')));
  assert.equal(queries.filter((query) => query.startsWith('INSERT')).length, 2);
});

test('public information page seed refuses to proceed when page rows are duplicated', async () => {
  const { client, pages } = createSeedClient([
    { page: 'about', title_en: 'About one' },
    { page: 'about', title_en: 'About two' },
  ]);

  await assert.rejects(
    seedMissingPublicInformationPages(client, { apply: true }),
    /Duplicate public information page rows exist/,
  );
  assert.equal(pages.length, 2);
});
