import { createPool, withReadOnlyTransaction } from '../src/db.js';
import { getMediaConfig } from '../src/config/media.js';
import {
  cleanOrphanedPropertyImages,
  storedMediaPath,
} from '../src/services/propertyImageService.js';

const deleteFiles = process.argv.includes('--delete');
const mediaConfig = getMediaConfig();
const pool = createPool(undefined, { readOnly: true });

try {
  const references = await withReadOnlyTransaction(pool, (client) => client.query(
    'SELECT image, original_image FROM user_propertyimage',
  ));
  const publicFiles = [];
  const privateFiles = [];
  for (const row of references.rows) {
    if (row.image) {
      publicFiles.push(storedMediaPath(mediaConfig.publicRoot, row.image, 'property_images'));
    }
    if (row.original_image) {
      privateFiles.push(storedMediaPath(
        mediaConfig.privateRoot,
        row.original_image,
        'private_property_images',
      ));
    }
  }
  const result = await cleanOrphanedPropertyImages(
    mediaConfig,
    publicFiles,
    privateFiles,
    { deleteFiles },
  );
  console.info(JSON.stringify({
    mode: deleteFiles ? 'delete' : 'dry-run',
    orphaned_files: result.orphanedCount,
    deleted_files: result.removedCount,
  }));
} catch (error) {
  console.error('Orphaned-media inspection failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
