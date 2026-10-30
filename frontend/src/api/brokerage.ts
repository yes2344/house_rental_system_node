import { apiClient } from './client';

export type SocialPlatform =
  | 'facebook'
  | 'whatsapp'
  | 'telegram'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'linkedin'
  | 'x';

export interface BrokerageSocialLink {
  platform: SocialPlatform;
  url: string;
  is_enabled: boolean;
  display_order: number;
}

export interface BrokerageContact {
  site_name: string;
  footer_copyright: string;
  site_logo: string | null;
  homepage_hero_image: string | null;
  business_name: string;
  phone: string;
  email: string;
  social_links: BrokerageSocialLink[];
}

export const emptyBrokerageContact: BrokerageContact = {
  site_name: 'Infinity House',
  footer_copyright: '',
  site_logo: '',
  homepage_hero_image: '',
  business_name: '',
  phone: '',
  email: '',
  social_links: [],
};

export async function getBrokerageContact(signal?: AbortSignal): Promise<BrokerageContact> {
  const response = await apiClient.get<BrokerageContact>('/brokerage/contact/', { signal });
  return response.data;
}

export async function updateBrokerageContact(
  updates: Partial<Pick<BrokerageContact, 'business_name' | 'phone' | 'email' | 'social_links' | 'footer_copyright'>>,
): Promise<BrokerageContact> {
  const response = await apiClient.patch<BrokerageContact>('/brokerage/contact/', updates);
  return response.data;
}

export async function updateSiteBranding(updates: {
  site_name: string;
  site_logo?: File;
  clear_site_logo?: boolean;
  homepage_hero_image?: File;
  clear_homepage_hero_image?: boolean;
}): Promise<BrokerageContact> {
  const form = new FormData();
  form.append('site_name', updates.site_name);
  if (updates.site_logo) form.append('site_logo', updates.site_logo);
  if (updates.clear_site_logo) form.append('clear_site_logo', 'true');
  if (updates.homepage_hero_image) form.append('homepage_hero_image', updates.homepage_hero_image);
  if (updates.clear_homepage_hero_image) {
    form.append('clear_homepage_hero_image', 'true');
  }
  const response = await apiClient.patch<BrokerageContact>('/brokerage/contact/', form);
  return response.data;
}
