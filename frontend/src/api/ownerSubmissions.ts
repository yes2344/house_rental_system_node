import { apiClient } from './client';
import type {
  ManagedImage,
  ManagedProperty,
  ManagedPropertyPayload,
} from './management';
import type { PaginatedResponse } from './properties';

export type OwnerSubmissionStatus =
  | 'pending_review'
  | 'corrections_requested'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'expired'
  | 'withdrawn';

export interface OwnerSubmission extends Omit<ManagedProperty, 'publication_status'> {
  publication_status: ManagedProperty['publication_status'];
  owner_contact_name: string;
  owner_contact_phone: string;
  owner_contact_email: string;
  submission_status: OwnerSubmissionStatus;
  review_feedback: string;
  submission_events: {
    event_type: string;
    from_status: string;
    to_status: string;
    details: Record<string, unknown>;
    actor_name: string | null;
    created_at: string;
  }[];
}

export type OwnerSubmissionPayload = Omit<
  ManagedPropertyPayload,
  'status' | 'contact_name' | 'contact_phone' | 'contact_email'
> & {
  owner_contact_name?: string;
  owner_contact_phone?: string;
  owner_contact_email?: string;
  authorization_confirmed?: boolean;
  terms_accepted?: boolean;
};

export interface OwnerSubmissionReview {
  id: number;
  property: OwnerSubmission;
  owner_contact_name: string;
  owner_contact_phone: string;
  owner_contact_email: string;
  status: OwnerSubmissionStatus;
  agent_feedback: string;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_id: number | null;
  assigned_reviewer_id: number | null;
  assigned_reviewer_name: string | null;
  events: OwnerSubmission['submission_events'];
}

export interface SubmissionReviewer {
  id: number;
  username: string;
  display_name: string;
}

export interface OwnerSubmissionReviewFilters {
  status?: OwnerSubmissionStatus;
  page?: number;
  ordering?: string;
}

export async function getMySubmissions(
  page = 1,
  signal?: AbortSignal,
): Promise<PaginatedResponse<OwnerSubmission>> {
  const response = await apiClient.get<PaginatedResponse<OwnerSubmission>>('/submissions/', {
    params: { page },
    signal,
  });
  return response.data;
}

export async function getMySubmission(id: number, signal?: AbortSignal): Promise<OwnerSubmission> {
  const response = await apiClient.get<OwnerSubmission>(`/submissions/${id}/`, { signal });
  return response.data;
}

export async function createOwnerSubmission(payload: OwnerSubmissionPayload): Promise<OwnerSubmission> {
  const response = await apiClient.post<OwnerSubmission>('/submissions/', payload);
  return response.data;
}

export async function updateOwnerSubmission(
  id: number,
  payload: OwnerSubmissionPayload,
): Promise<OwnerSubmission> {
  const response = await apiClient.patch<OwnerSubmission>(`/submissions/${id}/`, payload);
  return response.data;
}

export async function deleteMySubmissions(ids: number[]): Promise<number> {
  const response = await apiClient.post<{ deleted_count: number }>(
    '/submissions/bulk-delete/',
    { ids },
  );
  return response.data.deleted_count;
}

export async function deleteManagedSubmissions(ids: number[]): Promise<number> {
  const response = await apiClient.post<{ deleted_count: number }>(
    '/management/submissions/bulk-delete/',
    { ids },
  );
  return response.data.deleted_count;
}

export async function uploadOwnerSubmissionImage(id: number, image: File): Promise<ManagedImage> {
  const formData = new FormData();
  formData.append('image', image);
  const response = await apiClient.post<ManagedImage>(`/submissions/${id}/images/`, formData);
  return response.data;
}

export async function getSubmissionReviews(
  filters: OwnerSubmissionReviewFilters = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<OwnerSubmissionReview>> {
  const response = await apiClient.get<PaginatedResponse<OwnerSubmissionReview>>(
    '/management/submissions/',
    { params: filters, signal },
  );
  return response.data;
}

export async function getSubmissionReviewers(signal?: AbortSignal): Promise<SubmissionReviewer[]> {
  const response = await apiClient.get<SubmissionReviewer[]>('/management/submissions/reviewers/', { signal });
  return response.data;
}

export async function assignSubmissionReviewer(
  id: number,
  assignedReviewerId: number | null,
): Promise<OwnerSubmissionReview> {
  const response = await apiClient.post<OwnerSubmissionReview>(
    `/management/submissions/${id}/assignment/`,
    { assigned_reviewer_id: assignedReviewerId },
  );
  return response.data;
}

export async function decideSubmission(
  id: number,
  payload:
    | { action: 'approve'; agreement_start_date: string; agreement_duration_months: number; agreement_terms: string }
    | { action: 'reject' | 'request_corrections'; feedback: string },
): Promise<OwnerSubmissionReview> {
  const response = await apiClient.post<OwnerSubmissionReview>(
    `/management/submissions/${id}/decision/`,
    payload,
  );
  return response.data;
}
