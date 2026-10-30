import { lazy, Suspense, useMemo } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { BrokerageContactProvider } from './BrokerageContactContext';
import { HomepageContentProvider } from './HomepageContentContext';
import { PageLayout } from './components/PageLayout';
import { RequireAuth } from './components/RequireAuth';
import { RequireAgentAccountManager } from './components/RequireAgentAccountManager';
import { RequireMarketplaceAccess } from './components/RequireMarketplaceAccess';
import { RequireLocationManager } from './components/RequireLocationManager';
import { RequireNonAgent } from './components/RequireNonAgent';
import { RequireListingManager } from './components/RequireListingManager';
import { RequireDashboardAccess } from './components/RequireDashboardAccess';
import { RequireBrandingManager } from './components/RequireBrandingManager';
import { RequireSettingsManager } from './components/RequireSettingsManager';
import { OwnerDashboardLayout } from './components/OwnerDashboardLayout';
import { usePreferences } from './PreferencesContext';
import { messages, type MessageKey } from './i18n';

const HomePage = lazy(() =>
  import('./pages/HomePage').then(({ HomePage }) => ({ default: HomePage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/PhaseNoticePage').then(({ NotFoundPage }) => ({ default: NotFoundPage })),
);
const PropertyDetailPage = lazy(() =>
  import('./pages/PropertyDetailPage').then(({ PropertyDetailPage }) => ({ default: PropertyDetailPage })),
);
const ViewingRequestPage = lazy(() =>
  import('./pages/ViewingRequestPage').then(({ ViewingRequestPage }) => ({ default: ViewingRequestPage })),
);
const ViewingRequestStatusPage = lazy(() =>
  import('./pages/ViewingRequestStatusPage').then(({ ViewingRequestStatusPage }) => ({ default: ViewingRequestStatusPage })),
);
const CustomerViewingRequestsPage = lazy(() =>
  import('./pages/CustomerViewingRequestsPage').then(({ CustomerViewingRequestsPage }) => ({ default: CustomerViewingRequestsPage })),
);
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then(({ AccountPage }) => ({ default: AccountPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then(({ DashboardPage }) => ({ default: DashboardPage })),
);
const FavoritesPage = lazy(() =>
  import('./pages/FavoritesPage').then(({ FavoritesPage }) => ({ default: FavoritesPage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then(({ LoginPage }) => ({ default: LoginPage })),
);
const VerifyEmailPage = lazy(() =>
  import('./pages/VerifyEmailPage').then(({ VerifyEmailPage }) => ({ default: VerifyEmailPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then(({ ForgotPasswordPage }) => ({ default: ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then(({ ResetPasswordPage }) => ({ default: ResetPasswordPage })),
);
const InvitationAcceptPage = lazy(() =>
  import('./pages/InvitationAcceptPage').then(({ InvitationAcceptPage }) => ({ default: InvitationAcceptPage })),
);
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then(({ RegisterPage }) => ({ default: RegisterPage })),
);
const OwnerListingsPage = lazy(() =>
  import('./pages/OwnerListingsPage').then(({ OwnerListingsPage }) => ({ default: OwnerListingsPage })),
);
const OwnerPropertyFormPage = lazy(() =>
  import('./pages/OwnerPropertyFormPage').then(({ OwnerPropertyFormPage }) => ({ default: OwnerPropertyFormPage })),
);
const PropertySubmissionPage = lazy(() =>
  import('./pages/PropertySubmissionPage').then(({ PropertySubmissionPage }) => ({ default: PropertySubmissionPage })),
);
const MyPropertySubmissionsPage = lazy(() =>
  import('./pages/MyPropertySubmissionsPage').then(({ MyPropertySubmissionsPage }) => ({ default: MyPropertySubmissionsPage })),
);
const SubmissionReviewPage = lazy(() =>
  import('./pages/SubmissionReviewPage').then(({ SubmissionReviewPage }) => ({ default: SubmissionReviewPage })),
);
const OwnerViewingRequestsPage = lazy(() =>
  import('./pages/OwnerViewingRequestsPage').then(({ OwnerViewingRequestsPage }) => ({ default: OwnerViewingRequestsPage })),
);
const BrokerageSettingsPage = lazy(() =>
  import('./pages/BrokerageSettingsPage').then(({ BrokerageSettingsPage }) => ({ default: BrokerageSettingsPage })),
);
const SiteBrandingPage = lazy(() =>
  import('./pages/SiteBrandingPage').then(({ SiteBrandingPage }) => ({ default: SiteBrandingPage })),
);
const LocationManagementPage = lazy(() =>
  import('./pages/LocationManagementPage').then(({ LocationManagementPage }) => ({ default: LocationManagementPage })),
);
const AgentAccountManagementPage = lazy(() =>
  import('./pages/AgentAccountManagementPage').then(({ AgentAccountManagementPage }) => ({ default: AgentAccountManagementPage })),
);
const AgentOnboardingPage = lazy(() =>
  import('./pages/AgentOnboardingPage').then(({ AgentOnboardingPage }) => ({ default: AgentOnboardingPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then(({ SettingsPage }) => ({ default: SettingsPage })),
);
const PublicInformationPage = lazy(() =>
  import('./pages/PublicInformationPage').then(({ PublicInformationPage }) => ({ default: PublicInformationPage })),
);

function PropertiesHomeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/${search}`} replace />;
}

export default function App() {
  const { preferences, preferencesError, savePreferences } = usePreferences();
  const { locale } = preferences;
  const text = useMemo(
    () => (key: MessageKey) => messages[locale][key],
    [locale],
  );

  return (
    <BrokerageContactProvider>
      <HomepageContentProvider>
        <Routes>
          <Route
            element={(
              <PageLayout
                locale={locale}
                onLocaleChange={(nextLocale) => {
                  void savePreferences({ locale: nextLocale }).catch(() => undefined);
                }}
                preferenceError={preferencesError}
                text={text}
              />
            )}
          >
            <Route
              element={(
                <Suspense
                  fallback={(
                    <div className="p-8 text-center" role="status" aria-live="polite">
                      {text('routeLoading')}
                    </div>
                  )}
                >
                  <Outlet />
                </Suspense>
              )}
            >
              <Route index element={<HomePage locale={locale} text={text} />} />
              <Route path="about" element={<PublicInformationPage kind="about" locale={locale} text={text} />} />
              <Route path="contact" element={<PublicInformationPage kind="contact" locale={locale} text={text} />} />
              <Route path="property-management" element={<PublicInformationPage kind="propertyManagement" locale={locale} text={text} />} />
              <Route path="properties" element={<PropertiesHomeRedirect />} />
              <Route path="properties/:slug" element={<PropertyDetailPage locale={locale} text={text} />} />
              <Route path="viewing-requests/status" element={<ViewingRequestStatusPage text={text} />} />
              <Route path="login" element={<LoginPage text={text} />} />
              <Route path="verify-email" element={<VerifyEmailPage text={text} />} />
              <Route path="forgot-password" element={<ForgotPasswordPage text={text} />} />
              <Route path="reset-password" element={<ResetPasswordPage text={text} />} />
              <Route path="accept-invitation" element={<InvitationAcceptPage text={text} />} />
              <Route path="register" element={<RegisterPage text={text} />} />
              <Route path="settings" element={<SettingsPage text={text} />} />
              <Route element={<RequireAuth text={text} />}>
                <Route path="agent-onboarding" element={<AgentOnboardingPage text={text} />} />
                <Route element={<RequireMarketplaceAccess text={text} />}>
                  <Route element={<RequireNonAgent />}>
                    <Route path="submissions/new" element={<PropertySubmissionPage locale={locale} text={text} />} />
                    <Route path="submissions/:id/edit" element={<PropertySubmissionPage locale={locale} text={text} />} />
                    <Route path="my-submissions" element={<MyPropertySubmissionsPage locale={locale} text={text} />} />
                  </Route>
                </Route>
                <Route element={<RequireDashboardAccess text={text} />}>
                  <Route path="dashboard" element={<DashboardPage text={text} />} />
                </Route>
                <Route path="admin" element={<Navigate to="/dashboard" replace />} />
                <Route element={<RequireMarketplaceAccess text={text} />}>
                  <Route element={<RequireNonAgent />}>
                    <Route path="viewing-requests/new" element={<ViewingRequestPage locale={locale} text={text} />} />
                    <Route path="viewing-requests" element={<CustomerViewingRequestsPage locale={locale} text={text} />} />
                    <Route path="favorites" element={<FavoritesPage locale={locale} text={text} />} />
                  </Route>
                  <Route path="account" element={<AccountPage locale={locale} text={text} />} />
                </Route>
                <Route element={<RequireAgentAccountManager text={text} />}>
                  <Route path="management/agents" element={<AgentAccountManagementPage text={text} />} />
                  <Route
                    path="management/public-accounts"
                    element={<AgentAccountManagementPage text={text} mode="public" />}
                  />
                </Route>
                <Route element={<RequireListingManager text={text} />}>
                  <Route element={<OwnerDashboardLayout text={text} />}>
                    <Route path="management/listings" element={<OwnerListingsPage locale={locale} text={text} />} />
                    <Route path="management/listings/new" element={<OwnerPropertyFormPage locale={locale} text={text} />} />
                    <Route path="management/listings/:id/edit" element={<OwnerPropertyFormPage locale={locale} text={text} />} />
                    <Route path="management/submissions" element={<SubmissionReviewPage locale={locale} text={text} />} />
                    <Route path="management/viewing-requests" element={<OwnerViewingRequestsPage text={text} />} />
                  </Route>
                </Route>
                <Route element={<RequireSettingsManager text={text} />}>
                  <Route element={<OwnerDashboardLayout text={text} />}>
                    <Route path="management/brokerage" element={<BrokerageSettingsPage text={text} />} />
                  </Route>
                </Route>
                <Route element={<RequireBrandingManager text={text} />}>
                  <Route element={<OwnerDashboardLayout text={text} />}>
                    <Route path="management/branding" element={<SiteBrandingPage text={text} />} />
                  </Route>
                </Route>
                <Route element={<RequireLocationManager text={text} />}>
                  <Route element={<OwnerDashboardLayout text={text} />}>
                    <Route path="management/locations" element={<LocationManagementPage locale={locale} text={text} />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<NotFoundPage text={text} />} />
            </Route>
          </Route>
        </Routes>
      </HomepageContentProvider>
    </BrokerageContactProvider>
  );
}
