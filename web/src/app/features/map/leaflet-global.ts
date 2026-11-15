/**
 * Leaflet-Geoman's bundle patches a *global* `L`. We expose the bundled Leaflet module as
 * `globalThis.L` here, and import this file before '@geoman-io/leaflet-geoman-free' (see leaflet.ts),
 * so the app and Geoman share the same Leaflet classes.
 */
import L from 'leaflet';

(globalThis as unknown as { L: typeof L }).L = L;

export default L;
