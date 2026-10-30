import { useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, FileText, Plus, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import {
  deleteMySubmissions,
  getMySubmissions,
  type OwnerSubmission,
  type OwnerSubmissionStatus,
} from '../api/ownerSubmissions';
import { formatPropertyLocation } from '../components/locationDisplay';
import { formatPropertyPrice } from '../components/propertyDisplay';
import type { Locale, MessageKey } from '../i18n';

interface MyPropertySubmissionsPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

interface SubmissionsLocationState {
  submitted?: boolean;
  imageUploadFailures?: string[];
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

const deletableStatuses = new Set<OwnerSubmissionStatus>([
  'pending_review',
  'corrections_requested',
  'rejected',
]);

export function MyPropertySubmissionsPage({ locale, text }: MyPropertySubmissionsPageProps) {
  const location = useLocation();
  const locationState = location.state as SubmissionsLocationState | null;
  const [submissions, setSubmissions] = useState<OwnerSubmission[]>([]);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const loadSubmissions = (pageNumber: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    void getMySubmissions(pageNumber)
      .then((response) => {
        setSubmissions((current) => (
          append ? [...current, ...response.results] : response.results
        ));
        if (!append) setSelectedIds(new Set());
        setCount(response.count);
        setHasNext(Boolean(response.next));
        setPage(pageNumber);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => {
    loadSubmissions(1, false);
  }, []);

  const loadMore = () => {
    if (!hasNext || loadingMore) return;
    loadSubmissions(page + 1, true);
  };

  const deletableSubmissions = submissions.filter(
    (submission) => deletableStatuses.has(submission.submission_status),
  );
  const allDeletableSelected = deletableSubmissions.length > 0
    && deletableSubmissions.every((submission) => selectedIds.has(submission.id));

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllDeletable = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allDeletableSelected) {
        deletableSubmissions.forEach((submission) => next.delete(submission.id));
      } else {
        deletableSubmissions.forEach((submission) => next.add(submission.id));
      }
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = deletableSubmissions
      .filter((submission) => selectedIds.has(submission.id))
      .map((submission) => submission.id);
    if (!ids.length || !window.confirm(
      text('confirmDeleteSelectedSubmissions').replace('{count}', String(ids.length)),
    )) return;
    setBulkDeleting(true);
    setActionError('');
    try {
      await deleteMySubmissions(ids);
      setSelectedIds(new Set());
      loadSubmissions(1, false);
    } catch (requestError: unknown) {
      setActionError(`${text('bulkSubmissionDeleteError')} ${getErrorMessage(requestError)}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <main className="customer-page" id="main-content">
      <section className="customer-heading">
        <div className="container">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('accountEyebrow')}</p>
          <h1>{text('mySubmissions')}</h1>
          <p>{text('mySubmissionsIntro')}</p>
        </div>
      </section>
      <section className="container customer-content">
        {locationState?.submitted && <p className="manager-inline-success" role="status">{text('submissionSubmitted')}</p>}
        {actionError && <p className="manager-inline-error" role="alert">{actionError}</p>}
        {locationState?.imageUploadFailures?.length ? (
          <div className="manager-inline-error" role="alert">
            <p>{text('submissionImagesUploadIssue')}</p>
            <ul>{locationState.imageUploadFailures.map((failure) => <li key={failure}>{failure}</li>)}</ul>
          </div>
        ) : null}
        <div className="customer-section-heading">
          <div>
            <h2>{text('mySubmissions')}</h2>
            <p>{count} {text('submissionCount')}</p>
          </div>
          <Link className="button button-primary" to="/submissions/new"><Plus size={16} aria-hidden="true" />{text('addYourProperty')}</Link>
        </div>
        {loading ? (
          <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingSubmission')}</div>
        ) : error ? (
          <div className="listing-state listing-error" role="alert">{text('submissionsLoadError')} {error}</div>
        ) : submissions.length === 0 ? (
          <div className="listing-empty">
            <span className="empty-icon"><FileText size={22} aria-hidden="true" /></span>
            <h2>{text('submissionEmpty')}</h2>
            <p>{text('submissionEmptyIntro')}</p>
            <Link className="button button-primary" to="/submissions/new"><Plus size={16} aria-hidden="true" />{text('submitProperty')}</Link>
          </div>
        ) : (
          <>
            {deletableSubmissions.length > 0 && (
              <div className="manager-bulk-actions">
                <label className="manager-bulk-select">
                  <input
                    type="checkbox"
                    checked={allDeletableSelected}
                    onChange={toggleAllDeletable}
                    aria-label={text('selectAllSubmissions')}
                  />
                  <span>{text('selectAllSubmissions')}</span>
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
            <div className="submission-list">
              {submissions.map((submission) => {
                const statusKey = statusMessages[submission.submission_status];
                const primaryImage = submission.images.find((image) => image.is_primary) ?? submission.images[0];
                return (
                  <article className="submission-card" key={submission.id}>
                    <label className="submission-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(submission.id)}
                        disabled={!deletableStatuses.has(submission.submission_status) || bulkDeleting}
                        onChange={() => toggleSelected(submission.id)}
                        aria-label={`${text('selectSubmission')}: ${submission.title}`}
                        title={!deletableStatuses.has(submission.submission_status)
                          ? text('submissionNotDeletable')
                          : undefined}
                      />
                      <span className="visually-hidden">{text('selectSubmission')}: {submission.title}</span>
                    </label>
                    <div className="submission-card-media">
                      {primaryImage?.url
                        ? <img src={primaryImage.url} alt={primaryImage.caption || text('propertyPhoto')} />
                        : <span aria-hidden="true"><FileText size={23} /></span>}
                    </div>
                    <div className="submission-card-content">
                      <div className="submission-card-heading">
                        <div>
                          <h3>{submission.title}</h3>
                          <p>{formatPropertyLocation(submission, locale)}</p>
                        </div>
                        <span className={`submission-status submission-status-${submission.submission_status}`}>
                          <Clock3 size={14} aria-hidden="true" />{text(statusKey)}
                        </span>
                      </div>
                      <p className="submission-card-price">{formatPropertyPrice(
                        submission.price,
                        submission.listing_type,
                        submission.rental_frequency,
                        locale,
                        text,
                      )}</p>
                      {submission.review_feedback && (
                        <p className="submission-feedback"><strong>{text('submissionReviewFeedback')}:</strong> {submission.review_feedback}</p>
                      )}
                      {submission.submission_status === 'corrections_requested' && (
                        <Link className="button button-outline button-small" to={`/submissions/${submission.id}/edit`}>
                          {text('editRequestedCorrections')}<ArrowUpRight size={14} aria-hidden="true" />
                        </Link>
                      )}
                      <details className="submission-history">
                        <summary>{text('submissionHistory')}</summary>
                        <ol>
                          {submission.submission_events.map((event, index) => (
                            <li key={`${event.created_at}-${index}`}>
                              <span>{text(statusMessages[event.to_status as OwnerSubmissionStatus] ?? 'submissionPending')}</span>
                              <time dateTime={event.created_at}>{new Intl.DateTimeFormat(
                                locale === 'am' ? 'am-ET' : 'en-ET',
                                { dateStyle: 'medium', timeStyle: 'short' },
                              ).format(new Date(event.created_at))}</time>
                              {typeof event.details.feedback === 'string' && <p>{event.details.feedback}</p>}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
            {hasNext && (
              <div className="show-more-listings">
                <button className="button button-outline" type="button" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? text('loadingSubmission') : text('loadMoreSubmissions')}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
