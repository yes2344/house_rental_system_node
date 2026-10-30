import { useEffect, useState, type FormEvent } from 'react';

import { useBrokerageContact } from '../BrokerageContactContext';
import { getErrorMessage } from '../api/client';
import type { MessageKey } from '../i18n';

interface SiteBrandingPageProps {
  text: (key: MessageKey) => string;
}

export function SiteBrandingPage({ text }: SiteBrandingPageProps) {
  const { contact, saveBranding } = useBrokerageContact();
  const [siteName, setSiteName] = useState(contact.site_name);
  const [siteLogoFile, setSiteLogoFile] = useState<File | null>(null);
  const [clearSiteLogo, setClearSiteLogo] = useState(false);
  const [homepageHeroImageFile, setHomepageHeroImageFile] = useState<File | null>(null);
  const [clearHomepageHeroImage, setClearHomepageHeroImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => setSiteName(contact.site_name), [contact.site_name]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await saveBranding({
        site_name: siteName.trim(),
        ...(siteLogoFile ? { site_logo: siteLogoFile } : {}),
        ...(clearSiteLogo ? { clear_site_logo: true } : {}),
        ...(homepageHeroImageFile ? { homepage_hero_image: homepageHeroImageFile } : {}),
        ...(clearHomepageHeroImage ? { clear_homepage_hero_image: true } : {}),
      });
      setSiteLogoFile(null);
      setClearSiteLogo(false);
      setHomepageHeroImageFile(null);
      setClearHomepageHeroImage(false);
      setSaved(true);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="manager-page" id="main-content">
      <section className="manager-heading">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerEyebrow')}</p>
          <h1>{text('siteBrandingTitle')}</h1>
          <p>{text('siteBrandingIntro')}</p>
        </div>
      </section>
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <section className="manager-form-section">
          <div className="brokerage-contact-fields">
            <label className="manager-field">
              <span>{text('siteNameLabel')}</span>
              <input
                required
                maxLength={100}
                value={siteName}
                onChange={(event) => {
                  setSiteName(event.target.value);
                  setError('');
                  setSaved(false);
                }}
              />
            </label>
            <label className="manager-field">
              <span>{text('siteLogoLabel')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  setSiteLogoFile(event.target.files?.[0] ?? null);
                  if (event.target.files?.[0]) setClearSiteLogo(false);
                  setError('');
                  setSaved(false);
                }}
              />
            </label>
            {contact.site_logo && (
              <div className="manager-field">
                <span>{text('currentSiteLogo')}</span>
                <img className="site-logo-preview" src={contact.site_logo} alt={siteName} />
              </div>
            )}
            {contact.site_logo && (
              <label className="amenity-choice">
                <input
                  type="checkbox"
                  checked={clearSiteLogo}
                  onChange={(event) => {
                    setClearSiteLogo(event.target.checked);
                    if (event.target.checked) setSiteLogoFile(null);
                    setError('');
                    setSaved(false);
                  }}
                />
                <span>{text('removeSiteLogo')}</span>
              </label>
            )}
            <label className="manager-field">
              <span>{text('homepageHeroImageLabel')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  setHomepageHeroImageFile(event.target.files?.[0] ?? null);
                  if (event.target.files?.[0]) setClearHomepageHeroImage(false);
                  setError('');
                  setSaved(false);
                }}
              />
            </label>
            {contact.homepage_hero_image && (
              <div className="manager-field">
                <span>{text('currentHomepageHeroImage')}</span>
                <img
                  className="homepage-hero-preview"
                  src={contact.homepage_hero_image}
                  alt={text('heroArt')}
                />
              </div>
            )}
            {contact.homepage_hero_image && (
              <label className="amenity-choice">
                <input
                  type="checkbox"
                  checked={clearHomepageHeroImage}
                  onChange={(event) => {
                    setClearHomepageHeroImage(event.target.checked);
                    if (event.target.checked) setHomepageHeroImageFile(null);
                    setError('');
                    setSaved(false);
                  }}
                />
                <span>{text('removeHomepageHeroImage')}</span>
              </label>
            )}
          </div>
        </section>
        <section className="manager-form-section">
          {error && <p className="manager-inline-error" role="alert">{text('siteBrandingError')} {error}</p>}
          {saved && <p className="manager-inline-success" role="status">{text('siteBrandingSaved')}</p>}
          <div className="manager-form-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? text('savingSiteBranding') : text('saveSiteBranding')}
            </button>
          </div>
        </section>
      </form>
    </main>
  );
}
