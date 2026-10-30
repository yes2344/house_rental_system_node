import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useBrokerageContact } from '../BrokerageContactContext';
import type { MessageKey } from '../i18n';

interface PhaseNoticePageProps {
  text: (key: MessageKey) => string;
}

export function PhaseNoticePage({ text }: PhaseNoticePageProps) {
  return (
    <main className="notice-page" id="main-content">
      <div className="notice-card">
        <span className="notice-icon"><Compass size={24} aria-hidden="true" /></span>
        <p className="eyebrow eyebrow-muted">{text('placeholderEyebrow')}</p>
        <h1>{text('placeholderTitle')}</h1>
        <p>{text('placeholderBody')}</p>
        <Link className="button button-primary" to="/"><ArrowLeft size={16} aria-hidden="true" />{text('backHome')}</Link>
      </div>
    </main>
  );
}

export function NotFoundPage({ text }: PhaseNoticePageProps) {
  const { contact } = useBrokerageContact();
  return (
    <main className="notice-page" id="main-content">
      <div className="notice-card">
        <span className="notice-code">404</span>
        <p className="eyebrow eyebrow-muted">{contact.site_name || 'Infinity House'}</p>
        <h1>{text('notFoundTitle')}</h1>
        <p>{text('notFoundBody')}</p>
        <Link className="button button-primary" to="/"><ArrowLeft size={16} aria-hidden="true" />{text('backHome')}</Link>
      </div>
    </main>
  );
}
