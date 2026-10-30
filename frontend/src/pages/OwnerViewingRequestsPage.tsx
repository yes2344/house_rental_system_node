import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, ExternalLink, RotateCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import {
  getManagedViewingRequest,
  getManagedViewingRequests,
  actOnManagedViewingRequest,
  updateManagedViewingRequest,
  type ManagedViewingRequest,
  type ManagedViewingRequestFilters,
  type ManagedViewingRequestPayload,
  type ViewingRequestStatus,
} from '../api/management';
import type { MessageKey } from '../i18n';

interface OwnerViewingRequestsPageProps {
  text: (key: MessageKey) => string;
}

const PAGE_SIZE = 12;

interface RequestFormValues {
  status: '' | 'rejected';
  proposed_date: string;
  proposed_time: string;
  agent_notes: string;
}

function formFromRequest(request: ManagedViewingRequest): RequestFormValues {
  return {
    status: '',
    proposed_date: request.proposed_date ?? '',
    proposed_time: request.proposed_time?.slice(0, 5) ?? '',
    agent_notes: request.agent_notes,
  };
}

function requestStatusMessage(status: ViewingRequestStatus): MessageKey {
  if (status === 'proposed') return 'viewingProposed';
  if (status === 'confirmed') return 'viewingConfirmed';
  if (status === 'rejected') return 'viewingRejected';
  if (status === 'declined') return 'viewingVisitorDeclined';
  if (status === 'cancelled') return 'viewingCancelled';
  if (status === 'completed') return 'viewingCompleted';
  return 'viewingPending';
}

function isViewingRequestStatus(value: string | null): value is ViewingRequestStatus {
  return value === 'pending'
    || value === 'proposed'
    || value === 'confirmed'
    || value === 'rejected'
    || value === 'declined'
    || value === 'cancelled'
    || value === 'completed';
}

function eventMessage(eventType: string): MessageKey {
  if (eventType === 'proposal_sent') return 'appointmentProposedEvent';
  if (eventType === 'proposal_revised') return 'appointmentRevisedEvent';
  if (eventType === 'request_updated') return 'viewingRequestUpdatedEvent';
  if (eventType === 'proposal_accepted') return 'appointmentAcceptedEvent';
  if (eventType === 'proposal_declined') return 'appointmentDeclinedEvent';
  if (eventType === 'rejected') return 'requestRejectedEvent';
  if (eventType === 'request_confirmed') return 'requestConfirmedEvent';
  if (eventType === 'cancelled') return 'viewingCancelled';
  if (eventType === 'completed') return 'viewingCompleted';
  return 'requestSubmittedEvent';
}

