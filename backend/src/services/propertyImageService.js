import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ApiError } from "../errors.js";
import { requestOrigin } from "../requestOrigin.js";
import { withTransaction } from "../db.js";

export const PROPERTY_IMAGE_WATERMARK = "@Infinity House";
const watermarkGlyphs = {
  "@": ["01110", "10001", "10111", "10101", "10111", "10000", "01110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  f: ["00110", "01001", "01000", "11100", "01000", "01000", "01000"],
  t: ["01000", "01000", "11110", "01000", "01000", "01001", "00110"],
  y: ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "10110", "11001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
};
const allowedFormats = new Map([
  ["jpeg", { extension: "jpg", contentType: "image/jpeg" }],
  ["png", { extension: "png", contentType: "image/png" }],
  ["webp", { extension: "webp", contentType: "image/webp" }],
]);

export function watermarkSvg(width, height) {
  const characters = [...PROPERTY_IMAGE_WATERMARK];
  const textWidth =
    characters.reduce(
      (total, character) => total + (character === " " ? 4 : 6),
      0,
    ) - 1;
  const cellSize =
    Math.min((width * 0.9) / (textWidth + 4), (height * 0.16) / 10) / 2;
  const textHeight = 7 * cellSize;
  const originX = (width - textWidth * cellSize) / 2;
  const originY = (height - textHeight) / 2;
  let cursorX = 0;
  const glyphPaths = [];
  for (const character of characters) {
    if (character === " ") {
      cursorX += 4 * cellSize;
      continue;
    }
    const glyph = watermarkGlyphs[character];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          const x = cursorX + column * cellSize;
          const y = row * cellSize;
          glyphPaths.push(`M${x} ${y}h${cellSize}v${cellSize}h-${cellSize}z`);
        }
      }
    }
    cursorX += 6 * cellSize;
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${glyphPaths.join("")}" fill="#fff" fill-opacity=".5" transform="translate(${originX} ${originY})" />
  </svg>`);
}

export async function prepareImageUpload(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw new ApiError(400, "Choose a property image to upload.");
  }
  try {
    const image = sharp(file.buffer, { failOn: "error" });
    const metadata = await image.metadata();
    const format = allowedFormats.get(metadata.format);
    if (!format || !metadata.width || !metadata.height) {
      throw new ApiError(
        400,
        "Property photos must be valid JPEG, PNG, or WebP images.",
      );
    }
    const oriented = await sharp(file.buffer, { failOn: "error" })
      .rotate()
      .toBuffer();
    const orientedMetadata = await sharp(oriented).metadata();
    const overlay = watermarkSvg(
      orientedMetadata.width,
      orientedMetadata.height,
    );
    let publicPipeline = sharp(oriented).composite([{ input: overlay }]);
    if (metadata.format === "jpeg")
      publicPipeline = publicPipeline.jpeg({ quality: 92, mozjpeg: true });
    if (metadata.format === "png")
      publicPipeline = publicPipeline.png({ compressionLevel: 8 });
    if (metadata.format === "webp")
      publicPipeline = publicPipeline.webp({ quality: 92 });
    const publicBuffer = await publicPipeline.toBuffer();
    const originalFilename =
      path
        .basename(String(file.originalname || "property-image"))
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 255) || "property-image";
    return {
      contentType: format.contentType,
      extension: format.extension,
      width: orientedMetadata.width,
      height: orientedMetadata.height,
      originalFilename,
      originalBuffer: file.buffer,
      publicBuffer,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "The uploaded image could not be decoded. Choose a valid JPEG, PNG, or WebP image.",
    );
  }
}

export function storedMediaPath(root, storedName, expectedDirectory) {
  if (
    typeof storedName !== "string" ||
    !storedName ||
    storedName.includes("\\") ||
    storedName.startsWith("/") ||
    storedName
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") ||
    storedName.split("/").length !== 2 ||
    storedName.split("/")[0] !== expectedDirectory
  ) {
    throw new ApiError(404, "Image not found.");
  }
  const fullPath = path.resolve(root, storedName);
  if (!fullPath.startsWith(path.resolve(root) + path.sep)) {
    throw new ApiError(404, "Image not found.");
  }
  return fullPath;
}

async function writeMediaFiles(mediaConfig, image, request) {
  const baseName = `${randomUUID()}.${image.extension}`;
  const publicName = `property_images/${baseName}`;
  const privateName = `private_property_images/${baseName}`;
  const publicPath = storedMediaPath(
    mediaConfig.publicRoot,
    publicName,
    "property_images",
  );
  const privatePath = storedMediaPath(
    mediaConfig.privateRoot,
    privateName,
    "private_property_images",
  );
  request.uploadStage = "filesystem_directory";
  await Promise.all([
    mkdir(path.dirname(publicPath), { recursive: true, mode: 0o755 }),
    mkdir(path.dirname(privatePath), { recursive: true, mode: 0o700 }),
  ]);
  request.uploadStage = "filesystem_write";
  try {
    const writes = await Promise.allSettled([
      writeFile(publicPath, image.publicBuffer, { flag: "wx", mode: 0o644 }),
      writeFile(privatePath, image.originalBuffer, { flag: "wx", mode: 0o600 }),
    ]);
    const failure = writes.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  } catch (error) {
    const cleanup = await Promise.allSettled([
      rm(publicPath, { force: true }),
      rm(privatePath, { force: true }),
    ]);
    const cleanupFailure = cleanup.find(
      (result) => result.status === "rejected",
    );
    request.uploadCleanup = cleanupFailure ? "failed" : "succeeded";
    if (cleanupFailure) {
      request.uploadCleanupErrorCode =
        cleanupFailure.reason.code || cleanupFailure.reason.name;
    }
    throw error;
  }
  return { publicName, privateName, publicPath, privatePath };
}

async function removeFiles(paths) {
  await Promise.all(
    paths.filter(Boolean).map((filePath) => rm(filePath, { force: true })),
  );
}

function isAdmin(account) {
  return Boolean(
    account.is_superuser ||
    (account.is_staff && account.role === "administrator"),
  );
}

async function lockAndAuthorizeProperty(client, userId, propertyId, mode) {
  const result = await client.query(
    `SELECT property.id, property.service_type, property.submitted_by_id,
            account.is_active, account.is_staff, account.is_superuser,
            profile.role, profile.agent_approved, profile.management_permissions,
            announcement.submitter_id, announcement.status AS announcement_status
     FROM user_property AS property
     JOIN auth_user AS account ON account.id = $2
     LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
     LEFT JOIN owner_announcements_ownerannouncement AS announcement
       ON announcement.property_id = property.id
     WHERE property.id = $1
     FOR UPDATE OF property`,
    [propertyId, userId],
  );
  if (result.rowCount !== 1 || !result.rows[0].is_active) {
    throw new ApiError(404, "Property not found.");
  }
  const property = result.rows[0];
  if (mode === "submission") {
    const allowed = ["pending_review", "corrections_requested"].includes(
      property.announcement_status,
    );
    if (
      !["customer", "owner"].includes(property.role) ||
      property.submitter_id !== Number(userId) ||
      !allowed
    ) {
      throw new ApiError(404, "Submission not found.");
    }
    return property;
  }

  const allowed =
    property.service_type === "agent_managed" &&
    (isAdmin(property) ||
      (property.role === "agent" &&
        property.agent_approved &&
        property.submitted_by_id === Number(userId)));
  if (!allowed) throw new ApiError(404, "Property not found.");
  return property;
}

async function createImageRecord(
  client,
  propertyId,
  image,
  files,
  caption,
  isPrimary,
) {
  const result = await client.query(
    `INSERT INTO user_propertyimage
       (property_id, image, original_image, original_filename, original_content_type, caption, is_primary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING id, property_id, image, original_image, original_filename,
               original_content_type, caption, is_primary, created_at`,
    [
      propertyId,
      files.publicName,
      files.privateName,
      image.originalFilename,
      image.contentType,
      caption,
      isPrimary,
    ],
  );
  const record = result.rows[0];
  await client.query(
    `INSERT INTO backend_media_file_metadata
       (property_image_id, public_file_size_bytes, original_file_size_bytes,
        mime_type, file_extension, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      record.id,
      image.publicBuffer.length,
      image.originalBuffer.length,
      image.contentType,
      image.extension,
      image.width,
      image.height,
    ],
  );
  return record;
}

