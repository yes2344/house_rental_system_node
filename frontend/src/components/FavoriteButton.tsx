import { useState } from 'react';
import { Heart } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface FavoriteButtonProps {
  propertyId: number;
  text: (key: MessageKey) => string;
  variant?: 'card' | 'detail';
}

export function FavoriteButton({ propertyId, text, variant = 'card' }: FavoriteButtonProps) {
  const { account, authLoading, favorites, favoritesLoading, toggleFavorite } = useAuth();
  const location = useLocation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isFavorite = favorites.some((favorite) => favorite.property.id === propertyId);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  if (!account && !authLoading) {
    return (
      <Link
        className={`favorite-toggle favorite-control-${variant}`}
        to="/login"
        state={{ from: returnTo }}
        aria-label={text('saveFavoriteSignIn')}
        title={text('saveFavoriteSignIn')}
      >
        <Heart size={18} aria-hidden="true" />
      </Link>
    );
  }

  const label = text(isFavorite ? 'removeFavorite' : 'saveFavorite');
  return (
    <div className={`favorite-control favorite-control-${variant}`}>
      <button
        className={`favorite-toggle${isFavorite ? ' is-favorite' : ''}`}
        type="button"
        aria-label={label}
        aria-pressed={isFavorite}
        title={label}
        disabled={authLoading || favoritesLoading || saving}
        onClick={() => {
          setSaving(true);
          setError('');
          void toggleFavorite(propertyId)
            .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
            .finally(() => setSaving(false));
        }}
      >
        <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </div>
  );
}
