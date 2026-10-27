import {
  accessViewingReceipt,
  actOnManagementViewingRequest,
  assignSubmission,
  cancelCustomerViewingRequest,
  createOwnerSubmission,
  createViewingRequest,
  decideSubmission,
  deleteCustomerViewingRequest,
  deleteManagementSubmissions,
  deleteOwnerSubmissions,
  getCustomerViewingRequest,
  getManagementSubmission,
  getManagementViewingRequest,
  getOwnerSubmission,
  listCustomerViewingRequests,
  listManagementSubmissions,
  listManagementViewingRequests,
  listNotifications,
  listOwnerSubmissions,
  listSubmissionReviewers,
  patchCustomerViewingRequest,
  patchManagementViewingRequest,
  patchOwnerSubmission,
  readNotification,
  respondCustomerViewingRequest,
} from '../services/ownerViewingWorkflowsService.js';

const endpoint = (operation, statusCode = 200) => async (request, response, next) => {
  try {
    const result = await operation(request);
    if (result === null) {
      response.status(204).end();
      return;
    }
    response.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};

export function ownerViewingWorkflowsController({ pool }) {
  return {
    ownerSubmissionList: endpoint((request) => listOwnerSubmissions(
      pool, request, request.userId, request.validated.query,
    )),
    ownerSubmissionCreate: endpoint((request) => createOwnerSubmission(
      pool, request.userId, request.validated.body, request,
    ), 201),
    ownerSubmissionDetail: endpoint((request) => getOwnerSubmission(
      pool, request.userId, request.params.submissionId, request,
    )),
    ownerSubmissionPatch: endpoint((request) => patchOwnerSubmission(
      pool, request.userId, request.params.submissionId, request.validated.body, request,
    )),
    ownerSubmissionBulkDelete: endpoint((request) => deleteOwnerSubmissions(
      pool, request.userId, request.validated.body.ids,
    )),
    managementSubmissionList: endpoint((request) => listManagementSubmissions(
      pool, request, request.userId, request.validated.query,
    )),
    managementSubmissionBulkDelete: endpoint((request) => deleteManagementSubmissions(
      pool, request.userId, request.validated.body.ids,
    )),
    managementSubmissionReviewers: endpoint((request) => listSubmissionReviewers(
      pool, request.userId,
    )),
    managementSubmissionDetail: endpoint((request) => getManagementSubmission(
      pool, request.userId, request.params.submissionId, request,
    )),
    managementSubmissionAssignment: endpoint((request) => assignSubmission(
      pool, request.userId, request.params.submissionId,
      request.validated.body.assigned_reviewer_id, request,
    )),
    managementSubmissionDecision: endpoint((request) => decideSubmission(
      pool, request.userId, request.params.submissionId, request.validated.body, request,
    )),
    notificationList: endpoint((request) => listNotifications(
      pool, request, request.userId, request.validated.query,
    )),
    notificationRead: endpoint((request) => readNotification(
      pool, request.userId, request.params.notificationId,
    )),
    viewingCreate: endpoint((request) => createViewingRequest(
      pool, request.userId, request.validated.body,
    ), 201),
    customerViewingList: endpoint((request) => listCustomerViewingRequests(
      pool, request, request.userId, request.validated.query,
    )),
    customerViewingDetail: endpoint((request) => getCustomerViewingRequest(
      pool, request.userId, request.params.requestId,
    )),
    customerViewingPatch: endpoint((request) => patchCustomerViewingRequest(
      pool, request.userId, request.params.requestId, request.validated.body,
    )),
    customerViewingRespond: endpoint((request) => respondCustomerViewingRequest(
      pool, request.userId, request.params.requestId, request.validated.body.decision, request.validated.body.message,
    )),
    customerViewingCancel: endpoint((request) => cancelCustomerViewingRequest(
      pool, request.userId, request.params.requestId, request.validated.body.message,
    )),
    customerViewingDelete: endpoint((request) => deleteCustomerViewingRequest(
      pool, request.userId, request.params.requestId,
    )),
    managementViewingList: endpoint((request) => listManagementViewingRequests(
      pool, request, request.userId, request.validated.query,
    )),
    managementViewingDetail: endpoint((request) => getManagementViewingRequest(
      pool, request.userId, request.params.requestId,
    )),
    managementViewingPatch: endpoint((request) => patchManagementViewingRequest(
      pool, request.userId, request.params.requestId, request.validated.body,
    )),
    managementViewingAction: endpoint((request) => actOnManagementViewingRequest(
      pool, request.userId, request.params.requestId, request.validated.body.action, request.validated.body.message,
    )),
    viewingReceiptGet: endpoint((request) => accessViewingReceipt(
      pool, request.get('X-Viewing-Receipt'),
    )),
    viewingReceiptDecision: endpoint((request) => accessViewingReceipt(
      pool, request.get('X-Viewing-Receipt'), request.validated.body.decision,
    )),
  };
}
