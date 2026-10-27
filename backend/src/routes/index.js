import { Router } from 'express';
import { accountController } from '../controllers/accountController.js';
import { publicPropertyController } from '../controllers/publicPropertyController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireCsrf } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  accountPatchSchema,
  loginSchema,
  preferencesSchema,
  registrationSchema,
} from '../validators/accounts.js';
import { publicPropertyQuerySchema } from '../validators/publicProperties.js';
import { healthController } from '../controllers/healthController.js';
import { propertyImageController } from '../controllers/propertyImageController.js';
import { propertyImageUpload } from '../middleware/propertyImageUpload.js';
import { requireAdministrator } from '../middleware/requireAdministrator.js';
import { mediaStorageController } from '../controllers/mediaStorageController.js';
import { managedPropertyController } from '../controllers/managedPropertyController.js';
import { managedPropertyQuerySchema } from '../validators/managedProperties.js';
import { accountExtensionsRouter } from './accountExtensions.js';
import { adminManagementWorkflowsRouter } from './adminManagementWorkflows.js';
import { ownerViewingWorkflowsRouter } from './ownerViewingWorkflows.js';
import { siteWorkflowsRouter } from './siteWorkflows.js';

export function apiRouter({ pool, logger, mediaConfig, sendEmail }) {
  const router = Router();
  const accounts = accountController({ pool });
  const publicProperties = publicPropertyController({ pool });
  const images = propertyImageController({ pool, mediaConfig });
  const managedProperties = managedPropertyController({ pool });
  const storage = mediaStorageController({ pool, mediaConfig });

  router.get('/health/', healthController({ pool, logger }));
  router.get(
    '/admin/storage/',
    authenticate({ pool }),
    requireAdministrator({ pool }),
    storage,
  );
  router.get('/amenities/', publicProperties.amenities);
  router.get('/property-types/', publicProperties.propertyTypes);
  router.get(
    '/management/properties/',
    authenticate({ pool }),
    validateRequest(managedPropertyQuerySchema, 'query'),
    managedProperties.list,
  );
  router.get(
    '/properties/',
    validateRequest(publicPropertyQuerySchema, 'query'),
    publicProperties.properties,
  );
  router.get('/properties/:slug/', publicProperties.propertyDetail);
  router.get('/auth/csrf/', accounts.csrf);
  router.post(
    '/auth/register/',
    rateLimit({ limit: 5, windowMs: 60 * 60 * 1000 }),
    validateRequest(registrationSchema),
    accounts.register,
  );
  router.post(
    '/auth/login/',
    rateLimit({ limit: 10, windowMs: 60 * 1000 }),
    requireCsrf,
    validateRequest(loginSchema),
    accounts.login,
  );
  router.post('/auth/logout/', authenticate({ pool }), accounts.logout);
  router.route('/auth/me/')
    .get(authenticate({ pool }), accounts.me)
    .patch(
      authenticate({ pool }),
      validateRequest(accountPatchSchema),
      accounts.me,
    );
  router.route('/auth/preferences/')
    .get(authenticate({ pool }), accounts.preferences)
    .patch(
      authenticate({ pool }),
      validateRequest(preferencesSchema),
      accounts.preferences,
    );
  router.post('/auth/preferences/reset/', authenticate({ pool }), accounts.resetPreferences);
  router.get('/auth/activity/', authenticate({ pool }), accounts.activity);
  router.use(accountExtensionsRouter({ pool, sendEmail }));
  router.route('/management/properties/:propertyId/images/')
    .get(authenticate({ pool }), images.listManaged)
    .post(
      authenticate({ pool }),
      requireCsrf,
      propertyImageUpload,
      images.createManaged,
    );
  router.route('/management/properties/:propertyId/images/:imageId/')
    .get(authenticate({ pool }), images.getManaged)
    .patch(
      authenticate({ pool }),
      requireCsrf,
      images.updateManaged,
    )
    .put(
      authenticate({ pool }),
      requireCsrf,
      propertyImageUpload,
      images.replaceManaged,
    )
    .delete(
      authenticate({ pool }),
      requireCsrf,
      images.deleteManaged,
    );
  router.route('/submissions/:submissionId/images/')
    .get(authenticate({ pool }), images.listSubmission)
    .post(
      authenticate({ pool }),
      requireCsrf,
      propertyImageUpload,
      images.createSubmission,
    );
  router.get(
    '/management/images/:imageId/original/',
    authenticate({ pool }),
    images.original,
  );
  router.use(siteWorkflowsRouter({ pool, mediaConfig, logger }));
  router.use(ownerViewingWorkflowsRouter({ pool }));
  router.use(adminManagementWorkflowsRouter({ pool, mediaConfig, logger }));
  return router;
}
