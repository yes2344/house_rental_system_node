import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Paintbrush,
  Heart,
  MapPinned,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from '../AuthContext';
import type { MessageKey } from '../i18n';

interface DashboardPageProps {
  text: (key: MessageKey) => string;
}

export function DashboardPage({ text }: DashboardPageProps) {
  const { account } = useAuth();
  if (!account) return null;

  const permissions = account.management_permissions;
  const isAdministrator = account.role === 'administrator';
  const isAgent = account.role === 'agent';
  const canManageListings = permissions.some((permission) => permission.startsWith('properties.'));
  const canReviewSubmissions = permissions.some((permission) => [
    'announcements.review',
    'announcements.review_assigned',
  ].includes(permission));
  const canManageRequests = permissions.some((permission) => permission.startsWith('viewings.'))
    || (isAdministrator && canManageListings);
  const canManageSubcities = isAgent && permissions.includes('locations.manage_subcities');
  const canManageAgents = account.role === 'administrator' && permissions.includes('staff.manage');
  const canManageCities = account.role === 'administrator' && permissions.includes('locations.manage_cities');
  const canManageBranding = account.role === 'administrator' && permissions.includes('branding.manage');
  const canManageSettings = account.is_platform_owner
    || (isAgent && permissions.includes('settings.manage'));

  const entries: {
    href: string;
    title: string;
    icon: ReactNode;
  }[] = [
    ...(isAdministrator
      ? (canManageAgents ? [
        { href: '/management/agents', title: text('managerAgentAccounts'), icon: <Users aria-hidden="true" /> },
        { href: '/management/public-accounts', title: text('publicAccountManagementTitle'), icon: <UserRound aria-hidden="true" /> },
      ] : []).concat(canManageCities ? [
        { href: '/management/locations', title: text('locationManagementTitle'), icon: <MapPinned aria-hidden="true" /> },
      ] : []).concat(canManageBranding ? [
        { href: '/management/branding', title: text('siteBrandingTitle'), icon: <Paintbrush aria-hidden="true" /> },
      ] : []).concat(canManageSettings ? [
        { href: '/management/brokerage', title: text('brokerageSettingsTitle'), icon: <Paintbrush aria-hidden="true" /> },
      ] : [])
      : [
      { href: '/properties', title: text('explore'), icon: <Search aria-hidden="true" /> },
      { href: '/favorites', title: text('savedHomesTitle'), icon: <Heart aria-hidden="true" /> },
      { href: '/account', title: text('accountTitle'), icon: <UserRound aria-hidden="true" /> },
      ]),
  ];

  if (!isAdministrator && account.role !== 'agent') {
    entries.push({
      href: '/viewing-requests',
      title: text('yourViewingRequests'),
      icon: <CalendarDays aria-hidden="true" />,
    });
  }
  if (canManageListings) {
    entries.push({
      href: '/management/listings',
      title: text('managerListings'),
      icon: <Building2 aria-hidden="true" />,
    });
  }
  if (canReviewSubmissions) {
    entries.push({
      href: '/management/submissions',
      title: text('submissionReviewTitle'),
      icon: <Building2 aria-hidden="true" />,
    });
  }
  if (canManageRequests) {
    entries.push({
      href: '/management/viewing-requests',
      title: text('managerViewingRequests'),
      icon: <CalendarDays aria-hidden="true" />,
    });
  }
  if (canManageSubcities) {
    entries.push({
      href: '/management/locations',
      title: text('locationManagementTitle'),
      icon: <MapPinned aria-hidden="true" />,
    });
  }
  return (
    <main id="main-content" className="customer-page">
      <section className="customer-heading">
        <div className="container">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text(isAdministrator ? 'adminDashboardTitle' : 'dashboardTitle')}</p>
          <h1>{text(isAdministrator ? 'adminDashboardTitle' : 'dashboardTitle')}</h1>
          <p>{text('accountWelcome')} <strong>{account.username}</strong></p>
          <p>{text(isAdministrator ? 'adminDashboardIntro' : 'dashboardIntro')}</p>
        </div>
      </section>
      <section className="container customer-content">
        <div className="role-dashboard-grid">
          {entries.map((entry) => (
            <Link className="role-dashboard-card" key={entry.href} to={entry.href}>
              <span className="role-dashboard-icon">{entry.icon}</span>
              <strong>{entry.title}</strong>
              <span className="role-dashboard-open">{text('dashboardOpenSection')}<ArrowUpRight size={15} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
