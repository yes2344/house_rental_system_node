import { apiClient } from './client';

export type PublicInformationPageSlug = 'about' | 'contact' | 'property-management';

export interface PublicInformationPage {
  page: PublicInformationPageSlug;
  title_en: string;
  title_am: string;
  introduction_en: string;
  introduction_am: string;
  body_en: string;
  body_am: string;
  updated_at: string;
}

export type PublicInformationPageContent = Omit<PublicInformationPage, 'page' | 'updated_at'>;

export async function getPublicInformationPage(
  page: PublicInformationPageSlug,
  signal?: AbortSignal,
): Promise<PublicInformationPage> {
  const response = await apiClient.get<PublicInformationPage>(`/public-pages/${page}/`, { signal });
  return response.data;
}

export async function getManagedPublicInformationPages(
  signal?: AbortSignal,
): Promise<PublicInformationPage[]> {
  const response = await apiClient.get<{ results: PublicInformationPage[] }>(
    '/management/public-pages/',
    { signal },
  );
  return response.data.results;
}

export async function updateManagedPublicInformationPage(
  page: PublicInformationPageSlug,
  content: Partial<PublicInformationPageContent>,
): Promise<PublicInformationPage> {
  const response = await apiClient.patch<PublicInformationPage>(
    `/management/public-pages/${page}/`,
    content,
  );
  return response.data;
}
