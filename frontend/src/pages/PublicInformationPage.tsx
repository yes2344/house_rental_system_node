import { useEffect, useState } from 'react';
import { ArrowUpRight, Mail, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useBrokerageContact } from '../BrokerageContactContext';
import { getErrorMessage } from '../api/client';
import {
  getPublicInformationPage,
  type PublicInformationPage as PublicPageContent,
  type PublicInformationPageSlug,
} from '../api/publicInformation';
import type { Locale, MessageKey } from '../i18n';
import { SocialMark, socialPlatformNames } from '../components/SocialMark';

type PublicInformationPageKind = 'about' | 'contact' | 'propertyManagement';

interface PublicInformationPageProps {
  kind: PublicInformationPageKind;
  locale: Locale;
  text: (key: MessageKey) => string;
}

const pageCopy: Record<PublicInformationPageKind, {
  slug: PublicInformationPageSlug;
  title: MessageKey;
  body: MessageKey;
}> = {
  about: { slug: 'about', title: 'aboutTitle', body: 'aboutBody' },
  contact: { slug: 'contact', title: 'contactTitle', body: 'contactBody' },
  propertyManagement: {
    slug: 'property-management',
    title: 'propertyManagementTitle',
    body: 'propertyManagementBody',
  },
};

export function PublicInformationPage({ kind, locale, text }: PublicInformationPageProps) {
  const { contact, error } = useBrokerageContact();
  const [pageContent, setPageContent] = useState<PublicPageContent | null>(null);
  const [pageError, setPageError] = useState('');
  const copy = pageCopy[kind];
  const socials = contact.social_links.filter((link) => link.is_enabled && link.url);
  const hasContact = Boolean(contact.phone || contact.email || socials.length);

  useEffect(() => {
    const controller = new AbortController();
    setPageContent(null);
    setPageError('');
    getPublicInformationPage(copy.slug, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setPageContent(page);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setPageError(getErrorMessage(requestError));
      });
    return () => controller.abort();
  }, [copy.slug]);

  const title = pageContent
    ? pageContent[locale === 'am' ? 'title_am' : 'title_en']
    : text(copy.title);
  const introduction = pageContent
    ? pageContent[locale === 'am' ? 'introduction_am' : 'introduction_en']
    : text(copy.body);
  const body = pageContent?.[locale === 'am' ? 'body_am' : 'body_en'] ?? '';

  return (
    <main className="public-info-page" id="main-content">
      <section className="public-info-hero">
        <div className="container public-info-content">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('brandName')}</p>
          <h1>{title}</h1>
          <p>{introduction}</p>
          {body.split(/\r?\n/).filter(Boolean).map((paragraph, index) => (
            <p key={`${index}-${paragraph}`}>{paragraph}</p>
          ))}
          {pageError && <p className="public-contact-error" role="status">{text('publicPageLoadError')} {pageError}</p>}
          {kind === 'propertyManagement' && (
            <div className="public-info-actions">
              <Link className="button button-primary" to="/submissions/new" state={{ from: '/submissions/new' }}>
                {text('addYourProperty')}<ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <Link className="button button-outline" to="/contact">{text('contact')}</Link>
            </div>
          )}
        </div>
      </section>
      {kind === 'contact' && (
        <section className="container public-contact-section" aria-labelledby="public-contact-heading">
          <h2 id="public-contact-heading">{text('agentContactTitle')}</h2>
          {error && <p className="public-contact-error" role="status">{text('agentContactUnavailable')}</p>}
          {!hasContact && !error && <p>{text('contactDetailsNotConfigured')}</p>}
          <div className="public-contact-options">
            {contact.phone && (
              <a className="public-contact-option" href={`tel:${contact.phone}`}>
                <Phone aria-hidden="true" /><span>{text('contactByPhone')}</span><strong>{contact.phone}</strong>
              </a>
            )}
            {contact.email && (
              <a className="public-contact-option" href={`mailto:${contact.email}`}>
                <Mail aria-hidden="true" /><span>{text('contactByEmail')}</span><strong>{contact.email}</strong>
              </a>
            )}
            {socials.map((link) => (
              <a className="public-contact-option" key={link.platform} href={link.url} target="_blank" rel="noreferrer">
                <SocialMark platform={link.platform} /><span>{socialPlatformNames[link.platform]}</span><strong>{text('openContactChannel')}</strong>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
