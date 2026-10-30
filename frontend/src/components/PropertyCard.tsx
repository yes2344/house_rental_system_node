import { BedDouble, Bath, MapPin, Phone, Ruler } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { PropertySummary } from '../api/properties';
import { useBrokerageContact } from '../BrokerageContactContext';
import type { Locale, MessageKey } from '../i18n';
import { FavoriteButton } from './FavoriteButton';
import { formatPropertyPrice, formatRegistrationAge } from './propertyDisplay';
import { formatPropertyLocation } from './locationDisplay';
import { PropertySlideshow } from './PropertySlideshow';

interface PropertyCardProps {
  property: PropertySummary;
  locale: Locale;
  text: (key: MessageKey) => string;
  imageLoading?: 'eager' | 'lazy';
}

const statusMessageKeys: Record<PropertySummary['status'], MessageKey> = {
  available: 'available',
  rented: 'statusRented',
  sold: 'statusSold',
  inactive: 'statusInactive',
};

function getAreaSquareMetres(property: PropertySummary): number | null {
  if (property.area_value && property.area_unit) {
    const areaValue = Number(property.area_value);
    if (Number.isFinite(areaValue) && areaValue > 0) {
      return property.area_unit === 'sqm' ? areaValue : areaValue * 0.09290304;
    }
  }

  return property.area_sqft > 0 ? property.area_sqft * 0.09290304 : null;
}

export function PropertyCard({ property, locale, text, imageLoading = 'lazy' }: PropertyCardProps) {
  const { contact } = useBrokerageContact();
  const price = formatPropertyPrice(
    property.price,
    property.listing_type,
    property.rental_frequency,
    locale,
    text,
  );
  const statusKey = statusMessageKeys[property.status];
  const isLand = property.category === 'land';
  const areaSquareMetres = getAreaSquareMetres(property);
  const phoneNumber = property.public_contact_phone || contact.phone;
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  const phoneHref = phoneNumber
    ? `tel:${phoneNumber.trim().startsWith('+') ? '+' : ''}${phoneDigits}`
    : '';
  const location = formatPropertyLocation(property, locale);
  const registrationAge = formatRegistrationAge(property.created_at, locale);

  return (
    <article className="listing-card">
      <div className="listing-image-link">
        <PropertySlideshow
          images={property.images ?? []}
          fallbackImage={property.primary_image}
          title={property.title}
          fallbackLabel={text('emptyImageLabel')}
          previousLabel={text('previousPage')}
          nextLabel={text('nextPage')}
          photoLabel={text('photoNumber')}
          imageLoading={imageLoading}
        />
        <Link className="listing-image-target" to={`/properties/${property.slug}`}>
          <span className="visually-hidden">{property.title}</span>
        </Link>
        <div className="listing-image-shade" aria-hidden="true" />
        <span className={`listing-status listing-status-overlay${statusKey === 'available' ? '' : ' is-unavailable'}`}>
          <span aria-hidden="true" />{text(statusKey)}
        </span>
        <span className={`listing-type ${property.listing_type === 'rent' ? 'is-rent' : ''}`}>
          {property.listing_type === 'rent' ? text('forRent') : text('forSale')}
        </span>
        <div className="listing-image-bottom">
          <strong className="listing-price listing-price-overlay">{price}</strong>
        </div>
        {phoneNumber && (
          <div className="listing-image-contact">
            <a
              href={phoneHref}
              aria-label={`${text('contactByPhone')}: ${phoneNumber}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Phone size={13} aria-hidden="true" />
              <span>{phoneNumber}</span>
            </a>
          </div>
        )}
        <FavoriteButton propertyId={property.id} text={text} />
      </div>

      <div className="listing-card-content">
        <h3><Link to={`/properties/${property.slug}`}>{property.title}</Link></h3>
        {location && (
          <div className="listing-location">
            <MapPin size={14} aria-hidden="true" />
            <span>{location}</span>
          </div>
        )}
        <div className="listing-specs listing-card-specs">
          {areaSquareMetres !== null && (
            <span>
              <Ruler size={15} aria-hidden="true" />
              {new Intl.NumberFormat(locale === 'am' ? 'am-ET' : 'en-ET', {
                maximumFractionDigits: 1,
              }).format(areaSquareMetres)} {text('squareMetreSymbol')}
            </span>
          )}
          {!isLand && property.bedrooms > 0 && (
            <span>
              <BedDouble size={15} aria-hidden="true" />
              {property.bedrooms.toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')} {text('cardBedrooms')}
            </span>
          )}
          {!isLand && property.bathrooms > 0 && (
            <span>
              <Bath size={15} aria-hidden="true" />
              {property.bathrooms.toLocaleString(locale === 'am' ? 'am-ET' : 'en-ET')} {text('cardBathrooms')}
            </span>
          )}
        </div>
        {registrationAge && (
          <p className="listing-registration-date">
            <time dateTime={property.created_at}>{registrationAge}</time>
          </p>
        )}
      </div>
    </article>
  );
}
