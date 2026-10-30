import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogIn, LogOut, Mail, Menu, Phone, X } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import { useBrokerageContact } from '../BrokerageContactContext';
import { getErrorMessage } from '../api/client';
import {
  getPropertyTypeOptions,
  getUniquePropertyTypeOptions,
  type PropertyType,
  type PropertyTypeOption,
} from '../api/properties';
import type { Locale, MessageKey } from '../i18n';

interface HeaderProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  preferenceError: string;
  text: (key: MessageKey) => string;
}

type ListingMenu = 'rent' | 'buy';

const propertyTypeLabels: Record<PropertyType, MessageKey> = {
  house: 'house',
  villa: 'villa',
  apartment: 'apartment',
  condominium: 'condominium',
  land: 'land',
  office: 'office',
  shop: 'shop',
  warehouse: 'warehouse',
  commercial: 'commercial',
  other: 'otherPropertyType',
};

export function Header({ locale, onLocaleChange, preferenceError, text }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openListingMenu, setOpenListingMenu] = useState<ListingMenu | null>(null);
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [propertyTypesError, setPropertyTypesError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const { account, authLoading, signOut } = useAuth();
  const { contact } = useBrokerageContact();
  const uniquePropertyTypes = getUniquePropertyTypeOptions(propertyTypes);
  const hasBrokerageContact = Boolean(contact.phone || contact.email);
  const canAccessDashboard = Boolean(account && ['agent', 'administrator'].includes(account.role ?? ''));
  const canManageListings = Boolean(
    account?.role === 'agent'
    && account.management_permissions.some((permission) => [
      'properties.view_all',
      'properties.moderate',
      'properties.edit_all',
      'properties.manage_assigned',
    ].includes(permission)),
  );
  const addPropertyTarget = account?.role === 'agent'
    ? canManageListings ? '/management/listings/new' : '/submissions/new'
    : account?.role === 'administrator'
      ? '/dashboard'
      : account
        ? '/submissions/new'
        : '/login';
  const isAdministrator = account?.role === 'administrator';
  const accountDestination = account
    ? canAccessDashboard ? '/dashboard' : '/account'
    : '/login';
  const closeMenu = () => setMenuOpen(false);
  const closeNavigation = () => {
    closeMenu();
    setOpenListingMenu(null);
  };

  useEffect(() => {
    const controller = new AbortController();
    void getPropertyTypeOptions(controller.signal)
      .then(setPropertyTypes)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPropertyTypesError(getErrorMessage(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!openListingMenu) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenListingMenu(null);
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!navigationRef.current?.contains(event.target as Node)) {
        setOpenListingMenu(null);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [openListingMenu]);

  const listingMenu = (kind: ListingMenu) => {
    const listingType = kind === 'rent' ? 'rent' : 'sale';
    const title = text(kind === 'rent' ? 'navRent' : 'navBuy');
    const isOpen = openListingMenu === kind;
    const eligiblePropertyTypes = kind === 'rent'
      ? uniquePropertyTypes.filter((option) => option.value !== 'land')
      : uniquePropertyTypes;
    return (
      <div className={`nav-dropdown${isOpen ? ' is-open' : ''}`} key={kind}>
        <button
          className="nav-dropdown-trigger"
          type="button"
          aria-expanded={isOpen}
          aria-controls={`${kind}-navigation-menu`}
          onClick={() => setOpenListingMenu((current) => current === kind ? null : kind)}
        >
          {title}<ChevronDown size={15} aria-hidden="true" />
        </button>
        <div
          className="nav-dropdown-menu"
          id={`${kind}-navigation-menu`}
          aria-label={title}
          hidden={!isOpen}
        >
          <Link
            to={`/?listing_type=${listingType}`}
            onClick={closeNavigation}
          >
            {text(kind === 'rent' ? 'allRentals' : 'allPropertiesForSale')}
          </Link>
          {eligiblePropertyTypes.map((option) => (
            <Link
              key={option.value}
              to={`/?listing_type=${listingType}&property_type=${option.value}`}
              onClick={closeNavigation}
            >
              {text(propertyTypeLabels[option.value]) || option.label}
            </Link>
          ))}
          {propertyTypesError && (
            <span className="nav-dropdown-error" role="alert">{text('navigationOptionsError')}</span>
          )}
        </div>
      </div>
    );
  };

  const logout = () => {
    setLogoutError('');
    setLoggingOut(true);
    void signOut()
      .then(() => {
        closeMenu();
        setLoggingOut(false);
      })
      .catch((error: unknown) => {
        setLogoutError(getErrorMessage(error));
        setLoggingOut(false);
      });
  };

  return (
    <>
      <a className="skip-link" href="#main-content">{text('skipToContent')}</a>
      <header className="site-header">
        <div className="container header-inner">
          <Link
            className="brand"
            to="/"
            aria-label={contact.site_name || 'Infinity House'}
            onClick={closeNavigation}
          >
            {contact.site_logo ? (
              <img className="brand-logo" src={contact.site_logo} alt="" />
            ) : (
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 36 36" fill="none">
                  <path d="M5 17.1 18 6l13 11.1v12.1H5V17.1Z" fill="currentColor" />
                  <path d="m3 17.4 15-13 15 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 20h6v9h-6z" fill="#F8F8F4" />
                </svg>
              </span>
            )}
            <span className="brand-copy"><strong>{contact.site_name || 'Infinity House'}</strong></span>
          </Link>

          <div className="mobile-header-actions">
            <button
              className="menu-toggle"
              type="button"
              aria-label={menuOpen ? text('mobileMenuClose') : text('mobileMenuOpen')}
              aria-expanded={menuOpen}
              aria-controls="primary-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
            {account ? (
              <button
                className="mobile-account-link header-logout-icon"
                type="button"
                aria-label={text(loggingOut ? 'signingOut' : 'signOut')}
                title={text(loggingOut ? 'signingOut' : 'signOut')}
                disabled={loggingOut}
                onClick={logout}
              >
                <LogOut size={21} aria-hidden="true" />
              </button>
            ) : (
              <Link
                className="mobile-account-link"
                to={accountDestination}
                state={{ from: '/account' }}
                aria-label={text('signIn')}
                onClick={closeNavigation}
              >
                <LogIn size={21} aria-hidden="true" />
              </Link>
            )}
          </div>

          <nav
            className={`primary-navigation${menuOpen ? ' is-open' : ''}`}
            id="primary-navigation"
            aria-label={text('primaryNavigation')}
            ref={navigationRef}
          >
            <NavLink to="/" end onClick={closeNavigation}>{text('home')}</NavLink>
            <Link to="/#latest-listings" onClick={closeNavigation}>{text('allPropertiesNav')}</Link>
            {listingMenu('rent')}
            {listingMenu('buy')}
            <NavLink to="/about" onClick={closeNavigation}>{text('aboutUs')}</NavLink>
            <NavLink to="/contact" onClick={closeNavigation}>{text('contactUs')}</NavLink>
            <NavLink to="/property-management" onClick={closeNavigation}>{text('propertyManagement')}</NavLink>
            {account?.role !== 'administrator' && (
              <Link
                className="button button-small button-primary header-cta"
                to={addPropertyTarget}
                state={account ? undefined : { from: '/submissions/new' }}
                onClick={closeNavigation}
                aria-label={text('addYourProperty')}
              >
                {text('addYourProperty')}
              </Link>
            )}
            {hasBrokerageContact && (
              <section className="mobile-menu-contact" aria-label={text('agentContactTitle')}>
                <h2>{text('agentContactTitle')}</h2>
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} onClick={closeNavigation}>
                    <Phone size={16} aria-hidden="true" />
                    <span><small>{text('contactByPhone')}</small><strong>{contact.phone}</strong></span>
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} onClick={closeNavigation}>
                    <Mail size={16} aria-hidden="true" />
                    <span><small>{text('contactByEmail')}</small><strong>{contact.email}</strong></span>
                  </a>
                )}
              </section>
            )}
          </nav>

          <div className={`header-actions${menuOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="language-toggle"
              onClick={() => onLocaleChange(locale === 'en' ? 'am' : 'en')}
              aria-label={locale === 'en' ? text('switchLocale') : text('switchLocaleToEnglish')}
            >
              {text('localeName')}
            </button>
            {authLoading ? (
              <span className="header-account-check">{text('loadingAccount')}</span>
            ) : account ? (
              <>
                {canAccessDashboard && (
                  <Link className="header-sign-in" to="/dashboard" onClick={closeNavigation}>{text('dashboardTitle')}</Link>
                )}
                {!isAdministrator && (
                  <Link className="header-sign-in" to="/account" onClick={closeNavigation}>{text('myAccount')}</Link>
                )}
                {account.role !== 'agent' && account.role !== 'administrator' && (
                  <Link className="header-sign-in" to="/my-submissions" onClick={closeNavigation}>{text('mySubmissions')}</Link>
                )}
                {account.role !== 'agent' && account.role !== 'administrator' && (
                  <Link className="header-sign-in" to="/viewing-requests" onClick={closeNavigation}>
                    {text('yourViewingRequests')}
                  </Link>
                )}
                <button
                  className="header-sign-in header-logout header-logout-icon"
                  type="button"
                  aria-label={text(loggingOut ? 'signingOut' : 'signOut')}
                  title={text(loggingOut ? 'signingOut' : 'signOut')}
                  disabled={loggingOut}
                  onClick={logout}
                >
                  <LogOut size={20} aria-hidden="true" />
                </button>
              </>
            ) : (
              <Link
                className="header-sign-in header-account-icon"
                to="/login"
                state={{ from: '/account' }}
                aria-label={text('signIn')}
                title={text('signIn')}
                onClick={closeNavigation}
              >
                <LogIn size={20} aria-hidden="true" />
              </Link>
            )}
            {canManageListings && (
              <Link className="button button-small button-primary" to="/management/listings" onClick={closeNavigation}>
                {text('managerListings')}
              </Link>
            )}
            {logoutError && <span className="header-action-error" role="alert">{logoutError}</span>}
            {preferenceError && <span className="header-action-error" role="alert">{preferenceError}</span>}
          </div>
        </div>
      </header>
    </>
  );
}
