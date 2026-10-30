import { Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireSettingsManagerProps {
  text: (key: MessageKey) => string;
}

export function RequireSettingsManager({ text }: RequireSettingsManagerProps) {
  const { account } = useAuth();
  const canManageSettings = Boolean(
    account?.is_platform_owner
    || (account?.role === 'agent' && account.management_permissions.includes('settings.manage')),
  );

  if (canManageSettings) return <Outlet />;

  return (
    <main className="account-state-page" id="main-content">
      <section className="account-state-card" role="alert">
        <h1>{text('managerAccessTitle')}</h1>
        <p>{text('managerAccessBody')}</p>
      </section>
    </main>
  );
}
