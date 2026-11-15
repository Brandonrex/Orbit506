// Order matters: the global must exist before Geoman's bundle runs.
import L from './leaflet-global';
import '@geoman-io/leaflet-geoman-free';

export { L };
