import { useState } from 'react';
import { Accessibility, Globe2, Monitor, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  type DensityPreference,
  type LocalePreference,
  type ThemePreference,
} from '../api/preferences';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import { usePreferences } from '../PreferencesContext';
import type { MessageKey } from '../i18n';

interface SettingsPageProps {
  text: (key: MessageKey) => string;
}

export function SettingsPage({ text }: SettingsPageProps) {
  const { account } = useAuth();
  const {
    preferences,
    preferencesLoading,
    preferencesError,
    savePreferences,
    resetPreferences,
  } = usePreferences();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const update = async (updates: Parameters<typeof savePreferences>[0]) => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await savePreferences(updates);
      setSaved(true);
    } catch (saveError: unknown) {
      setError(`${text('settingsSaveError')} ${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await resetPreferences();
      setSaved(true);
    } catch (resetError: unknown) {
      setError(`${text('settingsResetError')} ${getErrorMessage(resetError)}`);
    } finally {
      setSaving(false);
    }
  };

  const chooseTheme = (value: string) => {
    if (value === 'light' || value === 'dark' || value === 'system') {
      void update({ theme: value as ThemePreference });
    }
  };

  const chooseLocale = (value: string) => {
    if (value === 'en' || value === 'am') {
      void update({ locale: value as LocalePreference });
    }
  };

  const chooseDensity = (value: string) => {
    if (value === 'comfortable' || value === 'compact') {
      void update({ density: value as DensityPreference });
    }
  };

  return (
    <main id="main-content" className="settings-page">
      <section className="customer-heading">
        <div className="container">
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('settingsEyebrow')}</p>
          <h1>{text('settingsTitle')}</h1>
          <p>{account ? text('settingsAccountDescription') : text('settingsGuestDescription')}</p>
        </div>
      </section>

      <section className="container settings-content" aria-busy={preferencesLoading || saving}>
        {preferencesLoading && (
          <p className="settings-notice" role="status">{text('settingsLoading')}</p>
        )}
        {(error || preferencesError) && (
          <p className="settings-message is-error" role="alert">
            {error || `${text('settingsLoadError')} ${preferencesError}`}
          </p>
        )}
        {saved && <p className="settings-message is-success" role="status">{text('settingsSaved')}</p>}

        <section className="settings-panel" aria-labelledby="settings-appearance-heading">
          <div className="settings-panel-heading">
            <span className="settings-icon"><Monitor size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="settings-appearance-heading">{text('settingsAppearanceTitle')}</h2>
              <p>{text('settingsAppearanceDescription')}</p>
            </div>
          </div>
          <label className="settings-control" htmlFor="settings-theme">
            <span><strong>{text('settingsTheme')}</strong><small>{text('settingsThemeDescription')}</small></span>
            <select
              id="settings-theme"
              value={preferences.theme}
              disabled={saving || preferencesLoading}
              onChange={(event) => chooseTheme(event.currentTarget.value)}
            >
              <option value="light">{text('settingsThemeLight')}</option>
              <option value="dark">{text('settingsThemeDark')}</option>
              <option value="system">{text('settingsThemeSystem')}</option>
            </select>
          </label>
          <label className="settings-control" htmlFor="settings-density">
            <span><strong>{text('settingsDensity')}</strong><small>{text('settingsDensityDescription')}</small></span>
            <select
              id="settings-density"
              value={preferences.density}
              disabled={saving || preferencesLoading}
              onChange={(event) => chooseDensity(event.currentTarget.value)}
            >
              <option value="comfortable">{text('settingsDensityComfortable')}</option>
              <option value="compact">{text('settingsDensityCompact')}</option>
            </select>
          </label>
        </section>

        <section className="settings-panel" aria-labelledby="settings-language-heading">
          <div className="settings-panel-heading">
            <span className="settings-icon"><Globe2 size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="settings-language-heading">{text('settingsLanguageTitle')}</h2>
              <p>{text('settingsLanguageDescription')}</p>
            </div>
          </div>
          <label className="settings-control" htmlFor="settings-language">
            <span><strong>{text('settingsLanguage')}</strong><small>{text('settingsLanguageHint')}</small></span>
            <select
              id="settings-language"
              value={preferences.locale}
              disabled={saving || preferencesLoading}
              onChange={(event) => chooseLocale(event.currentTarget.value)}
            >
              <option value="en">{text('settingsEnglish')}</option>
              <option value="am">{text('settingsAmharic')}</option>
            </select>
          </label>
        </section>

        <section className="settings-panel" aria-labelledby="settings-accessibility-heading">
          <div className="settings-panel-heading">
            <span className="settings-icon"><Accessibility size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="settings-accessibility-heading">{text('settingsAccessibilityTitle')}</h2>
              <p>{text('settingsAccessibilityDescription')}</p>
            </div>
          </div>
          <label className="settings-toggle" htmlFor="settings-reduced-motion">
            <span><strong>{text('settingsReducedMotion')}</strong><small>{text('settingsReducedMotionDescription')}</small></span>
            <input
              id="settings-reduced-motion"
              type="checkbox"
              checked={preferences.reduced_motion}
              disabled={saving || preferencesLoading}
              onChange={(event) => void update({ reduced_motion: event.currentTarget.checked })}
            />
          </label>
        </section>

        {account && (
          <section className="settings-panel" aria-labelledby="settings-account-heading">
            <div className="settings-panel-heading">
              <span className="settings-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
              <div>
                <h2 id="settings-account-heading">{text('settingsAccountSecurityTitle')}</h2>
                <p>{text('settingsAccountSecurityDescription')}</p>
              </div>
            </div>
            <div className="settings-account-actions">
              <Link className="button button-outline" to="/account">{text('settingsProfileLink')}</Link>
              <span>{text('settingsSecurityLimit')}</span>
            </div>
          </section>
        )}

        <div className="settings-footer">
          <p>{account ? text('settingsSavedToAccount') : text('settingsSavedToBrowser')}</p>
          <button
            className="button button-outline"
            type="button"
            disabled={saving || preferencesLoading}
            onClick={() => void reset()}
          >
            <RotateCcw size={15} aria-hidden="true" />{text('settingsReset')}
          </button>
        </div>
      </section>
    </main>
  );
}
