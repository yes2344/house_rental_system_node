import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MapPinned, Plus, Save, Trash2, X } from 'lucide-react';

import { getApiFieldErrors, getErrorMessage } from '../api/client';
import { useAuth } from '../AuthContext';
import {
  createManagedLocation,
  deleteManagedLocation,
  getManagedLocations,
  updateManagedLocation,
  type ManagedLocationPayload,
  type ManagedLocationType,
} from '../api/management';
import type { MarketplaceLocation } from '../api/properties';
import type { Locale, MessageKey } from '../i18n';

interface LocationManagementPageProps {
  locale: Locale;
  text: (key: MessageKey) => string;
}

interface LocationFormValues {
  name: string;
  name_am: string;
  location_type: ManagedLocationType;
  parent_id: string;
  is_active: boolean;
  display_order: string;
}

const emptyForm: LocationFormValues = {
  name: '',
  name_am: '',
  location_type: 'city',
  parent_id: '',
  is_active: true,
  display_order: '0',
};

function fromLocation(location: MarketplaceLocation): LocationFormValues {
  return {
    name: location.name,
    name_am: location.name_am,
    location_type: location.location_type,
    parent_id: location.parent_id === null ? '' : String(location.parent_id),
    is_active: location.is_active,
    display_order: String(location.display_order),
  };
}

function toPayload(
  values: LocationFormValues,
  isAgent: boolean,
  isCreating: boolean,
): ManagedLocationPayload {
  const payload: ManagedLocationPayload = {
    name: values.name.trim(),
    name_am: values.name_am.trim(),
    is_active: values.is_active,
    display_order: Number(values.display_order) || 0,
  };
  if (!isAgent && isCreating) {
    payload.location_type = values.location_type;
    if (values.location_type === 'subcity') payload.parent = Number(values.parent_id);
  }
  return payload;
}

