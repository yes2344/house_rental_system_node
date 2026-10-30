import { useEffect, useState } from 'react';
import { Check, ChevronDown, FileText, MapPin, Trash2, X } from 'lucide-react';

import { useAuth } from '../AuthContext';
import { getErrorMessage } from '../api/client';
import {
  assignSubmissionReviewer,
  deleteManagedSubmissions,
  decideSubmission,
  getSubmissionReviews,
  getSubmissionReviewers,
  type OwnerSubmissionReview,
  type OwnerSubmissionReviewFilters,
  type OwnerSubmissionStatus,
  type SubmissionReviewer,
} from '../api/ownerSubmissions';
import { formatPropertyPrice } from '../components/propertyDisplay';
import type { Locale, MessageKey } from '../i18n';

interface SubmissionReviewPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

const statusMessages: Record<OwnerSubmissionStatus, MessageKey> = {
  pending_review: 'submissionPending',
  corrections_requested: 'submissionCorrectionsRequested',
  approved: 'submissionApproved',
  rejected: 'submissionRejected',
  suspended: 'publicationSuspended',
  expired: 'submissionExpired',
  withdrawn: 'submissionWithdrawn',
};

const reviewStatuses: OwnerSubmissionStatus[] = [
  'pending_review',
  'corrections_requested',
  'approved',
  'rejected',
];

function ethiopianCurrentDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to determine the current Ethiopian local date.');
  return `${year}-${month}-${day}`;
}

