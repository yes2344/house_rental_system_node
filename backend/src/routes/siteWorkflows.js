import { Router } from 'express';
import multer from 'multer';
import { siteWorkflowController } from '../controllers/siteWorkflowController.js';
import { ApiError } from '../errors.js';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  brokerageContactPatchSchema,
  favoriteCreateSchema,
  listingReportSchema,
  locationPatchSchema,
  locationWriteSchema,
  managedLocationQuerySchema,
  publicLocationQuerySchema,
} from '../validators/siteWorkflows.js';

const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 5, parts: 7 },
}).fields([
  { name: 'site_logo', maxCount: 1 },
  { name: 'homepage_hero_image', maxCount: 1 },
]);

function parseBrandingUpload(request, response, next) {
  brandingUpload(request, response, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      next(new ApiError(413, 'Branding images must be 5 MB or smaller.'));
      return;
    }
    if (error instanceof multer.MulterError) {
      next(new ApiError(400, 'The branding image upload is invalid.'));
      return;
    }
    next(error);
  });
}

export function siteWorkflowsRouter({ pool, mediaConfig, logger = console }) {
  const router = Router();
  const controller = siteWorkflowController({ pool, mediaConfig, logger });

  router.get('/homepage-notes/', controller.homepageNotes);
  router.get('/public-pages/:page/', controller.publicInformationPage);
  router.route('/brokerage/contact/')
    .get(controller.brokerageContact)
    .patch(
      authenticate({ pool }),
      parseBrandingUpload,
      validateRequest(brokerageContactPatchSchema),
      controller.patchBrokerageContact,
    );
  router.post(
    '/reports/',
    rateLimit({ limit: 10, windowMs: 60 * 60 * 1000 }),
    validateRequest(listingReportSchema),
    controller.listingReport,
  );
  router.route('/favorites/')
    .get(authenticate({ pool }), controller.favorites)
    .post(
      authenticate({ pool }),
      validateRequest(favoriteCreateSchema),
      controller.createFavorite,
    );
  router.delete('/favorites/:propertyId/', authenticate({ pool }), controller.deleteFavorite);
  router.get(
    '/locations/',
    validateRequest(publicLocationQuerySchema, 'query'),
    controller.publicLocations,
  );
  router.route('/management/locations/')
    .get(
      authenticate({ pool }),
      validateRequest(managedLocationQuerySchema, 'query'),
      controller.managedLocations,
    )
    .post(
      authenticate({ pool }),
      validateRequest(locationWriteSchema),
      controller.createManagedLocation,
    );
  router.route('/management/locations/:id/')
    .get(authenticate({ pool }), controller.managedLocation)
    .patch(
      authenticate({ pool }),
      validateRequest(locationPatchSchema),
      controller.updateManagedLocation,
    )
    .delete(authenticate({ pool }), controller.deleteManagedLocation);

  return router;
}
