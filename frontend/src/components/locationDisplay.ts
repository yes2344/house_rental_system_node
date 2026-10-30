import type { PropertyLocationPathItem } from '../api/properties';
import type { Locale } from '../i18n';

interface PropertyLocationData {
  location: string;
  location_path?: PropertyLocationPathItem[];
}

export function formatPropertyLocation(property: PropertyLocationData, locale: Locale): string {
  const hierarchyItems = (property.location_path ?? [])
    .filter((item) => item.location_type !== 'country');
  const hierarchy = hierarchyItems
    .map((item) => (locale === 'am' && item.name_am ? item.name_am : item.name).trim())
    .filter(Boolean);
  const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase();
  const uniqueHierarchy = hierarchy.filter((name, index) =>
    hierarchy.findIndex((item) => normalize(item) === normalize(name)) === index);
  const hierarchyAliases = new Set(
    hierarchyItems.flatMap((item) => [item.name, item.name_am].filter(Boolean).map(normalize)),
  );
  const addressParts = property.location
    .split(/[,·]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !hierarchyAliases.has(normalize(part)));
  const uniqueAddressParts = addressParts.filter(
    (part, index) => addressParts.findIndex((item) => normalize(item) === normalize(part)) === index,
  );
  return [...uniqueHierarchy, ...uniqueAddressParts].join(' · ') || property.location;
}