export function SubmissionReviewPage({ locale, text }: SubmissionReviewPageProps) {
  const { account } = useAuth();
  const canAssignReviews = Boolean(account?.management_permissions.includes('announcements.assign'));
  const canBulkDelete = account?.role === 'administrator';
  const [statusFilter, setStatusFilter] = useState<OwnerSubmissionStatus | ''>('pending_review');
  const [reviews, setReviews] = useState<OwnerSubmissionReview[]>([]);
  const [reviewers, setReviewers] = useState<SubmissionReviewer[]>([]);
  const [reviewerOptionsError, setReviewerOptionsError] = useState('');
  const [assignmentValues, setAssignmentValues] = useState<Record<number, string>>({});
  const [assignmentErrors, setAssignmentErrors] = useState<Record<number, string>>({});
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [decisionErrors, setDecisionErrors] = useState<Record<number, string>>({});
  const [actingId, setActingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [agreementTerms, setAgreementTerms] = useState<Record<number, string>>({});
  const [agreementStartDates, setAgreementStartDates] = useState<Record<number, string>>({});
  const [agreementDurations, setAgreementDurations] = useState<Record<number, string>>({});
  const [customAgreementDurations, setCustomAgreementDurations] = useState<Record<number, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState('');

  useEffect(() => {
    if (!canAssignReviews) return undefined;
    const controller = new AbortController();
    void getSubmissionReviewers(controller.signal)
      .then(setReviewers)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setReviewerOptionsError(getErrorMessage(requestError));
        }
      });
    return () => controller.abort();
  }, [canAssignReviews]);

  const loadReviews = (filters: OwnerSubmissionReviewFilters, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    void getSubmissionReviews(filters)
      .then((response) => {
        setReviews((current) => append ? [...current, ...response.results] : response.results);
        if (!append) setSelectedIds(new Set());
        setCount(response.count);
        setHasNext(Boolean(response.next));
        setPage(filters.page ?? 1);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => {
    loadReviews({ status: statusFilter || undefined, page: 1 });
  }, [statusFilter]);

  const act = async (review: OwnerSubmissionReview, action: 'approve' | 'reject' | 'request_corrections') => {
    if (action === 'approve' && agreementDurations[review.id] === 'custom') {
      const customDuration = Number(customAgreementDurations[review.id]);
      if (!Number.isInteger(customDuration) || customDuration < 1 || customDuration > 120) {
        setDecisionErrors((current) => ({
          ...current,
          [review.id]: text('agreementDurationValidation'),
        }));
        return;
      }
    }
    setActingId(review.id);
    setDecisionErrors((current) => ({ ...current, [review.id]: '' }));
    try {
      if (action === 'approve') {
        const selectedDuration = agreementDurations[review.id] ?? '12';
        await decideSubmission(review.id, {
          action,
          agreement_start_date: agreementStartDates[review.id] || ethiopianCurrentDate(),
          agreement_duration_months: Number(
            selectedDuration === 'custom'
              ? customAgreementDurations[review.id] ?? ''
              : selectedDuration,
          ),
          agreement_terms: agreementTerms[review.id]?.trim() ?? '',
        });
      } else {
        await decideSubmission(review.id, {
          action,
          feedback: feedback[review.id]?.trim() ?? '',
        });
      }
      loadReviews({ status: statusFilter || undefined, page: 1 });
    } catch (requestError: unknown) {
      setDecisionErrors((current) => ({ ...current, [review.id]: getErrorMessage(requestError) }));
    } finally {
      setActingId(null);
    }
  };

  const assignReviewer = async (review: OwnerSubmissionReview) => {
    const selectedReviewer = assignmentValues[review.id]
      ?? (review.assigned_reviewer_id === null ? '' : String(review.assigned_reviewer_id));
    setAssigningId(review.id);
    setAssignmentErrors((current) => ({ ...current, [review.id]: '' }));
    try {
      await assignSubmissionReviewer(
        review.id,
        selectedReviewer ? Number(selectedReviewer) : null,
      );
      loadReviews({ status: statusFilter || undefined, page: 1 });
    } catch (requestError: unknown) {
      setAssignmentErrors((current) => ({ ...current, [review.id]: getErrorMessage(requestError) }));
    } finally {
      setAssigningId(null);
    }
  };

  const loadMore = () => {
    if (!hasNext || loadingMore) return;
    loadReviews({ status: statusFilter || undefined, page: page + 1 }, true);
  };

  const allVisibleSelected = reviews.length > 0
    && reviews.every((review) => selectedIds.has(review.id));

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected
      ? new Set()
      : new Set(reviews.map((review) => review.id)));
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = reviews
      .filter((review) => selectedIds.has(review.id))
      .map((review) => review.id);
    if (!ids.length || !window.confirm(
      text('confirmDeleteManagedSubmissions').replace('{count}', String(ids.length)),
    )) return;
    setBulkDeleting(true);
    setBulkDeleteError('');
    try {
      await deleteManagedSubmissions(ids);
      setSelectedIds(new Set());
      loadReviews({ status: statusFilter || undefined, page: 1 });
    } catch (requestError: unknown) {
      setBulkDeleteError(`${text('bulkSubmissionDeleteError')} ${getErrorMessage(requestError)}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <main className="manager-page" id="main-content">
      <section className="manager-heading">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerEyebrow')}</p>
          <h1>{text('submissionReviewTitle')}</h1>
          <p>{text('submissionReviewIntro')}</p>
        </div>
      </section>
      <section className="manager-list-section">
        <div className="manager-list-toolbar">
          <label className="manager-field">
            <span>{text('filterSubmissions')}</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OwnerSubmissionStatus | '')}>
              <option value="">{text('allSubmissions')}</option>
              {reviewStatuses.map((value) => <option value={value} key={value}>{text(statusMessages[value])}</option>)}
            </select>
          </label>
          <p>{count} {text('submissionCount')}</p>
        </div>
        {bulkDeleteError && <p className="manager-inline-error" role="alert">{bulkDeleteError}</p>}
        {loading ? (
          <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingSubmission')}</div>
        ) : error ? (
          <div className="listing-state listing-error" role="alert">{text('submissionsLoadError')} {error}</div>
        ) : reviews.length === 0 ? (
          <div className="listing-empty">
            <span className="empty-icon"><FileText size={22} aria-hidden="true" /></span>
            <h2>{text('noSubmissionsForReview')}</h2>
          </div>
        ) : (
          <>
          {canBulkDelete && (
            <div className="manager-bulk-actions">
              <label className="manager-bulk-select">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label={text('selectAllReviews')}
                />
                <span>{text('selectAllReviews')}</span>
              </label>
              <span>{text('selectedSubmissions').replace('{count}', String(selectedIds.size))}</span>
              <button
                className="button button-danger button-small"
                type="button"
                disabled={!selectedIds.size || bulkDeleting}
                onClick={() => void deleteSelected()}
              >
                <Trash2 size={15} aria-hidden="true" />
                {bulkDeleting ? text('deletingSelectedSubmissions') : text('deleteSelectedSubmissions')}
              </button>
            </div>
          )}
          <div className="submission-review-list">
            {reviews.map((review) => {
              const property = review.property;
              const canDecide = review.status === 'pending_review' || review.status === 'corrections_requested';
              const selectedDuration = agreementDurations[review.id] ?? '12';
              return (
                <article className="submission-review-card" key={review.id}>
                  {canBulkDelete && (
                    <label className="submission-select submission-review-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(review.id)}
                        disabled={bulkDeleting}
                        onChange={() => toggleSelected(review.id)}
                        aria-label={`${text('selectReview')}: ${property.title}`}
                      />
                      <span className="visually-hidden">{text('selectReview')}: {property.title}</span>
                    </label>
                  )}
                  <header className="submission-review-heading">
                    <div>
                      <span className={`submission-status submission-status-${review.status}`}>
                        {text(statusMessages[review.status])}
                      </span>
                      <h2>{property.title}</h2>
                      <p><MapPin size={14} aria-hidden="true" />{property.location}</p>
                    </div>
                    <strong>{formatPropertyPrice(property.price, property.listing_type, property.rental_frequency, locale, text)}</strong>
                  </header>
                  {review.assigned_reviewer_name && (
                    <p className="submission-review-assignee">
                      <strong>{text('assignSubmissionReviewer')}:</strong> {review.assigned_reviewer_name}
                    </p>
                  )}
                  <details className="submission-review-details">
                    <summary>{text('submissionReviewDetails')}<ChevronDown size={15} aria-hidden="true" /></summary>
                    <div className="submission-review-detail-grid">
                      <p><strong>{text('propertyType')}:</strong> {property.category}</p>
                      <p><strong>{text('listingType')}:</strong> {text(property.listing_type === 'sale' ? 'searchBuy' : 'searchRent')}</p>
                      <p><strong>{text('bedrooms')}:</strong> {property.bedrooms}</p>
                      <p><strong>{text('bathrooms')}:</strong> {property.bathrooms}</p>
                      <p><strong>{text('sizeLabel')}:</strong> {property.area_value ?? property.area_sqft} {property.area_unit}</p>
                      <p><strong>{text('submissionSubmittedBy')}:</strong> {review.owner_contact_name} · {review.owner_contact_phone}
                        {review.owner_contact_email && <> · {review.owner_contact_email}</>}
                      </p>
                    </div>
                    <p className="submission-review-description">{property.description}</p>
                    {property.features && <p>{property.features}</p>}
                    {property.images.length > 0 && (
                      <div className="submission-image-grid">
                        {property.images.map((image) => (
                          image.url && <img key={image.id} src={image.url} alt={image.caption || text('propertyPhoto')} />
                        ))}
                      </div>
                    )}
                    <ol className="submission-event-list">
                      {review.events.map((event, index) => (
                        <li key={`${event.created_at}-${index}`}>
                          {event.event_type === 'assigned'
                            ? text('reviewAssignedEvent')
                            : event.event_type === 'unassigned'
                              ? text('reviewUnassignedEvent')
                              : text(statusMessages[event.to_status as OwnerSubmissionStatus] ?? 'submissionPending')}
                          <time dateTime={event.created_at}>{new Intl.DateTimeFormat(
                            locale === 'am' ? 'am-ET' : 'en-ET',
                            { dateStyle: 'medium', timeStyle: 'short' },
                          ).format(new Date(event.created_at))}</time>
                          {typeof event.details.assigned_reviewer_name === 'string'
                            && <p>{event.details.assigned_reviewer_name}</p>}
                          {typeof event.details.feedback === 'string' && <p>{event.details.feedback}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                  {canAssignReviews && canDecide && (
                    <div className="submission-review-assignment">
                      <label className="manager-field">
                        <span>{text('assignSubmissionReviewer')}</span>
                        <select
                          value={assignmentValues[review.id]
                            ?? (review.assigned_reviewer_id === null ? '' : String(review.assigned_reviewer_id))}
                          onChange={(event) => setAssignmentValues((current) => ({
                            ...current,
                            [review.id]: event.target.value,
                          }))}
                        >
                          <option value="">{text('submissionReviewerUnassigned')}</option>
                          {reviewers.map((reviewer) => (
                            <option key={reviewer.id} value={reviewer.id}>{reviewer.display_name}</option>
                          ))}
                        </select>
                      </label>
                      {reviewerOptionsError && (
                        <p className="manager-inline-error" role="alert">
                          {text('reviewerOptionsError')} {reviewerOptionsError}
                        </p>
                      )}
                      {assignmentErrors[review.id] && (
                        <p className="manager-inline-error" role="alert">{assignmentErrors[review.id]}</p>
                      )}
                      <button
                        className="button button-outline"
                        type="button"
                        disabled={assigningId === review.id || Boolean(reviewerOptionsError)}
                        onClick={() => void assignReviewer(review)}
                      >
                        {assigningId === review.id ? text('savingSubmission') : text('saveReviewerAssignment')}
                      </button>
                    </div>
                  )}
                  {canDecide && (
                    <div className="submission-review-actions">
                      <label className="manager-field">
                        <span>{text('reviewFeedback')}</span>
                        <textarea
                          rows={2}
                          value={feedback[review.id] ?? ''}
                          onChange={(event) => setFeedback((current) => ({ ...current, [review.id]: event.target.value }))}
                        />
                      </label>
                      <details className="submission-agreement-fields">
                        <summary>{text('reviewAgreement')}</summary>
                        <div className="manager-form-grid">
                          <label className="manager-field">
                            <span>{text('agreementStartDate')}</span>
                            <input
                              type="date"
                              value={agreementStartDates[review.id] ?? new Date().toISOString().slice(0, 10)}
                              onChange={(event) => setAgreementStartDates((current) => ({ ...current, [review.id]: event.target.value }))}
                            />
                          </label>
                          <label className="manager-field">
                            <span>{text('agreementDurationMonths')}</span>
                            <select
                              value={selectedDuration}
                              onChange={(event) => setAgreementDurations((current) => ({ ...current, [review.id]: event.target.value }))}
                            >
                              {[3, 6, 12, 24, 36].map((months) => (
                                <option key={months} value={months}>
                                  {text('agreementMonthsOption').replace('{months}', String(months))}
                                </option>
                              ))}
                              <option value="custom">{text('agreementCustomDuration')}</option>
                            </select>
                          </label>
                          {selectedDuration === 'custom' && (
                            <label className="manager-field manager-field-wide">
                              <span>{text('agreementCustomDuration')}</span>
                              <input
                                type="number"
                                min="1"
                                max="120"
                                required
                                value={customAgreementDurations[review.id] ?? ''}
                                onChange={(event) => setCustomAgreementDurations((current) => ({
                                  ...current,
                                  [review.id]: event.target.value,
                                }))}
                              />
                            </label>
                          )}
                          <label className="manager-field manager-field-wide">
                            <span>{text('agreementTerms')}</span>
                            <textarea
                              rows={3}
                              value={agreementTerms[review.id] ?? ''}
                              onChange={(event) => setAgreementTerms((current) => ({ ...current, [review.id]: event.target.value }))}
                            />
                          </label>
                        </div>
                      </details>
                      {decisionErrors[review.id] && <p className="manager-inline-error" role="alert">{text('submissionDecisionError')} {decisionErrors[review.id]}</p>}
                      <div className="submission-review-buttons">
                        <button className="button button-primary" type="button" disabled={actingId === review.id} onClick={() => void act(review, 'approve')}>
                          <Check size={15} aria-hidden="true" />{actingId === review.id ? text('savingSubmission') : text('approveSubmission')}
                        </button>
                        <button className="button button-outline" type="button" disabled={actingId === review.id} onClick={() => void act(review, 'request_corrections')}>
                          {text('requestCorrections')}
                        </button>
                        <button className="button button-outline submission-reject-button" type="button" disabled={actingId === review.id} onClick={() => void act(review, 'reject')}>
                          <X size={15} aria-hidden="true" />{text('rejectSubmission')}
                        </button>
                      </div>
                    </div>
                  )}
                  {!canDecide && review.agent_feedback && (
                    <p className="submission-feedback"><strong>{text('submissionReviewFeedback')}:</strong> {review.agent_feedback}</p>
                  )}
                </article>
              );
            })}
          </div>
          </>
        )}
        {hasNext && !loading && !error && (
          <div className="show-more-listings">
            <button className="button button-outline" type="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? text('loadingSubmission') : text('loadMoreSubmissions')}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