export function OwnerViewingRequestsPage({ text }: OwnerViewingRequestsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState<ManagedViewingRequest[]>([]);
  const [count, setCount] = useState(0);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [previousPage, setPreviousPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<ManagedViewingRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [values, setValues] = useState<RequestFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const rawPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage : 1;
  const rawStatus = searchParams.get('status');
  const statusFilter = isViewingRequestStatus(rawStatus) ? rawStatus : undefined;
  const rawOrdering = searchParams.get('ordering');
  const ordering = rawOrdering === 'preferred_date' || rawOrdering === 'scheduled_date'
    ? rawOrdering
    : '-created_at';

  useEffect(() => {
    const controller = new AbortController();
    const filters: ManagedViewingRequestFilters = {
      page_size: PAGE_SIZE,
      status: statusFilter,
      ordering,
      page,
    };
    setLoading(true);
    setLoadError('');
    void getManagedViewingRequests(filters, controller.signal)
      .then((response) => {
        setRequests(response.results);
        setCount(response.count);
        setNextPage(response.next);
        setPreviousPage(response.previous);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRequests([]);
        setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ordering, page, reloadKey, statusFilter]);

  const chooseRequest = async (id: number) => {
    setDetailLoading(true);
    setDetailError('');
    setSaveError('');
    setSaveSuccess('');
    try {
      const request = await getManagedViewingRequest(id);
      setSelected(request);
      setValues(formFromRequest(request));
    } catch (error: unknown) {
      setSelected(null);
      setValues(null);
      setDetailError(getErrorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const updateFormValue = <K extends keyof RequestFormValues>(name: K, value: RequestFormValues[K]) => {
    setValues((current) => current ? { ...current, [name]: value } : current);
    setSaveError('');
    setSaveSuccess('');
  };

  const saveRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !values) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    const payload: ManagedViewingRequestPayload = {
      ...(values.status === 'rejected' ? { status: 'rejected' as const } : {}),
      ...(selected.status !== 'confirmed' ? {
        proposed_date: values.proposed_date || null,
        proposed_time: values.proposed_time || null,
      } : {}),
      agent_notes: values.agent_notes,
    };
    try {
      const updated = await updateManagedViewingRequest(selected.id, payload);
      setSelected(updated);
      setValues(formFromRequest(updated));
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSaveSuccess(text('requestManagementSaved'));
      setReloadKey((current) => current + 1);
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const runRequestAction = async (action: 'confirm_requested' | 'cancel' | 'complete') => {
    if (!selected) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      const updated = await actOnManagedViewingRequest(selected.id, action, actionMessage.trim());
      setSelected(updated);
      setValues(formFromRequest(updated));
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setActionMessage('');
      setSaveSuccess(text('requestManagementSaved'));
      setReloadKey((current) => current + 1);
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const updateFilter = (name: 'status' | 'ordering', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('page');
    setSearchParams(next);
  };

  const changePage = (nextPageValue: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPageValue > 1) next.set('page', String(nextPageValue));
    else next.delete('page');
    setSearchParams(next);
  };

  const preferredDate = (request: ManagedViewingRequest) =>
    `${request.preferred_date}${request.preferred_time ? ` · ${request.preferred_time.slice(0, 5)}` : ''}`;

  return (
    <main className="manager-page" id="main-content">
      <section className="manager-heading">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerEyebrow')}</p>
          <h1>{text('managerViewingRequests')}</h1>
          <p>{text('managerViewingIntro')}</p>
        </div>
      </section>

      <div className="manager-filter-bar">
        <label className="manager-filter">
          <span>{text('requestStatus')}</span>
          <select value={statusFilter ?? ''} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">{text('allStatuses')}</option>
            <option value="pending">{text('viewingPending')}</option>
            <option value="proposed">{text('viewingProposed')}</option>
            <option value="confirmed">{text('viewingConfirmed')}</option>
            <option value="rejected">{text('viewingRejected')}</option>
            <option value="declined">{text('viewingVisitorDeclined')}</option>
            <option value="cancelled">{text('viewingCancelled')}</option>
            <option value="completed">{text('viewingCompleted')}</option>
          </select>
        </label>
        <label className="manager-filter">
          <span>{text('sortBy')}</span>
          <select value={ordering} onChange={(event) => updateFilter('ordering', event.target.value)}>
            <option value="-created_at">{text('sortNewest')}</option>
            <option value="preferred_date">{text('sortPreferredDate')}</option>
            <option value="proposed_date">{text('appointmentProposalDate')}</option>
            <option value="scheduled_date">{text('sortScheduledDate')}</option>
          </select>
        </label>
        <button className="button button-outline" type="button" onClick={() => setReloadKey((current) => current + 1)}>
          <RotateCw size={15} aria-hidden="true" />{text('refresh')}
        </button>
      </div>

      {loadError && <div className="manager-form-error" role="alert">{text('managerLoadError')} {loadError}</div>}
      {loading ? (
        <div className="listing-state" role="status"><span className="loading-spinner" />{text('managerLoadingRequests')}</div>
      ) : requests.length ? (
        <>
          <div className="manager-table-wrap">
            <table className="manager-table">
              <thead>
                <tr>
                  <th scope="col">{text('requester')}</th>
                  <th scope="col">{text('listingTitle')}</th>
                  <th scope="col">{text('preferredDate')}</th>
                  <th scope="col">{text('requestStatus')}</th>
                  <th scope="col"><span className="visually-hidden">{text('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className={selected?.id === request.id ? 'is-selected' : ''}>
                    <td>
                      <strong>{request.full_name}</strong>
                      <span className="manager-row-secondary">{request.phone}</span>
                      {request.message && <span className="manager-row-secondary manager-request-message">{request.message}</span>}
                    </td>
                    <td>
                      <Link className="manager-row-property" to={`/management/listings/${request.property.id}/edit`}>{request.property.title}</Link>
                      <Link
                        className="manager-public-listing-link"
                        to={`/properties/${encodeURIComponent(request.property.slug)}`}
                        aria-label={`${text('openPublicListing')}: ${request.property.title}`}
                        title={text('openPublicListing')}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                      </Link>
                      <span className="manager-row-secondary">{request.property.location}</span>
                    </td>
                    <td>{preferredDate(request)}</td>
                    <td><span className={`manager-badge request-${request.status}`}>{text(requestStatusMessage(request.status))}</span></td>
                    <td>
                      <button className="manager-row-action" type="button" onClick={() => void chooseRequest(request.id)}>
                        {text('reviewRequest')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="manager-pagination">
            <span>{text('managerResultCount').replace('{count}', String(count))}</span>
            <div>
              <button className="button button-outline button-small" type="button" disabled={!previousPage} onClick={() => changePage(page - 1)}>
                <ArrowLeft size={15} aria-hidden="true" />{text('previousPage')}
              </button>
              <span>{text('pageOf')} {page} / {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span>
              <button className="button button-outline button-small" type="button" disabled={!nextPage} onClick={() => changePage(page + 1)}>
                {text('nextPage')}<ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : !loadError ? (
        <div className="manager-state">
          <CalendarClock size={25} aria-hidden="true" />
          <h2>{text('noManagedRequests')}</h2>
          <p>{text('noManagedRequestsBody')}</p>
        </div>
      ) : null}

      {detailLoading && <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingRequestDetails')}</div>}
      {detailError && <div className="manager-form-error" role="alert">{detailError}</div>}
      {selected && values && (
        <section className="request-review-card" aria-labelledby="request-review-title">
          <div className="request-review-heading">
            <div>
              <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('privateRequestDetails')}</p>
              <h2 id="request-review-title">{selected.full_name}</h2>
              <Link to={`/management/listings/${selected.property.id}/edit`}>{selected.property.title}</Link>
            </div>
            <span className={`manager-badge request-${selected.status}`}>{text(requestStatusMessage(selected.status))}</span>
          </div>
          <div className="request-contact-grid">
            <div><span>{text('emailAddress')}</span><a href={`mailto:${selected.email}`}>{selected.email}</a></div>
            <div><span>{text('phoneNumber')}</span><a href={`tel:${selected.phone}`}>{selected.phone}</a></div>
            <div><span>{text('preferredDate')}</span><strong>{preferredDate(selected)}</strong></div>
            {selected.message && <div className="request-message"><span>{text('requestMessage')}</span><p>{selected.message}</p></div>}
            {selected.scheduled_date && (
              <div>
                <span>{text('scheduledDate')}</span>
                <strong>{selected.scheduled_date}{selected.scheduled_time ? ` · ${selected.scheduled_time.slice(0, 5)}` : ''}</strong>
                <small>{text('appointmentTimezone').replace('{timezone}', selected.appointment_timezone)}</small>
              </div>
            )}
          </div>
          <section className="request-event-history" aria-labelledby="request-event-history-title">
            <h3 id="request-event-history-title">{text('requestHistory')}</h3>
            <ol>
              {selected.events.map((event, index) => (
                <li key={`${event.event_type}-${event.created_at}-${index}`}>
                  <strong>{text(eventMessage(event.event_type))}</strong>
                  <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
                  {event.proposed_date && (
                    <span>
                      {event.proposed_date}{event.proposed_time ? ` · ${event.proposed_time.slice(0, 5)}` : ''}
                    </span>
                  )}
                  {event.actor_name && <span>{event.actor_name}</span>}
                  {event.message && <p>{event.message}</p>}
                </li>
              ))}
            </ol>
          </section>
          <form className="request-update-form" onSubmit={(event) => void saveRequest(event)}>
            <h3>{text('manageRequest')}</h3>
            <div className="manager-form-grid">
              <label className="manager-field">
                <span>{text('requestStatus')}</span>
                <select value={values.status} onChange={(event) => updateFormValue('status', event.target.value as '' | 'rejected')}>
                  <option value="">{text('keepCurrentStatus')}</option>
                  <option value="rejected">{text('viewingRejected')}</option>
                </select>
              </label>
              <label className="manager-field">
                <span>{text('appointmentProposalDate')}</span>
                <input
                  type="date"
                  value={values.proposed_date}
                  disabled={selected.status === 'confirmed'}
                  onChange={(event) => updateFormValue('proposed_date', event.target.value)}
                />
              </label>
              <label className="manager-field">
                <span>{text('appointmentProposalTime')}</span>
                <input
                  type="time"
                  value={values.proposed_time}
                  disabled={selected.status === 'confirmed'}
                  onChange={(event) => updateFormValue('proposed_time', event.target.value)}
                />
              </label>
              <p className="manager-field-hint">
                {text('appointmentTimezone').replace('{timezone}', selected.appointment_timezone)}
              </p>
              <label className="manager-field manager-field-wide">
                <span>{text('privateAgentNotes')}</span>
                <textarea rows={4} value={values.agent_notes} onChange={(event) => updateFormValue('agent_notes', event.target.value)} />
              </label>
            </div>
            {saveError && <p className="manager-inline-error" role="alert">{saveError}</p>}
            {saveSuccess && <p className="manager-inline-success" role="status">{saveSuccess}</p>}
            <div className="manager-form-actions">
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? text('savingRequest') : text('saveRequest')}</button>
              <button className="button button-outline" type="button" onClick={() => { setSelected(null); setValues(null); }}>
                <ArrowLeft size={15} aria-hidden="true" />{text('closeRequestDetails')}
              </button>
            </div>
          </form>
          {['pending', 'proposed', 'confirmed', 'declined'].includes(selected.status) && (
            <section className="request-update-form" aria-labelledby="request-action-title">
              <h3 id="request-action-title">{text('requestActions')}</h3>
              <label className="manager-field manager-field-wide">
                <span>{text('messageToCustomer')}</span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={actionMessage}
                  onChange={(event) => setActionMessage(event.target.value)}
                />
              </label>
              <div className="manager-form-actions">
                {(selected.status === 'pending' || selected.status === 'declined') && selected.preferred_time && (
                  <button className="button button-primary" type="button" disabled={saving} onClick={() => void runRequestAction('confirm_requested')}>
                    {text('confirmRequestedTime')}
                  </button>
                )}
                {selected.status === 'confirmed' && (
                  <button className="button button-primary" type="button" disabled={saving} onClick={() => void runRequestAction('complete')}>
                    {text('markViewingCompleted')}
                  </button>
                )}
                <button className="button button-outline" type="button" disabled={saving} onClick={() => void runRequestAction('cancel')}>
                  {text('cancelViewingRequest')}
                </button>
              </div>
            </section>
          )}
        </section>
      )}
    </main>
  );
}
