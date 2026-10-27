import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import {
  PROPERTY_IMAGE_WATERMARK,
  imageUrl,
  prepareImageUpload,
  storedMediaPath,
  watermarkSvg,
} from "../src/services/propertyImageService.js";

const temporaryDirectories = [];
const sampleImage = await sharp({
  create: {
    width: 320,
    height: 200,
    channels: 3,
    background: "#ccddee",
  },
})
  .jpeg()
  .toBuffer();

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function fakePool(userId = 1, initialImages = [], propertyOverrides = {}) {
  const images = initialImages.map((image) => ({ ...image }));
  let nextId = Math.max(0, ...images.map((image) => image.id)) + 1;
  const property = {
    id: 1,
    service_type: "agent_managed",
    submitted_by_id: 1,
    is_active: true,
    is_staff: false,
    is_superuser: false,
    role: "agent",
    agent_approved: true,
    management_permissions: ["properties.manage_assigned"],
    submitter_id: null,
    announcement_status: null,
    ...propertyOverrides,
  };

  return {
    images,
    async query(sql, values = []) {
      if (sql.includes("FROM accounts_tabsessiontoken AS session")) {
        return { rows: [{ session_id: 1, user_id: userId }], rowCount: 1 };
      }
      if (sql.includes("FROM user_propertyimage AS image")) {
        const image = images.find((entry) => entry.id === Number(values[0]));
        if (!image) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              ...image,
              service_type: property.service_type,
              submitted_by_id: property.submitted_by_id,
              is_active: true,
              is_staff: false,
              is_superuser: false,
              role: property.role,
              agent_approved: true,
              management_permissions: ["properties.manage_assigned"],
              submitter_id: property.submitter_id,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          const normalized = sql.replace(/\s+/g, " ").trim();
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
            return { rows: [], rowCount: 0 };
          }
          if (normalized.startsWith("SELECT property.id")) {
            return { rows: [{ ...property }], rowCount: 1 };
          }
          if (
            normalized.startsWith(
              "SELECT id FROM user_propertyimage WHERE id = $1 AND property_id = $2 FOR UPDATE",
            )
          ) {
            const image = images.find(
              (entry) =>
                entry.id === Number(values[0]) &&
                entry.property_id === Number(values[1]),
            );
            return {
              rows: image ? [{ id: image.id }] : [],
              rowCount: image ? 1 : 0,
            };
          }
          if (normalized.startsWith("SELECT COUNT(*)")) {
            return { rows: [{ image_count: images.length }], rowCount: 1 };
          }
          if (normalized.startsWith("SELECT site_name, phone")) {
            return {
              rows: [{ site_name: "Infinity House", phone: "" }],
              rowCount: 1,
            };
          }
          if (
            normalized.startsWith(
              "UPDATE user_propertyimage SET is_primary = FALSE WHERE property_id = $1 AND id <> $2",
            )
          ) {
            for (const image of images) {
              if (
                image.property_id === Number(values[0]) &&
                image.id !== Number(values[1])
              ) {
                image.is_primary = false;
              }
            }
            return { rows: [], rowCount: 0 };
          }
          if (
            normalized.startsWith(
              "UPDATE user_propertyimage SET is_primary = FALSE WHERE property_id = $1",
            )
          ) {
            for (const image of images) image.is_primary = false;
            return { rows: [], rowCount: images.length };
          }
          if (normalized.startsWith("INSERT INTO user_propertyimage")) {
            assert.match(normalized, /caption, is_primary, created_at\)/);
            assert.match(
              normalized,
              /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, NOW\(\)\)/,
            );
            const row = {
              id: nextId++,
              property_id: Number(values[0]),
              image: values[1],
              original_image: values[2],
              original_filename: values[3],
              original_content_type: values[4],
              caption: values[5],
              is_primary: values[6],
              created_at: new Date().toISOString(),
            };
            images.push(row);
            return { rows: [row], rowCount: 1 };
          }
          if (
            normalized.startsWith("INSERT INTO backend_media_file_metadata")
          ) {
            return { rows: [], rowCount: 1 };
          }
          if (
            normalized.startsWith(
              "SELECT id, image, original_image, caption, is_primary, created_at FROM user_propertyimage WHERE property_id",
            )
          ) {
            const rows = images
              .filter((image) => image.property_id === Number(values[0]))
              .sort((a, b) => a.id - b.id);
            return { rows, rowCount: rows.length };
          }
          if (
            normalized.startsWith(
              "SELECT id, image, original_image, caption, is_primary FROM user_propertyimage WHERE id",
            )
          ) {
            const row = images.find(
              (image) =>
                image.id === Number(values[0]) &&
                image.property_id === Number(values[1]),
            );
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
          }
          if (
            normalized.startsWith("UPDATE user_propertyimage SET image = $1")
          ) {
            const image = images.find(
              (entry) => entry.id === Number(values[4]),
            );
            if (!image) return { rows: [], rowCount: 0 };
            [
              image.image,
              image.original_image,
              image.original_filename,
              image.original_content_type,
            ] = values;
            return { rows: [{ ...image }], rowCount: 1 };
          }
          if (
            normalized.startsWith(
              "SELECT id, image, original_image FROM user_propertyimage WHERE id",
            )
          ) {
            const row = images.find(
              (image) =>
                image.id === Number(values[0]) &&
                image.property_id === Number(values[1]),
            );
            return {
              rows: row
                ? [
                    {
                      id: row.id,
                      image: row.image,
                      original_image: row.original_image,
                    },
                  ]
                : [],
              rowCount: row ? 1 : 0,
            };
          }
          if (normalized.startsWith("DELETE FROM user_propertyimage")) {
            const index = images.findIndex(
              (image) => image.id === Number(values[0]),
            );
            if (index < 0) return { rows: [], rowCount: 0 };
            images.splice(index, 1);
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected image-test SQL: ${normalized}`);
        },
        release() {},
      };
    },
  };
}

async function startServer(t, pool, mediaConfig) {
  const app = createApp({ pool, mediaConfig, logger: { error() {} } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let closed = false;
  const close = () => {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };
  t.after(close);
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close };
}

async function makeMediaConfig() {
  const root = await mkdtemp(path.join(os.tmpdir(), "infinity-house-media-"));
  temporaryDirectories.push(root);
  return {
    publicRoot: path.join(root, "public"),
    privateRoot: path.join(root, "private"),
  };
}

function multipart(image = sampleImage, filename = "house.jpg") {
  const form = new FormData();
  form.append("image", new Blob([image], { type: "image/jpeg" }), filename);
  form.append("caption", "Front room");
  return form;
}

const headers = {
  Authorization: "Bearer test-session",
  Cookie: "csrftoken=test-csrf-token",
  "X-CSRFToken": "test-csrf-token",
};

test("property image URLs use HTTPS behind a TLS-terminating proxy", () => {
  const request = {
    protocol: "http",
    get(name) {
      if (name === "x-forwarded-proto") return "https";
      if (name === "host") return "homes.example.test";
      return undefined;
    },
  };

  assert.equal(
    imageUrl(request, "property_images/front room.jpg"),
    "https://homes.example.test/media/property_images/front%20room.jpg",
  );
});

test("managed property images upload as watermarked public files and private originals, with stable gallery order", async (t) => {
  const mediaConfig = await makeMediaConfig();
  const pool = fakePool();
  const server = await startServer(t, pool, mediaConfig);
  const { baseUrl } = server;

  const first = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(),
    },
  );
  assert.equal(first.status, 201);
  const firstImage = await first.json();
  assert.equal(firstImage.is_primary, true);
  assert.equal(firstImage.caption, "Front room");
  assert.ok(
    firstImage.original_url.endsWith(
      `/management/images/${firstImage.id}/original/`,
    ),
  );

  const second = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(sampleImage, "back.jpg"),
    },
  );
  assert.equal(second.status, 201);
  const secondImage = await second.json();
  assert.equal(secondImage.is_primary, false);

  const publicPath = new URL(firstImage.image).pathname;
  const publicFile = path.join(
    mediaConfig.publicRoot,
    decodeURIComponent(publicPath.slice("/media/".length)),
  );
  const privateFile = path.join(
    mediaConfig.privateRoot,
    pool.images[0].original_image,
  );
  await stat(publicFile);
  assert.deepEqual(await readFile(privateFile), sampleImage);
  assert.equal(
    (await sharp(await readFile(publicFile)).metadata()).format,
    "jpeg",
  );

  const listing = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/`,
    { headers },
  );
  const gallery = await listing.json();
  assert.deepEqual(
    gallery.results.map((image) => image.id),
    [firstImage.id, secondImage.id],
  );
  assert.equal(gallery.results[0].is_primary, true);
  assert.equal(gallery.results[1].is_primary, false);

  const publicResponse = await fetch(firstImage.image);
  assert.equal(publicResponse.status, 200);
  const privateResponse = await fetch(firstImage.original_url);
  assert.equal(privateResponse.status, 401);
  const authorizedOriginal = await fetch(firstImage.original_url, { headers });
  assert.equal(authorizedOriginal.status, 200);
  assert.deepEqual(
    Buffer.from(await authorizedOriginal.arrayBuffer()),
    sampleImage,
  );
  assert.equal(
    (await fetch(`${baseUrl}/media/${pool.images[0].original_image}`)).status,
    404,
  );

  await server.close();
  const restartedServer = await startServer(t, pool, mediaConfig);
  const persistedImageUrl = `${restartedServer.baseUrl}${new URL(firstImage.image).pathname}`;
  assert.equal((await fetch(persistedImageUrl)).status, 200);
  assert.equal(
    (
      await fetch(
        `${restartedServer.baseUrl}/media/property_images/missing.jpg`,
      )
    ).status,
    404,
  );
});

