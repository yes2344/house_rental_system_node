import { apiClient, nodePublicApiClient } from './client';

export interface MarketplaceLocation {
  id: number;
  name: string;
  name_am: string;
  slug: string;
  location_type: LocationType;
  parent_id: number | null;
  aliases_en: string[];
  aliases_am: string[];
  is_active: boolean;
  display_order: number;
}

export interface PropertyLocationPathItem {
  id: number;
  name: string;
  name_am: string;
  location_type: LocationType;
}

export type LocationType =
  | 'country'
  | 'region'
  | 'city_administration'
  | 'city'
  | 'subcity'
  | 'woreda'
  | 'neighborhood';

export type ListingType = 'sale' | 'rent';
export type PropertyType =
  | 'house' | 'villa' | 'apartment' | 'condominium' | 'land'
  | 'office' | 'shop' | 'warehouse' | 'commercial' | 'other';

export interface PropertyTypeOption {
  value: PropertyType;
  label: string;
}

export function getUniquePropertyTypeOptions(options: PropertyTypeOption[]): PropertyTypeOption[] {
  const unique = new Map<PropertyType, PropertyTypeOption>();
  for (const option of options) {
    if (!unique.has(option.value)) unique.set(option.value, option);
  }
  return [...unique.values()];
}

export async function getPropertyTypeOptions(signal?: AbortSignal): Promise<PropertyTypeOption[]> {
  const response = await nodePublicApiClient.get<PropertyTypeOption[]>('/property-types/', { signal });
  return response.data;
}

export interface PropertySummary {
  id: number;
  title: string;
  slug: string;
  location: string;
  administrative_location: number | null;
  location_path: PropertyLocationPathItem[];
  category: PropertyType;
  listing_type: ListingType;
  rental_frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | '';
  price: string;
  currency: 'ETB';
  area_value: string | null;
  area_unit: 'sqm' | 'sqft' | '';
  bedrooms: number;
  bathrooms: number;
  area_sqft: number;
  status: 'available' | 'rented' | 'sold' | 'inactive';
  service_type: 'agent_managed' | 'owner_announced';
  public_contact_name: string;
  public_contact_phone: string;
  public_contact_email: string;
  primary_image: string | null;
  images: { id: number; url: string | null; caption: string; is_primary: boolean }[];
  created_at: string;
}

export interface PropertyDetail extends PropertySummary {
  description: string;
  features: string;
  amenities: { id: number; name: string; name_am: string; slug: string }[];
  updated_at: string;
}

export interface PropertyFilters {
  search?: string;
  listing_type?: string;
  property_type?: string;
  location?: string;
  location_id?: number;
  city_id?: number;
  min_price?: string;
  max_price?: string;
  min_bedrooms?: string;
  min_bathrooms?: string;
  max_bedrooms?: string;
  max_bathrooms?: string;
  min_size?: string;
  max_size?: string;
  amenities?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export async function getLocations(
  parentId?: number,
  signal?: AbortSignal,
  includeAll = false,
  locationType?: string,
): Promise<MarketplaceLocation[]> {
  const response = await apiClient.get<MarketplaceLocation[]>('/locations/', {
    params: includeAll
      ? { all: 1 }
      : {
        ...(parentId ? { parent_id: parentId } : {}),
        ...(locationType ? { type: locationType } : {}),
      },
    signal,
  });
  return response.data;
}

export async function getLocationsByTypes(
  locationTypes: string[],
  signal?: AbortSignal,
): Promise<MarketplaceLocation[]> {
  const response = await apiClient.get<MarketplaceLocation[]>('/locations/', {
    params: { types: locationTypes.join(',') },
    signal,
  });
  return response.data;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export async function getProperties(
  filters: PropertyFilters,
  signal?: AbortSignal,
): Promise<PaginatedResponse<PropertySummary>> {
  const response = await nodePublicApiClient.get<PaginatedResponse<PropertySummary>>('/properties/', {
    params: filters,
    signal,
  });
  return response.data;
}

export async function getProperty(slug: string, signal?: AbortSignal): Promise<PropertyDetail> {
  const response = await nodePublicApiClient.get<PropertyDetail>(
    `/properties/${encodeURIComponent(slug)}/`,
    { signal },
  );
  return response.data;
}
