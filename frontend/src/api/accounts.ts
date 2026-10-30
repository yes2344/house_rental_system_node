import {
  apiClient,
  clearTabSessionToken,
  setCsrfToken,
  setTabSessionToken,
} from './client';

export type AccountRole = 'customer' | 'owner' | 'agent' | 'administrator' | null;

export interface Account {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AccountRole;
  phone: string;
  management_permissions: string[];
  is_platform_owner: boolean;
  agent_onboarding_required: boolean;
  agent_password_changed: boolean;
  assigned_city_id: number | null;
  assigned_city_name: string | null;
  assigned_city_name_am: string | null;
}

export interface RegistrationPayload {
  username: string;
  email: string;
  password: string;
  phone?: string;
}

export interface AccountEmailPayload {
  email: string;
}

export interface AccountTokenPayload {
  uid: string;
  token: string;
}

export interface PasswordResetPayload extends AccountTokenPayload {
  password: string;
  password_confirmation: string;
}

export interface AccountUpdatePayload {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

export interface AgentInitialPasswordPayload {
  username?: string;
  new_password: string;
}

export interface AgentProfilePayload {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export interface AccountActivity {
  favorites: {
    id: number;
    property: {
      id: number;
      title: string;
      slug: string;
      listing_type: 'sale' | 'rent';
      status: string;
    };
    created_at: string;
  }[];
  viewing_requests: {
    id: number;
    property: {
      id: number;
      title: string;
      slug: string;
      listing_type: 'sale' | 'rent';
      status: string;
    };
    status: 'pending' | 'proposed' | 'confirmed' | 'rejected' | 'declined' | 'cancelled' | 'completed';
    preferred_date: string;
    preferred_time: string | null;
    scheduled_date: string | null;
    scheduled_time: string | null;
    created_at: string;
  }[];
}

export async function getCsrfToken(): Promise<string> {
  const response = await apiClient.get<{ csrf_token: string }>('/auth/csrf/');
  setCsrfToken(response.data.csrf_token);
  return response.data.csrf_token;
}

export async function getCurrentAccount(signal?: AbortSignal): Promise<Account> {
  const response = await apiClient.get<Account>('/auth/me/', { signal });
  return response.data;
}

export async function registerAccount(payload: RegistrationPayload): Promise<Account> {
  const response = await apiClient.post<Account>('/auth/register/', payload);
  return response.data;
}

export async function verifyEmail(payload: AccountTokenPayload): Promise<void> {
  await apiClient.post('/auth/verify-email/', payload);
}

export async function resendVerificationEmail(payload: AccountEmailPayload): Promise<void> {
  await apiClient.post('/auth/verify-email/resend/', payload);
}

export async function requestPasswordReset(payload: AccountEmailPayload): Promise<void> {
  await apiClient.post('/auth/password-reset/', payload);
}

export async function confirmPasswordReset(payload: PasswordResetPayload): Promise<void> {
  await apiClient.post('/auth/password-reset/confirm/', payload);
}

export async function startSession(identifier: string, password: string): Promise<Account> {
  const csrfToken = await getCsrfToken();
  const response = await apiClient.post<Account & { csrf_token: string; session_token: string }>(
    '/auth/login/',
    { identifier, password },
    { headers: { 'X-CSRFToken': csrfToken } },
  );
  setCsrfToken(response.data.csrf_token);
  setTabSessionToken(response.data.session_token);
  return response.data;
}

export async function endSession(): Promise<void> {
  await apiClient.post('/auth/logout/', {});
  clearTabSessionToken();
}

export async function updateAccount(payload: AccountUpdatePayload): Promise<Account> {
  const response = await apiClient.patch<Account>('/auth/me/', payload);
  return response.data;
}

export async function changeAgentInitialPassword(
  payload: AgentInitialPasswordPayload,
): Promise<Account> {
  const response = await apiClient.post<Account>('/auth/agent-onboarding/password/', payload);
  return response.data;
}

export async function completeAgentInitialProfile(payload: AgentProfilePayload): Promise<Account> {
  const response = await apiClient.post<Account>('/auth/agent-onboarding/profile/', payload);
  return response.data;
}

export async function getAccountActivity(signal?: AbortSignal): Promise<AccountActivity> {
  const response = await apiClient.get<AccountActivity>('/auth/activity/', { signal });
  return response.data;
}