export function LocationManagementPage({ locale, text }: LocationManagementPageProps) {
  const { account } = useAuth();
  const isAgent = account?.role === 'agent';
  const managedType: ManagedLocationType = isAgent ? 'subcity' : 'city';
  const [locations, setLocations] = useState<MarketplaceLocation[]>([]);
  const [values, setValues] = useState<LocationFormValues>(() => ({
    ...emptyForm,
    location_type: isAgent ? 'subcity' : 'city',
  }));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const editorRef = useRef<HTMLElement>(null);

  const loadLocations = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setLocations(await getManagedLocations(signal));
      setError('');
    } catch (loadError) {
      if (!signal?.aborted) setError(getErrorMessage(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLocations(controller.signal);
    return () => controller.abort();
  }, [loadLocations]);

  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const editingLocation = editingId === null ? null : locationById.get(editingId) ?? null;
  const selectedParentLocation = locationById.get(Number(values.parent_id));
  const hasActiveEthiopia = !isAgent || locations.some(
    (location) =>
      location.location_type === 'country'
      && location.name.trim().toLocaleLowerCase() === 'ethiopia'
      && location.is_active,
  );
  const parentCityOptions = locations.filter(
    (location) =>
      location.is_active
      && (location.location_type === 'city' || location.location_type === 'city_administration'),
  );
  const canCreateLocation = isAgent
    ? Boolean(account?.assigned_city_id)
    : values.location_type === 'subcity'
      ? parentCityOptions.some((location) => String(location.id) === values.parent_id)
      : hasActiveEthiopia;
  const filteredLocations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return locations.filter((location) => {
      if (!normalizedSearch) return true;
      const parentName = location.parent_id === null ? '' : locationById.get(location.parent_id)?.name ?? '';
      return [location.name, location.name_am, parentName, ...location.aliases_en, ...location.aliases_am]
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    });
  }, [locationById, locations, search]);

  const startEditing = (location: MarketplaceLocation) => {
    setEditingId(location.id);
    setValues(fromLocation(location));
    setFieldErrors({});
    setError('');
    setSuccess('');
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setValues({
      ...emptyForm,
      location_type: managedType,
    });
    setFieldErrors({});
    setError('');
    setSuccess('');
  };

  const updateValue = <K extends keyof LocationFormValues>(key: K, value: LocationFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
    setError('');
    setSuccess('');
  };

  const saveLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingId === null && !canCreateLocation) return;
    setSaving(true);
    setError('');
    setSuccess('');
    setFieldErrors({});
    try {
      if (editingId === null) {
        await createManagedLocation(toPayload(values, isAgent, true));
      } else {
        await updateManagedLocation(editingId, toPayload(values, isAgent, false));
      }
      setLocations(await getManagedLocations());
      resetForm();
      setSuccess(text(editingId === null ? 'locationCreated' : 'locationUpdated'));
    } catch (saveError) {
      setError(getErrorMessage(saveError));
      setFieldErrors(getApiFieldErrors(saveError));
    } finally {
      setSaving(false);
    }
  };

  const removeLocation = async (location: MarketplaceLocation) => {
    if (!window.confirm(text('confirmLocationDelete'))) return;
    setDeletingId(location.id);
    setError('');
    setSuccess('');
    try {
      await deleteManagedLocation(location.id);
      setLocations((current) => current.filter((item) => item.id !== location.id));
      if (editingId === location.id) resetForm();
      setSuccess(text('locationDeleted'));
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const localizedLocationType = (type: string) => text(
    ({
      country: 'locationCountry',
      region: 'locationRegion',
      city_administration: 'locationCityAdministration',
      city: 'locationCity',
      subcity: 'locationSubcity',
      woreda: 'locationWoreda',
      neighborhood: 'locationNeighborhood',
    } as Record<string, MessageKey>)[type] ?? 'administrativeLocation',
  );

  return (
    <main className="manager-page location-management-page" id="main-content">
      <header className="manager-page-header">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerContactSettings')}</p>
          <h1>{text('locationManagementTitle')}</h1>
          <p>{text('locationManagementDescription')}</p>
        </div>
      </header>

      <div className="location-management-grid">
        <section ref={editorRef} className="manager-panel location-editor">
          <div className="manager-panel-heading">
            <h2>
              {editingLocation
                ? `${text('editLocation')}: ${editingLocation.name}`
                : text('addLocation')}
            </h2>
            {editingId !== null && (
              <button className="button button-secondary" type="button" onClick={resetForm}>
                <X size={15} aria-hidden="true" />{text('cancelEdit')}
              </button>
            )}
          </div>
          <form className="manager-form-grid" onSubmit={saveLocation}>
            <label className="filter-label">{text('locationName')}
              <input className="filter-input" required maxLength={120} value={values.name} onChange={(event) => updateValue('name', event.target.value)} />
              {fieldErrors.name && <small role="alert">{fieldErrors.name}</small>}
            </label>
            <label className="filter-label">{text('locationNameAm')}
              <input className="filter-input" maxLength={120} value={values.name_am} onChange={(event) => updateValue('name_am', event.target.value)} />
              {fieldErrors.name_am && <small role="alert">{fieldErrors.name_am}</small>}
            </label>
            {isAgent || editingId !== null ? (
              <div className="filter-label">
                {text('locationLevelFixed')}
                <div className="location-level-fixed" aria-live="polite">
                  <strong>{localizedLocationType(isAgent ? managedType : values.location_type)}</strong>
                  {isAgent && (
                    <small>
                      {locale === 'am'
                        ? account?.assigned_city_name_am ?? account?.assigned_city_name ?? text('assignedCity')
                        : account?.assigned_city_name ?? text('assignedCity')}
                    </small>
                  )}
                </div>
              </div>
            ) : (
              <label className="filter-label">{text('locationType')}
                <select
                  className="filter-select"
                  value={values.location_type}
                  onChange={(event) => {
                    const locationType: ManagedLocationType =
                      event.target.value === 'subcity' ? 'subcity' : 'city';
                    setValues((current) => ({
                      ...current,
                      location_type: locationType,
                      parent_id: locationType === 'subcity' ? current.parent_id : '',
                    }));
                    setFieldErrors((current) => ({ ...current, location_type: '', parent: '' }));
                    setError('');
                    setSuccess('');
                  }}
                >
                  <option value="city">{localizedLocationType('city')}</option>
                  <option value="subcity">{localizedLocationType('subcity')}</option>
                </select>
                {fieldErrors.location_type && <small role="alert">{fieldErrors.location_type}</small>}
              </label>
            )}
            {!isAgent && (
              <div className="filter-label">
                {text('locationCountry')}
                <div className="location-level-fixed">
                  <strong>Ethiopia</strong>
                </div>
              </div>
            )}
            {!isAgent && editingId === null && values.location_type === 'city' && !hasActiveEthiopia && (
              <p className="manager-error location-form-message" role="alert">{text('locationCountryMissing')}</p>
            )}
            {!isAgent && values.location_type === 'subcity' && editingId === null && (
              <label className="filter-label">{text('locationParent')}
                <select
                  className="filter-select"
                  required
                  value={values.parent_id}
                  onChange={(event) => updateValue('parent_id', event.target.value)}
                >
                  <option value="">{text('chooseCity')}</option>
                  {parentCityOptions.map((location) => (
                    <option key={location.id} value={location.id}>
                      {locale === 'am' && location.name_am ? location.name_am : location.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.parent && <small role="alert">{fieldErrors.parent}</small>}
              </label>
            )}
            {!isAgent && values.location_type === 'subcity' && editingId !== null && (
              <div className="filter-label">
                {text('locationParent')}
                <div className="location-level-fixed">
                  {locale === 'am' && selectedParentLocation?.name_am
                    ? selectedParentLocation.name_am
                    : selectedParentLocation?.name ?? '—'}
                </div>
              </div>
            )}
            <label className="filter-label">{text('displayOrder')}
              <input
                className="filter-input"
                type="number"
                min="0"
                step="1"
                value={values.display_order}
                onChange={(event) => updateValue('display_order', event.target.value)}
              />
              {fieldErrors.display_order && <small role="alert">{fieldErrors.display_order}</small>}
            </label>
            <label className="location-active-toggle">
              <input type="checkbox" checked={values.is_active} onChange={(event) => updateValue('is_active', event.target.checked)} />
              {text('locationActive')}
            </label>
            {error && <p className="manager-error location-form-message" role="alert">{error}</p>}
            {success && <p className="manager-success location-form-message" role="status">{success}</p>}
            <div className="location-form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={saving || (editingId === null && !canCreateLocation)}
              >
                {editingId === null ? <Plus size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                {saving ? text('savingLocation') : text('saveLocation')}
              </button>
            </div>
          </form>
        </section>

        <section className="manager-panel location-list-panel">
          <div className="manager-panel-heading">
            <h2><MapPinned size={17} aria-hidden="true" />{text('configuredLocations')}</h2>
            <span>{locations.length}</span>
          </div>
          <label className="filter-label location-list-search">{text('searchLocations')}
            <input className="filter-input" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {error && locations.length === 0 && <p className="manager-error" role="alert">{error}</p>}
          {loading ? <p role="status">{text('loadingLocations')}</p> : filteredLocations.length === 0 ? (
            <p className="location-list-empty">{text('locationOptionsEmpty')}</p>
          ) : (
            <div className="location-table-wrap">
              <table className="manager-table location-table">
                <thead><tr>
                  <th>{text('locationName')}</th>
                  <th>{text('locationType')}</th>
                  <th>{text('locationParent')}</th>
                  <th>{text('listingStatus')}</th>
                  <th><span className="sr-only">{text('actions')}</span></th>
                </tr></thead>
                <tbody>
                  {filteredLocations.map((location) => (
                    <tr key={location.id}>
                      <td>
                        <strong>{locale === 'am' && location.name_am ? location.name_am : location.name}</strong>
                        {location.name_am && locale !== 'am' && <small>{location.name_am}</small>}
                      </td>
                      <td>{localizedLocationType(location.location_type)}</td>
                      <td>{location.parent_id === null ? '—' : locationById.get(location.parent_id)?.name ?? '—'}</td>
                      <td><span className={`status-pill ${location.is_active ? 'is-active' : 'is-inactive'}`}>
                        {text(location.is_active ? 'available' : 'statusInactive')}
                      </span></td>
                      <td>
                        {(isAgent
                          ? location.location_type === managedType
                          : location.location_type === 'city' || location.location_type === 'subcity') && (
                          <div className="location-row-actions">
                            <button className="button button-secondary location-edit-button" type="button" onClick={() => startEditing(location)}>
                              {text('editLocation')}
                            </button>
                            <button
                              className="button button-outline"
                              type="button"
                              disabled={deletingId === location.id}
                              onClick={() => void removeLocation(location)}
                            >
                              <Trash2 size={14} aria-hidden="true" />{text('deleteLocation')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <p className="location-management-note">{text('locationManagementNote')}</p>
    </main>
  );
}
