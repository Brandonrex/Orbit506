import { area, centroid } from '@turf/turf';
import type { Polygon } from 'geojson';

import { M2_PER_HECTARE, M2_PER_MANZANA } from '../config/basemaps';
import { nearestPlace } from '../config/places';
import { STRINGS } from '../i18n/strings';
import { fmt } from '../services/analysis.service';

/** "Near Pacayas, Cartago" for a land boundary, or its center coordinates when no town is close. */
export function landLocation(geometry: Polygon): string {
  const [lng, lat] = centroid({ type: 'Feature', properties: {}, geometry }).geometry.coordinates;
  const place = nearestPlace(lat, lng);
  return place ? STRINGS.lands.near(place.label.replace(/, Costa Rica$/, '')) : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** "12.40 ha · 17.75 mz" (Turf area, same as the dashboard). */
export function landArea(geometry: Polygon): string {
  const m2 = area({ type: 'Feature', properties: {}, geometry });
  return `${fmt(m2 / M2_PER_HECTARE, 2)} ${STRINGS.units.ha} · ${fmt(m2 / M2_PER_MANZANA, 2)} ${STRINGS.units.mz}`;
}
