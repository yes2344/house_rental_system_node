import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

export const nodePublicApiClient = axios.create({
  baseURL,
  withCredentials: false,
  headers: { Accept: 'application/json' },
});

const tabSessionStorageKey = 'addis-ababa-homes.session-token';
let csrfTokenInMemory = '';
let csrfTokenRequest: Promise<string> | null = null;

export function setTabSessionToken(token: string) {
  window.sessionStorage.setItem(tabSessionStorageKey, token);
}

export function clearTabSessionToken() {
  window.sessionStorage.removeItem(tabSessionStorageKey);
}

export function setCsrfToken(token: string) {
  csrfTokenInMemory = token;
}

async function fetchCsrfToken(): Promise<string> {
  if (!csrfTokenRequest) {
    csrfTokenRequest = apiClient
      .get<{ csrf_token: string }>('/auth/csrf/')
      .then(({ data }) => {
        setCsrfToken(data.csrf_token);
        return data.csrf_token;
      })
      .finally(() => {
        csrfTokenRequest = null;
      });
  }
  return csrfTokenRequest;
}

export function getApiFieldErrors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {};
  const responseData = error.response?.data as
    | { error?: { details?: unknown } }
    | undefined;
  const details = responseData?.error?.details;
  if (!details || typeof details !== 'object') return {};

  const fieldErrors: Record<string, string> = {};
  for (const [field, value] of Object.entries(details)) {
    if (typeof value === 'string') fieldErrors[field] = value;
    else if (Array.isArray(value)) {
      const messages = value.filter((item): item is string => typeof item === 'string');
      if (messages.length) fieldErrors[field] = messages.join(' ');
    }
  }
  return fieldErrors;
}

apiClient.interceptors.request.use(async (config) => {
  const sessionToken = window.sessionStorage.getItem(tabSessionStorageKey);
  if (sessionToken) config.headers.set('Authorization', `Bearer ${sessionToken}`);

  if (config.method && !['get', 'head', 'options'].includes(config.method.toLowerCase())) {
    const cookieToken = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('csrftoken='))
      ?.split('=')
      .slice(1)
      .join('=');

    const csrfToken = cookieToken
      ? decodeURIComponent(cookieToken)
      : csrfTokenInMemory || await fetchCsrfToken();
    config.headers.set('X-CSRFToken', csrfToken);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error)
      && [401, 403].includes(error.response?.status ?? 0)
      && error.config?.url?.replace(/\/+$/, '').endsWith('/auth/me')
    ) {
      clearTabSessionToken();
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response && error.response.status >= 500) {
      return 'The server encountered an error. Please try again later.';
    }
    const fieldErrors = getApiFieldErrors(error);
    if (Object.keys(fieldErrors).length) return Object.values(fieldErrors).join(' ');
    const apiMessage = error.response?.data?.error?.message;
    if (typeof apiMessage === 'string') return apiMessage;
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (error.response) return `The server returned an error (${error.response.status}).`;
    return 'The server could not be reached. Check that the API service is running.';
  }
  return 'Something went wrong. Please try again.';
}
