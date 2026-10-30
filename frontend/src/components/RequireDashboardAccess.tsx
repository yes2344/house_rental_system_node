import { Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireDashboardAccessProps {
  text: (key: MessageKey) => string;
}

export function RequireDashboardAccess({ text }: RequireDashboardAccessProps) {
  const { account } = useAuth();
  const canAccessDashboard = Boolean(account && ['agent', 'administrator'].includes(account.role ?? ''));

  if (canAccessDashboard) return <Outlet />;

  return (
    <main className="account-state-page" id="main-content">
      <section className="account-state-card" role="alert">
        <h1>{text('managerAccessTitle')}</h1>
        <p>{text('managerAccessBody')}</p>
      </section>
    </main>
  );
}
