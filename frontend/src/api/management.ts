import { apiClient } from './client';
import type { LocationType, MarketplaceLocation, PaginatedResponse, PropertyLocationPathItem } from './properties';

export type ManagedListingType = 'sale' | 'rent';
export type ManagedPropertyType =
  | 'house' | 'villa' | 'apartment' | 'condominium' | 'land'
  | 'office' | 'shop' | 'warehouse' | 'commercial' | 'other';
export type ManagedPropertyStatus = 'available' | 'rented' | 'sold' | 'inactive';
export type PublicationStatus =
  | 'draft' | 'pending_review' | 'published' | 'rejected' | 'suspended' | 'expired' | 'withdrawn';
export type ManagedAreaUnit = 'sqm' | 'sqft' | '';
export type ManagedRentalFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | '';
export type ViewingRequestStatus =
  | 'pending'
  | 'proposed'
  | 'confirmed'
  | 'rejected'
  | 'declined'
  | 'cancelled'
  | 'completed';

export interface AmenityOption {
  id: number;
  name: string;
  name_am: string;
  slug: string;
}

export interface ManagedAgentAccount {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  assigned_city_id: number | null;
  role: 'agent';
  is_active: boolean;
  agent_approved: boolean;
  agent_onboarding_required: boolean;
  management_permissions: string[];
  date_joined: string;
}

export interface ManagedPublicAccount {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: 'customer' | 'owner';
  is_active: boolean;
  date_joined: string;
}

export type ManagedLocationType = LocationType;

export interface ManagedLocationPayload {
  name: string;
  name_am: string;
  is_active: boolean;
  display_order: number;
  location_type?: ManagedLocationType;
  parent?: number;
}

export async function getManagedLocations(signal?: AbortSignal): Promise<MarketplaceLocation[]> {
  const response = await apiClient.get<MarketplaceLocation[]>('/management/locations/', {
    params: { all: 1 },
    signal,
  });
  return response.data;
}

export async function createManagedLocation(payload: ManagedLocationPayload): Promise<MarketplaceLocation> {
  const response = await apiClient.post<MarketplaceLocation>('/management/locations/', payload);
  return response.data;
}

export async function updateManagedLocation(
  id: number,
  payload: Partial<ManagedLocationPayload>,
): Promise<MarketplaceLocation> {
  const response = await apiClient.patch<MarketplaceLocation>(`/management/locations/${id}/`, payload);
  return response.data;
}

export async function deleteManagedLocation(id: number): Promise<void> {
  await apiClient.delete(`/management/locations/${id}/`);
}

export async function getManagedAgentAccounts(signal?: AbortSignal): Promise<ManagedAgentAccount[]> {
  const accounts: ManagedAgentAccount[] = [];
  let nextPage: string | null = '/admin/delegated-accounts/';
  while (nextPage) {
    const currentPage: string = nextPage;
    const pageResponse = await apiClient.get<PaginatedResponse<ManagedAgentAccount>>(
      currentPage,
      { signal },
    );
    accounts.push(...pageResponse.data.results);
    nextPage = pageResponse.data.next;
  }
  return accounts;
}

export async function createManagedAgentAccount(
  payload: { username: string; password: string; assigned_city_id: number },
): Promise<ManagedAgentAccount> {
  const response = await apiClient.post<ManagedAgentAccount>('/admin/delegated-accounts/', payload);
  return response.data;
}

export async function updateManagedAgentAccount(
  id: number,
  payload: Partial<Pick<ManagedAgentAccount, 'username' | 'email' | 'first_name' | 'last_name' | 'phone' | 'is_active' | 'assigned_city_id'>>
    & { initial_password?: string; management_permissions?: string[] },
): Promise<ManagedAgentAccount> {
  const response = await apiClient.patch<ManagedAgentAccount>(`/admin/delegated-accounts/${id}/`, payload);
  return response.data;
}

export async function deleteManagedAgentAccount(id: number): Promise<void> {
  await apiClient.delete(`/admin/delegated-accounts/${id}/`);
}

