import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, ImagePlus, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import { getApiFieldErrors, getErrorMessage } from '../api/client';
import {
  getAmenities,
  type AmenityOption,
  type ManagedAreaUnit,
  type ManagedListingType,
  type ManagedPropertyType,
  type ManagedRentalFrequency,
} from '../api/management';
import {
  createOwnerSubmission,
  getMySubmission,
  updateOwnerSubmission,
  uploadOwnerSubmissionImage,
  type OwnerSubmission,
  type OwnerSubmissionPayload,
} from '../api/ownerSubmissions';
import { LocationCascade } from '../components/LocationCascade';
import type { Locale, MessageKey } from '../i18n';

interface PropertySubmissionPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

interface SubmissionValues {
  title: string;
  location: string;
  administrative_location: string;
  category: ManagedPropertyType;
  listing_type: ManagedListingType;
  price: string;
  bedrooms: string;
  bathrooms: string;
  area_value: string;
  area_unit: ManagedAreaUnit;
  rental_frequency: ManagedRentalFrequency;
  description: string;
  features: string;
  amenities: number[];
  owner_contact_name: string;
  owner_contact_phone: string;
  owner_contact_email: string;
}

const emptyValues: SubmissionValues = {
  title: '',
  location: '',
  administrative_location: '',
  category: 'house',
  listing_type: 'sale',
  price: '',
  bedrooms: '',
  bathrooms: '',
  area_value: '',
  area_unit: '',
  rental_frequency: '',
  description: '',
  features: '',
  amenities: [],
  owner_contact_name: '',
  owner_contact_phone: '',
  owner_contact_email: '',
};

function valuesFromSubmission(submission: OwnerSubmission): SubmissionValues {
  return {
    title: submission.title,
    location: submission.location,
    administrative_location: submission.administrative_location === null
      ? ''
      : String(submission.administrative_location),
    category: submission.category,
    listing_type: submission.listing_type,
    price: submission.price,
    bedrooms: String(submission.bedrooms),
    bathrooms: String(submission.bathrooms),
    area_value: submission.area_value ?? '',
    area_unit: submission.area_unit,
    rental_frequency: submission.rental_frequency,
    description: submission.description,
    features: submission.features,
    amenities: submission.amenities,
    owner_contact_name: submission.owner_contact_name,
    owner_contact_phone: submission.owner_contact_phone,
    owner_contact_email: submission.owner_contact_email,
  };
}

