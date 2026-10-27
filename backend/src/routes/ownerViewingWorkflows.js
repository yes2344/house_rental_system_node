import { Router } from 'express';
import { ownerViewingWorkflowsController } from '../controllers/ownerViewingWorkflowsController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireCsrf } from '../middleware/csrf.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  assignmentSchema,
  bulkDeleteSchema,
  decisionSchema,
  managementSubmissionQuerySchema,
  notificationQuerySchema,
  submissionCreateSchema,
  submissionPatchSchema,
  submissionQuerySchema,
  viewingActionSchema,
  viewingCancellationSchema,
  viewingCreateSchema,
  viewingManagerPatchSchema,
  viewingPatchSchema,
  viewingQuerySchema,
  viewingDecisionSchema,
} from '../validators/ownerViewingWorkflows.js';

export function ownerViewingWorkflowsRouter({ pool }) {
  const router = Router();
  const controller = ownerViewingWorkflowsController({ pool });
  const auth = authenticate({ pool });

  router.route('/submissions/')
    .get(auth, validateRequest(submissionQuerySchema, 'query'), controller.ownerSubmissionList)
    .post(auth, requireCsrf, validateRequest(submissionCreateSchema), controller.ownerSubmissionCreate);
  router.post('/submissions/bulk-delete/', auth, requireCsrf, validateRequest(bulkDeleteSchema), controller.ownerSubmissionBulkDelete);
  router.route('/submissions/:submissionId/')
    .get(auth, validateRequestId('submissionId'), controller.ownerSubmissionDetail)
    .patch(auth, requireCsrf, validateRequestId('submissionId'), validateRequest(submissionPatchSchema), controller.ownerSubmissionPatch);

  router.get('/management/submissions/', auth, validateRequest(managementSubmissionQuerySchema, 'query'), controller.managementSubmissionList);
  router.post('/management/submissions/bulk-delete/', auth, requireCsrf, validateRequest(bulkDeleteSchema), controller.managementSubmissionBulkDelete);
  router.get('/management/submissions/reviewers/', auth, controller.managementSubmissionReviewers);
  router.get('/management/submissions/:submissionId/', auth, validateRequestId('submissionId'), controller.managementSubmissionDetail);
  router.post('/management/submissions/:submissionId/assignment/', auth, requireCsrf, validateRequestId('submissionId'), validateRequest(assignmentSchema), controller.managementSubmissionAssignment);
  router.post('/management/submissions/:submissionId/decision/', auth, requireCsrf, validateRequestId('submissionId'), validateRequest(decisionSchema), controller.managementSubmissionDecision);

  router.get('/notifications/', auth, validateRequest(notificationQuerySchema, 'query'), controller.notificationList);
  router.post('/notifications/:notificationId/read/', auth, requireCsrf, validateRequestId('notificationId'), controller.notificationRead);

  router.post('/viewing-requests/', auth, requireCsrf, validateRequest(viewingCreateSchema), controller.viewingCreate);
  router.use('/viewing-requests/receipt/', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.route('/viewing-requests/receipt/')
    .get(controller.viewingReceiptGet)
    .post(requireCsrf, validateRequest(viewingDecisionSchema), controller.viewingReceiptDecision);
  router.route('/viewing-requests/mine/')
    .get(auth, validateRequest(viewingQuerySchema, 'query'), controller.customerViewingList);
  router.route('/viewing-requests/mine/:requestId/')
    .get(auth, validateRequestId('requestId'), controller.customerViewingDetail)
    .patch(auth, requireCsrf, validateRequestId('requestId'), validateRequest(viewingPatchSchema), controller.customerViewingPatch)
    .delete(auth, requireCsrf, validateRequestId('requestId'), controller.customerViewingDelete);
  router.post('/viewing-requests/mine/:requestId/respond/', auth, requireCsrf, validateRequestId('requestId'), validateRequest(viewingDecisionSchema), controller.customerViewingRespond);
  router.post('/viewing-requests/mine/:requestId/cancel/', auth, requireCsrf, validateRequestId('requestId'), validateRequest(viewingCancellationSchema), controller.customerViewingCancel);
  router.get('/management/viewing-requests/', auth, validateRequest(viewingQuerySchema, 'query'), controller.managementViewingList);
  router.route('/management/viewing-requests/:requestId/')
    .get(auth, validateRequestId('requestId'), controller.managementViewingDetail)
    .patch(auth, requireCsrf, validateRequestId('requestId'), validateRequest(viewingManagerPatchSchema), controller.managementViewingPatch);
  router.post('/management/viewing-requests/:requestId/action/', auth, requireCsrf, validateRequestId('requestId'), validateRequest(viewingActionSchema), controller.managementViewingAction);
  return router;
}

function validateRequestId(name) {
  return (request, _response, next) => {
    if (!/^[1-9]\d*$/.test(request.params[name]) || !Number.isSafeInteger(Number(request.params[name]))) {
      const error = new Error('Request validation failed.');
      error.statusCode = 400;
      error.details = { [name]: ['Must be a positive integer.'] };
      next(error);
      return;
    }
    next();
  };
}