export function imageUrl(request, storedName) {
  if (
    typeof storedName !== "string" ||
    !storedName.startsWith("property_images/") ||
    storedName.includes("\\") ||
    storedName.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new ApiError(
      500,
      "A property image does not have a safe local media path.",
    );
  }
  const encodedPath = storedName.split("/").map(encodeURIComponent).join("/");
  return `${requestOrigin(request)}/media/${encodedPath}`;
}

function serializeImage(request, row, originalAccess) {
  return {
    id: Number(row.id),
    image: imageUrl(request, row.image),
    original_url: originalAccess
      ? `${requestOrigin(request)}/api/v1/management/images/${row.id}/original/`
      : null,
    caption: row.caption || "",
    is_primary: Boolean(row.is_primary),
    created_at: row.created_at,
  };
}

export async function listManagedImages(pool, request, userId, propertyId) {
  return withTransaction(pool, async (client) => {
    await lockAndAuthorizeProperty(client, userId, propertyId, "managed");
    const result = await client.query(
      `SELECT id, image, original_image, caption, is_primary, created_at
       FROM user_propertyimage WHERE property_id = $1 ORDER BY id`,
      [propertyId],
    );
    return {
      count: result.rowCount,
      next: null,
      previous: null,
      results: result.rows.map((row) => serializeImage(request, row, true)),
    };
  });
}

