import { Mail, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { BrokerageContact } from '../api/brokerage';
import type { MessageKey } from '../i18n';

interface FooterProps {
  contact: BrokerageContact;
  contactError: string;
  text: (key: MessageKey) => string;
}

export function Footer({ contact, contactError, text }: FooterProps) {
  const { account } = useAuth();
  const isAdministrator = account?.role === 'administrator';
  const hasBrokerageContact = Boolean(contact.phone || contact.email);
  const currentYear = new Date().getFullYear();
  const footerCopyright = contact.footer_copyright.trim()
    ? contact.footer_copyright.replaceAll('{year}', String(currentYear))
    : `© ${currentYear} ${contact.site_name || 'Infinity House'}`;

  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div className="footer-brand">
          <Link className="brand brand-footer" to={isAdministrator ? '/dashboard' : '/'}>
            {contact.site_logo ? (
              <img className="brand-logo" src={contact.site_logo} alt="" />
            ) : (
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 36 36" fill="none">
                  <path d="M5 17.1 18 6l13 11.1v12.1H5V17.1Z" fill="currentColor" />
                  <path d="m3 17.4 15-13 15 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 20h6v9h-6z" fill="#153F35" />
                </svg>
              </span>
            )}
            <span className="brand-copy"><strong>{contact.site_name || 'Infinity House'}</strong></span>
          </Link>
          <p>{text('footerNote')}</p>
        </div>
        <nav className="footer-links" aria-label={text('footerNavigation')}>
          <h2>{text('footerNavigation')}</h2>
          <Link to="/">{text('home')}</Link>
          <Link to="/#latest-listings">{text('allPropertiesNav')}</Link>
          <Link to="/?listing_type=rent">{text('navRent')}</Link>
          <Link to="/?listing_type=sale">{text('navBuy')}</Link>
          <Link to="/about">{text('aboutUs')}</Link>
          <Link to="/contact">{text('contactUs')}</Link>
          <Link to="/property-management">{text('propertyManagement')}</Link>
          <Link to={account ? '/account' : '/login'}>
            {text(account ? 'myAccount' : 'footerAccount')}
          </Link>
        </nav>
        {(hasBrokerageContact || contactError) && (
          <section className="footer-contact" aria-label={text('agentContactTitle')}>
            <h2>{text('agentContactTitle')}</h2>
            {contact.phone && (
              <a href={`tel:${contact.phone}`}><Phone size={15} aria-hidden="true" />{contact.phone}</a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`}><Mail size={15} aria-hidden="true" />{contact.email}</a>
            )}
            {contactError && <p className="footer-contact-error" role="status">{text('agentContactUnavailable')}</p>}
          </section>
        )}
      </div>
      <div className="container footer-bottom">
        <span>{footerCopyright}</span>
        <span className="footer-developer-credit">
          Developed by Shumet · <a href="mailto:shumetyeserah8@gmail.com">shumetyeserah8@gmail.com</a>
          {' · '}
          <a href="tel:0923442839">0923442839</a>
        </span>
      </div>
    </footer>
  );
}
