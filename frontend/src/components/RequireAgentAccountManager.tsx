import { Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireAgentAccountManagerProps {
  text: (key: MessageKey) => string;
}

export function RequireAgentAccountManager({ text }: RequireAgentAccountManagerProps) {
  const { account } = useAuth();
  const canManage = Boolean(
    account?.role === 'administrator'
    && account.management_permissions.includes('staff.manage'),
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
