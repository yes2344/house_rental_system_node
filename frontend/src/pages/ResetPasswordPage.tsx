import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { getApiFieldErrors, getErrorMessage } from '../api/client';
import { confirmPasswordReset } from '../api/accounts';
import type { MessageKey } from '../i18n';

interface ResetPasswordPageProps {
  text: (key: MessageKey) => string;
}

export function ResetPasswordPage({ text }: ResetPasswordPageProps) {
  const [searchParams] = useSearchParams();
  const uid = searchParams.get('uid') ?? '';
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    if (!uid || !token) {
      setError(text('invalidResetLink'));
      return;
    }
    if (password !== confirmation) {
      setFieldErrors({ password_confirmation: text('passwordMismatch') });
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset({
        uid,
        token,
        password,
        password_confirmation: confirmation,
      });
      setComplete(true);
    } catch (requestError: unknown) {
      const apiErrors = getApiFieldErrors(requestError);
      setFieldErrors(apiErrors);
      if (apiErrors.non_field_errors) setError(apiErrors.non_field_errors);
      else if (!Object.keys(apiErrors).length) setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <span className="auth-icon"><KeyRound size={22} aria-hidden="true" /></span>
        <p className="eyebrow eyebrow-muted">{text('accountEyebrow')}</p>
        <h1>{text(complete ? 'passwordResetCompleteTitle' : 'resetPasswordTitle')}</h1>
        <p className="auth-intro">{text(complete ? 'passwordResetCompleteIntro' : 'resetPasswordIntro')}</p>
        {complete ? (
          <Link className="button button-primary" to="/login">
            {text('continueToSignIn')}<ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <>
            {error && <p className="auth-form-error" role="alert">{error}</p>}
            <form className="auth-form" onSubmit={submit}>
              <label htmlFor="new-password">{text('newPassword')}
                <input
                  id="new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'new-password-error' : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {fieldErrors.password && <small id="new-password-error" className="auth-field-error">{fieldErrors.password}</small>}
              </label>
              <label htmlFor="confirm-new-password">{text('confirmPassword')}
                <input
                  id="confirm-new-password"
                  name="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  aria-invalid={Boolean(fieldErrors.password_confirmation)}
                  aria-describedby={fieldErrors.password_confirmation ? 'confirm-new-password-error' : undefined}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                {fieldErrors.password_confirmation && (
                  <small id="confirm-new-password-error" className="auth-field-error">
                    {fieldErrors.password_confirmation}
                  </small>
                )}
              </label>
              <button className="button button-primary" type="submit" disabled={submitting}>
                {text(submitting ? 'savingNewPassword' : 'saveNewPassword')}<ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          </>
        )}
        <p className="auth-switch"><Link to="/login">{text('backToSignIn')}</Link></p>
      </section>
    </main>
  );
}
