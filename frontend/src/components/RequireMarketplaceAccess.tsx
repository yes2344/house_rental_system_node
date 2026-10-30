import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireMarketplaceAccessProps {
  text: (key: MessageKey) => string;
}

export function RequireMarketplaceAccess({ text }: RequireMarketplaceAccessProps) {
  const { account, authLoading } = useAuth();

  if (authLoading) {
    return (
      <main className="account-state-page" id="main-content">
        <div className="listing-state" role="status">
          <span className="loading-spinner" />{text('loadingAccount')}
        </div>
      </main>
    );
  }

  if (account?.role === 'administrator') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
