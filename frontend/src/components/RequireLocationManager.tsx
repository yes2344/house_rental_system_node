import { Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireLocationManagerProps {
  text: (key: MessageKey) => string;
}

export function RequireLocationManager({ text }: RequireLocationManagerProps) {
  const { account } = useAuth();
  const canManage = Boolean(
    account?.management_permissions.includes('locations.manage_cities')
    || (account?.role === 'agent' && account.management_permissions.includes('locations.manage_subcities')),
  );

  if (canManage) return <Outlet />;

  return (
    <main className="account-state-page" id="main-content">
      <section className="account-state-card" role="alert">
        <h1>{text('managerAccessTitle')}</h1>
        <p>{text('managerAccessBody')}</p>
      </section>
    </main>
  );
}
