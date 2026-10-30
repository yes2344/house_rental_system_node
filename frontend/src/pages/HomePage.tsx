import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, House, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import {
  getLocations,
  getLocationsByTypes,
  getProperties,
  getPropertyTypeOptions,
  getUniquePropertyTypeOptions,
  type ListingType,
  type MarketplaceLocation,
  type LocationType,
  type PaginatedResponse,
  type PropertyFilters,
  type PropertySummary,
  type PropertyType,
  type PropertyTypeOption,
} from '../api/properties';
import { PropertyCard } from '../components/PropertyCard';
import { useHomepageContent } from '../HomepageContentContext';
import { SocialMark, socialPlatformNames } from '../components/SocialMark';
import { useBrokerageContact } from '../BrokerageContactContext';
import type { Locale, MessageKey } from '../i18n';

export interface HomePageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

const propertyTypeMessageKeys: Record<PropertyType, MessageKey> = {
  house: 'house',
  villa: 'villa',
  apartment: 'apartment',
  condominium: 'condominium',
  land: 'land',
  office: 'office',
  shop: 'shop',
  warehouse: 'warehouse',
  commercial: 'commercial',
  other: 'otherPropertyType',
};

const categoryFallbackImages: Partial<Record<PropertyType, string>> = {
  house: '/category-images/house.jpg',
  villa: '/category-images/house.jpg',
  apartment: '/category-images/apartment.jpg',
  condominium: '/category-images/apartment.jpg',
  land: '/category-images/land.jpg',
  office: '/category-images/office.jpg',
  shop: '/category-images/shop.jpg',
  warehouse: '/category-images/warehouse.jpg',
  commercial: '/category-images/commercial.jpg',
  other: '/category-images/house.jpg',
};

const childLocationMessageKeys: Partial<Record<LocationType, MessageKey>> = {
  subcity: 'locationSubcity',
  woreda: 'locationWoreda',
  neighborhood: 'locationNeighborhood',
};

