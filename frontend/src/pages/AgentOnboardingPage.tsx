import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { Navigate } from 'react-router-dom';

import { getApiFieldErrors, getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface AgentOnboardingPageProps {
  text: (key: MessageKey) => string;
}

export function AgentOnboardingPage({ text }: AgentOnboardingPageProps) {
  const { account, changeAgentInitialPassword, completeAgentInitialProfile } = useAuth();
  const [step, setStep] = useState<'password' | 'profile'>(
    account?.agent_password_changed ? 'profile' : 'password',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [firstName, setFirstName] = useState(account?.first_name ?? '');
  const [lastName, setLastName] = useState(account?.last_name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!account) return <Navigate to="/login" replace />;
  if (account.role !== 'agent' || !account.agent_onboarding_required) {
    return <Navigate to={account.role === 'agent' || account.role === 'administrator' ? '/dashboard' : '/'} replace />;
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    if (password !== confirmation) {
      setError(text('passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await changeAgentInitialPassword({
        ...(username.trim() ? { username: username.trim() } : {}),
        new_password: password,
      });
      setPassword('');
      setConfirmation('');
      setStep('profile');
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
      setFieldErrors(getApiFieldErrors(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const completeProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    setSubmitting(true);
    try {
      await completeAgentInitialProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
      setFieldErrors(getApiFieldErrors(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <span className="auth-icon"><KeyRound size={22} aria-hidden="true" /></span>
        <p className="eyebrow eyebrow-muted">{text('accountEyebrow')}</p>
        <h1>{text('agentFirstLoginTitle')}</h1>
        {step === 'password' ? (
          <>
            <h2>{text('agentPasswordStepTitle')}</h2>
            <p className="auth-intro">{text('agentPasswordStepIntro')}</p>
            {error && <p className="auth-form-error" role="alert">{error}</p>}
            <form className="auth-form" onSubmit={(event) => void changePassword(event)}>
              <label htmlFor="agent-new-username">{text('optionalAgentUsername')}
                <input
                  id="agent-new-username"
                  autoComplete="username"
                  maxLength={150}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                {fieldErrors.username && <small role="alert">{fieldErrors.username}</small>}
              </label>
              <label htmlFor="agent-new-password">{text('newPassword')}
                <input
                  id="agent-new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {fieldErrors.new_password && <small role="alert">{fieldErrors.new_password}</small>}
              </label>
              <label htmlFor="agent-password-confirmation">{text('confirmPassword')}
                <input
                  id="agent-password-confirmation"
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
                {submitting ? text('agentSetupSaving') : text('continueToAgentProfile')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          </>
        ) : (
          <>
            <h2>{text('agentProfileStepTitle')}</h2>
            <p className="auth-intro">{text('agentProfileStepIntro')}</p>
            {error && <p className="auth-form-error" role="alert">{error}</p>}
            <form className="auth-form" onSubmit={(event) => void completeProfile(event)}>
              <label htmlFor="agent-first-name">{text('agentFirstName')}
                <input
                  id="agent-first-name"
                  autoComplete="given-name"
                  maxLength={150}
                  required
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                />
                {fieldErrors.first_name && <small role="alert">{fieldErrors.first_name}</small>}
              </label>
              <label htmlFor="agent-last-name">{text('agentLastName')}
                <input
                  id="agent-last-name"
                  autoComplete="family-name"
                  maxLength={150}
                  required
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
                {fieldErrors.last_name && <small role="alert">{fieldErrors.last_name}</small>}
              </label>
              <label htmlFor="agent-email">{text('agentEmail')}
                <input
                  id="agent-email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {fieldErrors.email && <small role="alert">{fieldErrors.email}</small>}
              </label>
              <label htmlFor="agent-phone">{text('agentPhone')}
                <input
                  id="agent-phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={50}
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
                {fieldErrors.phone && <small role="alert">{fieldErrors.phone}</small>}
              </label>
              <button className="button button-primary" type="submit" disabled={submitting}>
                {submitting ? text('agentSetupSaving') : text('completeAgentSetup')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
