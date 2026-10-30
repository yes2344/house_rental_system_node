import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Plus, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import { getErrorMessage } from '../api/client';
import { formatPropertyPrice, formatRegistrationDate } from '../components/propertyDisplay';
import { formatPropertyLocation } from '../components/locationDisplay';
import { PropertySlideshow } from '../components/PropertySlideshow';
import {
  getManagedProperties,
  deleteManagedProperties,
  updateManagedPropertyPublication,
  type ManagedProperty,
  type ManagedPropertyFilters,
  type PublicationStatus,
} from '../api/management';
import type { Locale, MessageKey } from '../i18n';

interface OwnerListingsPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

const PAGE_SIZE = 12;

const publicationMessage: Record<PublicationStatus, MessageKey> = {
  draft: 'publicationDraft',
  pending_review: 'publicationPending',
  published: 'publicationPublished',
  rejected: 'publicationRejected',
  suspended: 'publicationSuspended',
  expired: 'publicationExpired',
  withdrawn: 'publicationWithdrawn',
};

function propertyStatusMessage(status: ManagedProperty['status']): MessageKey {
  if (status === 'rented') return 'statusRented';
  if (status === 'sold') return 'statusSold';
  if (status === 'inactive') return 'statusInactive';
  return 'available';
}

export function OwnerListingsPage({ locale, text }: OwnerListingsPageProps) {
  const { account } = useAuth();
  const permissions = account?.management_permissions ?? [];
  const canCreate = Boolean(
    (permissions.includes('properties.edit_all') && permissions.includes('properties.moderate'))
    || (account?.role === 'agent' && permissions.includes('properties.manage_assigned')),
  );
  const canModerate = permissions.includes('properties.moderate');
  const canBulkDelete = Boolean(
    (account?.role === 'agent' && permissions.includes('properties.manage_assigned'))
    || (account?.role === 'administrator'
      && (permissions.includes('properties.delete_all') || permissions.includes('properties.edit_all'))),
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [publicationStatus, setPublicationStatus] = useState(searchParams.get('publication_status') ?? '');
  const [result, setResult] = useState<{ count: number; next: string | null; previous: string | null; results: ManagedProperty[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [publicationBusyId, setPublicationBusyId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const pageValue = Number(searchParams.get('page') ?? 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;

  useEffect(() => {
    const controller = new AbortController();
    const rawStatus = searchParams.get('status');
    const rawPublicationStatus = searchParams.get('publication_status');
    const filters: ManagedPropertyFilters = {
      page_size: PAGE_SIZE,
      search: searchParams.get('search') || undefined,
      status: rawStatus === 'available' || rawStatus === 'rented' || rawStatus === 'sold' || rawStatus === 'inactive'
        ? rawStatus
        : undefined,
      publication_status: rawPublicationStatus === 'draft' || rawPublicationStatus === 'pending_review'
        || rawPublicationStatus === 'published' || rawPublicationStatus === 'rejected'
        || rawPublicationStatus === 'suspended' || rawPublicationStatus === 'expired'
        || rawPublicationStatus === 'withdrawn'
        ? rawPublicationStatus
        : undefined,
      page,
    };

    setLoading(true);
    setError('');
    void getManagedProperties(filters, controller.signal)
      .then((nextResult) => {
        setResult(nextResult);
        setSelectedIds(new Set());
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, reloadKey, searchParams]);

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
    setStatus(searchParams.get('status') ?? '');
    setPublicationStatus(searchParams.get('publication_status') ?? '');
  }, [searchParams]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (search.trim()) next.set('search', search.trim());
    if (status) next.set('status', status);
    if (publicationStatus) next.set('publication_status', publicationStatus);
    setSearchParams(next);
  };

  const changePage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setSearchParams(next);
  };

  const togglePublication = async (property: ManagedProperty) => {
    setPublicationBusyId(property.id);
    setActionError('');
    try {
      const updated = await updateManagedPropertyPublication(
        property.id,
        property.publication_status === 'published' ? 'draft' : 'published',
      );
      setResult((current) => current && ({
        ...current,
        results: current.results.map((item) => item.id === updated.id ? updated : item),
      }));
    } catch (requestError: unknown) {
      setActionError(`${text('publicationUpdateError')} ${getErrorMessage(requestError)}`);
    } finally {
      setPublicationBusyId(null);
    }
  };

  const visibleIds = result?.results.map((property) => property.id) ?? [];
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };

  const deleteSelected = async () => {
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    if (!ids.length || !window.confirm(text('confirmDeleteSelectedListings').replace('{count}', String(ids.length)))) return;
    setBulkDeleting(true);
    setActionError('');
    try {
      const deletedCount = await deleteManagedProperties(ids);
      setSelectedIds(new Set());
      if (result) {
        setResult({
          ...result,
          count: Math.max(0, result.count - deletedCount),
          results: result.results.filter((property) => !ids.includes(property.id)),
        });
      }
      if (result && result.results.length === ids.length && page > 1) changePage(page - 1);
      else setReloadKey((key) => key + 1);
    } catch (requestError: unknown) {
      setActionError(`${text('bulkDeleteError')} ${getErrorMessage(requestError)}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <main className="manager-page" id="main-content">
      <section className="manager-heading">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerEyebrow')}</p>
          <h1>{text('managerListings')}</h1>
          <p>{text('managerListingsIntro')}</p>
        </div>
        {canCreate && (
          <Link className="button button-primary" to="/management/listings/new">
            <Plus size={17} aria-hidden="true" />{text('createListing')}
          </Link>
        )}
      </section>

      <form className="manager-filter-bar" onSubmit={applyFilters}>
        <label className="manager-search">
          <span>{text('searchKeyword')}</span>
          <span className="manager-search-input">
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </span>
        </label>
        <label className="manager-filter">
          <span>{text('listingStatus')}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{text('allStatuses')}</option>
            <option value="available">{text('available')}</option>
            <option value="rented">{text('statusRented')}</option>
            <option value="sold">{text('statusSold')}</option>
            <option value="inactive">{text('statusInactive')}</option>
          </select>
        </label>
        <label className="manager-filter">
          <span>{text('publicationStatus')}</span>
          <select value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value)}>
            <option value="">{text('allStatuses')}</option>
            <option value="draft">{text('publicationDraft')}</option>
            <option value="pending_review">{text('publicationPending')}</option>
            <option value="published">{text('publicationPublished')}</option>
            <option value="rejected">{text('publicationRejected')}</option>
            <option value="suspended">{text('publicationSuspended')}</option>
            <option value="expired">{text('publicationExpired')}</option>
            <option value="withdrawn">{text('publicationWithdrawn')}</option>
          </select>
        </label>
        <button className="button button-outline" type="submit">{text('applyFilters')}</button>
      </form>

      {loading ? (
        <div className="listing-state" role="status"><span className="loading-spinner" />{text('managerLoadingListings')}</div>
      ) : error ? (
        <div className="manager-state manager-error" role="alert">
          <h2>{text('managerLoadError')}</h2>
          <p>{error}</p>
          <button className="button button-outline" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            {text('retry')}
          </button>
        </div>
      ) : result?.results.length ? (
        <>
          {actionError && <p className="manager-inline-error" role="alert">{actionError}</p>}
          {canBulkDelete && (
            <div className="manager-bulk-actions">
              <label className="manager-bulk-select">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label={text('selectAllListings')}
                />
                <span>{text('selectAllListings')}</span>
              </label>
              <span>{text('selectedListings').replace('{count}', String(selectedIds.size))}</span>
              <button
                className="button button-danger button-small"
                type="button"
                disabled={!selectedIds.size || bulkDeleting}
                onClick={() => void deleteSelected()}
              >
                <Trash2 size={15} aria-hidden="true" />
                {bulkDeleting ? text('deletingSelectedListings') : text('deleteSelectedListings')}
              </button>
            </div>
          )}
          {account?.role === 'agent' ? (
            <div className="manager-listing-grid">
              {result.results.map((property) => (
                <article className="manager-listing-card" key={property.id}>
                  {canBulkDelete && (
                    <label className="manager-listing-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(property.id)}
                        onChange={() => toggleSelected(property.id)}
                        aria-label={`${text('selectListing')}: ${property.title}`}
                      />
                      <span className="visually-hidden">{text('selectListing')}: {property.title}</span>
                    </label>
                  )}
                  <div className="manager-listing-image">
                    <PropertySlideshow
                      images={property.images ?? []}
                      title={property.title}
                      fallbackLabel={text('emptyImageLabel')}
                      previousLabel={text('previousPage')}
                      nextLabel={text('nextPage')}
                      photoLabel={text('photoNumber')}
                    />
                    <span className={`listing-type${property.listing_type === 'rent' ? ' is-rent' : ''}`}>
                      {text(property.listing_type === 'rent' ? 'forRent' : 'forSale')}
                    </span>
                  </div>
                  <div className="manager-listing-content">
                    <div className="manager-listing-badges">
                      <span className={`manager-badge status-${property.status}`}>
                        {text(propertyStatusMessage(property.status))}
                      </span>
                      <span className={`manager-badge publication-${property.publication_status}`}>
                        {text(publicationMessage[property.publication_status])}
                      </span>
                    </div>
                    <h2>{property.title}</h2>
                    <p className="manager-listing-location">{formatPropertyLocation(property, locale)}</p>
                    <strong className="manager-listing-price">
                      {formatPropertyPrice(property.price, property.listing_type, property.rental_frequency, locale, text)}
                    </strong>
                    <p className="manager-listing-date">
                      {text('registeredDate')} {formatRegistrationDate(property.created_at, locale)}
                    </p>
                    <div className="manager-listing-actions">
                      <Link className="button button-outline button-small" to={`/management/listings/${property.id}/edit`}>
                        {text('editListing')}
                      </Link>
                      {canModerate && (property.publication_status === 'published' || property.publication_status === 'draft' || property.publication_status === 'rejected') && (
                        <button
                          className="button button-primary button-small"
                          type="button"
                          disabled={publicationBusyId === property.id || (property.publication_status !== 'published' && property.status !== 'available')}
                          onClick={() => void togglePublication(property)}
                        >
                          {publicationBusyId === property.id
                            ? text('publishingListing')
                            : text(property.publication_status === 'published' ? 'unpublishListing' : 'publishListing')}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
          <div className="manager-table-wrap">
            <table className="manager-table">
              <thead>
                <tr>
                  {canBulkDelete && (
                    <th scope="col">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label={text('selectAllListings')}
                      />
                    </th>
                  )}
                  <th scope="col">{text('listingTitle')}</th>
                  <th scope="col">{text('listingTypeLabel')}</th>
                  <th scope="col">{text('priceLabel')}</th>
                  <th scope="col">{text('listingStatus')}</th>
                  <th scope="col">{text('publicationStatus')}</th>
                  <th scope="col"><span className="visually-hidden">{text('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((property) => (
                  <tr key={property.id}>
                    {canBulkDelete && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(property.id)}
                          onChange={() => toggleSelected(property.id)}
                          aria-label={`${text('selectListing')}: ${property.title}`}
                        />
                      </td>
                    )}
                    <td>
                      <strong>{property.title}</strong>
                      <span className="manager-row-secondary">{formatPropertyLocation(property, locale)}</span>
                      {formatRegistrationDate(property.created_at, locale) && (
                        <span className="manager-row-secondary">
                          {text('registeredDate')} {formatRegistrationDate(property.created_at, locale)}
                        </span>
                      )}
                    </td>
                    <td>{text(property.listing_type === 'rent' ? 'forRent' : 'forSale')}</td>
                    <td>{formatPropertyPrice(property.price, property.listing_type, property.rental_frequency, locale, text)}</td>
                    <td><span className={`manager-badge status-${property.status}`}>{text(propertyStatusMessage(property.status))}</span></td>
                    <td><span className={`manager-badge publication-${property.publication_status}`}>{text(publicationMessage[property.publication_status])}</span></td>
                    <td className="manager-row-actions">
                      <Link className="manager-row-action" to={`/management/listings/${property.id}/edit`}>{text('editListing')}</Link>
                      {canModerate && (property.publication_status === 'published' || property.publication_status === 'draft' || property.publication_status === 'rejected') && (
                        <button
                          className="manager-row-action"
                          type="button"
                          disabled={publicationBusyId === property.id || (property.publication_status !== 'published' && property.status !== 'available')}
                          onClick={() => void togglePublication(property)}
                        >
                          {publicationBusyId === property.id
                            ? text('publishingListing')
                            : text(property.publication_status === 'published' ? 'unpublishListing' : 'publishListing')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <div className="manager-pagination">
            <span>{text('managerResultCount').replace('{count}', String(result.count))}</span>
            <div>
              <button className="button button-outline button-small" type="button" disabled={!result.previous} onClick={() => changePage(page - 1)}>
                <ArrowLeft size={15} aria-hidden="true" />{text('previousPage')}
              </button>
              <span>{text('pageOf')} {page} / {Math.max(1, Math.ceil(result.count / PAGE_SIZE))}</span>
              <button className="button button-outline button-small" type="button" disabled={!result.next} onClick={() => changePage(page + 1)}>
                {text('nextPage')}<ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="manager-state">
          <h2>{text('managerNoListings')}</h2>
          <p>{text('managerNoListingsBody')}</p>
          {canCreate && <Link className="button button-primary" to="/management/listings/new"><Plus size={16} aria-hidden="true" />{text('createListing')}</Link>}
        </div>
      )}
    </main>
  );
}
