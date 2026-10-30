import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';

export function RequireNonAgent() {
  const { account } = useAuth();

  if (account?.role === 'agent') {
    return <Navigate to="/management/listings" replace />;
  }

  return <Outlet />;
}