export function PropertySubmissionPage({ locale, text }: PropertySubmissionPageProps) {
  const { id: idParam } = useParams();
  const submissionId = idParam ? Number(idParam) : null;
  const editing = Number.isInteger(submissionId) && (submissionId ?? 0) > 0;
  const navigate = useNavigate();
  const { account } = useAuth();
  const [values, setValues] = useState<SubmissionValues>(() => ({
    ...emptyValues,
    owner_contact_name: [account?.first_name, account?.last_name].filter(Boolean).join(' ') || account?.username || '',
    owner_contact_phone: account?.phone ?? '',
    owner_contact_email: account?.email ?? '',
  }));
  const [submission, setSubmission] = useState<OwnerSubmission | null>(null);
  const [amenities, setAmenities] = useState<AmenityOption[]>([]);
  const [stagedImages, setStagedImages] = useState<File[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState('');
  const [amenityError, setAmenityError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [imageError, setImageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  useEffect(() => {
    const controller = new AbortController();
    void getAmenities(controller.signal)
      .then(setAmenities)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setAmenityError(getErrorMessage(error));
      });
    if (editing && submissionId) {
      setLoading(true);
      void getMySubmission(submissionId, controller.signal)
        .then((current) => {
          setSubmission(current);
          setValues(valuesFromSubmission(current));
          if (current.submission_status !== 'corrections_requested') {
            setPageError(text('submissionEditOnlyWhenCorrections'));
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setPageError(getErrorMessage(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => controller.abort();
  }, [editing, submissionId]);

  useEffect(() => {
    if (editing || !account) return;
    setValues((previous) => ({
      ...previous,
      owner_contact_name: previous.owner_contact_name
        || [account.first_name, account.last_name].filter(Boolean).join(' ')
        || account.username,
      owner_contact_phone: previous.owner_contact_phone || account.phone,
      owner_contact_email: previous.owner_contact_email || account.email,
    }));
  }, [account, editing]);

  const updateValue = <K extends keyof SubmissionValues>(key: K, value: SubmissionValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
    setSaveError('');
  };

  const chooseImages = (event: ChangeEvent<HTMLInputElement>) => {
    const accepted = ['jpg', 'jpeg', 'png', 'webp'];
    const existingImageCount = submission?.images.length ?? 0;
    const maximumStagedImages = Math.max(0, 10 - existingImageCount);
    const files = Array.from(event.target.files ?? []);
    const nextImages = [...stagedImages];
    let issue = '';
    for (const file of files) {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!accepted.includes(extension ?? '')) {
        issue = text('imageTypeError');
      } else if (file.size > 10 * 1024 * 1024) {
        issue = text('imageSizeError');
      } else if (nextImages.length >= maximumStagedImages) {
        issue = text('imageLimitError');
      } else {
        nextImages.push(file);
      }
    }
    setStagedImages(nextImages);
    setImageError(issue);
    event.target.value = '';
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaveError('');
    setImageError('');
    setFieldErrors({});
    const payload: OwnerSubmissionPayload = {
      title: values.title.trim(),
      location: values.location.trim(),
      administrative_location: values.administrative_location
        ? Number(values.administrative_location)
        : null,
      category: values.category,
      listing_type: values.listing_type,
      price: values.price.trim(),
      bedrooms: Number(values.bedrooms || 0),
      bathrooms: Number(values.bathrooms || 0),
      area_sqft: values.area_unit === 'sqft' && values.area_value
        ? Math.round(Number(values.area_value))
        : 0,
      area_value: values.area_value || null,
      area_unit: values.area_value ? values.area_unit : '',
      rental_frequency: values.listing_type === 'rent' ? values.rental_frequency : '',
      description: values.description.trim(),
      features: values.features.trim(),
      amenities: values.amenities,
      owner_contact_name: values.owner_contact_name.trim(),
      owner_contact_phone: values.owner_contact_phone.trim(),
      owner_contact_email: values.owner_contact_email.trim(),
      ...(editing ? {} : { authorization_confirmed: true, terms_accepted: true }),
    };
    try {
      const saved = editing && submissionId
        ? await updateOwnerSubmission(submissionId, payload)
        : await createOwnerSubmission({
          ...payload,
          authorization_confirmed: authorizationConfirmed,
          terms_accepted: termsAccepted,
        });
      const failures: string[] = [];
      for (const image of stagedImages) {
        try {
          await uploadOwnerSubmissionImage(saved.id, image);
        } catch (error: unknown) {
          failures.push(`${image.name}: ${getErrorMessage(error)}`);
        }
      }
      navigate('/my-submissions', {
        replace: true,
        state: {
          submitted: true,
          ...(failures.length ? { imageUploadFailures: failures } : {}),
        },
      });
    } catch (error: unknown) {
      setFieldErrors(getApiFieldErrors(error));
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  if (loading) {
    return <main className="manager-page" id="main-content"><div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingSubmission')}</div></main>;
  }

  if (pageError || (editing && !submission)) {
    return (
      <main className="manager-page" id="main-content">
        <div className="listing-state listing-error" role="alert">
          {pageError || text('submissionNotFound')}
          <Link className="button button-outline" to="/my-submissions">{text('mySubmissions')}</Link>
        </div>
      </main>
    );
  }

  const propertyTypes: ManagedPropertyType[] = [
    'house', 'villa', 'apartment', 'condominium', 'land',
    'office', 'shop', 'warehouse', 'commercial', 'other',
  ];

  return (
    <main className="manager-page" id="main-content">
      <section className="manager-heading">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerEyebrow')}</p>
          <h1>{text(editing ? 'editPropertySubmission' : 'addYourProperty')}</h1>
          <p>{text(editing ? 'submissionCorrectionsIntro' : 'propertySubmissionIntro')}</p>
        </div>
        <Link className="button button-outline" to="/my-submissions">{text('mySubmissions')}</Link>
      </section>
      {submission?.review_feedback && (
        <p className="manager-inline-error" role="status">
          <strong>{text('submissionReviewFeedback')}</strong> {submission.review_feedback}
        </p>
      )}
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <section className="manager-form-section">
          <h2>{text('propertyDetails')}</h2>
          <div className="manager-form-grid">
            <label className="manager-field">
              <span>{text('propertyTitle')} *</span>
              <input required maxLength={200} value={values.title} onChange={(event) => updateValue('title', event.target.value)} />
              {fieldErrors.title && <small className="auth-field-error">{fieldErrors.title}</small>}
            </label>
            <label className="manager-field">
              <span>{text('location')} *</span>
              <input required maxLength={200} value={values.location} onChange={(event) => updateValue('location', event.target.value)} />
              {fieldErrors.location && <small className="auth-field-error">{fieldErrors.location}</small>}
            </label>
            <div className="manager-field">
              <LocationCascade
                value={values.administrative_location}
                locale={locale}
                onChange={(value) => updateValue('administrative_location', value)}
                text={text}
                required
              />
              {fieldErrors.administrative_location && <small className="auth-field-error">{fieldErrors.administrative_location}</small>}
            </div>
            <label className="manager-field">
              <span>{text('propertyType')} *</span>
              <select value={values.category} onChange={(event) => updateValue('category', event.target.value as ManagedPropertyType)}>
                {propertyTypes.map((type) => (
                  <option key={type} value={type}>
                    {type === 'house' || type === 'villa'
                      ? text('house')
                      : type === 'apartment'
                        ? text('apartment')
                        : type === 'land'
                          ? text('land')
                          : type === 'commercial'
                            ? text('commercial')
                            : `${type[0].toUpperCase()}${type.slice(1)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="manager-field">
              <span>{text('listingType')} *</span>
              <select
                value={values.listing_type}
                onChange={(event) => {
                  const nextType = event.target.value as ManagedListingType;
                  updateValue('listing_type', nextType);
                  if (nextType === 'sale') updateValue('rental_frequency', '');
                }}
              >
                <option value="sale">{text('searchBuy')}</option>
                <option value="rent">{text('searchRent')}</option>
              </select>
            </label>
            <label className="manager-field">
              <span>{text('price')} (ETB) *</span>
              <input type="number" min="0.01" step="0.01" required value={values.price} onChange={(event) => updateValue('price', event.target.value)} />
              {fieldErrors.price && <small className="auth-field-error">{fieldErrors.price}</small>}
            </label>
            {values.listing_type === 'rent' && (
              <label className="manager-field">
                <span>{text('rentalFrequency')} *</span>
                <select required value={values.rental_frequency} onChange={(event) => updateValue('rental_frequency', event.target.value as ManagedRentalFrequency)}>
                  <option value="">{text('selectOption')}</option>
                  <option value="daily">{text('daily')}</option>
                  <option value="monthly">{text('monthly')}</option>
                  <option value="yearly">{text('yearly')}</option>
                </select>
                {fieldErrors.rental_frequency && <small className="auth-field-error">{fieldErrors.rental_frequency}</small>}
              </label>
            )}
            <label className="manager-field">
              <span>{text('bedrooms')}</span>
              <input type="number" min="0" step="1" value={values.bedrooms} onChange={(event) => updateValue('bedrooms', event.target.value)} />
            </label>
            <label className="manager-field">
              <span>{text('bathrooms')}</span>
              <input type="number" min="0" step="1" value={values.bathrooms} onChange={(event) => updateValue('bathrooms', event.target.value)} />
            </label>
            <label className="manager-field">
              <span>{text('sizeLabel')}</span>
              <div className="filter-two-columns">
                <input type="number" min="0.01" step="0.01" value={values.area_value} onChange={(event) => updateValue('area_value', event.target.value)} />
                <select required={Boolean(values.area_value)} value={values.area_unit} onChange={(event) => updateValue('area_unit', event.target.value as ManagedAreaUnit)}>
                  <option value="">{text('selectOption')}</option>
                  <option value="sqm">m²</option>
                  <option value="sqft">sq ft</option>
                </select>
              </div>
              {fieldErrors.area_unit && <small className="auth-field-error">{fieldErrors.area_unit}</small>}
            </label>
            <label className="manager-field manager-field-wide">
              <span>{text('detailsHeading')} *</span>
              <textarea required rows={5} value={values.description} onChange={(event) => updateValue('description', event.target.value)} />
              {fieldErrors.description && <small className="auth-field-error">{fieldErrors.description}</small>}
            </label>
            <label className="manager-field manager-field-wide">
              <span>{text('features')}</span>
              <textarea rows={3} value={values.features} onChange={(event) => updateValue('features', event.target.value)} />
            </label>
          </div>
        </section>

        <section className="manager-form-section">
          <h2>{text('amenitiesHeading')}</h2>
          {amenityError && <p className="manager-inline-error" role="alert">{text('amenityLoadError')} {amenityError}</p>}
          <div className="amenity-choice-grid">
            {amenities.map((amenity) => (
              <label className="amenity-choice" key={amenity.id}>
                <input
                  type="checkbox"
                  checked={values.amenities.includes(amenity.id)}
                  onChange={(event) => updateValue(
                    'amenities',
                    event.target.checked
                      ? [...values.amenities, amenity.id]
                      : values.amenities.filter((id) => id !== amenity.id),
                  )}
                />
                <span>{locale === 'am' && amenity.name_am ? amenity.name_am : amenity.name}</span>
              </label>
            ))}
            {!amenities.length && !amenityError && <p>{text('noAmenities')}</p>}
          </div>
        </section>

        <section className="manager-form-section">
          <h2>{text('propertyPhotos')}</h2>
          {submission?.images.length ? (
            <div className="submission-image-grid">
              {submission.images.map((image) => (
                image.url && <img key={image.id} src={image.url} alt={image.caption || text('propertyPhoto')} />
              ))}
            </div>
          ) : null}
          <label className="manager-field">
            <span>{text('uploadPropertyPhotos')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} />
          </label>
          <p className="manager-field-hint">{text('submissionPhotoHelp')}</p>
          {stagedImages.length > 0 && (
            <ul className="submission-staged-images">
              {stagedImages.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}-${index}`}>{file.name}
                  <button className="filter-clear" type="button" onClick={() => setStagedImages((current) => current.filter((item) => item !== file))}>
                    {text('removeSelectedImage')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {imageError && <p className="manager-inline-error" role="alert">{imageError}</p>}
        </section>

        <section className="manager-form-section">
          <h2>{text('ownerContactDetails')}</h2>
          <div className="manager-form-grid">
            <label className="manager-field">
              <span>{text('fullName')} *</span>
              <input required maxLength={200} value={values.owner_contact_name} onChange={(event) => updateValue('owner_contact_name', event.target.value)} />
              {fieldErrors.owner_contact_name && <small className="auth-field-error">{fieldErrors.owner_contact_name}</small>}
            </label>
            <label className="manager-field">
              <span>{text('phoneNumber')} *</span>
              <input type="tel" required maxLength={50} value={values.owner_contact_phone} onChange={(event) => updateValue('owner_contact_phone', event.target.value)} />
              {fieldErrors.owner_contact_phone && <small className="auth-field-error">{fieldErrors.owner_contact_phone}</small>}
            </label>
            <label className="manager-field">
              <span>{text('emailAddress')}</span>
              <input type="email" maxLength={254} value={values.owner_contact_email} onChange={(event) => updateValue('owner_contact_email', event.target.value)} />
              {fieldErrors.owner_contact_email && <small className="auth-field-error">{fieldErrors.owner_contact_email}</small>}
            </label>
          </div>
          {!editing && (
            <div className="submission-consent">
              <label className="amenity-choice">
                <input type="checkbox" required checked={authorizationConfirmed} onChange={(event) => setAuthorizationConfirmed(event.target.checked)} />
                <span>{text('submissionAuthorization')}</span>
              </label>
              {fieldErrors.authorization_confirmed && <small className="auth-field-error">{fieldErrors.authorization_confirmed}</small>}
              <label className="amenity-choice">
                <input type="checkbox" required checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                <span>{text('submissionTerms')}</span>
              </label>
              {fieldErrors.terms_accepted && <small className="auth-field-error">{fieldErrors.terms_accepted}</small>}
            </div>
          )}
          <p className="manager-field-hint">{text('submissionContactPrivacy')}</p>
        </section>
        {saveError && <p className="manager-inline-error" role="alert">{text('submissionSaveError')} {saveError}</p>}
        <div className="manager-form-actions">
          <Link className="button button-outline" to="/my-submissions"><ArrowLeft size={16} aria-hidden="true" />{text('cancel')}</Link>
          <button className="button button-primary" type="submit" disabled={saving || Boolean(pageError)}>
            {saving ? <><span className="loading-spinner" />{text('savingSubmission')}</> : <><Upload size={16} aria-hidden="true" />{text(editing ? 'resubmitProperty' : 'submitProperty')}</>}
          </button>
        </div>
      </form>
      <p className="submission-image-icon" aria-hidden="true"><ImagePlus size={16} /></p>
    </main>
  );
}
