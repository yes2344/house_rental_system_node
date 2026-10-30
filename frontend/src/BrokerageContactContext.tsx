import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  emptyBrokerageContact,
  getBrokerageContact,
  updateSiteBranding,
  updateBrokerageContact,
  type BrokerageContact,
} from './api/brokerage';
import { getErrorMessage } from './api/client';

interface BrokerageContactContextValue {
  contact: BrokerageContact;
  loading: boolean;
  error: string;
  save: (updates: Partial<BrokerageContact>) => Promise<void>;
  saveBranding: (updates: {
    site_name: string;
    site_logo?: File;
    clear_site_logo?: boolean;
    homepage_hero_image?: File;
    clear_homepage_hero_image?: boolean;
  }) => Promise<void>;
  refresh: () => Promise<void>;
}

const BrokerageContactContext = createContext<BrokerageContactContextValue | null>(null);

export function BrokerageContactProvider({ children }: { children: ReactNode }) {
  const [contact, setContact] = useState(emptyBrokerageContact);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setContact(await getBrokerageContact());
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getBrokerageContact(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setContact(value);
          setError('');
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.title = contact.site_name || 'Infinity House';
  }, [contact.site_name]);

  const save = useCallback(async (updates: Partial<BrokerageContact>) => {
    setError('');
    try {
      const updated = await updateBrokerageContact(updates);
      setContact(updated);
    } catch (requestError: unknown) {
      const message = getErrorMessage(requestError);
      setError(message);
      throw requestError;
    }
  }, []);

  const saveBranding = useCallback(async (updates: {
    site_name: string;
    site_logo?: File;
    clear_site_logo?: boolean;
    homepage_hero_image?: File;
    clear_homepage_hero_image?: boolean;
  }) => {
    setError('');
    try {
      setContact(await updateSiteBranding(updates));
    } catch (requestError: unknown) {
      const message = getErrorMessage(requestError);
      setError(message);
      throw requestError;
    }
  }, []);

  const value = useMemo(
    () => ({ contact, loading, error, save, saveBranding, refresh }),
    [contact, loading, error, save, saveBranding, refresh],
  );
  return <BrokerageContactContext.Provider value={value}>{children}</BrokerageContactContext.Provider>;
}

export function useBrokerageContact() {
  const context = useContext(BrokerageContactContext);
  if (!context) throw new Error('useBrokerageContact must be used inside BrokerageContactProvider.');
  return context;
}
