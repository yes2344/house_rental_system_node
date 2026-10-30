import { apiClient } from './client';
import type { PaginatedResponse } from './properties';

export interface HomepageNote {
  id: number;
  title: string;
  text: string;
  image: string | null;
  is_published: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface HomepageNotePayload {
  title: string;
  text: string;
  is_published: boolean;
  display_order: number;
  image?: File;
}

function toHomepageNoteFormData(payload: Partial<HomepageNotePayload>): FormData {
  const formData = new FormData();
  if (payload.title !== undefined) formData.append('title', payload.title);
  if (payload.text !== undefined) formData.append('text', payload.text);
  if (payload.is_published !== undefined) {
    formData.append('is_published', String(payload.is_published));
  }
  if (payload.display_order !== undefined) {
    formData.append('display_order', String(payload.display_order));
  }
  if (payload.image) formData.append('image', payload.image);
  return formData;
}

export async function getHomepageNotes(signal?: AbortSignal): Promise<HomepageNote[]> {
  const response = await apiClient.get<PaginatedResponse<HomepageNote>>('/homepage-notes/', { signal });
  return response.data.results;
}

export async function getManagedHomepageNotes(signal?: AbortSignal): Promise<HomepageNote[]> {
  const response = await apiClient.get<PaginatedResponse<HomepageNote>>('/management/homepage-notes/', { signal });
  return response.data.results;
}

export async function createHomepageNote(payload: HomepageNotePayload): Promise<HomepageNote> {
  const response = await apiClient.post<HomepageNote>(
    '/management/homepage-notes/',
    toHomepageNoteFormData(payload),
  );
  return response.data;
}

export async function updateHomepageNote(
  id: number,
  payload: Partial<HomepageNotePayload>,
): Promise<HomepageNote> {
  const response = await apiClient.patch<HomepageNote>(
    `/management/homepage-notes/${id}/`,
    toHomepageNoteFormData(payload),
  );
  return response.data;
}

export async function deleteHomepageNote(id: number): Promise<void> {
  await apiClient.delete(`/management/homepage-notes/${id}/`);
}
