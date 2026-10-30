import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface OwnerDashboardLayoutProps {
  text: (key: MessageKey) => string;
}

export function OwnerDashboardLayout({ text }: OwnerDashboardLayoutProps) {
  const { account } = useAuth();
  const permissions = account?.management_permissions ?? [];
  const isAuthorizedAgent = account?.role === 'agent';
  const canReviewSubmissions = permissions.some((permission) => [
    'announcements.review',
    'announcements.review_assigned',
  ].includes(permission));
  const canViewProperties = permissions.some((permission) => [
      'properties.view_all',
      'properties.moderate',
      'properties.edit_all',
      'properties.manage_assigned',
    ].includes(permission));
  const canViewRequests = permissions.some((permission) => permission.startsWith('viewings.'))
    || (account?.role === 'administrator' && canViewProperties);
  const canManageSubcities = isAuthorizedAgent && permissions.includes('locations.manage_subcities');
  const canManageAgents = account?.role === 'administrator' && permissions.includes('staff.manage');
  const canManageCities = account?.role === 'administrator' && permissions.includes('locations.manage_cities');
  const canManageBranding = account?.role === 'administrator' && permissions.includes('branding.manage');
  const canManageSettings = Boolean(
    account?.is_platform_owner
    || (isAuthorizedAgent && permissions.includes('settings.manage')),
  );

  return (
    <div className="manager-shell">
      <nav className="manager-navigation" aria-label={text('managerNavigation')}>
        {canViewProperties && <NavLink to="/management/listings" end>{text('managerListings')}</NavLink>}
        {canReviewSubmissions && <NavLink to="/management/submissions">{text('submissionReviewTitle')}</NavLink>}
        {canViewRequests && <NavLink to="/management/viewing-requests">{text('managerViewingRequests')}</NavLink>}
        {(canManageSubcities || canManageCities) && <NavLink to="/management/locations">{text('locationManagementTitle')}</NavLink>}
        {canManageAgents && <NavLink to="/management/agents">{text('managerAgentAccounts')}</NavLink>}
        {canManageBranding && <NavLink to="/management/branding">{text('siteBrandingTitle')}</NavLink>}
        {canManageSettings && <NavLink to="/management/brokerage">{text('brokerageSettingsTitle')}</NavLink>}
      </nav>
      <Outlet />
    </div>
  );
}