test("owner submission images are available only to the submitter while the submission is reviewable", async (t) => {
  const mediaConfig = await makeMediaConfig();
  const pool = fakePool(2, [], {
    service_type: "owner_announced",
    submitted_by_id: null,
    role: "owner",
    submitter_id: 2,
    announcement_status: "pending_review",
  });
  const { baseUrl } = await startServer(t, pool, mediaConfig);
  const url = `${baseUrl}/api/v1/submissions/1/images/`;
  const beforeUpload = await fetch(url, { headers });
  assert.equal(beforeUpload.status, 200);
  assert.equal((await beforeUpload.json()).count, 0);

  const upload = await fetch(url, {
    method: "POST",
    headers,
    body: multipart(),
  });
  assert.equal(upload.status, 201);
  const image = await upload.json();
  assert.equal(image.is_primary, false);

  const afterUpload = await fetch(url, { headers });
  assert.equal((await afterUpload.json()).count, 1);
  const original = await fetch(image.original_url, { headers });
  assert.equal(original.status, 200);
});

test("managed image replacement and deletion update PostgreSQL references and remove old files", async (t) => {
  const mediaConfig = await makeMediaConfig();
  const pool = fakePool();
  const { baseUrl } = await startServer(t, pool, mediaConfig);
  const uploaded = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(),
    },
  );
  const image = await uploaded.json();
  const oldPublicName = pool.images[0].image;
  const oldOriginalName = pool.images[0].original_image;

  const replacement = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/${image.id}/`,
    {
      method: "PUT",
      headers,
      body: multipart(sampleImage, "replacement.jpg"),
    },
  );
  assert.equal(replacement.status, 200);
  const updated = await replacement.json();
  assert.equal(updated.id, image.id);
  assert.notEqual(pool.images[0].image, oldPublicName);
  await assert.rejects(stat(path.join(mediaConfig.publicRoot, oldPublicName)));
  await assert.rejects(
    stat(path.join(mediaConfig.privateRoot, oldOriginalName)),
  );

  const replacedPublicName = pool.images[0].image;
  const replacedOriginalName = pool.images[0].original_image;
  const deleted = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/${image.id}/`,
    {
      method: "DELETE",
      headers,
    },
  );
  assert.equal(deleted.status, 204);
  assert.equal(pool.images.length, 0);
  await assert.rejects(
    stat(path.join(mediaConfig.publicRoot, replacedPublicName)),
  );
  await assert.rejects(
    stat(path.join(mediaConfig.privateRoot, replacedOriginalName)),
  );
});

