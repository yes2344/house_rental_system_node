import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import { requestPasswordReset } from '../api/accounts';
import type { MessageKey } from '../i18n';

interface ForgotPasswordPageProps {
  text: (key: MessageKey) => string;
}

export function ForgotPasswordPage({ text }: ForgotPasswordPageProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSent(false);
    try {
      await requestPasswordReset({ email: email.trim() });
      setSent(true);
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
        <h1>{text('forgotPasswordTitle')}</h1>
        <p className="auth-intro">{text('forgotPasswordIntro')}</p>
        {sent && <p className="auth-success" role="status">{text('passwordResetRequestGeneric')}</p>}
        {error && <p className="auth-form-error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="recovery-email">{text('emailAddress')}
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {text(submitting ? 'sendingResetInstructions' : 'sendResetInstructions')}<ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        <p className="auth-switch"><Link to="/login">{text('backToSignIn')}</Link></p>
      </section>
    </main>
  );
}
