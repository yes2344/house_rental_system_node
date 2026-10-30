import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { apiClient, getErrorMessage } from '../api/client';
import type { MessageKey } from '../i18n';

interface InvitationAcceptPageProps {
  text: (key: MessageKey) => string;
}

interface InvitationResponse {
  username: string;
}

export function InvitationAcceptPage({ text }: InvitationAcceptPageProps) {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError(text('passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiClient.post<InvitationResponse>('/auth/invitations/accept/', {
        token: token.trim(),
        password,
      });
      navigate('/login', {
        replace: true,
        state: { invitationAccepted: true, username: response.data.username },
      });
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <span className="auth-icon"><KeyRound size={22} aria-hidden="true" /></span>
        <p className="eyebrow eyebrow-muted">{text('accountEyebrow')}</p>
        <h1>{text('acceptInvitation')}</h1>
        <p className="auth-intro">{text('invitationIntro')}</p>
        {error && <p className="auth-form-error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="invitation-token">{text('invitationToken')}
            <input
              id="invitation-token"
              name="token"
              autoComplete="off"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label htmlFor="invitation-password">{text('password')}
            <input
              id="invitation-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label htmlFor="invitation-confirmation">{text('confirmPassword')}
            <input
              id="invitation-confirmation"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <p className="auth-helper">{text('passwordHint')}</p>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? text('acceptingInvitation') : text('acceptInvitation')}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        <p className="auth-switch"><Link to="/login">{text('signIn')}</Link></p>
      </section>
    </main>
  );
}
