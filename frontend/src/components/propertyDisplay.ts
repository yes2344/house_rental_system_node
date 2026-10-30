import type { ListingType } from '../api/properties';
import type { ManagedRentalFrequency } from '../api/management';
import type { Locale, MessageKey } from '../i18n';

type RentalPeriod = ManagedRentalFrequency;

export function formatPropertyPrice(
  price: string,
  listingType: ListingType,
  rentalFrequency: RentalPeriod,
  locale: Locale,
  text: (key: MessageKey) => string,
): string {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return text('priceOnRequest');
  const formattedPrice = new Intl.NumberFormat(locale === 'am' ? 'am-ET' : 'en-ET', {
    maximumFractionDigits: 0,
  }).format(numericPrice);
  const periodKey: Record<Exclude<RentalPeriod, ''>, MessageKey> = {
    daily: 'daily',
    weekly: 'weekly',
    monthly: 'monthly',
    yearly: 'yearly',
  };
  const period = listingType === 'rent' && rentalFrequency
    ? ` ${text(periodKey[rentalFrequency])}`
    : '';
  return `${text('ethiopianBirr')} ${formattedPrice}${period}`;
}

export function formatRegistrationDate(createdAt: string | null | undefined, locale: Locale): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'am' ? 'am-ET' : 'en-ET', {
    dateStyle: 'medium',
  }).format(date);
}

export function formatRegistrationAge(createdAt: string | null | undefined, locale: Locale): string | null {
  if (!createdAt) return null;
  const registeredAt = new Date(createdAt);
  if (Number.isNaN(registeredAt.getTime())) return null;

  const elapsedSeconds = (Date.now() - registeredAt.getTime()) / 1000;
  const elapsedDays = Math.abs(elapsedSeconds) / 86400;
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;

  if (elapsedDays >= 365) {
    value = Math.floor(elapsedDays / 365);
    unit = 'year';
  } else if (elapsedDays >= 30) {
    value = Math.floor(elapsedDays / 30);
    unit = 'month';
  } else if (elapsedDays >= 7) {
    value = Math.floor(elapsedDays / 7);
    unit = 'week';
  } else if (elapsedDays >= 1) {
    value = Math.floor(elapsedDays);
    unit = 'day';
  } else if (Math.abs(elapsedSeconds) >= 3600) {
    value = Math.floor(Math.abs(elapsedSeconds) / 3600);
    unit = 'hour';
  } else if (Math.abs(elapsedSeconds) >= 60) {
    value = Math.floor(Math.abs(elapsedSeconds) / 60);
    unit = 'minute';
  } else {
    value = Math.floor(Math.abs(elapsedSeconds));
    unit = 'second';
  }

  return new Intl.RelativeTimeFormat(locale === 'am' ? 'am-ET' : 'en-ET', {
    numeric: 'always',
  }).format(elapsedSeconds >= 0 ? -value : value, unit);
}
