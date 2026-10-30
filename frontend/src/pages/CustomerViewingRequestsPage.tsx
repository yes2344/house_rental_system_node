import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import {
  cancelCustomerViewingRequest,
  deleteCustomerViewingRequest,
  getCustomerViewingRequests,
  respondToCustomerViewingRequest,
  updateCustomerViewingRequest,
  type CustomerViewingRequest,
  type CustomerViewingRequestUpdate,
  type ViewingRequestStatusValue,
} from '../api/viewings';
import type { Locale, MessageKey } from '../i18n';

interface CustomerViewingRequestsPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

const statuses: ViewingRequestStatusValue[] = [
  'pending', 'proposed', 'confirmed', 'rejected', 'declined', 'cancelled', 'completed',
];

function statusMessage(status: ViewingRequestStatusValue): MessageKey {
  const messages: Record<ViewingRequestStatusValue, MessageKey> = {
    pending: 'viewingPending',
    proposed: 'viewingProposed',
    confirmed: 'viewingConfirmed',
    rejected: 'viewingRejected',
    declined: 'viewingVisitorDeclined',
    cancelled: 'viewingCancelled',
    completed: 'viewingCompleted',
  };
  return messages[status];
}

function eventMessage(eventType: string): MessageKey {
  if (eventType === 'proposal_sent') return 'appointmentProposedEvent';
  if (eventType === 'proposal_revised') return 'appointmentRevisedEvent';
  if (eventType === 'request_updated') return 'viewingRequestUpdatedEvent';
  if (eventType === 'proposal_accepted') return 'appointmentAcceptedEvent';
  if (eventType === 'proposal_declined') return 'appointmentDeclinedEvent';
  if (eventType === 'request_confirmed') return 'requestConfirmedEvent';
  if (eventType === 'rejected') return 'requestRejectedEvent';
  if (eventType === 'cancelled') return 'viewingCancelled';
  if (eventType === 'completed') return 'viewingCompleted';
  return 'requestSubmittedEvent';
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'am' ? 'am-ET' : 'en-ET', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`));
}

function localDateString(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function CustomerViewingRequestsPage({ locale, text }: CustomerViewingRequestsPageProps) {
  const [requests, setRequests] = useState<CustomerViewingRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyRequest, setBusyRequest] = useState<number | null>(null);
  const [editingRequest, setEditingRequest] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<
    Partial<Record<keyof CustomerViewingRequestUpdate, string>>
  >({});
  const [reload, setReload] = useState(0);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getCustomerViewingRequests(
        page,
        statusFilter ? statusFilter as ViewingRequestStatusValue : undefined,
      );
      setRequests(result.results);
      setCount(result.count);
      setHasPrevious(Boolean(result.previous));
      setHasNext(Boolean(result.next));
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, reload, statusFilter]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const runAction = async (
    request: CustomerViewingRequest,
    action: 'accept' | 'decline' | 'cancel',
  ) => {
    setBusyRequest(request.id);
    setActionError('');
    try {
      if (action === 'cancel') await cancelCustomerViewingRequest(request.id);
      else await respondToCustomerViewingRequest(request.id, action);
      await loadRequests();
    } catch (actionFailure: unknown) {
      setActionError(getErrorMessage(actionFailure));
    } finally {
      setBusyRequest(null);
    }
  };

  const saveRequestChanges = async (event: FormEvent<HTMLFormElement>, request: CustomerViewingRequest) => {
    event.preventDefault();
    setBusyRequest(request.id);
    setActionError('');
    try {
      await updateCustomerViewingRequest(request.id, {
        full_name: editValues.full_name ?? request.full_name,
        email: editValues.email ?? request.email,
        phone: editValues.phone ?? request.phone,
        preferred_date: editValues.preferred_date ?? request.preferred_date,
        preferred_time: editValues.preferred_time || null,
        message: editValues.message ?? request.message,
      });
      setEditingRequest(null);
      setEditValues({});
      await loadRequests();
    } catch (saveError: unknown) {
      setActionError(getErrorMessage(saveError));
    } finally {
      setBusyRequest(null);
    }
  };

  const startEditing = (request: CustomerViewingRequest) => {
    setEditingRequest(request.id);
    setEditValues({
      full_name: request.full_name,
      email: request.email,
      phone: request.phone,
      preferred_date: request.preferred_date,
      preferred_time: request.preferred_time?.slice(0, 5) ?? '',
      message: request.message,
    });
    setActionError('');
  };

  const updateEditValue = (field: keyof CustomerViewingRequestUpdate, value: string) => {
    setEditValues((current) => ({ ...current, [field]: value }));
  };

  const deleteViewingRequest = async (request: CustomerViewingRequest) => {
    if (!window.confirm(text('confirmHideViewingRequest'))) return;
    setBusyRequest(request.id);
    setActionError('');
    try {
      await deleteCustomerViewingRequest(request.id);
      if (editingRequest === request.id) setEditingRequest(null);
      if (requests.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        await loadRequests();
      }
    } catch (actionFailure: unknown) {
      setActionError(getErrorMessage(actionFailure));
    } finally {
      setBusyRequest(null);
    }
  };

  const changeFilter = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <main id="main-content" className="customer-page">
      <section className="customer-heading">
        <div className="container">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('viewingActivity')}</p>
          <h1>{text('yourViewingRequests')}</h1>
          <p>{text('yourViewingRequestsIntro')}</p>
        </div>
      </section>
      <section className="container customer-content">
        <section className="customer-panel" aria-labelledby="customer-viewing-requests-title">
          <div className="customer-panel-heading">
            <div>
              <h2 id="customer-viewing-requests-title">{text('viewingActivity')}</h2>
              <p>{text('yourViewingRequestsCount').replace('{count}', String(count))}</p>
            </div>
            <div className="customer-request-toolbar">
              <label>
                <span className="visually-hidden">{text('requestStatus')}</span>
                <select value={statusFilter} onChange={(event) => changeFilter(event.target.value)}>
                  <option value="">{text('allStatuses')}</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>{text(statusMessage(status))}</option>
                  ))}
                </select>
              </label>
              <button className="button button-outline button-small" type="button" onClick={() => setReload((value) => value + 1)}>
                <RotateCw size={15} aria-hidden="true" />{text('refresh')}
              </button>
            </div>
          </div>

          {error && <div className="customer-error" role="alert"><p>{text('activityLoadError')} {error}</p></div>}
          {actionError && <div className="customer-error" role="alert"><p>{actionError}</p></div>}
          {loading ? (
            <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingActivity')}</div>
          ) : requests.length ? (
            <div className="customer-request-list">
              {requests.map((request) => (
                <article className="customer-request-card" key={request.id}>
                  <div className="customer-request-heading">
                    <div>
                      <Link to={`/properties/${encodeURIComponent(request.property.slug)}`}>{request.property.title}</Link>
                      <p>{request.property.location}</p>
                    </div>
                    <span className={`activity-status is-${request.status}`}>{text(statusMessage(request.status))}</span>
                  </div>
                  <div className="customer-request-dates">
                    <p><strong>{text('preferredDate')}:</strong> {formatDate(request.preferred_date, locale)}{request.preferred_time ? ` · ${request.preferred_time.slice(0, 5)}` : ''}</p>
                    {request.proposed_date && request.status === 'proposed' && (
                      <p><strong>{text('appointmentProposalDate')}:</strong> {formatDate(request.proposed_date, locale)}{request.proposed_time ? ` · ${request.proposed_time.slice(0, 5)}` : ''}</p>
                    )}
                    {request.scheduled_date && (
                      <p><strong>{text('scheduledDate')}:</strong> {formatDate(request.scheduled_date, locale)}{request.scheduled_time ? ` · ${request.scheduled_time.slice(0, 5)}` : ''} ({request.appointment_timezone})</p>
                    )}
                  </div>
                  {request.message && <p className="customer-request-message">{request.message}</p>}
                  <details className="customer-request-history">
                    <summary>{text('requestHistory')}</summary>
                    <ol>
                      {request.events.map((event, index) => (
                        <li key={`${event.event_type}-${event.created_at}-${index}`}>
                          <strong>{text(eventMessage(event.event_type))}</strong>
                          <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')}</time>
                          {event.proposed_date && <span>{formatDate(event.proposed_date, locale)}{event.proposed_time ? ` · ${event.proposed_time.slice(0, 5)}` : ''}</span>}
                          {event.message && <p>{event.message}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                  {editingRequest === request.id && (
                    <form
                      className="customer-request-edit-form"
                      onSubmit={(event) => void saveRequestChanges(event, request)}
                    >
                      <label>
                        <span>{text('fullName')}</span>
                        <input
                          autoComplete="name"
                          maxLength={200}
                          required
                          value={editValues.full_name ?? ''}
                          onChange={(event) => updateEditValue('full_name', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>{text('emailAddress')}</span>
                        <input
                          type="email"
                          autoComplete="email"
                          required
                          value={editValues.email ?? ''}
                          onChange={(event) => updateEditValue('email', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>{text('phoneNumber')}</span>
                        <input
                          type="tel"
                          autoComplete="tel"
                          maxLength={50}
                          required
                          value={editValues.phone ?? ''}
                          onChange={(event) => updateEditValue('phone', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>{text('preferredDate')}</span>
                        <input
                          type="date"
                          min={localDateString(new Date())}
                          required
                          value={editValues.preferred_date ?? ''}
                          onChange={(event) => updateEditValue('preferred_date', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>{text('preferredTime')}</span>
                        <input
                          type="time"
                          value={editValues.preferred_time ?? ''}
                          onChange={(event) => updateEditValue('preferred_time', event.target.value)}
                        />
                      </label>
                      <label className="customer-request-edit-message">
                        <span>{text('optionalMessage')}</span>
                        <textarea
                          rows={3}
                          value={editValues.message ?? ''}
                          onChange={(event) => updateEditValue('message', event.target.value)}
                        />
                      </label>
                      <div className="customer-request-edit-actions">
                        <button className="button button-primary button-small" type="submit" disabled={busyRequest === request.id}>
                          {busyRequest === request.id ? text('savingOwnViewingRequest') : text('saveRequestChanges')}
                        </button>
                        <button className="button button-outline button-small" type="button" onClick={() => setEditingRequest(null)}>
                          {text('cancelRequestEdit')}
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="customer-request-actions">
                    {request.status === 'pending' && (
                      <button
                        className="button button-outline button-small"
                        type="button"
                        disabled={busyRequest === request.id}
                        onClick={() => editingRequest === request.id ? setEditingRequest(null) : startEditing(request)}
                      >
                        <Pencil size={14} aria-hidden="true" />{editingRequest === request.id ? text('cancelRequestEdit') : text('editViewingRequest')}
                      </button>
                    )}
                    {request.status === 'proposed' && (
                      <>
                        <button className="button button-primary button-small" type="button" disabled={busyRequest === request.id} onClick={() => void runAction(request, 'accept')}>
                          {text('acceptProposal')}
                        </button>
                        <button className="button button-outline button-small" type="button" disabled={busyRequest === request.id} onClick={() => void runAction(request, 'decline')}>
                          {text('declineProposal')}
                        </button>
                      </>
                    )}
                    {['pending', 'proposed', 'confirmed', 'declined'].includes(request.status) && (
                      <button className="button button-outline button-small" type="button" disabled={busyRequest === request.id} onClick={() => void runAction(request, 'cancel')}>
                        {text('cancelViewingRequest')}
                      </button>
                    )}
                    <button className="button button-outline button-small" type="button" disabled={busyRequest === request.id} onClick={() => void deleteViewingRequest(request)}>
                      <Trash2 size={14} aria-hidden="true" />{text('hideViewingRequest')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : !error ? (
            <div className="activity-empty">
              <CalendarClock size={25} aria-hidden="true" />
              <p>{text('noViewingActivity')}</p>
              <Link to="/">{text('browseAll')}</Link>
            </div>
          ) : null}

          <div className="manager-pagination customer-request-pagination">
            <span>{text('yourViewingRequestsCount').replace('{count}', String(count))}</span>
            <div>
              <button className="button button-outline button-small" type="button" disabled={!hasPrevious || loading} onClick={() => setPage((value) => value - 1)}>
                <ArrowLeft size={15} aria-hidden="true" />{text('previousPage')}
              </button>
              <span>{text('pageOf')} {page} / {Math.max(1, Math.ceil(count / 12))}</span>
              <button className="button button-outline button-small" type="button" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)}>
                {text('nextPage')}<ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
          <Link className="customer-inline-link" to="/account">{text('backToAccount')}</Link>
        </section>
      </section>
    </main>
  );
}
