import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getHomepageNotes, type HomepageNote } from './api/homepageContent';
import { getErrorMessage } from './api/client';

interface HomepageContentValue {
  notes: HomepageNote[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

const HomepageContentContext = createContext<HomepageContentValue | null>(null);

export function HomepageContentProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<HomepageNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNotes(await getHomepageNotes());
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getHomepageNotes(controller.signal)
      .then(setNotes)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const value = useMemo(
    () => ({ notes, loading, error, refresh }),
    [notes, loading, error, refresh],
  );
  return <HomepageContentContext.Provider value={value}>{children}</HomepageContentContext.Provider>;
}

export function useHomepageContent() {
  const context = useContext(HomepageContentContext);
  if (!context) throw new Error('useHomepageContent must be used inside HomepageContentProvider.');
  return context;
}
