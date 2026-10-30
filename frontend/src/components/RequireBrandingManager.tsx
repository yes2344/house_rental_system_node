import { Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireBrandingManagerProps {
  text: (key: MessageKey) => string;
}

export function RequireBrandingManager({ text }: RequireBrandingManagerProps) {
  const { account } = useAuth();
  const canManageBranding = Boolean(
    account?.role === 'administrator'
    && account.management_permissions.includes('branding.manage'),
  );

  if (canManageBranding) return <Outlet />;

  return (
    <main className="account-state-page" id="main-content">
      <section className="account-state-card" role="alert">
        <h1>{text('managerAccessTitle')}</h1>
        <p>{text('managerAccessBody')}</p>
      </section>
    </main>
  );
}