export async function listSubmissionImages(pool, request, userId, propertyId) {
  return withTransaction(pool, async (client) => {
    await lockAndAuthorizeProperty(client, userId, propertyId, "submission");
    const result = await client.query(
      `SELECT id, image, original_image, caption, is_primary, created_at
       FROM user_propertyimage WHERE property_id = $1 ORDER BY id`,
      [propertyId],
    );
    return {
      count: result.rowCount,
      next: null,
      previous: null,
      results: result.rows.map((row) => serializeImage(request, row, true)),
    };
  });
}

export async function getManagedImage(
  pool,
  request,
  userId,
  propertyId,
  imageId,
) {
  return withTransaction(pool, async (client) => {
    await lockAndAuthorizeProperty(client, userId, propertyId, "managed");
    const result = await client.query(
      `SELECT id, image, original_image, caption, is_primary, created_at
       FROM user_propertyimage WHERE id = $1 AND property_id = $2`,
      [imageId, propertyId],
    );
    if (result.rowCount !== 1) throw new ApiError(404, "Image not found.");
    return serializeImage(request, result.rows[0], true);
  });
}

export async function createPropertyImage(
  pool,
  request,
  userId,
  propertyId,
  mode,
  file,
  fields,
  mediaConfig,
) {
  const caption = fields.caption || "";
  request.uploadStage = "input_validation";
  request.uploadFileCount = file ? 1 : 0;
  request.uploadFileSizeBytes = file?.size ?? 0;
  if (typeof caption !== "string" || caption.length > 200) {
    throw new ApiError(400, "Caption must be 200 characters or fewer.");
  }
  if (
    fields.is_primary !== undefined &&
    !["true", "false"].includes(fields.is_primary)
  ) {
    throw new ApiError(400, "is_primary must be true or false.");
  }

  let createdFiles;
  let imageRecord;
  try {
    request.uploadStage = "property_authorization";
    await withTransaction(pool, async (client) => {
      await lockAndAuthorizeProperty(client, userId, propertyId, mode);
    });

    request.uploadStage = "image_processing";
    const image = await prepareImageUpload(file);
    createdFiles = await writeMediaFiles(mediaConfig, image, request);

    imageRecord = await withTransaction(pool, async (client) => {
      request.uploadStage = "property_authorization";
      const property = await lockAndAuthorizeProperty(
        client,
        userId,
        propertyId,
        mode,
      );
      request.uploadStage = "image_record_lookup";
      const count = await client.query(
        "SELECT COUNT(*)::integer AS image_count FROM user_propertyimage WHERE property_id = $1",
        [propertyId],
      );
      const imageCount = count.rows[0].image_count;
      if (imageCount >= 10)
        throw new ApiError(400, "A listing can have at most 10 photos.");
      const isPrimary =
        mode === "managed"
          ? imageCount === 0 || fields.is_primary === "true"
          : fields.is_primary === "true";
      if (isPrimary) {
        request.uploadStage = "primary_image_update";
        await client.query(
          "UPDATE user_propertyimage SET is_primary = FALSE WHERE property_id = $1",
          [propertyId],
        );
      }
      request.uploadStage = "database_image_record";
      const record = await createImageRecord(
        client,
        property.id,
        image,
        createdFiles,
        caption,
        isPrimary,
      );
      request.uploadStage = "database_commit";
      return record;
    });
  } catch (error) {
    if (createdFiles) {
      try {
        await removeFiles([createdFiles.publicPath, createdFiles.privatePath]);
        request.uploadCleanup = "succeeded";
      } catch (cleanupError) {
        request.uploadCleanup = "failed";
        request.uploadCleanupErrorCode = cleanupError.code || cleanupError.name;
      }
    }
    throw error;
  }
  return serializeImage(request, imageRecord, true);
}

