import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface RequireAuthProps {
  text: (key: MessageKey) => string;
}

export function RequireAuth({ text }: RequireAuthProps) {
  const { account, authError, authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return (
      <main className="account-state-page" id="main-content">
        <div className="listing-state" role="status">
          <span className="loading-spinner" />{text('loadingAccount')}
        </div>
      </main>
    );
  }

  if (authError) {
    return (
      <main className="account-state-page" id="main-content">
        <div className="account-state-card" role="alert">
          <h1>{text('accountStatusError')}</h1>
          <p>{authError}</p>
          <button className="button button-outline" type="button" onClick={() => window.location.reload()}>
            {text('refresh')}
          </button>
        </div>
      </main>
    );
  }

  if (!account) return <Navigate to="/login" replace state={{ from: { pathname: location.pathname, search: location.search, hash: location.hash } }} />;
  if (account.agent_onboarding_required && location.pathname !== '/agent-onboarding') {
    return <Navigate to="/agent-onboarding" replace />;
  }
  return <Outlet />;
}
