import { Phone } from 'lucide-react';

import type { MessageKey } from '../i18n';
import { SocialMark } from './SocialMark';

interface FloatingContactLinksProps {
  text: (key: MessageKey) => string;
}

export function FloatingContactLinks({ text }: FloatingContactLinksProps) {
  return (
    <nav className="floating-contact-links" aria-label={text('floatingContactLinks')}>
      <a className="floating-contact-link floating-contact-phone" href="tel:0985957555" aria-label={text('contactByPhone')}>
        <Phone size={19} aria-hidden="true" />
      </a>
      <a className="floating-contact-link floating-contact-telegram" href="https://t.me/Lion1621" target="_blank" rel="noreferrer" aria-label={text('contactByTelegram')}>
        <SocialMark platform="telegram" />
      </a>
      <a className="floating-contact-link floating-contact-whatsapp" href="https://wa.me/251985957555" target="_blank" rel="noreferrer" aria-label={text('contactByWhatsApp')}>
        <SocialMark platform="whatsapp" />
      </a>
    </nav>
  );
}
