import { useEffect, useState } from 'react';
import axios from 'axios';
import { ArrowLeft, Bath, BedDouble, CalendarDays, Check, Mail, MapPin, Phone, Ruler, Send, Share2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { getErrorMessage } from '../api/client';
import { getProperty, type PropertyDetail } from '../api/properties';
import { useAuth } from '../AuthContext';
import { FavoriteButton } from '../components/FavoriteButton';
import { formatPropertyPrice, formatRegistrationDate } from '../components/propertyDisplay';
import { formatPropertyLocation } from '../components/locationDisplay';
import { PropertyGallery } from '../components/PropertyGallery';
import { useBrokerageContact } from '../BrokerageContactContext';
import type { MessageKey } from '../i18n';
import type { HomePageProps } from './HomePage';

export function PropertyDetailPage({ locale, text }: HomePageProps) {
  const { slug = '' } = useParams();
  const { account } = useAuth();
  const { contact, error: contactError } = useBrokerageContact();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setProperty(null);
    setError('');
    setNotFound(false);
    getProperty(slug, controller.signal)
      .then(setProperty)
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setNotFound(axios.isAxiosError(requestError) && requestError.response?.status === 404);
        setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  const shareProperty = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage(text('shareSuccess'));
    } catch {
      setShareMessage(text('shareError'));
    }
  };

  if (loading) {
    return <main className="detail-state-page" id="main-content"><div className="listing-state" role="status"><span className="loading-spinner" />{text('loadingListings')}</div></main>;
  }

  if (!property) {
    return (
      <main className="detail-state-page" id="main-content">
        <div className="listing-state detail-error" role="alert">
          <span>{notFound ? text('propertyNotFound') : text('listingsError')}<small>{notFound ? text('listingUnavailable') : error}</small></span>
          <div className="detail-error-actions">
            {!notFound && <button className="button button-outline" type="button" onClick={() => window.location.reload()}>{text('refresh')}</button>}
            <Link className="button button-primary" to="/"><ArrowLeft size={15} aria-hidden="true" />{text('backToProperties')}</Link>
          </div>
        </div>
      </main>
    );
  }

  const categoryKey: Record<string, MessageKey> = {
    house: 'house',
    villa: 'house',
    apartment: 'apartment',
    land: 'land',
    commercial: 'commercial',
  };
  const formattedUpdatedDate = new Intl.DateTimeFormat(locale === 'am' ? 'am-ET' : 'en-ET', {
    dateStyle: 'medium',
  }).format(new Date(property.updated_at));
  const formattedRegistrationDate = formatRegistrationDate(property.created_at, locale);
  const whatsappLink = contact.social_links.find((link) => link.platform === 'whatsapp')?.url;
  const telegramLink = contact.social_links.find((link) => link.platform === 'telegram')?.url;
  const formattedLocation = formatPropertyLocation(property, locale);

  return (
    <main id="main-content" className="detail-page">
      <section className="detail-heading container">
        <div className="breadcrumbs"><Link to="/">{text('home')}</Link><span>/</span><span>{property.title}</span></div>
        <Link className="back-link" to="/"><ArrowLeft size={15} aria-hidden="true" />{text('backToProperties')}</Link>
        <div className="detail-title-row">
          <div><p className="detail-location"><MapPin size={15} aria-hidden="true" />{formattedLocation}</p><h1>{property.title}</h1></div>
          <div className="detail-actions">
            <FavoriteButton propertyId={property.id} text={text} variant="detail" />
            <button className="share-button" type="button" onClick={() => void shareProperty()}><Share2 size={15} aria-hidden="true" />{text('shareProperty')}</button>
          </div>
        </div>
        {shareMessage && <p className="share-feedback" role="status">{shareMessage}</p>}
      </section>

      <PropertyGallery property={property} text={text} />

      <section className="container detail-content-layout">
        <div className="detail-primary-content">
          <div className="detail-price-row">
            <div className="detail-price"><span>{text('priceLabel')}</span><strong>{formatPropertyPrice(
              property.price,
              property.listing_type,
              property.rental_frequency,
              locale,
              text,
            )}</strong></div>
            <span className="detail-availability"><span />{text('available')}</span>
          </div>
          <section className="detail-section">
            <h2>{text('specifications')}</h2>
            <div className="detail-spec-grid">
              <div className="detail-spec"><span className="detail-spec-icon"><BedDouble size={19} aria-hidden="true" /></span><span><small>{text('bedrooms')}</small><strong>{property.bedrooms}</strong></span></div>
              <div className="detail-spec"><span className="detail-spec-icon"><Bath size={19} aria-hidden="true" /></span><span><small>{text('bathrooms')}</small><strong>{property.bathrooms}</strong></span></div>
              <div className="detail-spec"><span className="detail-spec-icon"><Ruler size={19} aria-hidden="true" /></span><span><small>{text('sizeLabel')}</small><strong>{property.area_sqft.toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')} {text('area')}</strong></span></div>
              <div className="detail-spec"><span className="detail-spec-icon"><MapPin size={19} aria-hidden="true" /></span><span><small>{text('categoryLabel')}</small><strong>{text(categoryKey[property.category] ?? 'house')}</strong></span></div>
            </div>
          </section>
          <section className="detail-section detail-description">
            <h2>{text('detailsHeading')}</h2>
            <p>{property.description || text('descriptionUnavailable')}</p>
            {property.features && <p className="detail-features">{property.features}</p>}
          </section>
          {property.amenities.length > 0 && (
            <section className="detail-section">
              <h2>{text('amenitiesHeading')}</h2>
              <ul className="amenity-list">
                {property.amenities.map((amenity) => <li key={amenity.id}><Check size={14} aria-hidden="true" />{locale === 'am' && amenity.name_am ? amenity.name_am : amenity.name}</li>)}
              </ul>
            </section>
          )}
          <section className="detail-section property-location-section">
            <h2>{text('propertyLocation')}</h2>
            <p className="detail-location-address"><MapPin size={15} aria-hidden="true" />{formattedLocation}</p>
          </section>
          {formattedRegistrationDate && (
            <p className="detail-updated"><CalendarDays size={14} aria-hidden="true" />{text('registeredDate')} {formattedRegistrationDate}</p>
          )}
          <p className="detail-updated">{text('lastUpdated')} {formattedUpdatedDate}</p>
        </div>

        <aside className="contact-card">
          <p className="eyebrow eyebrow-muted">{text('contactHeading')}</p>
          <h2>{property.public_contact_name || contact.business_name || text('contactPerson')}</h2>
          {property.public_contact_phone && (
            <a className="contact-method" href={`tel:${property.public_contact_phone}`}>
              <Phone size={17} aria-hidden="true" /><span><small>{text('contactByPhone')}</small><strong>{property.public_contact_phone}</strong></span>
            </a>
          )}
          {property.public_contact_email && (
            <a className="contact-method" href={`mailto:${property.public_contact_email}`}>
              <Mail size={17} aria-hidden="true" /><span><small>{text('contactByEmail')}</small><strong>{property.public_contact_email}</strong></span>
            </a>
          )}
          {contact.phone && (
            <a className="contact-method" href={`tel:${contact.phone}`}><Phone size={17} aria-hidden="true" /><span><small>{text('contactByPhone')}</small><strong>{contact.phone}</strong></span></a>
          )}
          {whatsappLink && (
            <a className="contact-method" href={whatsappLink} target="_blank" rel="noreferrer"><Send size={17} aria-hidden="true" /><span><small>WhatsApp</small><strong>{text('contactAgent')}</strong></span></a>
          )}
          {telegramLink && (
            <a className="contact-method" href={telegramLink} target="_blank" rel="noreferrer"><Send size={17} aria-hidden="true" /><span><small>Telegram</small><strong>{text('contactAgent')}</strong></span></a>
          )}
          {contact.email && (
            <a className="contact-method" href={`mailto:${contact.email}`}><Mail size={17} aria-hidden="true" /><span><small>{text('contactByEmail')}</small><strong>{contact.email}</strong></span></a>
          )}
          {account?.role !== 'agent' && (
            <>
              <Link className="button button-primary viewing-cta" to={`/viewing-requests/new?property_id=${property.id}&property_slug=${encodeURIComponent(property.slug)}`}><CalendarDays size={16} aria-hidden="true" />{text('requestViewing')}</Link>
              <p className="contact-note">{contactError ? text('agentContactUnavailable') : text('viewingNoAccount')}</p>
            </>
          )}
          {!contactError && !contact.phone && !contact.email && !whatsappLink && !telegramLink && (
            <p className="contact-note">{text('agentContactNotConfigured')}</p>
          )}
        </aside>
      </section>
    </main>
  );
}
