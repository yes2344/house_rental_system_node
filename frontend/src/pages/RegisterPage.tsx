import { useState, type FormEvent } from 'react';
import { ArrowRight, UserRoundPlus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { getApiFieldErrors, getErrorMessage } from '../api/client';
import { registerAccount } from '../api/accounts';
import type { MessageKey } from '../i18n';

interface RegisterPageProps {
  text: (key: MessageKey) => string;
}

interface RegistrationValues {
  username: string;
  email: string;
  phone: string;
  password: string;
  password_confirmation: string;
}

interface RegistrationLocationState {
  from?: string | { pathname?: string; search?: string; hash?: string };
}

function getSafeRedirectTarget(from: unknown): string {
  if (typeof from === 'string') {
    return from.startsWith('/')
      && !from.startsWith('//')
      && !from.includes('\\')
      && !/[\u0000-\u001f]/.test(from)
      ? from
      : '/';
  }
  if (from && typeof from === 'object') {
    const candidate = from as { pathname?: string; search?: string; hash?: string };
    if (
      candidate.pathname?.startsWith('/')
      && !candidate.pathname.startsWith('//')
      && !candidate.pathname.includes('\\')
      && !/[\u0000-\u001f]/.test(candidate.pathname)
    ) {
      return getSafeRedirectTarget(
        `${candidate.pathname}${candidate.search ?? ''}${candidate.hash ?? ''}`,
      );
    }
  }
  return '/';
}

export function RegisterPage({ text }: RegisterPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as RegistrationLocationState | null;
  const [values, setValues] = useState<RegistrationValues>({
    username: '',
    email: '',
    phone: '',
    password: '',
    password_confirmation: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field: keyof RegistrationValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setFieldErrors((previous) => ({ ...previous, [field]: '' }));
    setError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (values.password !== values.password_confirmation) {
      setFieldErrors((previous) => ({ ...previous, password_confirmation: text('passwordMismatch') }));
      return;
    }

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      await registerAccount({
        username: values.username.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        password: values.password,
      });
      navigate('/login', {
        replace: true,
        state: {
          registered: true,
          from: getSafeRedirectTarget(state?.from),
        },
      });
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
        <span className="auth-icon"><UserRoundPlus size={22} aria-hidden="true" /></span>
        <p className="eyebrow eyebrow-muted">{text('accountEyebrow')}</p>
        <h1>{text('createAccount')}</h1>
        <p className="auth-intro">{text('registrationIntro')}</p>
        {error && <p className="auth-form-error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="register-username">{text('username')} *
            <input
              id="register-username"
              name="username"
              autoComplete="username"
              maxLength={150}
              required
              value={values.username}
              aria-invalid={Boolean(fieldErrors.username)}
              aria-describedby={fieldErrors.username ? 'register-username-error' : undefined}
              onChange={(event) => updateField('username', event.target.value)}
            />
            {fieldErrors.username && <small id="register-username-error" className="auth-field-error">{fieldErrors.username}</small>}
          </label>
          <label htmlFor="register-email">{text('emailAddress')} *
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={values.email}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
              onChange={(event) => updateField('email', event.target.value)}
            />
            {fieldErrors.email && <small id="register-email-error" className="auth-field-error">{fieldErrors.email}</small>}
          </label>
          <label htmlFor="register-phone">{text('phoneNumber')} <span>{text('optionalField')}</span>
            <input
              id="register-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={50}
              value={values.phone}
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? 'register-phone-error' : undefined}
              onChange={(event) => updateField('phone', event.target.value)}
            />
            {fieldErrors.phone && <small id="register-phone-error" className="auth-field-error">{fieldErrors.phone}</small>}
          </label>
          <label htmlFor="register-password">{text('password')} *
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={values.password}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'register-password-error' : 'register-password-hint'}
              onChange={(event) => updateField('password', event.target.value)}
            />
            {fieldErrors.password
              ? <small id="register-password-error" className="auth-field-error">{fieldErrors.password}</small>
              : <small id="register-password-hint" className="auth-field-hint">{text('passwordHint')}</small>}
          </label>
          <label htmlFor="register-password-confirmation">{text('confirmPassword')} *
            <input
              id="register-password-confirmation"
              name="password_confirmation"
              type="password"
              autoComplete="new-password"
              required
              value={values.password_confirmation}
              aria-invalid={Boolean(fieldErrors.password_confirmation)}
              aria-describedby={fieldErrors.password_confirmation ? 'register-password-confirmation-error' : undefined}
              onChange={(event) => updateField('password_confirmation', event.target.value)}
            />
            {fieldErrors.password_confirmation && <small id="register-password-confirmation-error" className="auth-field-error">{fieldErrors.password_confirmation}</small>}
          </label>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? text('creatingAccount') : text('createAccount')}<ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        <p className="auth-switch">
          {text('alreadyHaveAccount')} <Link to="/login" state={{ from: state?.from }}>{text('signIn')}</Link>
        </p>
      </section>
    </main>
  );
}
