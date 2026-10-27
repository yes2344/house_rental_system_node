import { ApiError } from '../errors.js';
import {
  createPropertyImage,
  deleteManagedImage,
  getManagedImage,
  getOriginalImage,
  listManagedImages,
  listSubmissionImages,
  replaceManagedImage,
  updateManagedImage,
} from '../services/propertyImageService.js';

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new ApiError(404, `${label} not found.`);
  }
  return number;
}

export function propertyImageController({ pool, mediaConfig }) {
  return {
    listManaged: async (request, response) => {
      response.json(await listManagedImages(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.propertyId, 'Property'),
      ));
    },
    listSubmission: async (request, response) => {
      response.json(await listSubmissionImages(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.submissionId, 'Submission'),
      ));
    },
    getManaged: async (request, response) => {
      response.json(await getManagedImage(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.propertyId, 'Property'),
        positiveInteger(request.params.imageId, 'Image'),
      ));
    },
    createManaged: async (request, response) => {
      response.status(201).json(await createPropertyImage(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.propertyId, 'Property'),
        'managed',
        request.file,
        request.body || {},
        mediaConfig,
      ));
    },
    createSubmission: async (request, response) => {
      response.status(201).json(await createPropertyImage(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.submissionId, 'Submission'),
        'submission',
        request.file,
        request.body || {},
        mediaConfig,
      ));
    },
    updateManaged: async (request, response) => {
      response.json(await updateManagedImage(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.propertyId, 'Property'),
        positiveInteger(request.params.imageId, 'Image'),
        request.body || {},
      ));
    },
    replaceManaged: async (request, response) => {
      response.json(await replaceManagedImage(
        pool,
        request,
        request.userId,
        positiveInteger(request.params.propertyId, 'Property'),
        positiveInteger(request.params.imageId, 'Image'),
        request.file,
        mediaConfig,
      ));
    },
    deleteManaged: async (request, response) => {
      await deleteManagedImage(
        pool,
        request.userId,
        positiveInteger(request.params.propertyId, 'Property'),
        positiveInteger(request.params.imageId, 'Image'),
        mediaConfig,
      );
      response.status(204).end();
    },
    original: async (request, response) => {
      const file = await getOriginalImage(
        pool,
        request.userId,
        positiveInteger(request.params.imageId, 'Image'),
        mediaConfig,
      );
      const asciiFilename = file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      response.set({
        'Cache-Control': 'private, no-store',
        'Content-Type': file.contentType,
        'Content-Disposition': `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'X-Content-Type-Options': 'nosniff',
      });
      response.sendFile(file.filePath);
    },
  };
}
