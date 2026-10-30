import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Heart, RotateCw, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getAccountActivity, type AccountActivity } from '../api/accounts';
import { getApiFieldErrors, getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import type { Locale, MessageKey } from '../i18n';

interface AccountPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

interface ProfileValues {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

const statusMessage: Record<string, MessageKey> = {
  pending: 'viewingPending',
  proposed: 'viewingProposed',
  confirmed: 'viewingConfirmed',
  rejected: 'viewingRejected',
  declined: 'viewingVisitorDeclined',
  cancelled: 'viewingCancelled',
  completed: 'viewingCompleted',
};

const roleMessage: Record<string, MessageKey> = {
  customer: 'roleCustomer',
  owner: 'roleOwner',
  agent: 'roleAgent',
  administrator: 'roleAdministrator',
};

export function AccountPage({ locale, text }: AccountPageProps) {
  const { account, favorites, favoritesLoading, updateProfile } = useAuth();
  const [values, setValues] = useState<ProfileValues>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [activityReload, setActivityReload] = useState(0);

  useEffect(() => {
    if (!account) return;
    setValues({
      first_name: account.first_name,
      last_name: account.last_name,
      email: account.email,
      phone: account.phone,
    });
  }, [account]);

  useEffect(() => {
    if (!account || account.role === 'agent') {
      setActivity(null);
      setActivityLoading(false);
      setActivityError('');
      return;
    }
    const controller = new AbortController();
    setActivityLoading(true);
    setActivityError('');
    getAccountActivity(controller.signal)
      .then(setActivity)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setActivityError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setActivityLoading(false);
      });
    return () => controller.abort();
  }, [account?.id, account?.role, activityReload]);

  if (!account) return null;

  const updateValue = (field: keyof ProfileValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setFieldErrors((previous) => ({ ...previous, [field]: '' }));
    setProfileError('');
    setProfileSaved(false);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError('');
    setFieldErrors({});
    setProfileSaved(false);
    try {
      await updateProfile({
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
      });
      setProfileSaved(true);
    } catch (error: unknown) {
      const errors = getApiFieldErrors(error);
      setFieldErrors(errors);
      if (!Object.keys(errors).length) setProfileError(getErrorMessage(error));
    } finally {
      setSavingProfile(false);
    }
  };

  const formatDate = (date: string) => new Intl.DateTimeFormat(
    locale === 'am' ? 'am-ET' : 'en-ET',
    { dateStyle: 'medium' },
  ).format(new Date(`${date}T00:00:00`));

  const roleKey = roleMessage[account.role ?? 'customer'] ?? 'roleCustomer';

  return (
    <main id="main-content" className="customer-page">
      <section className="customer-heading">
        <div className="container">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('accountEyebrow')}</p>
          <h1>{text('accountTitle')}</h1>
          <p>{text('accountWelcome')} <strong>{account.username}</strong></p>
        </div>
      </section>
      <section className="container customer-content">
        <div className="customer-overview">
          <article className="customer-summary-card">
            <span className="customer-summary-icon"><UserRound size={20} aria-hidden="true" /></span>
            <div><small>{text('accountRole')}</small><strong>{text(roleKey)}</strong></div>
          </article>
          <Link className="customer-summary-card customer-summary-link" to="/favorites">
            <span className="customer-summary-icon"><Heart size={20} aria-hidden="true" /></span>
            <div>
              <small>{text('savedHomesTitle')}</small>
              <strong>{favoritesLoading ? text('loadingFavorites') : `${favorites.length} ${text('savedHomesCount')}`}</strong>
            </div>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <section className="customer-panel">
          <h2>{text('profileDetails')}</h2>
          <p className="customer-username">{text('username')}: <strong>{account.username}</strong></p>
          {profileError && <p className="auth-form-error" role="alert">{profileError}</p>}
          {profileSaved && <p className="auth-success" role="status">{text('profileSaved')}</p>}
          <form className="profile-form" onSubmit={saveProfile}>
            <label htmlFor="profile-first-name">{text('firstName')}
              <input
                id="profile-first-name"
                autoComplete="given-name"
                maxLength={150}
                value={values.first_name}
                aria-invalid={Boolean(fieldErrors.first_name)}
                aria-describedby={fieldErrors.first_name ? 'profile-first-name-error' : undefined}
                onChange={(event) => updateValue('first_name', event.target.value)}
              />
              {fieldErrors.first_name && <small id="profile-first-name-error" className="auth-field-error">{fieldErrors.first_name}</small>}
            </label>
            <label htmlFor="profile-last-name">{text('lastName')}
              <input
                id="profile-last-name"
                autoComplete="family-name"
                maxLength={150}
                value={values.last_name}
                aria-invalid={Boolean(fieldErrors.last_name)}
                aria-describedby={fieldErrors.last_name ? 'profile-last-name-error' : undefined}
                onChange={(event) => updateValue('last_name', event.target.value)}
              />
              {fieldErrors.last_name && <small id="profile-last-name-error" className="auth-field-error">{fieldErrors.last_name}</small>}
            </label>
            <label htmlFor="profile-email">{text('emailAddress')}
              <input
                id="profile-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={values.email}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'profile-email-error' : undefined}
                onChange={(event) => updateValue('email', event.target.value)}
              />
              {fieldErrors.email && <small id="profile-email-error" className="auth-field-error">{fieldErrors.email}</small>}
            </label>
            <label htmlFor="profile-phone">{text('phoneNumber')}
              <input
                id="profile-phone"
                type="tel"
                autoComplete="tel"
                maxLength={50}
                value={values.phone}
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={fieldErrors.phone ? 'profile-phone-error' : undefined}
                onChange={(event) => updateValue('phone', event.target.value)}
              />
              {fieldErrors.phone && <small id="profile-phone-error" className="auth-field-error">{fieldErrors.phone}</small>}
            </label>
            <button className="button button-primary" type="submit" disabled={savingProfile}>
              {savingProfile ? text('savingProfile') : text('saveProfile')}<ArrowRight size={15} aria-hidden="true" />
            </button>
          </form>
        </section>

        {account.role !== 'agent' && <section className="customer-panel">
          <div className="customer-panel-heading">
            <div><h2>{text('viewingActivity')}</h2><p>{text('viewingActivityIntro')}</p></div>
            <div className="customer-panel-links">
              <Link to="/viewing-requests" className="customer-inline-link">{text('yourViewingRequests')}<ArrowRight size={14} aria-hidden="true" /></Link>
              <Link to="/favorites" className="customer-inline-link">{text('savedHomesTitle')}<ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </div>
          {activityLoading ? (
            <div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingActivity')}</div>
          ) : activityError ? (
            <div className="customer-error" role="alert">
              <p>{text('activityLoadError')} {activityError}</p>
              <button className="button button-outline" type="button" onClick={() => setActivityReload((count) => count + 1)}>
                <RotateCw size={15} aria-hidden="true" />{text('retry')}
              </button>
            </div>
          ) : activity?.viewing_requests.length ? (
            <div className="activity-list">
              {activity.viewing_requests.map((request) => (
                <article className="activity-row" key={request.id}>
                  <div>
                    <Link to={`/properties/${encodeURIComponent(request.property.slug)}`}>{request.property.title}</Link>
                    <small>{text('preferredDate')}: {formatDate(request.preferred_date)}</small>
                  </div>
                  <span className={`activity-status is-${request.status}`}>
                    {text(statusMessage[request.status] ?? 'viewingPending')}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="activity-empty">
              <p>{text('noViewingActivity')}</p>
              <Link to="/">{text('browseAll')}</Link>
            </div>
          )}
        </section>}
      </section>
    </main>
  );
}
