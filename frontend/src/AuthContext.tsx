import axios from 'axios';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  endSession,
  changeAgentInitialPassword as changeAgentInitialPasswordRequest,
  completeAgentInitialProfile as completeAgentInitialProfileRequest,
  getCurrentAccount,
  startSession,
  updateAccount as updateAccountRequest,
  type Account,
  type AccountUpdatePayload,
  type AgentInitialPasswordPayload,
  type AgentProfilePayload,
} from './api/accounts';
import { addFavorite, getFavorites, removeFavorite, type Favorite } from './api/favorites';
import { getErrorMessage } from './api/client';

interface AuthContextValue {
  account: Account | null;
  authLoading: boolean;
  authError: string;
  favorites: Favorite[];
  favoritesLoading: boolean;
  favoritesError: string;
  signIn: (username: string, password: string) => Promise<Account>;
  signOut: () => Promise<void>;
  updateProfile: (payload: AccountUpdatePayload) => Promise<void>;
  changeAgentInitialPassword: (payload: AgentInitialPasswordPayload) => Promise<Account>;
  completeAgentInitialProfile: (payload: AgentProfilePayload) => Promise<Account>;
  refreshFavorites: () => Promise<void>;
  toggleFavorite: (propertyId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [account, setAccount] = useState<Account | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesError, setFavoritesError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getCurrentAccount(controller.signal)
      .then((currentAccount) => {
        setAccount(currentAccount);
        setAuthError('');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) {
          setAccount(null);
          setAuthError('');
        } else {
          setAuthError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthLoading(false);
      });
    return () => controller.abort();
  }, []);

  const refreshFavorites = useCallback(async () => {
    if (!account) {
      setFavorites([]);
      setFavoritesError('');
      setFavoritesLoading(false);
      return;
    }

    setFavoritesLoading(true);
    setFavoritesError('');
    try {
      setFavorites(await getFavorites());
    } catch (error: unknown) {
      setFavoritesError(getErrorMessage(error));
    } finally {
      setFavoritesLoading(false);
    }
  }, [account?.id]);

  useEffect(() => {
    void refreshFavorites();
  }, [refreshFavorites]);

  const signIn = useCallback(async (username: string, password: string) => {
    const currentAccount = await startSession(username, password);
    setAccount(currentAccount);
    setAuthError('');
    return currentAccount;
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setAccount(null);
    setFavorites([]);
    setFavoritesError('');
  }, []);

  const updateProfile = useCallback(async (payload: AccountUpdatePayload) => {
    const updatedAccount = await updateAccountRequest(payload);
    setAccount(updatedAccount);
  }, []);

  const changeAgentInitialPassword = useCallback(async (payload: AgentInitialPasswordPayload) => {
    const updatedAccount = await changeAgentInitialPasswordRequest(payload);
    setAccount(updatedAccount);
    return updatedAccount;
  }, []);

  const completeAgentInitialProfile = useCallback(async (payload: AgentProfilePayload) => {
    const updatedAccount = await completeAgentInitialProfileRequest(payload);
    setAccount(updatedAccount);
    return updatedAccount;
  }, []);

  const toggleFavorite = useCallback(async (propertyId: number) => {
    if (!account) throw new Error('Sign in before saving a property.');
    const existingFavorite = favorites.find((favorite) => favorite.property.id === propertyId);
    if (existingFavorite) {
      await removeFavorite(propertyId);
      setFavorites((current) => current.filter((favorite) => favorite.property.id !== propertyId));
    } else {
      const favorite = await addFavorite(propertyId);
      setFavorites((current) => [
        favorite,
        ...current.filter((item) => item.property.id !== propertyId),
      ]);
    }
    setFavoritesError('');
  }, [account, favorites]);

  const value = useMemo<AuthContextValue>(() => ({
    account,
    authLoading,
    authError,
    favorites,
    favoritesLoading,
    favoritesError,
    signIn,
    signOut,
    updateProfile,
    changeAgentInitialPassword,
    completeAgentInitialProfile,
    refreshFavorites,
    toggleFavorite,
  }), [
    account,
    authLoading,
    authError,
    favorites,
    favoritesLoading,
    favoritesError,
    signIn,
    signOut,
    updateProfile,
    changeAgentInitialPassword,
    completeAgentInitialProfile,
    refreshFavorites,
    toggleFavorite,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