test("image upload enforces object permissions and rejects undecodable files", async (t) => {
  const mediaConfig = await makeMediaConfig();
  const ownerPool = fakePool(2);
  const { baseUrl: unauthorizedBaseUrl } = await startServer(
    t,
    ownerPool,
    mediaConfig,
  );
  const unauthorized = await fetch(
    `${unauthorizedBaseUrl}/api/v1/management/properties/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(),
    },
  );
  assert.equal(unauthorized.status, 404);
  assert.equal(ownerPool.images.length, 0);

  const pool = fakePool();
  const { baseUrl } = await startServer(t, pool, mediaConfig);
  const invalid = await fetch(
    `${baseUrl}/api/v1/management/properties/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(Buffer.from("MZ executable data"), "fake.jpg"),
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal(pool.images.length, 0);

  const fullPool = fakePool(
    1,
    Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      property_id: 1,
      image: `property_images/${index}.jpg`,
      original_image: `private_property_images/${index}.jpg`,
      caption: "",
      is_primary: index === 0,
      created_at: new Date().toISOString(),
    })),
  );
  const fullBaseUrl = (await startServer(t, fullPool, mediaConfig)).baseUrl;
  const full = await fetch(
    `${fullBaseUrl}/api/v1/management/properties/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(),
    },
  );
  assert.equal(full.status, 400);
  assert.equal(fullPool.images.length, 10);
});

test("property photo creation, replacement, and submissions accept files larger than 10 MB", async (t) => {
  const mediaConfig = await makeMediaConfig();
  const largePhoto = Buffer.concat([
    sampleImage,
    Buffer.alloc(10 * 1024 * 1024 + 1),
  ]);
  const managedPool = fakePool();
  const { baseUrl: managedBaseUrl } = await startServer(
    t,
    managedPool,
    mediaConfig,
  );
  const managedUrl = `${managedBaseUrl}/api/v1/management/properties/1/images/`;
  const created = await fetch(managedUrl, {
    method: "POST",
    headers,
    body: multipart(largePhoto, "large.jpg"),
  });

  assert.equal(created.status, 201);
  const createdImage = await created.json();
  assert.equal(managedPool.images.length, 1);

  const replaced = await fetch(`${managedUrl}${createdImage.id}/`, {
    method: "PUT",
    headers,
    body: multipart(largePhoto, "replacement-large.jpg"),
  });
  assert.equal(replaced.status, 200);

  const submissionPool = fakePool(2, [], {
    service_type: "owner_announced",
    submitted_by_id: null,
    role: "owner",
    submitter_id: 2,
    announcement_status: "pending_review",
  });
  const { baseUrl: submissionBaseUrl } = await startServer(
    t,
    submissionPool,
    mediaConfig,
  );
  const submitted = await fetch(
    `${submissionBaseUrl}/api/v1/submissions/1/images/`,
    {
      method: "POST",
      headers,
      body: multipart(largePhoto, "submission-large.jpg"),
    },
  );
  assert.equal(submitted.status, 201);
  assert.equal(submissionPool.images.length, 1);
});

test("stored image paths reject traversal and missing public files return 404", async (t) => {
  const mediaConfig = await makeMediaConfig();
  const { baseUrl } = await startServer(t, fakePool(), mediaConfig);
  assert.throws(
    () =>
      storedMediaPath(
        mediaConfig.publicRoot,
        "property_images/../../secret",
        "property_images",
      ),
    { statusCode: 404 },
  );
  const response = await fetch(`${baseUrl}/media/property_images/missing.jpg`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.status_code, 404);
});

test("image decoder accepts supported formats based on bytes rather than browser MIME", async () => {
  assert.equal(PROPERTY_IMAGE_WATERMARK, "@Infinity House");
  const watermark = watermarkSvg(320, 200).toString();
  assert.match(watermark, /<svg width="320" height="200"/);
  assert.match(watermark, /<path d="M/);
  assert.match(watermark, /fill="#fff" fill-opacity="\.5"/);
  assert.doesNotMatch(watermark, /<text\b/);
  assert.doesNotMatch(watermark, /phone|logo|@infinity house/);
  assert.notEqual(watermark, watermarkSvg(1600, 1200).toString());
  for (const format of ["jpeg", "png", "webp"]) {
    const source = await sharp({
      create: {
        width: 320,
        height: 200,
        channels: 3,
        background: "#ccddee",
      },
    })
      .toFormat(format)
      .toBuffer();
    const result = await prepareImageUpload({
      buffer: source,
      size: source.length,
      originalname: `upload.${format}`,
      mimetype: "application/octet-stream",
    });
    assert.equal(
      result.contentType,
      format === "jpeg" ? "image/jpeg" : `image/${format}`,
    );
    assert.equal((await sharp(result.publicBuffer).metadata()).format, format);
  }
});
