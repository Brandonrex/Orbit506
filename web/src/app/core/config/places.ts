/**
 * Small offline gazetteer for the data area (Cartago, Costa Rica). Used by the location search in
 * the "Add land" dialog and to label a land by its nearest town. Coordinates are town centers.
 */
export interface Place {
  label: string;
  /** Short name used in "Near …" labels. */
  short: string;
  lat: number;
  lng: number;
}

export const CARTAGO_CENTER = { lat: 9.86444, lng: -83.91944 };

export const PLACES: Place[] = [
  { label: 'Cartago, Costa Rica', short: 'Cartago', ...CARTAGO_CENTER },
  { label: 'Pacayas, Cartago, Costa Rica', short: 'Pacayas', lat: 9.9166, lng: -83.8079 },
  { label: 'Tierra Blanca, Cartago, Costa Rica', short: 'Tierra Blanca', lat: 9.9158, lng: -83.893 },
  { label: 'Cervantes, Cartago, Costa Rica', short: 'Cervantes', lat: 9.8843, lng: -83.8178 },
  { label: 'Cot, Cartago, Costa Rica', short: 'Cot', lat: 9.893, lng: -83.873 },
  { label: 'San Rafael de Oreamuno, Cartago, Costa Rica', short: 'San Rafael de Oreamuno', lat: 9.874, lng: -83.903 },
  { label: 'Paraíso, Cartago, Costa Rica', short: 'Paraíso', lat: 9.8383, lng: -83.8656 },
  { label: 'Orosi, Cartago, Costa Rica', short: 'Orosi', lat: 9.796, lng: -83.854 },
  { label: 'Tejar, El Guarco, Cartago, Costa Rica', short: 'Tejar', lat: 9.846, lng: -83.942 },
  { label: 'Tres Ríos, La Unión, Cartago, Costa Rica', short: 'Tres Ríos', lat: 9.905, lng: -83.987 },
  { label: 'Juan Viñas, Cartago, Costa Rica', short: 'Juan Viñas', lat: 9.899, lng: -83.747 },
  { label: 'Turrialba, Cartago, Costa Rica', short: 'Turrialba', lat: 9.9046, lng: -83.6832 },
];

/** Places whose label contains the search term (accent- and case-insensitive). */
export function searchPlaces(term: string): Place[] {
  const t = normalize(term.trim());
  return t ? PLACES.filter(p => normalize(p.label).includes(t)) : PLACES;
}

/** Nearest gazetteer place within `maxKm`, or null. */
export function nearestPlace(lat: number, lng: number, maxKm = 8): Place | null {
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of PLACES) {
    const km = haversineKm(lat, lng, p.lat, p.lng);
    if (km < bestKm) {
      best = p;
      bestKm = km;
    }
  }
  return bestKm <= maxKm ? best : null;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
