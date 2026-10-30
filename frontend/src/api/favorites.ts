import { apiClient } from './client';
import type { PaginatedResponse, PropertySummary } from './properties';

export interface Favorite {
  id: number;
  property: PropertySummary;
  created_at: string;
}

export async function getFavorites(signal?: AbortSignal): Promise<Favorite[]> {
  const response = await apiClient.get<PaginatedResponse<Favorite>>('/favorites/', { signal });
  return response.data.results;
}

export async function addFavorite(propertyId: number): Promise<Favorite> {
  const response = await apiClient.post<Favorite>('/favorites/', { property_id: propertyId });
  return response.data;
}

export async function removeFavorite(propertyId: number): Promise<void> {
  await apiClient.delete(`/favorites/${propertyId}/`);
}