export async function getManagedPublicAccounts(signal?: AbortSignal): Promise<ManagedPublicAccount[]> {
  const accounts: ManagedPublicAccount[] = [];
  let nextPage: string | null = '/admin/public-accounts/';
  while (nextPage) {
    const currentPage: string = nextPage;
    const pageResponse = await apiClient.get<PaginatedResponse<ManagedPublicAccount>>(
      currentPage,
      { signal },
    );
    accounts.push(...pageResponse.data.results);
    nextPage = pageResponse.data.next;
  }
  return accounts;
}

export async function createManagedPublicAccount(
  payload: Omit<ManagedPublicAccount, 'id' | 'date_joined' | 'is_active'> & { password: string },
): Promise<ManagedPublicAccount> {
  const response = await apiClient.post<ManagedPublicAccount>('/admin/public-accounts/', payload);
  return response.data;
}

export async function updateManagedPublicAccount(
  id: number,
  payload: Partial<Pick<ManagedPublicAccount, 'username' | 'email' | 'first_name' | 'last_name' | 'phone' | 'role' | 'is_active'>>
    & { password?: string },
): Promise<ManagedPublicAccount> {
  const response = await apiClient.patch<ManagedPublicAccount>(`/admin/public-accounts/${id}/`, payload);
  return response.data;
}

export async function deleteManagedPublicAccount(id: number): Promise<void> {
  await apiClient.delete(`/admin/public-accounts/${id}/`);
}

export async function actOnManagedViewingRequest(
  id: number,
  action: 'confirm_requested' | 'cancel' | 'complete',
  message = '',
): Promise<ManagedViewingRequest> {
  const response = await apiClient.post<ManagedViewingRequest>(
    `/management/viewing-requests/${id}/action/`,
    { action, message },
  );
  return response.data;
}

export interface ManagedProperty {
  id: number;
  title: string;
  slug: string;
  location: string;
  administrative_location: number | null;
  location_path: PropertyLocationPathItem[];
  category: ManagedPropertyType;
  listing_type: ManagedListingType;
  price: string;
  currency: 'ETB';
  bedrooms: number;
  bathrooms: number;
  area_sqft: number;
  area_value: string | null;
  area_unit: ManagedAreaUnit;
  rental_frequency: ManagedRentalFrequency;
  description: string;
  features: string;
  status: ManagedPropertyStatus;
  publication_status: PublicationStatus;
  is_featured: boolean;
  submitted_by_id: number | null;
  moderation_note: string;
  amenities: number[];
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  images: { id: number; url: string | null; caption: string; is_primary: boolean }[];
  created_at: string;
  updated_at: string;
}

export interface ManagedPropertyPayload {
  title: string;
  location: string;
  administrative_location: number | null;
  category: ManagedPropertyType;
  listing_type: ManagedListingType;
  price: string;
  bedrooms: number;
  bathrooms: number;
  area_sqft: number;
  area_value: string | null;
  area_unit: ManagedAreaUnit;
  rental_frequency: ManagedRentalFrequency;
  description: string;
  features: string;
  status: ManagedPropertyStatus;
  amenities: number[];
  contact_name: string;
  contact_phone: string;
  contact_email: string;
}

export interface ManagedImage {
  id: number;
  image: string;
  original_url: string | null;
  caption: string;
  is_primary: boolean;
  created_at: string;
}

