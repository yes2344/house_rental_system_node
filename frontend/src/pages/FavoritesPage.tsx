import { Heart, RotateCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PropertyCard } from '../components/PropertyCard';
import { useAuth } from '../AuthContext';
import type { Locale, MessageKey } from '../i18n';

interface FavoritesPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

export function FavoritesPage({ locale, text }: FavoritesPageProps) {
  const { favorites, favoritesError, favoritesLoading, refreshFavorites } = useAuth();

  return (
    <main id="main-content" className="customer-page">
      <section className="customer-heading">
        <div className="container">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('accountEyebrow')}</p>
          <h1>{text('savedHomesTitle')}</h1>
          <p>{text('savedHomesIntro')}</p>
        </div>
      </section>
      <section className="container customer-content">
        {favoritesLoading ? (
          <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingFavorites')}</div>
        ) : favoritesError ? (
          <div className="customer-error" role="alert">
            <p>{text('favoritesLoadError')} {favoritesError}</p>
            <button className="button button-outline" type="button" onClick={() => void refreshFavorites()}>
              <RotateCw size={15} aria-hidden="true" />{text('retry')}
            </button>
          </div>
        ) : favorites.length ? (
          <div className="listing-grid results-grid">
            {favorites.map((favorite) => (
              <PropertyCard key={favorite.id} property={favorite.property} locale={locale} text={text} />
            ))}
          </div>
        ) : (
          <div className="results-empty customer-empty">
            <span className="customer-empty-icon"><Heart size={24} aria-hidden="true" /></span>
            <h2>{text('noSavedHomes')}</h2>
            <p>{text('noSavedHomesBody')}</p>
            <Link className="button button-primary" to="/">{text('browseAll')}</Link>
          </div>
        )}
      </section>
    </main>
  );
}