export async function updateManagedImage(
  pool,
  request,
  userId,
  propertyId,
  imageId,
  fields,
) {
  const caption = fields.caption;
  const isPrimary = fields.is_primary;
  if (
    caption !== undefined &&
    (typeof caption !== "string" || caption.length > 200)
  ) {
    throw new ApiError(400, "Caption must be 200 characters or fewer.");
  }
  if (isPrimary !== undefined && typeof isPrimary !== "boolean") {
    throw new ApiError(400, "is_primary must be a boolean.");
  }

  return withTransaction(pool, async (client) => {
    await lockAndAuthorizeProperty(client, userId, propertyId, "managed");
    const selected = await client.query(
      `SELECT id, image, original_image, caption, is_primary, created_at
       FROM user_propertyimage WHERE id = $1 AND property_id = $2 FOR UPDATE`,
      [imageId, propertyId],
    );
    if (selected.rowCount !== 1) throw new ApiError(404, "Image not found.");
    if (isPrimary === true) {
      await client.query(
        "UPDATE user_propertyimage SET is_primary = FALSE WHERE property_id = $1 AND id <> $2",
        [propertyId, imageId],
      );
    }
    const update = await client.query(
      `UPDATE user_propertyimage
       SET caption = COALESCE($1, caption), is_primary = COALESCE($2, is_primary)
       WHERE id = $3
       RETURNING id, image, original_image, caption, is_primary, created_at`,
      [caption ?? null, isPrimary ?? null, imageId],
    );
    return serializeImage(request, update.rows[0], true);
  });
}

export async function replaceManagedImage(
  pool,
  request,
  userId,
  propertyId,
  imageId,
  file,
  mediaConfig,
) {
  request.uploadFileCount = file ? 1 : 0;
  request.uploadFileSizeBytes = file?.size ?? 0;
  request.uploadStage = "property_authorization";
  await withTransaction(pool, async (client) => {
    await lockAndAuthorizeProperty(client, userId, propertyId, "managed");
    const selected = await client.query(
      `SELECT id FROM user_propertyimage
       WHERE id = $1 AND property_id = $2 FOR UPDATE`,
      [imageId, propertyId],
    );
    if (selected.rowCount !== 1) throw new ApiError(404, "Image not found.");
  });

  request.uploadStage = "image_processing";
  const image = await prepareImageUpload(file);
  let createdFiles;
  let replaced;
  try {
    createdFiles = await writeMediaFiles(mediaConfig, image, request);
    replaced = await withTransaction(pool, async (client) => {
      request.uploadStage = "property_authorization";
      await lockAndAuthorizeProperty(client, userId, propertyId, "managed");
      const selected = await client.query(
        `SELECT id, image, original_image, caption, is_primary
         FROM user_propertyimage WHERE id = $1 AND property_id = $2 FOR UPDATE`,
        [imageId, propertyId],
      );
      if (selected.rowCount !== 1) throw new ApiError(404, "Image not found.");
      request.uploadStage = "database_image_record";
      const update = await client.query(
        `UPDATE user_propertyimage
         SET image = $1, original_image = $2, original_filename = $3, original_content_type = $4
         WHERE id = $5
         RETURNING id, image, original_image, caption, is_primary, created_at`,
        [
          createdFiles.publicName,
          createdFiles.privateName,
          image.originalFilename,
          image.contentType,
          imageId,
        ],
      );
      await client.query(
        `INSERT INTO backend_media_file_metadata
           (property_image_id, public_file_size_bytes, original_file_size_bytes,
            mime_type, file_extension, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (property_image_id) DO UPDATE SET
           public_file_size_bytes = EXCLUDED.public_file_size_bytes,
           original_file_size_bytes = EXCLUDED.original_file_size_bytes,
           mime_type = EXCLUDED.mime_type,
           file_extension = EXCLUDED.file_extension,
           width = EXCLUDED.width,
           height = EXCLUDED.height,
           uploaded_at = CURRENT_TIMESTAMP`,
        [
          imageId,
          image.publicBuffer.length,
          image.originalBuffer.length,
          image.contentType,
          image.extension,
          image.width,
          image.height,
        ],
      );
      request.uploadStage = "database_commit";
      return {
        record: update.rows[0],
        oldImage: selected.rows[0].image,
        oldOriginal: selected.rows[0].original_image,
      };
    });
  } catch (error) {
    if (createdFiles) {
      try {
        await removeFiles([createdFiles.publicPath, createdFiles.privatePath]);
        request.uploadCleanup = "succeeded";
      } catch (cleanupError) {
        request.uploadCleanup = "failed";
        request.uploadCleanupErrorCode = cleanupError.code || cleanupError.name;
      }
    }
    throw error;
  }
  request.uploadStage = "filesystem_cleanup";
  try {
    await removeFiles([
      replaced.oldImage
        ? storedMediaPath(
            mediaConfig.publicRoot,
            replaced.oldImage,
            "property_images",
          )
        : null,
      replaced.oldOriginal
        ? storedMediaPath(
            mediaConfig.privateRoot,
            replaced.oldOriginal,
            "private_property_images",
          )
        : null,
    ]);
    request.uploadCleanup = "succeeded";
  } catch (cleanupError) {
    request.uploadCleanup = "failed";
    request.uploadCleanupErrorCode = cleanupError.code || cleanupError.name;
    throw cleanupError;
  }
  return serializeImage(request, replaced.record, true);
}