export interface ManagedViewingRequest {
  id: number;
  property: {
    id: number;
    title: string;
    slug: string;
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
  status: ViewingRequestStatus;
  scheduled_date: string | null;
  scheduled_time: string | null;
  agent_notes: string;
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

export interface ManagedViewingRequestPayload {
  status?: 'rejected';
  proposed_date?: string | null;
  proposed_time?: string | null;
  agent_notes: string;
}

export interface ManagedPropertyFilters {
  search?: string;
  status?: ManagedPropertyStatus;
  publication_status?: PublicationStatus;
  listing_type?: ManagedListingType;
  property_type?: ManagedPropertyType;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export async function getAmenities(signal?: AbortSignal): Promise<AmenityOption[]> {
  const response = await apiClient.get<PaginatedResponse<AmenityOption>>('/amenities/', { signal });
  return response.data.results;
}

export async function getManagedProperties(
  filters: ManagedPropertyFilters,
  signal?: AbortSignal,
): Promise<PaginatedResponse<ManagedProperty>> {
  const response = await apiClient.get<PaginatedResponse<ManagedProperty>>('/management/properties/', {
    params: filters,
    signal,
  });
  return response.data;
}

export async function getManagedProperty(id: number, signal?: AbortSignal): Promise<ManagedProperty> {
  const response = await apiClient.get<ManagedProperty>(`/management/properties/${id}/`, { signal });
  return response.data;
}

export async function createManagedProperty(payload: ManagedPropertyPayload): Promise<ManagedProperty> {
  const response = await apiClient.post<ManagedProperty>('/management/properties/', payload);
  return response.data;
}

export async function updateManagedProperty(
  id: number,
  payload: ManagedPropertyPayload,
): Promise<ManagedProperty> {
  const response = await apiClient.patch<ManagedProperty>(`/management/properties/${id}/`, payload);
  return response.data;
}

export async function updateManagedPropertyPublication(
  id: number,
  publication_status: 'published' | 'draft',
): Promise<ManagedProperty> {
  const response = await apiClient.post<ManagedProperty>(
    `/management/properties/${id}/publication/`,
    { publication_status },
  );
  return response.data;
}

export async function deleteManagedProperty(id: number): Promise<void> {
  await apiClient.delete(`/management/properties/${id}/`);
}

export async function deleteManagedProperties(ids: number[]): Promise<number> {
  const response = await apiClient.post<{ deleted_count: number }>(
    '/management/properties/bulk-delete/',
    { ids },
  );
  return response.data.deleted_count;
}

export async function getManagedImages(propertyId: number, signal?: AbortSignal): Promise<ManagedImage[]> {
  const response = await apiClient.get<PaginatedResponse<ManagedImage>>(
    `/management/properties/${propertyId}/images/`,
    { signal },
  );
  return response.data.results;
}

export async function uploadManagedImage(
  propertyId: number,
  image: File,
  caption: string,
  isPrimary: boolean,
): Promise<ManagedImage> {
  const formData = new FormData();
  formData.append('image', image);
  formData.append('caption', caption);
  formData.append('is_primary', String(isPrimary));
  const response = await apiClient.post<ManagedImage>(
    `/management/properties/${propertyId}/images/`,
    formData,
  );
  return response.data;
}

export async function updateManagedImage(
  propertyId: number,
  imageId: number,
  payload: { is_primary?: boolean; caption?: string },
): Promise<ManagedImage> {
  const response = await apiClient.patch<ManagedImage>(
    `/management/properties/${propertyId}/images/${imageId}/`,
    payload,
  );
  return response.data;
}

export async function deleteManagedImage(propertyId: number, imageId: number): Promise<void> {
  await apiClient.delete(`/management/properties/${propertyId}/images/${imageId}/`);
}

export interface ManagedViewingRequestFilters {
  status?: ViewingRequestStatus;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export async function getManagedViewingRequests(
  filters: ManagedViewingRequestFilters,
  signal?: AbortSignal,
): Promise<PaginatedResponse<ManagedViewingRequest>> {
  const response = await apiClient.get<PaginatedResponse<ManagedViewingRequest>>(
    '/management/viewing-requests/',
    { params: filters, signal },
  );
  return response.data;
}

export async function getManagedViewingRequest(
  id: number,
): Promise<ManagedViewingRequest> {
  const response = await apiClient.get<ManagedViewingRequest>(`/management/viewing-requests/${id}/`);
  return response.data;
}

export async function updateManagedViewingRequest(
  id: number,
  payload: ManagedViewingRequestPayload,
): Promise<ManagedViewingRequest> {
  const response = await apiClient.patch<ManagedViewingRequest>(
    `/management/viewing-requests/${id}/`,
    payload,
  );
  return response.data;
}
