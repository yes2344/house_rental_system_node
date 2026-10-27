export const publicInformationPageDefaults = [
  {
    page: 'about',
    title_en: 'About Infinity House',
    title_am: 'ስለ Infinity House',
    introduction_en: 'Infinity House brings property listings for rent and sale into one place. Browse listing details, request a viewing, or contact the configured service channels.',
    introduction_am: 'Infinity House ለኪራይና ለሽያጭ የቀረቡ የንብረት ዝርዝሮችን በአንድ ቦታ ያቀርባል። ዝርዝሮችን ይመልከቱ፣ የጉብኝት ጥያቄ ያቅርቡ ወይም የተዋቀሩትን የግንኙነት መንገዶች ይጠቀሙ።',
  },
  {
    page: 'contact',
    title_en: 'Contact',
    title_am: 'ያግኙን',
    introduction_en: 'Reach Infinity House using the contact options configured below.',
    introduction_am: 'ከታች በተዋቀሩት የግንኙነት መንገዶች Infinity Houseን ያግኙ።',
  },
  {
    page: 'property-management',
    title_en: 'Property management',
    title_am: 'የንብረት አስተዳደር',
    introduction_en: 'We help property owners present their listings and connect with people looking to rent or buy. Contact us to discuss property-management services.',
    introduction_am: 'የንብረት ባለቤቶች ዝርዝሮቻቸውን ለማቅረብና ለመከራየት ወይም ለመግዛት ከሚፈልጉ ሰዎች ጋር ለመገናኘት እናግዛለን። ስለ ንብረት አስተዳደር አገልግሎቶች ለመወያየት ያግኙን።',
  },
];

export function getDefaultPublicInformationPage(page) {
  const defaults = publicInformationPageDefaults.find((item) => item.page === page);
  if (!defaults) return null;
  return {
    ...defaults,
    body_en: '',
    body_am: '',
    updated_at: null,
  };
}

export async function seedMissingPublicInformationPages(client, { apply = false } = {}) {
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    if (apply) await client.query('SELECT pg_advisory_xact_lock(68127215, 2)');

    const table = await client.query(
      `SELECT to_regclass('public.portal_admin_publicinformationpage') IS NOT NULL AS exists`,
    );
    if (!table.rows[0]?.exists) {
      throw new Error('The public information page table is missing from the public schema.');
    }

    const duplicates = await client.query(
      `SELECT page FROM public.portal_admin_publicinformationpage
       WHERE page = ANY($1::text[])
       GROUP BY page HAVING COUNT(*) > 1`,
      [publicInformationPageDefaults.map(({ page }) => page)],
    );
    if (duplicates.rowCount) {
      throw new Error('Duplicate public information page rows exist; inspect them before seeding.');
    }

    const existingResult = await client.query(
      `SELECT page FROM public.portal_admin_publicinformationpage
       WHERE page = ANY($1::text[])`,
      [publicInformationPageDefaults.map(({ page }) => page)],
    );
    const existingPages = new Set(existingResult.rows.map(({ page }) => page));
    const existing = publicInformationPageDefaults
      .filter(({ page }) => existingPages.has(page))
      .map(({ page }) => page);
    const missing = publicInformationPageDefaults.filter(({ page }) => !existingPages.has(page));
    const inserted = [];

    if (apply) {
      for (const page of missing) {
        const result = await client.query(
          `INSERT INTO public.portal_admin_publicinformationpage
             (page, title_en, title_am, introduction_en, introduction_am,
              body_en, body_am, updated_at)
           VALUES ($1, $2, $3, $4, $5, '', '', CURRENT_TIMESTAMP)
           RETURNING page`,
          [page.page, page.title_en, page.title_am, page.introduction_en, page.introduction_am],
        );
        if (result.rowCount !== 1) {
          throw new Error(`Could not create the missing "${page.page}" public page.`);
        }
        inserted.push(page.page);
      }
    }

    await client.query('COMMIT');
    return { existing, missing: missing.map(({ page }) => page), inserted };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}