export async function deleteManagedImage(
  pool,
  userId,
  propertyId,
  imageId,
  mediaConfig,
) {
  const deleted = await withTransaction(pool, async (client) => {
    await lockAndAuthorizeProperty(client, userId, propertyId, "managed");
    const selected = await client.query(
      `SELECT id, image, original_image
       FROM user_propertyimage WHERE id = $1 AND property_id = $2 FOR UPDATE`,
      [imageId, propertyId],
    );
    if (selected.rowCount !== 1) throw new ApiError(404, "Image not found.");
    await client.query("DELETE FROM user_propertyimage WHERE id = $1", [
      imageId,
    ]);
    return selected.rows[0];
  });
  await removeFiles([
    deleted.image
      ? storedMediaPath(
          mediaConfig.publicRoot,
          deleted.image,
          "property_images",
        )
      : null,
    deleted.original_image
      ? storedMediaPath(
          mediaConfig.privateRoot,
          deleted.original_image,
          "private_property_images",
        )
      : null,
  ]);
}

export async function getOriginalImage(pool, userId, imageId, mediaConfig) {
  const result = await pool.query(
    `SELECT image.id, image.original_image, image.original_filename, image.original_content_type,
            property.service_type, property.submitted_by_id,
            account.is_active, account.is_staff, account.is_superuser,
            profile.role, profile.agent_approved, profile.management_permissions,
            announcement.submitter_id
     FROM user_propertyimage AS image
     JOIN user_property AS property ON property.id = image.property_id
     JOIN auth_user AS account ON account.id = $2
     LEFT JOIN accounts_profile AS profile ON profile.user_id = account.id
     LEFT JOIN owner_announcements_ownerannouncement AS announcement
       ON announcement.property_id = property.id
     WHERE image.id = $1`,
    [imageId, userId],
  );
  if (result.rowCount !== 1) throw new ApiError(404, "Image not found.");
  const row = result.rows[0];
  const isManager = isAdmin(row);
  const isAssignedAgent =
    row.role === "agent" &&
    row.agent_approved &&
    row.submitted_by_id === Number(userId);
  const isSubmitter =
    row.service_type === "owner_announced" &&
    row.submitter_id === Number(userId);
  if (!row.is_active || !(isManager || isAssignedAgent || isSubmitter)) {
    throw new ApiError(404, "Image not found.");
  }
  if (!row.original_image) throw new ApiError(404, "Image not found.");
  const filePath = storedMediaPath(
    mediaConfig.privateRoot,
    row.original_image,
    "private_property_images",
  );
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new ApiError(404, "Image not found.");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.code === "ENOENT") throw new ApiError(404, "Image not found.");
    throw error;
  }
  return {
    filePath,
    filename: path.basename(row.original_filename || "property-image"),
    contentType:
      allowedFormats.get(
        row.original_content_type === "image/jpeg"
          ? "jpeg"
          : row.original_content_type === "image/png"
            ? "png"
            : row.original_content_type === "image/webp"
              ? "webp"
              : "",
      )?.contentType || "application/octet-stream",
  };
}

export async function cleanOrphanedPropertyImages(
  mediaConfig,
  referencedPublic,
  referencedPrivate,
  { deleteFiles = false } = {},
) {
  const referenced = new Set(
    [...referencedPublic, ...referencedPrivate].map((filePath) =>
      path.resolve(filePath),
    ),
  );
  const roots = [
    [mediaConfig.publicRoot, "property_images"],
    [mediaConfig.privateRoot, "private_property_images"],
  ];
  const removed = [];
  for (const [root, directory] of roots) {
    const folder = path.join(root, directory);
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const candidate = path.resolve(folder, entry.name);
      if (!referenced.has(candidate)) removed.push(candidate);
    }
  }
  if (deleteFiles) await removeFiles(removed);
  return {
    orphanedCount: removed.length,
    removedCount: deleteFiles ? removed.length : 0,
  };
}
