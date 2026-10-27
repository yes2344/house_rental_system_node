import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { storedMediaPath } from './propertyImageService.js';

async function listFiles(root, relative = '') {
  let entries;
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isFile()) files.push(child);
    else if (entry.isDirectory()) files.push(...await listFiles(root, child));
  }
  return files;
}

async function inspectRoot(root) {
  const files = await listFiles(root);
  let bytes = 0;
  for (const relativePath of files) {
    const file = await stat(path.join(root, relativePath));
    bytes += file.size;
  }
  return { files, bytes };
}

async function filesystemStats(root) {
  let probe = root;
  try {
    let stats;
    while (!stats) {
      try {
        stats = await statfs(probe);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(probe);
        if (parent === probe) throw error;
        probe = parent;
      }
    }
    return {
      total_bytes: Number(stats.blocks) * Number(stats.bsize),
      available_bytes: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch (error) {
    if (['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
      return { total_bytes: null, available_bytes: null };
    }
    throw error;
  }
}

function getExpectedPath(root, relativePath, expectedDirectory) {
  try {
    return storedMediaPath(root, relativePath, expectedDirectory);
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

export async function getMediaStorageReport(pool, mediaConfig) {
  const [publicStorage, privateStorage, publicFilesystem, privateFilesystem, database] = await Promise.all([
    inspectRoot(mediaConfig.publicRoot),
    inspectRoot(mediaConfig.privateRoot),
    filesystemStats(mediaConfig.publicRoot),
    filesystemStats(mediaConfig.privateRoot),
    pool.query('SELECT image, original_image FROM user_propertyimage'),
  ]);

  const publicDiskFiles = new Set(publicStorage.files.map((file) => path.resolve(mediaConfig.publicRoot, file)));
  const privateDiskFiles = new Set(privateStorage.files.map((file) => path.resolve(mediaConfig.privateRoot, file)));
  const referencedPublic = new Set();
  const referencedPrivate = new Set();
  let invalidReferences = 0;
  let missingFiles = 0;

  for (const row of database.rows) {
    if (row.image) {
      const expected = getExpectedPath(mediaConfig.publicRoot, row.image, 'property_images');
      if (!expected) invalidReferences += 1;
      else {
        referencedPublic.add(expected);
        if (!publicDiskFiles.has(expected)) missingFiles += 1;
      }
    }
    if (row.original_image) {
      const expected = getExpectedPath(
        mediaConfig.privateRoot,
        row.original_image,
        'private_property_images',
      );
      if (!expected) invalidReferences += 1;
      else {
        referencedPrivate.add(expected);
        if (!privateDiskFiles.has(expected)) missingFiles += 1;
      }
    }
  }

  const usedBytes = publicStorage.bytes + privateStorage.bytes;
  const usagePercent = mediaConfig.capacityBytes === null
    ? null
    : usedBytes / mediaConfig.capacityBytes * 100;

  return {
    media_roots: {
      public: mediaConfig.publicRoot,
      private: mediaConfig.privateRoot,
    },
    storage: {
      file_count: publicStorage.files.length + privateStorage.files.length,
      used_bytes: usedBytes,
      configured_capacity_bytes: mediaConfig.capacityBytes,
      configured_remaining_bytes: mediaConfig.capacityBytes === null
        ? null
        : Math.max(0, mediaConfig.capacityBytes - usedBytes),
      configured_usage_percent: usagePercent === null ? null : Number(usagePercent.toFixed(2)),
      warning_percent: mediaConfig.warningPercent,
      warning: usagePercent !== null && usagePercent >= mediaConfig.warningPercent,
      public: {
        file_count: publicStorage.files.length,
        used_bytes: publicStorage.bytes,
        filesystem_total_bytes: publicFilesystem.total_bytes,
        filesystem_available_bytes: publicFilesystem.available_bytes,
      },
      private: {
        file_count: privateStorage.files.length,
        used_bytes: privateStorage.bytes,
        filesystem_total_bytes: privateFilesystem.total_bytes,
        filesystem_available_bytes: privateFilesystem.available_bytes,
      },
    },
    database_reconciliation: {
      image_records: database.rowCount,
      referenced_public_files: referencedPublic.size,
      referenced_private_files: referencedPrivate.size,
      missing_files: missingFiles,
      invalid_references: invalidReferences,
      orphaned_public_files: [...publicDiskFiles].filter((file) => !referencedPublic.has(file)).length,
      orphaned_private_files: [...privateDiskFiles].filter((file) => !referencedPrivate.has(file)).length,
    },
  };
}
