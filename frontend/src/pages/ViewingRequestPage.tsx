import { useEffect, useMemo, useState, type FormEvent } from 'react';
import axios from 'axios';
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import { getApiFieldErrors, getErrorMessage } from '../api/client';
import { getProperty, type PropertyDetail } from '../api/properties';
import { createViewingRequest, type ViewingRequestReceipt } from '../api/viewings';
import type { Locale, MessageKey } from '../i18n';

type ViewingRequestField = 'full_name' | 'email' | 'phone' | 'preferred_date' | 'preferred_time' | 'message';
type FieldErrors = Partial<Record<ViewingRequestField, string>>;

interface ViewingRequestPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

interface FormValues {
  full_name: string;
  email: string;
  phone: string;
  preferred_date: string;
  preferred_time: string;
  message: string;
}

const emptyForm: FormValues = {
  full_name: '',
  email: '',
  phone: '',
  preferred_date: '',
  preferred_time: '',
  message: '',
};

function localDateString(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

export function ViewingRequestPage({ locale, text }: ViewingRequestPageProps) {
  const { account } = useAuth();
  const [searchParams] = useSearchParams();
  const propertyIdParam = searchParams.get('property_id');
  const propertyId = Number(propertyIdParam);
  const propertySlug = searchParams.get('property_slug') ?? '';
  const validPropertySelection = Boolean(
    propertyIdParam && Number.isInteger(propertyId) && propertyId > 0 && propertySlug,
  );
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [loadingProperty, setLoadingProperty] = useState(true);
  const [propertyUnavailable, setPropertyUnavailable] = useState(false);
  const [propertyError, setPropertyError] = useState('');
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ViewingRequestReceipt | null>(null);
  const minimumDate = useMemo(() => localDateString(new Date()), []);

  useEffect(() => {
    if (!account) return;
    setValues((previous) => ({
      ...previous,
      full_name: previous.full_name || [account.first_name, account.last_name].filter(Boolean).join(' ') || account.username,
      email: previous.email || account.email,
      phone: previous.phone || account.phone,
    }));
  }, [account]);

  useEffect(() => {
    const controller = new AbortController();
    setProperty(null);
    setPropertyError('');
    setPropertyUnavailable(!validPropertySelection);
    setLoadingProperty(validPropertySelection);
    if (!validPropertySelection) return () => controller.abort();

    getProperty(propertySlug, controller.signal)
      .then((loadedProperty) => {
        if (loadedProperty.id !== propertyId) {
          setPropertyUnavailable(true);
          return;
        }
        setProperty(loadedProperty);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          setPropertyUnavailable(true);
        } else {
          setPropertyError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProperty(false);
      });

    return () => controller.abort();
  }, [propertyId, propertySlug, validPropertySelection]);

  const updateField = (field: keyof FormValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    setSubmitError('');
  };

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!property || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    setFieldErrors({});

    try {
      const response = await createViewingRequest({
        property_id: property.id,
        full_name: values.full_name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        preferred_date: values.preferred_date,
        ...(values.preferred_time ? { preferred_time: values.preferred_time } : {}),
        message: values.message.trim(),
      });
      setReceipt(response);
    } catch (error: unknown) {
      const apiErrors = getApiFieldErrors(error);
      setFieldErrors({
        full_name: apiErrors.full_name,
        email: apiErrors.email,
        phone: apiErrors.phone,
        preferred_date: apiErrors.preferred_date,
        preferred_time: apiErrors.preferred_time,
        message: apiErrors.message,
      });
      if (apiErrors.property_id) {
        setProperty(null);
        setPropertyUnavailable(true);
      } else if (!Object.keys(apiErrors).length) {
        setSubmitError(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatPrice = (price: string) => new Intl.NumberFormat(
    locale === 'am' ? 'am-ET' : 'en-ET',
    { maximumFractionDigits: 0 },
  ).format(Number(price));

  if (loadingProperty) {
    return (
      <main id="main-content" className="viewing-request-page">
        <div className="viewing-request-state" role="status">
          <span className="loading-spinner" />{text('loadingProperty')}
        </div>
      </main>
    );
  }

  if (!property) {
    return (
      <main id="main-content" className="viewing-request-page">
        <div className="viewing-request-state" role={propertyUnavailable ? 'status' : 'alert'}>
          <h1>{propertyUnavailable
            ? validPropertySelection ? text('propertyNotFound') : text('choosePropertyFirst')
            : text('listingsError')}</h1>
          <p>{propertyUnavailable
            ? validPropertySelection ? text('propertyUnavailable') : text('choosePropertyBody')
            : propertyError}</p>
          <Link className="button button-primary" to="/">
            <ArrowLeft size={16} aria-hidden="true" />{text('backToProperties')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="viewing-request-page">
      <div className="viewing-request-container">
        {!receipt && (
          <Link className="back-link" to={`/properties/${encodeURIComponent(property.slug)}`}>
            <ArrowLeft size={15} aria-hidden="true" />{text('backToListing')}
          </Link>
        )}
        <header className="viewing-request-heading">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('requestViewing')}</p>
          <h1>{text('viewingRequestTitle')}</h1>
          <p>{text('viewingRequestIntro')}</p>
        </header>

        <section className="viewing-request-card" aria-labelledby="viewing-form-title">
          <div className="viewing-property-summary">
            <div>
              <span>{text('requestingProperty')}</span>
              <h2>{property.title}</h2>
              <p><MapPin size={15} aria-hidden="true" />{property.location}</p>
            </div>
            <strong>{text('ethiopianBirr')} {formatPrice(property.price)}</strong>
          </div>

          {receipt ? (
            <div className="viewing-success" role="status">
              <CheckCircle2 size={30} aria-hidden="true" />
              <div>
                <h2 id="viewing-form-title">{text('requestSuccessTitle')}</h2>
                <p>{text('requestSuccessBody')}</p>
                <p className="viewing-receipt">{text('requestReference')}: #{receipt.id} · {text('requestPending')}</p>
                {values.message.trim() && <p className="viewing-submitted-message"><strong>{text('yourMessage')}:</strong> {values.message.trim()}</p>}
                <p>{text('requestTrackedInAccount')}</p>
              </div>
              <div className="viewing-success-actions">
                <Link className="button button-outline" to="/viewing-requests">
                  {text('yourViewingRequests')}
                </Link>
                <Link className="button button-primary" to={`/properties/${encodeURIComponent(property.slug)}`}>
                  {text('backToListing')}
                </Link>
              </div>
            </div>
          ) : (
            <>
              <h2 className="viewing-form-title" id="viewing-form-title">{text('yourContactDetails')}</h2>
              <form className="viewing-request-form" onSubmit={submitRequest}>
                {submitError && <p className="viewing-submit-error" role="alert">{text('requestSubmitError')} {submitError}</p>}
                <div className="viewing-form-grid">
                  <label className="viewing-form-field" htmlFor="viewing-full-name">
                    <span>{text('fullName')} <b aria-hidden="true">*</b></span>
                    <input
                      id="viewing-full-name"
                      name="full_name"
                      autoComplete="name"
                      maxLength={200}
                      required
                      value={values.full_name}
                      aria-invalid={Boolean(fieldErrors.full_name)}
                      aria-describedby={fieldErrors.full_name ? 'viewing-full-name-error' : undefined}
                      onChange={(event) => updateField('full_name', event.target.value)}
                    />
                    {fieldErrors.full_name && <small id="viewing-full-name-error" className="viewing-field-error">{fieldErrors.full_name}</small>}
                  </label>
                  <label className="viewing-form-field" htmlFor="viewing-email">
                    <span>{text('emailAddress')} <b aria-hidden="true">*</b></span>
                    <input
                      id="viewing-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      required
                      value={values.email}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? 'viewing-email-error' : undefined}
                      onChange={(event) => updateField('email', event.target.value)}
                    />
                    {fieldErrors.email && <small id="viewing-email-error" className="viewing-field-error">{fieldErrors.email}</small>}
                  </label>
                  <label className="viewing-form-field" htmlFor="viewing-phone">
                    <span>{text('phoneNumber')} <b aria-hidden="true">*</b></span>
                    <input
                      id="viewing-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      maxLength={50}
                      required
                      value={values.phone}
                      aria-invalid={Boolean(fieldErrors.phone)}
                      aria-describedby={fieldErrors.phone ? 'viewing-phone-error' : undefined}
                      onChange={(event) => updateField('phone', event.target.value)}
                    />
                    {fieldErrors.phone && <small id="viewing-phone-error" className="viewing-field-error">{fieldErrors.phone}</small>}
                  </label>
                  <label className="viewing-form-field" htmlFor="viewing-preferred-date">
                    <span>{text('preferredDate')} <b aria-hidden="true">*</b></span>
                    <span className="viewing-date-input">
                      <CalendarDays size={16} aria-hidden="true" />
                      <input
                        id="viewing-preferred-date"
                        name="preferred_date"
                        type="date"
                        min={minimumDate}
                        required
                        value={values.preferred_date}
                        aria-invalid={Boolean(fieldErrors.preferred_date)}
                        aria-describedby={fieldErrors.preferred_date ? 'viewing-date-error' : undefined}
                        onChange={(event) => updateField('preferred_date', event.target.value)}
                      />
                    </span>
                    {fieldErrors.preferred_date && <small id="viewing-date-error" className="viewing-field-error">{fieldErrors.preferred_date}</small>}
                  </label>
                  <label className="viewing-form-field" htmlFor="viewing-preferred-time">
                    <span>{text('preferredTime')} <b aria-hidden="true">*</b></span>
                    <input
                      id="viewing-preferred-time"
                      name="preferred_time"
                      type="time"
                      value={values.preferred_time}
                      aria-invalid={Boolean(fieldErrors.preferred_time)}
                      aria-describedby={fieldErrors.preferred_time ? 'viewing-time-error' : undefined}
                      onChange={(event) => updateField('preferred_time', event.target.value)}
                    />
                    {fieldErrors.preferred_time && <small id="viewing-time-error" className="viewing-field-error">{fieldErrors.preferred_time}</small>}
                  </label>
                  <label className="viewing-form-field viewing-message-field" htmlFor="viewing-message">
                    <span>{text('optionalMessage')}</span>
                    <textarea
                      id="viewing-message"
                      name="message"
                      rows={4}
                      value={values.message}
                      aria-invalid={Boolean(fieldErrors.message)}
                      aria-describedby={fieldErrors.message ? 'viewing-message-error' : undefined}
                      onChange={(event) => updateField('message', event.target.value)}
                    />
                    {fieldErrors.message && <small id="viewing-message-error" className="viewing-field-error">{fieldErrors.message}</small>}
                  </label>
                </div>
                <div className="viewing-form-actions">
                  <p>{text('requiredFieldsNote')}</p>
                  <button className="button button-primary" type="submit" disabled={submitting}>
                    {submitting && <span className="loading-spinner" aria-hidden="true" />}
                    {submitting ? text('sendingRequest') : text('sendViewingRequest')}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
