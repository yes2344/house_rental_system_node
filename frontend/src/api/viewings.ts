import { apiClient } from './client';

export interface ViewingRequestPayload {
  property_id: number;
  full_name: string;
  email: string;
  phone: string;
  preferred_date: string;
  preferred_time?: string | null;
  message?: string;
}

export type ViewingRequestStatusValue =
  | 'pending'
  | 'proposed'
  | 'confirmed'
  | 'rejected'
  | 'declined'
  | 'cancelled'
  | 'completed';

export interface ViewingRequestReceipt {
  id: number;
  status: ViewingRequestStatusValue;
  created_at: string;
}

export interface ViewingRequestStatus {
  id: number;
  property_title: string;
  status: ViewingRequestStatusValue;
  preferred_date: string;
  preferred_time: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  appointment_timezone: string;
  created_at: string;
}

export interface CustomerViewingRequest {
  id: number;
  property: {
    id: number;
    title: string;
    slug: string;
    listing_type: 'sale' | 'rent';
    status: string;
    location: string;
  };
  full_name: string;
  email: string;
  phone: string;
  preferred_date: string;
  preferred_time: string | null;
  message: string;
  proposed_date: string | null;
  proposed_time: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: ViewingRequestStatusValue;
  appointment_timezone: string;
  events: {
    event_type: string;
    from_status: string;
    to_status: string;
    proposed_date: string | null;
    proposed_time: string | null;
    actor_name: string | null;
    message: string;
    created_at: string;
  }[];
  created_at: string;
}

export type CustomerViewingRequestUpdate = Pick<
  ViewingRequestPayload,
  'full_name' | 'email' | 'phone' | 'preferred_date' | 'preferred_time' | 'message'
>;

export interface CustomerViewingRequestPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: CustomerViewingRequest[];
}

export async function createViewingRequest(
  payload: ViewingRequestPayload,
): Promise<ViewingRequestReceipt> {
  const response = await apiClient.post<ViewingRequestReceipt>('/viewing-requests/', payload);
  return response.data;
}

export async function getCustomerViewingRequests(
  page: number,
  status?: ViewingRequestStatusValue,
): Promise<CustomerViewingRequestPage> {
  const response = await apiClient.get<CustomerViewingRequestPage>('/viewing-requests/mine/', {
    params: { page, ...(status ? { status } : {}) },
  });
  return response.data;
}

export async function updateCustomerViewingRequest(
  id: number,
  payload: Partial<CustomerViewingRequestUpdate>,
): Promise<CustomerViewingRequest> {
  const response = await apiClient.patch<CustomerViewingRequest>(
    `/viewing-requests/mine/${id}/`,
    payload,
  );
  return response.data;
}

export async function respondToCustomerViewingRequest(
  id: number,
  decision: 'accept' | 'decline',
  message = '',
): Promise<CustomerViewingRequest> {
  const response = await apiClient.post<CustomerViewingRequest>(
    `/viewing-requests/mine/${id}/respond/`,
    { decision, message },
  );
  return response.data;
}

export async function cancelCustomerViewingRequest(
  id: number,
  message = '',
): Promise<CustomerViewingRequest> {
  const response = await apiClient.post<CustomerViewingRequest>(
    `/viewing-requests/mine/${id}/cancel/`,
    { message },
  );
  return response.data;
}

export async function deleteCustomerViewingRequest(id: number): Promise<void> {
  await apiClient.delete(`/viewing-requests/mine/${id}/`);
}

export async function getViewingRequestStatus(receiptToken: string): Promise<ViewingRequestStatus> {
  const response = await apiClient.get<ViewingRequestStatus>('/viewing-requests/receipt/', {
    headers: { 'X-Viewing-Receipt': receiptToken },
  });
  return response.data;
}

export async function respondToViewingProposal(
  receiptToken: string,
  decision: 'accept' | 'decline',
): Promise<ViewingRequestStatus> {
  const response = await apiClient.post<ViewingRequestStatus>(
    '/viewing-requests/receipt/',
    { decision },
    { headers: { 'X-Viewing-Receipt': receiptToken } },
  );
  return response.data;
}
