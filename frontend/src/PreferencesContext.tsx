import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  defaultUserPreferences,
  getUserPreferences,
  resetUserPreferences,
  updateUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from './api/preferences';
import { getErrorMessage } from './api/client';
import { useAuth } from './AuthContext';

const guestPreferencesKey = 'habesha-homes-guest-preferences';

interface PreferencesContextValue {
  preferences: UserPreferences;
  preferencesLoading: boolean;
  preferencesError: string;
  savePreferences: (updates: UserPreferencesUpdate) => Promise<void>;
  resetPreferences: () => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function isTheme(value: unknown): value is UserPreferences['theme'] {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isLocale(value: unknown): value is UserPreferences['locale'] {
  return value === 'en' || value === 'am';
}

function isDensity(value: unknown): value is UserPreferences['density'] {
  return value === 'comfortable' || value === 'compact';
}

function readGuestPreferences(): { preferences: UserPreferences; error: string } {
  try {
    const rawPreferences = window.localStorage.getItem(guestPreferencesKey);
    if (!rawPreferences) return { preferences: { ...defaultUserPreferences }, error: '' };
    const parsed: unknown = JSON.parse(rawPreferences);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Stored display preferences are not a valid object.');
    }
    const values = parsed as Record<string, unknown>;
    return {
      preferences: {
        theme: isTheme(values.theme) ? values.theme : defaultUserPreferences.theme,
        locale: isLocale(values.locale) ? values.locale : defaultUserPreferences.locale,
        density: isDensity(values.density) ? values.density : defaultUserPreferences.density,
        reduced_motion: typeof values.reduced_motion === 'boolean'
          ? values.reduced_motion
          : defaultUserPreferences.reduced_motion,
      },
      error: '',
    };
  } catch (error: unknown) {
    return { preferences: { ...defaultUserPreferences }, error: getErrorMessage(error) };
  }
}

function storeGuestPreferences(preferences: UserPreferences) {
  window.localStorage.setItem(guestPreferencesKey, JSON.stringify(preferences));
}

interface PreferencesProviderProps {
  children: ReactNode;
}

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const { account, authLoading } = useAuth();
  const [initialGuestState] = useState(readGuestPreferences);
  const [preferences, setPreferences] = useState<UserPreferences>(initialGuestState.preferences);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesError, setPreferencesError] = useState(initialGuestState.error);
  const loadRequestId = useRef(0);

  useEffect(() => {
    document.documentElement.lang = preferences.locale;
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.reducedMotion = preferences.reduced_motion ? 'reduce' : 'system';
  }, [preferences.locale, preferences.density, preferences.reduced_motion]);

  useEffect(() => {
    const root = document.documentElement;
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      root.dataset.theme = preferences.theme === 'system'
        ? (colorScheme.matches ? 'dark' : 'light')
        : preferences.theme;
      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (themeColor) {
        themeColor.content = root.dataset.theme === 'dark' ? '#121a17' : '#f8f8f4';
      }
    };
    applyTheme();
    colorScheme.addEventListener('change', applyTheme);
    return () => colorScheme.removeEventListener('change', applyTheme);
  }, [preferences.theme]);

  useEffect(() => {
    if (authLoading) return;

    const requestId = ++loadRequestId.current;
    if (!account) {
      const guestState = readGuestPreferences();
      setPreferences(guestState.preferences);
      setPreferencesError(guestState.error);
      setPreferencesLoading(false);
      return;
    }

    const controller = new AbortController();
    setPreferencesLoading(true);
    setPreferencesError('');
    getUserPreferences(controller.signal)
      .then((savedPreferences) => {
        if (loadRequestId.current !== requestId) return;
        setPreferences(savedPreferences);
        setPreferencesError('');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && loadRequestId.current === requestId) {
          setPreferencesError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && loadRequestId.current === requestId) {
          setPreferencesLoading(false);
        }
      });
    return () => controller.abort();
  }, [account?.id, authLoading]);

  const savePreferences = useCallback(async (updates: UserPreferencesUpdate) => {
    loadRequestId.current += 1;
    setPreferencesLoading(false);
    setPreferencesError('');
    try {
      const updatedPreferences = account
        ? await updateUserPreferences(updates)
        : { ...preferences, ...updates };
      if (!account) storeGuestPreferences(updatedPreferences);
      setPreferences(updatedPreferences);
    } catch (error: unknown) {
      setPreferencesError(getErrorMessage(error));
      throw error;
    }
  }, [account, preferences]);

  const resetPreferences = useCallback(async () => {
    loadRequestId.current += 1;
    setPreferencesLoading(false);
    setPreferencesError('');
    try {
      const reset = account
        ? await resetUserPreferences()
        : { ...defaultUserPreferences };
      if (!account) storeGuestPreferences(reset);
      setPreferences(reset);
    } catch (error: unknown) {
      setPreferencesError(getErrorMessage(error));
      throw error;
    }
  }, [account]);

  const value = useMemo<PreferencesContextValue>(() => ({
    preferences,
    preferencesLoading,
    preferencesError,
    savePreferences,
    resetPreferences,
  }), [
    preferences,
    preferencesLoading,
    preferencesError,
    savePreferences,
    resetPreferences,
  ]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider.');
  return context;
}
