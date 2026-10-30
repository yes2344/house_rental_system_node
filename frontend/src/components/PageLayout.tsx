import { Outlet } from 'react-router-dom';

import type { Locale, MessageKey } from '../i18n';
import { useBrokerageContact } from '../BrokerageContactContext';
import { Footer } from './Footer';
import { FloatingContactLinks } from './FloatingContactLinks';
import { Header } from './Header';

interface PageLayoutProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  preferenceError: string;
  text: (key: MessageKey) => string;
}

export function PageLayout({ locale, onLocaleChange, preferenceError, text }: PageLayoutProps) {
  const { contact, error: contactError } = useBrokerageContact();
  return (
    <div className="app-shell">
      <Header
        locale={locale}
        onLocaleChange={onLocaleChange}
        preferenceError={preferenceError}
        text={text}
      />
      <Outlet />
      <FloatingContactLinks text={text} />
      <Footer contact={contact} contactError={contactError} text={text} />
    </div>
  );
}
