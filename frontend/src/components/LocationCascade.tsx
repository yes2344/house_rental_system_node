import { useEffect, useState } from 'react';

import { getManagedLocations } from '../api/management';
import { getLocations, type MarketplaceLocation } from '../api/properties';
import type { Locale, MessageKey } from '../i18n';

interface LocationCascadeProps {
  value: string;
  locale: Locale;
  onChange: (locationId: string) => void;
  text: (key: MessageKey) => string;
  required?: boolean;
  management?: boolean;
  fixedCityId?: number | null;
}

const locationTypeMessages: Record<string, MessageKey> = {
  country: 'locationCountry',
  region: 'locationRegion',
  city_administration: 'locationCityAdministration',
  city: 'locationCity',
  subcity: 'locationSubcity',
  woreda: 'locationWoreda',
  neighborhood: 'locationNeighborhood',
};

export function LocationCascade({
  value,
  locale,
  onChange,
  text,
  required = false,
  management = false,
  fixedCityId = null,
}: LocationCascadeProps) {
  const [locations, setLocations] = useState<MarketplaceLocation[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const cityFirst = true;

  useEffect(() => {
    const controller = new AbortController();
    void (management
      ? getManagedLocations(controller.signal)
      : getLocations(undefined, controller.signal, true))
      .then(setLocations)
      .catch(() => {
        if (!controller.signal.aborted) setError('Administrative locations could not be loaded.');
      });
    return () => controller.abort();
  }, [management]);

  useEffect(() => {
    const selectedId = Number(value);
    if (locations.length === 0) return;
    if (!Number.isInteger(selectedId) || selectedId < 1) {
      setSelectedIds(fixedCityId ? [fixedCityId] : []);
      return;
    }
    const byId = new Map(locations.map((location) => [location.id, location]));
    const path: number[] = [];
    let current: MarketplaceLocation | undefined = byId.get(selectedId);
    while (current) {
      path.unshift(current.id);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
    setSelectedIds(path);
  }, [fixedCityId, locations, value]);

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const selectedCityIndex = selectedIds.findIndex((id) => {
    const type = locationById.get(id)?.location_type;
    return type === 'city' || type === 'city_administration';
  });
  const selectedCityId = selectedCityIndex < 0 ? undefined : selectedIds[selectedCityIndex];
  const selectedCity = selectedCityId === undefined ? undefined : locationById.get(selectedCityId);
  const requiresSubcity = cityFirst && selectedCity?.location_type === 'city_administration';
  const cityOptions = locations.filter((location) => (
    (location.location_type === 'city' || location.location_type === 'city_administration')
    && (fixedCityId === null || location.id === fixedCityId)
    && (location.is_active || location.id === selectedCityId)
  ));
  const levels: { options: MarketplaceLocation[]; selectedId?: number }[] = [];
  if (cityFirst) {
    if (cityOptions.length > 0) {
      levels.push({ options: cityOptions, selectedId: selectedCityId });
    }

    let parentId = selectedCityId ?? null;
    let selectedPathIndex = selectedCityIndex;
    for (let level = 0; level < 7 && parentId !== null; level += 1) {
      const selectedAtLevel = selectedPathIndex < 0 ? undefined : selectedIds[selectedPathIndex + 1];
      const options = locations.filter(
        (location) => location.parent_id === parentId
          && !(level === 0 && requiresSubcity && location.location_type !== 'subcity')
          && (location.is_active || location.id === selectedAtLevel),
      );
      if (options.length === 0) break;
      levels.push({ options, selectedId: selectedAtLevel });
      parentId = selectedAtLevel ?? null;
      selectedPathIndex += 1;
    }
  } else {
    let parentId: number | null = null;
    for (let level = 0; level < 8; level += 1) {
      const selectedAtLevel = selectedIds[level];
      const options = locations.filter(
        (location) => location.parent_id === parentId
          && (location.is_active || location.id === selectedAtLevel),
      );
      if (options.length === 0) break;
      levels.push({ options, selectedId: selectedAtLevel });
      parentId = selectedAtLevel ?? null;
      if (parentId === null) break;
    }
  }

  const choose = (level: number, rawValue: string) => {
    const selectedLocation = rawValue ? locationById.get(Number(rawValue)) : undefined;
    let nextIds: number[];
    if (!cityFirst) {
      nextIds = selectedIds.slice(0, level);
      if (selectedLocation) nextIds.push(selectedLocation.id);
    } else if (level === 0) {
      nextIds = [];
      let current = selectedLocation;
      while (current) {
        nextIds.unshift(current.id);
        current = current.parent_id === null ? undefined : locationById.get(current.parent_id);
      }
    } else {
      const cityPathIndex = selectedIds.findIndex((id) => {
        const type = locationById.get(id)?.location_type;
        return type === 'city' || type === 'city_administration';
      });
      nextIds = selectedIds.slice(0, cityPathIndex + level);
      if (selectedLocation) nextIds.push(selectedLocation.id);
    }
    setSelectedIds(nextIds);
    onChange(nextIds.length ? String(nextIds[nextIds.length - 1]) : '');
  };

  return (
    <fieldset className="location-cascade">
      <legend>{text('locationCityAndArea')}</legend>
      <div className="filter-two-columns">
        {levels.map(({ options, selectedId }, level) => (
          <label className="filter-label" key={level}>
            {text(locationTypeMessages[cityFirst && level === 0 ? 'city' : options[0]?.location_type] ?? 'administrativeLocation')}
            <select
              className="filter-select"
              value={selectedId ?? ''}
              disabled={(fixedCityId !== null && level === 0) || options.every((location) => !location.is_active)}
              required={required && (!cityFirst || level === 0 || (requiresSubcity && level === 1))}
              onChange={(event) => choose(level, event.target.value)}
            >
              <option value="">{text('selectOption')}</option>
              {options.map((location) => (
                <option
                  key={location.id}
                  value={location.id}
                  disabled={!location.is_active && selectedIds[level] !== location.id}
                >
                  {locale === 'am' && location.name_am ? location.name_am : location.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {required && requiresSubcity && levels.length === 1 && (
        <small role="alert">{text('locationSubcityRequired')}</small>
      )}
      {error && <small role="alert">{text('locationLoadError')}</small>}
      {!error && locations.length === 0 && <small>{text('locationOptionsEmpty')}</small>}
    </fieldset>
  );
}