export function HomePage({ locale, text }: HomePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlListingType = searchParams.get('listing_type') ?? '';
  const urlPropertyType = searchParams.get('property_type') ?? '';
  const urlOrdering = searchParams.get('ordering') ?? '-created_at';
  const urlLocationId = searchParams.get('location_id') ?? '';
  const urlCityId = searchParams.get('city_id') ?? '';
  const urlKeyword = searchParams.get('search') ?? '';
  const urlMinPrice = searchParams.get('min_price') ?? '';
  const urlMaxPrice = searchParams.get('max_price') ?? '';
  const urlMinBedrooms = searchParams.get('min_bedrooms') ?? '';
  const urlMinBathrooms = searchParams.get('min_bathrooms') ?? '';
  const { notes } = useHomepageContent();
  const { contact } = useBrokerageContact();
  const [listingType, setListingType] = useState(urlListingType);
  const [propertyType, setPropertyType] = useState(urlPropertyType);
  const [ordering, setOrdering] = useState(urlOrdering);
  const [locationId, setLocationId] = useState<number | null>(Number(urlLocationId) || null);
  const [cityId, setCityId] = useState<number | null>(Number(urlCityId) || null);
  const [cities, setCities] = useState<MarketplaceLocation[]>([]);
  const [childLocations, setChildLocations] = useState<MarketplaceLocation[]>([]);
  const [propertyTypeOptions, setPropertyTypeOptions] = useState<PropertyTypeOption[]>([]);
  const [propertyTypeOptionsLoading, setPropertyTypeOptionsLoading] = useState(true);
  const [propertyTypeOptionsRetryKey, setPropertyTypeOptionsRetryKey] = useState(0);
  const [locationOptionsError, setLocationOptionsError] = useState('');
  const [propertyTypeOptionsError, setPropertyTypeOptionsError] = useState('');
  const [result, setResult] = useState<PaginatedResponse<PropertySummary> | null>(null);
  const [additionalProperties, setAdditionalProperties] = useState<PropertySummary[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listingsError, setListingsError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [retryListingsKey, setRetryListingsKey] = useState(0);
  const moreRequestController = useRef<AbortController | null>(null);
  const uniquePropertyTypeOptions = useMemo(
    () => getUniquePropertyTypeOptions(propertyTypeOptions),
    [propertyTypeOptions],
  );
  const availablePropertyTypes = useMemo(() => {
    const options = uniquePropertyTypeOptions;
    return listingType === 'rent'
      ? options.filter((option) => option.value !== 'land')
      : options;
  }, [listingType, uniquePropertyTypeOptions]);
  const childLocationLabelKey = childLocations.length > 0
    && childLocations.every((item) => item.location_type === childLocations[0].location_type)
    ? childLocationMessageKeys[childLocations[0].location_type] ?? 'location'
    : 'location';
  const apiFilters = useMemo<PropertyFilters>(() => {
    const locationIdParam = Number(urlLocationId);
    const cityIdParam = Number(urlCityId);
    const locationParam = searchParams.get('location')?.trim();
    return {
      page_size: 12,
      ordering: urlOrdering || undefined,
      search: urlKeyword.trim() || undefined,
      listing_type: urlListingType || undefined,
      property_type: urlListingType === 'rent' && urlPropertyType === 'land'
        ? undefined
        : urlPropertyType || undefined,
      location_id: Number.isInteger(locationIdParam) && locationIdParam > 0 ? locationIdParam : undefined,
      city_id: Number.isInteger(cityIdParam) && cityIdParam > 0 ? cityIdParam : undefined,
      location: !locationIdParam && locationParam ? locationParam : undefined,
      min_price: urlMinPrice || undefined,
      max_price: urlMaxPrice || undefined,
      min_bedrooms: urlMinBedrooms || undefined,
      min_bathrooms: urlMinBathrooms || undefined,
    };
  }, [
    searchParams,
    urlCityId,
    urlKeyword,
    urlListingType,
    urlLocationId,
    urlMaxPrice,
    urlMinBathrooms,
    urlMinBedrooms,
    urlMinPrice,
    urlOrdering,
    urlPropertyType,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    moreRequestController.current?.abort();
    setAdditionalProperties([]);
    setMoreError('');
    setListingsLoading(true);
    setListingsError('');
    void getProperties(apiFilters, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setResult(response);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setListingsError(getErrorMessage(error));
          setResult(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setListingsLoading(false);
      });
    return () => {
      controller.abort();
      moreRequestController.current?.abort();
    };
  }, [apiFilters, retryListingsKey]);

  useEffect(() => {
    setListingType(urlListingType);
    setPropertyType(urlPropertyType);
    setOrdering(urlOrdering);
    const selectedLocation = Number(urlLocationId) || null;
    setLocationId(selectedLocation);
    setCityId(Number(urlCityId) || null);
  }, [
    urlCityId,
    urlListingType,
    urlLocationId,
    urlOrdering,
    urlPropertyType,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void getPropertyTypeOptions(controller.signal)
      .then((options) => {
        if (!controller.signal.aborted) {
          setPropertyTypeOptions(options);
          setPropertyTypeOptionsError('');
          setPropertyTypeOptionsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPropertyTypeOptionsError(getErrorMessage(error));
          setPropertyTypeOptionsLoading(false);
        }
      });
    return () => controller.abort();
  }, [propertyTypeOptionsRetryKey]);

  const updateResults = useCallback((updates: Partial<Record<
    'listing_type' | 'property_type' | 'location' | 'location_id' | 'city_id'
      | 'ordering' | 'search' | 'min_price' | 'max_price' | 'min_bedrooms' | 'min_bathrooms',
    string | number | null
  >>) => {
    const next = new URLSearchParams(searchParams);
    next.delete('page');
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (urlListingType === 'rent' && urlPropertyType === 'land') {
      setPropertyType('');
      updateResults({ property_type: null });
    }
  }, [urlListingType, urlPropertyType, updateResults]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateResults({
      search: null,
      min_price: null,
      max_price: null,
      min_bedrooms: null,
      min_bathrooms: null,
    });
    document.getElementById('latest-listings')?.scrollIntoView({ behavior: 'smooth' });
  };

  const changeListingType = (value: ListingType | '') => {
    setListingType(value);
    if (value === 'rent' && propertyType === 'land') {
      setPropertyType('');
      updateResults({ listing_type: value, property_type: null });
      return;
    }
    updateResults({ listing_type: value });
  };

  const searchCategory = (category: string) => {
    setPropertyType(category);
    if (category === 'land' && listingType === 'rent') {
      setListingType('');
      updateResults({ listing_type: null, property_type: category });
    } else {
      updateResults({ property_type: category });
    }
    document.getElementById('latest-listings')?.scrollIntoView({ behavior: 'smooth' });
  };

  const clearFilters = () => {
    setListingType('');
    setPropertyType('');
    setLocationId(null);
    setCityId(null);
    setChildLocations([]);
    setSearchParams({});
  };

  const retryListings = () => setRetryListingsKey((current) => current + 1);
  const retryPropertyTypes = () => {
    setPropertyTypeOptionsError('');
    setPropertyTypeOptionsLoading(true);
    setPropertyTypeOptionsRetryKey((current) => current + 1);
  };

  const loadMoreListings = async () => {
    if (!result?.next || loadingMore) return;
    const controller = new AbortController();
    moreRequestController.current?.abort();
    moreRequestController.current = controller;
    setLoadingMore(true);
    setMoreError('');
    try {
      const nextResult = await getProperties(
        { ...apiFilters, page: 2 + Math.floor(additionalProperties.length / 12) },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setAdditionalProperties((current) => [...current, ...nextResult.results]);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) setMoreError(getErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  };

  const properties = [...(result?.results ?? []), ...additionalProperties];
  const categoryListingImages = useMemo(() => {
    const images: Partial<Record<PropertyType, string>> = {};
    for (const property of properties) {
      if (images[property.category]) continue;
      const image = property.primary_image
        || property.images.find((candidate) => candidate.is_primary && candidate.url)?.url
        || property.images.find((candidate) => candidate.url)?.url;
      if (image) images[property.category] = image;
    }
    return images;
  }, [properties]);
  const hasMoreListings = Boolean(result?.next) && properties.length < (result?.count ?? 0);

  useEffect(() => {
    const controller = new AbortController();
    void getLocationsByTypes(['city', 'city_administration'], controller.signal)
      .then((items) => {
        setCities(items);
        setLocationOptionsError('');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLocationOptionsError(getErrorMessage(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setChildLocations([]);
    if (!cityId) return;
    const controller = new AbortController();
    void getLocations(cityId, controller.signal)
      .then((items) => {
        setChildLocations(items);
        setLocationOptionsError('');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLocationOptionsError(getErrorMessage(error));
      });
    return () => controller.abort();
  }, [cityId]);

  return (
    <main id="main-content">
      <section className="hero-section">
        <img
          className="hero-background"
          src={contact.homepage_hero_image || '/category-images/house.jpg'}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
        />
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>
              <span className="hero-headline">{text('heroHeadline')}</span>
              <span>{text('heroBrandLine')}</span>
            </h1>
          </div>
        </div>
      </section>

      <section className="home-search-section">
        <div className="container">
          <form className="search-panel" onSubmit={submitSearch}>
            <div className="search-panel-head">
              <div className="listing-type-toggle" role="group" aria-label={text('searchLabel')}>
                <button
                  type="button"
                  className={!listingType ? 'is-active' : ''}
                  aria-pressed={!listingType}
                  onClick={() => changeListingType('')}
                >{text('anyType')}</button>
                <button
                  type="button"
                  className={listingType === 'sale' ? 'is-active' : ''}
                  aria-pressed={listingType === 'sale'}
                  onClick={() => changeListingType('sale')}
                >{text('searchBuy')}</button>
                <button
                  type="button"
                  className={listingType === 'rent' ? 'is-active' : ''}
                  aria-pressed={listingType === 'rent'}
                  onClick={() => changeListingType('rent')}
                >{text('searchRent')}</button>
              </div>
            </div>
            <div className={`search-fields${cityId ? ' has-subcity' : ''}`}>
              <div className="search-field">
                <label htmlFor="home-city">{text('locationCity')}</label>
                <select
                  id="home-city"
                  value={cityId ?? ''}
                  onChange={(event) => {
                    const selectedCityId = Number(event.target.value) || null;
                    setCityId(selectedCityId);
                    setLocationId(null);
                    setChildLocations([]);
                    updateResults({ city_id: selectedCityId, location_id: null });
                  }}
                >
                  <option value="">{text('chooseCity')}</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {locale === 'am' && city.name_am ? city.name_am : city.name}
                    </option>
                  ))}
                </select>
              </div>
              {cityId && (
                <label className="search-field search-field-subcity">
                  <span>
                    {text(childLocationLabelKey === 'locationSubcity'
                      ? 'searchLocationSubcity'
                      : childLocationLabelKey)}
                  </span>
                  <select
                    value={locationId ?? ''}
                    onChange={(event) => {
                      const selectedLocationId = Number(event.target.value) || null;
                      setLocationId(selectedLocationId);
                      updateResults({ location_id: selectedLocationId });
                    }}
                    disabled={!childLocations.length}
                  >
                    <option value="">{text('allAreas')}</option>
                    {childLocations.map((childLocation) => (
                      <option key={childLocation.id} value={childLocation.id}>
                        {locale === 'am' && childLocation.name_am ? childLocation.name_am : childLocation.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="search-field search-field-type">
                <span>{text('propertyType')}</span>
                <select
                  value={propertyType}
                  onChange={(event) => {
                    const selectedType = event.target.value;
                    setPropertyType(selectedType);
                    updateResults({ property_type: selectedType });
                  }}
                >
                  <option value="">{text('anyType')}</option>
                  {availablePropertyTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {text(propertyTypeMessageKeys[option.value])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="search-field search-field-ordering">
                <span>{text('sortBy')}</span>
                <select
                  value={ordering}
                  onChange={(event) => {
                    const selectedOrdering = event.target.value;
                    setOrdering(selectedOrdering);
                    updateResults({ ordering: selectedOrdering });
                  }}
                >
                  <option value="-created_at">{text('sortNewest')}</option>
                  <option value="created_at">{text('sortOldest')}</option>
                  <option value="price">{text('sortPriceLow')}</option>
                  <option value="-price">{text('sortPriceHigh')}</option>
                </select>
              </label>
              <button className="button button-primary search-submit" type="submit">
                <Search size={17} aria-hidden="true" /><span>{text('searchButton')}</span>
              </button>
            </div>
            {locationOptionsError
              ? <p className="search-note" role="status">{text('locationLoadError')} {locationOptionsError}</p>
              : null}
            {propertyTypeOptionsError
              ? <p className="search-note" role="alert">{text('propertyTypeOptionsLoadError')} {propertyTypeOptionsError}</p>
              : null}
          </form>
        </div>
      </section>

      <section className="section listings-section" id="latest-listings">
        <div className="container">
          <div className="section-heading home-listings-heading">
            <div>
              <h2>{text('latestTitle')}</h2>
              <p className="section-description">
                {listingsLoading ? text('loadingListings') : `${result?.count ?? 0} ${text('resultCount')}`}
              </p>
            </div>
            <button
              className="button button-outline button-small home-filter-clear"
              type="button"
              onClick={clearFilters}
            >
              {text('clearFilters')}
            </button>
          </div>
          {listingsLoading ? (
            <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingListings')}</div>
          ) : listingsError ? (
            <div className="listing-state listing-error" role="alert">
              <span>{text('listingsError')} <small>{listingsError}</small></span>
              <button className="button button-outline" type="button" onClick={retryPropertyTypes}>{text('retry')}</button>
            </div>
          ) : properties.length ? (
            <>
              <div className="listing-grid">
                {properties.map((property, index) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    locale={locale}
                    text={text}
                    imageLoading={index < 3 ? 'eager' : 'lazy'}
                  />
                ))}
              </div>
              {hasMoreListings && (
                <div className="show-more-listings">
                  {moreError && <p className="listing-error" role="alert">{text('listingsError')} {moreError}</p>}
                  <button className="button button-outline" type="button" onClick={() => void loadMoreListings()} disabled={loadingMore}>
                    {loadingMore
                      ? <><span className="loading-spinner" />{text('loadingListings')}</>
                      : <>{text('showMoreListings')}<ChevronDown size={16} aria-hidden="true" /></>}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="listing-empty">
              <span className="empty-icon"><House size={23} aria-hidden="true" /></span>
              <h2>{text('noSearchResults')}</h2>
              <p>{text('adjustFilters')}</p>
              <button className="button button-outline" type="button" onClick={clearFilters}>{text('clearFilters')}</button>
            </div>
          )}
        </div>
      </section>

      {notes.length > 0 && (
        <section className="section homepage-notes-section">
          <div className="container">
            <div className="homepage-notes-grid">
              {notes.map((note) => (
                <article className="homepage-note-card" key={note.id}>
                  {note.title && <h2>{note.title}</h2>}
                  <div className="homepage-note-body">
                    <p>{note.text}</p>
                    {note.image && (
                      <img
                        className="homepage-note-image"
                        src={note.image}
                        alt={note.title}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section category-section" aria-labelledby="category-section-title">
        <div className="container">
          <div className="section-heading category-heading">
            <div>
              <h2 id="category-section-title">{text('explorePropertiesByType')}</h2>
              <p className="section-description">{text('categorySectionDescription')}</p>
            </div>
          </div>
          {propertyTypeOptionsLoading ? (
            <div className="listing-state" role="status">
              <span className="loading-spinner" />{text('loadingPropertyTypes')}
            </div>
          ) : propertyTypeOptionsError ? (
            <div className="listing-state listing-error" role="alert">
              <span>{text('propertyTypeOptionsLoadError')} <small>{propertyTypeOptionsError}</small></span>
              <button className="button button-outline" type="button" onClick={retryListings}>{text('retry')}</button>
            </div>
          ) : uniquePropertyTypeOptions.length ? (
            <>
              <div className="category-grid">
                {uniquePropertyTypeOptions.map((option) => (
                  <button
                    className="category-card"
                    type="button"
                    key={option.value}
                    onClick={() => searchCategory(option.value)}
                    aria-label={`${text(propertyTypeMessageKeys[option.value])}: ${text('categorySearch')}`}
                  >
                    {(categoryListingImages[option.value] || categoryFallbackImages[option.value]) && (
                      <img
                        className="category-card-image"
                        src={categoryListingImages[option.value] || categoryFallbackImages[option.value]}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          const fallbackImage = categoryFallbackImages[option.value];
                          if (
                            categoryListingImages[option.value]
                            && fallbackImage
                            && categoryListingImages[option.value] !== fallbackImage
                            && event.currentTarget.dataset.usingFallback !== 'true'
                          ) {
                            event.currentTarget.dataset.usingFallback = 'true';
                            event.currentTarget.src = fallbackImage;
                          } else {
                            event.currentTarget.hidden = true;
                          }
                        }}
                      />
                    )}
                    <span className="category-card-shade" aria-hidden="true" />
                    <span className="category-copy">
                      <span className="category-name">{text(propertyTypeMessageKeys[option.value]) || option.label}</span>
                      <span className="category-action">{text('categorySearch')} <ArrowUpRight size={16} aria-hidden="true" /></span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="listing-empty">
              <span className="empty-icon"><House size={23} aria-hidden="true" /></span>
              <p>{text('noPropertyTypesAvailable')}</p>
            </div>
          )}
        </div>
      </section>

      {contact.social_links.some((link) => link.is_enabled && link.url) && (
        <section className="homepage-social-section" aria-label={text('agentSocialLinks')}>
          <div className="container homepage-social-inner">
            <div className="footer-socials">
              {contact.social_links.filter((link) => link.is_enabled && link.url).map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={socialPlatformNames[link.platform]}
                  title={socialPlatformNames[link.platform]}
                >
                  <SocialMark platform={link.platform} />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

    </main>
  );
}
