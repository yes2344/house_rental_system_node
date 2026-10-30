import { useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarClock, CheckCircle2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import {
  getViewingRequestStatus,
  respondToViewingProposal,
  type ViewingRequestStatus,
} from '../api/viewings';
import type { MessageKey } from '../i18n';

interface ViewingRequestStatusPageProps {
  text: (key: MessageKey) => string;
}

function initialReceiptToken(state: unknown): string {
  if (!state || typeof state !== 'object' || !('token' in state)) return '';
  return typeof state.token === 'string' ? state.token : '';
}

function statusMessageKey(status: ViewingRequestStatus['status']): MessageKey {
  if (status === 'proposed') return 'viewingProposed';
  if (status === 'confirmed') return 'viewingConfirmed';
  if (status === 'rejected') return 'viewingRejected';
  if (status === 'declined') return 'viewingVisitorDeclined';
  return 'viewingPending';
}

export function ViewingRequestStatusPage({ text }: ViewingRequestStatusPageProps) {
  const location = useLocation();
  const [token, setToken] = useState(() => initialReceiptToken(location.state));
  const [request, setRequest] = useState<ViewingRequestStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const checkStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      setRequest(await getViewingRequestStatus(token.trim()));
    } catch (requestError: unknown) {
      setRequest(null);
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  const respond = async (decision: 'accept' | 'decline') => {
    if (!request || loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      setRequest(await respondToViewingProposal(token.trim(), decision));
      setSuccess(text('viewingResponseSaved'));
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  const appointmentDate = request?.scheduled_date ?? request?.proposed_date;
  const appointmentTime = request?.scheduled_time ?? request?.proposed_time;

  return (
    <main id="main-content" className="viewing-request-page">
      <div className="viewing-request-container">
        <Link className="back-link" to="/">
          <ArrowLeft size={15} aria-hidden="true" />{text('backToProperties')}
        </Link>
        <header className="viewing-request-heading">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('requestReference')}</p>
          <h1>{text('lookupViewingRequest')}</h1>
        </header>

        <section className="viewing-request-card" aria-labelledby="receipt-status-title">
          <form className="viewing-request-form" onSubmit={(event) => void checkStatus(event)}>
            <label className="viewing-form-field" htmlFor="viewing-receipt-token">
              <span>{text('receiptToken')}</span>
              <input
                id="viewing-receipt-token"
                autoComplete="off"
                required
                maxLength={200}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            {error && <p className="viewing-submit-error" role="alert">{text('statusLookupError')} {error}</p>}
            <button className="button button-primary" type="submit" disabled={loading}>
              {loading ? text('checkingRequestStatus') : text('checkRequestStatus')}
            </button>
          </form>

          {request && (
            <section className="viewing-status-result" aria-labelledby="receipt-status-title" aria-live="polite">
              <div className="viewing-success">
                <CheckCircle2 size={28} aria-hidden="true" />
                <div>
                  <h2 id="receipt-status-title">{request.property_title}</h2>
                  <p>{text('requestReference')}: #{request.id}</p>
                  <p>{text(statusMessageKey(request.status))}</p>
                </div>
              </div>
              {appointmentDate && (
                <p className="viewing-receipt">
                  <CalendarClock size={16} aria-hidden="true" />
                  {text(request.status === 'confirmed' ? 'scheduledDate' : 'appointmentProposal')}: {appointmentDate}
                  {appointmentTime ? ` · ${appointmentTime.slice(0, 5)}` : ''}
                </p>
              )}
              {(request.proposed_date || request.scheduled_date) && (
                <p>{text('appointmentTimezone').replace('{timezone}', request.appointment_timezone)}</p>
              )}
              {success && <p role="status">{success}</p>}
              {request.status === 'proposed' && (
                <div className="viewing-form-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={loading}
                    onClick={() => void respond('accept')}
                  >
                    {text('acceptProposal')}
                  </button>
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={loading}
                    onClick={() => void respond('decline')}
                  >
                    {text('declineProposal')}
                  </button>
                </div>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
