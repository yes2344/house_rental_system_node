import { apiClient } from './client';

export type ThemePreference = 'light' | 'dark' | 'system';
export type LocalePreference = 'en' | 'am';
export type DensityPreference = 'comfortable' | 'compact';

export interface UserPreferences {
  theme: ThemePreference;
  locale: LocalePreference;
  density: DensityPreference;
  reduced_motion: boolean;
}

export type UserPreferencesUpdate = Partial<UserPreferences>;

export const defaultUserPreferences: UserPreferences = {
  theme: 'system',
  locale: 'en',
  density: 'comfortable',
  reduced_motion: false,
};

export async function getUserPreferences(signal?: AbortSignal): Promise<UserPreferences> {
  const response = await apiClient.get<UserPreferences>('/auth/preferences/', { signal });
  return response.data;
}

export async function updateUserPreferences(
  preferences: UserPreferencesUpdate,
): Promise<UserPreferences> {
  const response = await apiClient.patch<UserPreferences>('/auth/preferences/', preferences);
  return response.data;
}

export async function resetUserPreferences(): Promise<UserPreferences> {
  const response = await apiClient.post<UserPreferences>('/auth/preferences/reset/', {});
  return response.data;
}
