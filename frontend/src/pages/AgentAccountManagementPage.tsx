import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../AuthContext';
import { getApiFieldErrors, getErrorMessage } from '../api/client';
import {
  createManagedPublicAccount,
  createManagedAgentAccount,
  deleteManagedAgentAccount,
  deleteManagedPublicAccount,
  getManagedPublicAccounts,
  getManagedAgentAccounts,
  updateManagedPublicAccount,
  updateManagedAgentAccount,
  type ManagedAgentAccount,
  type ManagedPublicAccount,
} from '../api/management';
import { getLocationsByTypes, type MarketplaceLocation } from '../api/properties';
import type { MessageKey } from '../i18n';

interface AgentAccountManagementPageProps {
  text: (key: MessageKey) => string;
  mode?: 'agents' | 'public';
}

interface AgentEditValues {
  username: string;
  initial_password: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  is_active: boolean;
  assigned_city_id: string;
  manage_public_settings: boolean;
  review_assigned_submissions: boolean;
}

const emptyEditValues: AgentEditValues = {
  username: '',
  initial_password: '',
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  is_active: true,
  assigned_city_id: '',
  manage_public_settings: false,
  review_assigned_submissions: false,
};

function AgentAccountManagementContent({ text }: AgentAccountManagementPageProps) {
  const { account: currentAccount } = useAuth();
  const isPlatformOwner = Boolean(currentAccount?.is_platform_owner);
  const [accounts, setAccounts] = useState<ManagedAgentAccount[]>([]);
  const [cities, setCities] = useState<MarketplaceLocation[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [assignedCityId, setAssignedCityId] = useState('');
  const [editing, setEditing] = useState<ManagedAgentAccount | null>(null);
  const [editValues, setEditValues] = useState<AgentEditValues>(emptyEditValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getManagedAgentAccounts(controller.signal),
      getLocationsByTypes(['city'], controller.signal),
    ])
      .then(([agentAccounts, configuredCities]) => {
        setAccounts(agentAccounts);
        setCities(configuredCities);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assignedCityId) {
      setFieldErrors({ assigned_city_id: text('selectOption') });
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    setFieldErrors({});
    try {
      const created = await createManagedAgentAccount({
        username: username.trim(),
        password,
        assigned_city_id: Number(assignedCityId),
      });
      setAccounts((current) => [...current, created].sort((a, b) => a.username.localeCompare(b.username)));
      setUsername('');
      setPassword('');
      setAssignedCityId('');
      setSuccess(text('agentCreated'));
    } catch (createError: unknown) {
      setError(getErrorMessage(createError));
      setFieldErrors(getApiFieldErrors(createError));
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (account: ManagedAgentAccount) => {
    setEditing(account);
    setEditValues({
      username: account.username,
      initial_password: '',
      email: account.email,
      first_name: account.first_name,
      last_name: account.last_name,
      phone: account.phone,
      is_active: account.is_active,
      assigned_city_id: account.assigned_city_id === null ? '' : String(account.assigned_city_id),
      manage_public_settings: account.management_permissions.includes('settings.manage'),
      review_assigned_submissions: account.management_permissions.includes('announcements.review_assigned'),
    });
    setError('');
    setSuccess('');
    setFieldErrors({});
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    if (!editValues.assigned_city_id) {
      setFieldErrors({ assigned_city_id: text('selectOption') });
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    setFieldErrors({});
    try {
      const {
        initial_password,
        assigned_city_id,
        manage_public_settings,
        review_assigned_submissions,
        ...accountChanges
      } = editValues;
      const managementPermissions = editing.management_permissions.filter(
        (permission) => permission !== 'settings.manage'
          && permission !== 'announcements.review_assigned',
      );
      const updated = await updateManagedAgentAccount(editing.id, {
        ...accountChanges,
        assigned_city_id: Number(assigned_city_id),
        ...(initial_password ? { initial_password } : {}),
        management_permissions: [
          ...managementPermissions,
          ...(review_assigned_submissions ? ['announcements.review_assigned'] : []),
          ...(isPlatformOwner && manage_public_settings ? ['settings.manage'] : []),
        ],
      });
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditing(null);
      setSuccess(text('agentUpdated'));
    } catch (updateError: unknown) {
      setError(getErrorMessage(updateError));
      setFieldErrors(getApiFieldErrors(updateError));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (account: ManagedAgentAccount) => {
    setError('');
    setSuccess('');
    setUpdatingId(account.id);
    try {
      const updated = await updateManagedAgentAccount(account.id, { is_active: !account.is_active });
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSuccess(text('agentUpdated'));
    } catch (updateError: unknown) {
      setError(getErrorMessage(updateError));
    } finally {
      setUpdatingId(null);
    }
  };

  const removeAccount = async (account: ManagedAgentAccount) => {
    if (!window.confirm(text('confirmAgentDelete'))) return;
    setError('');
    setSuccess('');
    setDeletingId(account.id);
    try {
      await deleteManagedAgentAccount(account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      if (editing?.id === account.id) setEditing(null);
      setSuccess(text('agentDeleted'));
    } catch (deleteError: unknown) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="manager-page" id="main-content">
      <header className="manager-page-header">
        <div>
          <h1>{text('managerAgentAccounts')}</h1>
          <p>{text('agentAccountsDescription')}</p>
        </div>
      </header>

      {error && <p className="manager-error" role="alert">{error}</p>}
      {success && <p className="manager-inline-success" role="status">{success}</p>}

      <section className="manager-panel">
        <h2>{text('createAgentAccount')}</h2>
        <p>{text('agentInitialPasswordHelp')}</p>
        <form className="manager-form-grid" onSubmit={(event) => void createAccount(event)}>
          <label className="filter-label">{text('agentUsername')}
            <input
              className="filter-input"
              required
              maxLength={150}
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            {fieldErrors.username && <small role="alert">{fieldErrors.username}</small>}
          </label>
          <label className="filter-label">{text('initialPassword')}
            <input
              className="filter-input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldErrors.password && <small role="alert">{fieldErrors.password}</small>}
          </label>
          <label className="filter-label">{text('assignedCity')}
            <select
              className="filter-select"
              required
              value={assignedCityId}
              onChange={(event) => {
                setAssignedCityId(event.target.value);
                setFieldErrors((current) => ({ ...current, assigned_city_id: '' }));
              }}
            >
              <option value="">{text('selectOption')}</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
            {fieldErrors.assigned_city_id && <small role="alert">{fieldErrors.assigned_city_id}</small>}
            {cities.length === 0 && <small>{text('locationOptionsEmpty')}</small>}
          </label>
          <div className="location-form-actions">
            <button className="button button-primary" type="submit" disabled={saving || cities.length === 0}>
              {saving ? text('creatingAccount') : text('createAgentAccount')}
            </button>
          </div>
        </form>
      </section>

      {editing && (
        <section className="manager-panel">
          <h2>{text('editAgent')}</h2>
          <form className="manager-form-grid" onSubmit={(event) => void saveEdit(event)}>
            <label className="filter-label">{text('agentUsername')}
              <input
                className="filter-input"
                required
                maxLength={150}
                value={editValues.username}
                onChange={(event) => setEditValues((current) => ({ ...current, username: event.target.value }))}
              />
              {fieldErrors.username && <small role="alert">{fieldErrors.username}</small>}
            </label>
            <label className="filter-label">{text('resetAgentPassword')}
              <input
                className="filter-input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={editValues.initial_password}
                onChange={(event) => setEditValues((current) => ({ ...current, initial_password: event.target.value }))}
              />
              <small>{text('agentPasswordResetHelp')}</small>
              {fieldErrors.initial_password && <small role="alert">{fieldErrors.initial_password}</small>}
            </label>
            <label className="filter-label">{text('assignedCity')}
              <select
                className="filter-select"
                required
                value={editValues.assigned_city_id}
                onChange={(event) => setEditValues((current) => ({ ...current, assigned_city_id: event.target.value }))}
              >
                <option value="">{text('selectOption')}</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>{city.name}</option>
                ))}
              </select>
              {fieldErrors.assigned_city_id && <small role="alert">{fieldErrors.assigned_city_id}</small>}
            </label>
            <label className="filter-label">{text('agentEmail')}
              <input
                className="filter-input"
                type="email"
                maxLength={254}
                value={editValues.email}
                onChange={(event) => setEditValues((current) => ({ ...current, email: event.target.value }))}
              />
              {fieldErrors.email && <small role="alert">{fieldErrors.email}</small>}
            </label>
            <label className="filter-label">{text('agentFirstName')}
              <input
                className="filter-input"
                maxLength={150}
                value={editValues.first_name}
                onChange={(event) => setEditValues((current) => ({ ...current, first_name: event.target.value }))}
              />
              {fieldErrors.first_name && <small role="alert">{fieldErrors.first_name}</small>}
            </label>
            <label className="filter-label">{text('agentLastName')}
              <input
                className="filter-input"
                maxLength={150}
                value={editValues.last_name}
                onChange={(event) => setEditValues((current) => ({ ...current, last_name: event.target.value }))}
              />
              {fieldErrors.last_name && <small role="alert">{fieldErrors.last_name}</small>}
            </label>
            <label className="filter-label">{text('agentPhone')}
              <input
                className="filter-input"
                maxLength={50}
                value={editValues.phone}
                onChange={(event) => setEditValues((current) => ({ ...current, phone: event.target.value }))}
              />
              {fieldErrors.phone && <small role="alert">{fieldErrors.phone}</small>}
            </label>
            <label className="filter-label">
              <input
                type="checkbox"
                checked={editValues.is_active}
                onChange={(event) => setEditValues((current) => ({ ...current, is_active: event.target.checked }))}
              />
              {' '}{text('agentAccountActive')}
            </label>
            {isPlatformOwner && (
              <label className="filter-label">
                <input
                  type="checkbox"
                  checked={editValues.manage_public_settings}
                  onChange={(event) => setEditValues((current) => ({
                    ...current,
                    manage_public_settings: event.target.checked,
                  }))}
                />
                {' '}{text('managePublicSettings')}
                <small>{text('managePublicSettingsHelp')}</small>
              </label>
            )}
            <label className="filter-label">
              <input
                type="checkbox"
                checked={editValues.review_assigned_submissions}
                onChange={(event) => setEditValues((current) => ({
                  ...current,
                  review_assigned_submissions: event.target.checked,
                }))}
              />
              {' '}{text('reviewAssignedSubmissions')}
              <small>{text('reviewAssignedSubmissionsHelp')}</small>
            </label>
            <div className="location-form-actions">
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? text('savingLocation') : text('saveAgent')}
              </button>
              <button className="button button-secondary" type="button" onClick={() => setEditing(null)}>
                {text('cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="manager-panel location-list-panel">
        <div className="manager-panel-heading">
          <h2>{text('configuredAgentAccounts')}</h2>
          <span>{accounts.length}</span>
        </div>
        {loading ? <p role="status">{text('loadingLocations')}</p> : accounts.length === 0 ? (
          <p>{text('agentAccountsEmpty')}</p>
        ) : (
          <div className="location-table-wrap">
            <table className="manager-table">
              <thead>
                <tr>
                  <th>{text('agentUsername')}</th>
                  <th>{text('agentFullName')}</th>
                  <th>{text('agentEmail')}</th>
                  <th>{text('assignedCity')}</th>
                  <th>{text('listingStatus')}</th>
                  <th>{text('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{[account.first_name, account.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>{account.email || '—'}</td>
                    <td>{cities.find((city) => city.id === account.assigned_city_id)?.name ?? '—'}</td>
                    <td>
                      {!account.is_active
                        ? text('statusInactive')
                        : account.agent_onboarding_required
                          ? text('agentSetupPending')
                          : text('agentSetupComplete')}
                    </td>
                    <td>
                      <div className="location-row-actions">
                        <button className="button button-secondary" type="button" onClick={() => beginEdit(account)}>
                          {text('editAgent')}
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={updatingId === account.id}
                          onClick={() => void toggleActive(account)}
                        >
                          {text(account.is_active ? 'deactivateAgent' : 'reactivateAgent')}
                        </button>
                        <button
                          className="button button-outline"
                          type="button"
                          disabled={deletingId === account.id}
                          onClick={() => void removeAccount(account)}
                        >
                          {text('deleteAgent')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

interface PublicAccountFormValues {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  password: string;
  role: ManagedPublicAccount['role'];
}

const emptyPublicAccountForm: PublicAccountFormValues = {
  username: '',
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  password: '',
  role: 'customer',
};

function PublicAccountManagementContent({ text }: AgentAccountManagementPageProps) {
  const [accounts, setAccounts] = useState<ManagedPublicAccount[]>([]);
  const [formValues, setFormValues] = useState<PublicAccountFormValues>(emptyPublicAccountForm);
  const [editing, setEditing] = useState<ManagedPublicAccount | null>(null);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getManagedPublicAccounts(controller.signal)
      .then(setAccounts)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const resetForm = () => {
    setEditing(null);
    setFormValues(emptyPublicAccountForm);
    setPassword('');
    setFieldErrors({});
  };

  const beginEdit = (account: ManagedPublicAccount) => {
    setEditing(account);
    setFormValues({
      username: account.username,
      email: account.email,
      first_name: account.first_name,
      last_name: account.last_name,
      phone: account.phone,
      password: '',
      role: account.role,
    });
    setPassword('');
    setFieldErrors({});
    setError('');
    setSuccess('');
  };

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    setFieldErrors({});
    try {
      const { password: _, ...accountValues } = formValues;
      const saved = editing
        ? await updateManagedPublicAccount(editing.id, {
          ...accountValues,
          ...(password ? { password } : {}),
        })
        : await createManagedPublicAccount({
          ...accountValues,
          password: formValues.password,
        });
      setAccounts((current) => {
        const updated = editing
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [...current, saved];
        return updated.sort((a, b) => a.username.localeCompare(b.username));
      });
      resetForm();
      setSuccess(text(editing ? 'publicAccountUpdated' : 'publicAccountCreated'));
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
      setFieldErrors(getApiFieldErrors(saveError));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (account: ManagedPublicAccount) => {
    setError('');
    setSuccess('');
    setUpdatingId(account.id);
    try {
      const updated = await updateManagedPublicAccount(account.id, { is_active: !account.is_active });
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSuccess(text('publicAccountUpdated'));
    } catch (updateError: unknown) {
      setError(getErrorMessage(updateError));
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteAccount = async (account: ManagedPublicAccount) => {
    if (!window.confirm(text('confirmPublicAccountDelete'))) return;
    setError('');
    setSuccess('');
    setDeletingId(account.id);
    try {
      await deleteManagedPublicAccount(account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      if (editing?.id === account.id) resetForm();
      setSuccess(text('publicAccountDeleted'));
    } catch (deleteError: unknown) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const updateField = <K extends keyof PublicAccountFormValues>(
    key: K,
    value: PublicAccountFormValues[K],
  ) => setFormValues((current) => ({ ...current, [key]: value }));

  return (
    <main className="manager-page" id="main-content">
      <header className="manager-page-header">
        <div>
          <h1>{text('publicAccountManagementTitle')}</h1>
          <p>{text('publicAccountManagementDescription')}</p>
        </div>
      </header>
      {error && <p className="manager-error" role="alert">{error}</p>}
      {success && <p className="manager-inline-success" role="status">{success}</p>}

      <section className="manager-panel">
        <h2>{text(editing ? 'editPublicAccount' : 'createPublicAccount')}</h2>
        <form className="manager-form-grid" onSubmit={(event) => void saveAccount(event)}>
          <label className="filter-label">{text('agentUsername')}
            <input
              className="filter-input"
              required
              maxLength={150}
              autoComplete="username"
              value={formValues.username}
              onChange={(event) => updateField('username', event.target.value)}
            />
            {fieldErrors.username && <small role="alert">{fieldErrors.username}</small>}
          </label>
          <label className="filter-label">{text('agentEmail')}
            <input
              className="filter-input"
              type="email"
              maxLength={254}
              value={formValues.email}
              onChange={(event) => updateField('email', event.target.value)}
            />
            {fieldErrors.email && <small role="alert">{fieldErrors.email}</small>}
          </label>
          <label className="filter-label">{text('agentFirstName')}
            <input
              className="filter-input"
              maxLength={150}
              value={formValues.first_name}
              onChange={(event) => updateField('first_name', event.target.value)}
            />
          </label>
          <label className="filter-label">{text('agentLastName')}
            <input
              className="filter-input"
              maxLength={150}
              value={formValues.last_name}
              onChange={(event) => updateField('last_name', event.target.value)}
            />
          </label>
          <label className="filter-label">{text('agentPhone')}
            <input
              className="filter-input"
              maxLength={50}
              value={formValues.phone}
              onChange={(event) => updateField('phone', event.target.value)}
            />
            {fieldErrors.phone && <small role="alert">{fieldErrors.phone}</small>}
          </label>
          <label className="filter-label">{text('publicAccountRole')}
            <select
              className="filter-select"
              value={formValues.role}
              onChange={(event) => updateField(
                'role',
                event.target.value === 'owner' ? 'owner' : 'customer',
              )}
            >
              <option value="customer">{text('roleCustomer')}</option>
              <option value="owner">{text('roleOwner')}</option>
            </select>
            {fieldErrors.role && <small role="alert">{fieldErrors.role}</small>}
          </label>
          <label className="filter-label">{text(editing ? 'resetAgentPassword' : 'initialPassword')}
            <input
              className="filter-input"
              type="password"
              required={!editing}
              minLength={8}
              autoComplete="new-password"
              value={editing ? password : formValues.password}
              onChange={(event) => editing
                ? setPassword(event.target.value)
                : updateField('password', event.target.value)}
            />
            {editing && <small>{text('publicAccountPasswordHelp')}</small>}
            {fieldErrors.password && <small role="alert">{fieldErrors.password}</small>}
          </label>
          <div className="location-form-actions">
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? text('savingLocation') : text(editing ? 'savePublicAccount' : 'createPublicAccount')}
            </button>
            {editing && (
              <button className="button button-secondary" type="button" onClick={resetForm}>
                {text('cancel')}
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="manager-panel location-list-panel">
        <div className="manager-panel-heading">
          <h2>{text('publicAccountListTitle')}</h2>
          <span>{accounts.length}</span>
        </div>
        {loading ? <p role="status">{text('loadingLocations')}</p> : accounts.length === 0 ? (
          <p>{text('publicAccountsEmpty')}</p>
        ) : (
          <div className="location-table-wrap">
            <table className="manager-table">
              <thead>
                <tr>
                  <th>{text('agentUsername')}</th>
                  <th>{text('agentFullName')}</th>
                  <th>{text('agentEmail')}</th>
                  <th>{text('publicAccountRole')}</th>
                  <th>{text('listingStatus')}</th>
                  <th>{text('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{[account.first_name, account.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>{account.email || '—'}</td>
                    <td>{text(account.role === 'owner' ? 'roleOwner' : 'roleCustomer')}</td>
                    <td>{text(account.is_active ? 'statusActive' : 'statusInactive')}</td>
                    <td>
                      <div className="location-row-actions">
                        <button className="button button-secondary" type="button" onClick={() => beginEdit(account)}>
                          {text('editPublicAccount')}
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={updatingId === account.id}
                          onClick={() => void toggleActive(account)}
                        >
                          {text(account.is_active ? 'deactivateAgent' : 'reactivateAgent')}
                        </button>
                        <button
                          className="button button-outline"
                          type="button"
                          disabled={deletingId === account.id}
                          onClick={() => void deleteAccount(account)}
                        >
                          {text('deletePublicAccount')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export function AgentAccountManagementPage(props: AgentAccountManagementPageProps) {
  return props.mode === 'public'
    ? <PublicAccountManagementContent {...props} />
    : <AgentAccountManagementContent {...props} />;
}
