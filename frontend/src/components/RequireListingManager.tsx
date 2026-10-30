import { Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireListingManagerProps {
  text: (key: MessageKey) => string;
}

export function RequireListingManager({ text }: RequireListingManagerProps) {
  const { account } = useAuth();

  const canManage = Boolean(
    ['agent', 'administrator'].includes(account?.role ?? '') && account?.management_permissions.some(
      (permission) => permission.startsWith('properties.')
        || permission.startsWith('viewings.')
        || permission === 'announcements.review'
        || permission === 'announcements.review_assigned',
    ),
  );

  if (canManage) {
    return <Outlet />;
  }

  return (
    <main className="account-state-page" id="main-content">
      <section className="account-state-card" role="alert">
        <h1>{text('managerAccessTitle')}</h1>
        <p>{text('managerAccessBody')}</p>
      </section>
    </main>
  );
}
