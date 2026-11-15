import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Polygon } from 'geojson';

import type { SavedProperty } from '../models';
import { ApiError, PropertyApiService } from './property-api.service';
import { PropertyService } from './property.service';

const square = (x: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 9.86],
      [x + 0.01, 9.86],
      [x + 0.01, 9.87],
      [x, 9.87],
      [x, 9.86],
    ],
  ],
});

const saved = (id: number, name = `P${id}`): SavedProperty => ({
  id,
  name,
  notes: '',
  geometry: square(-83.9 + id / 100),
  areaM2: 1_213_184,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

/** Lets pending promise continuations run (the store awaits firstValueFrom). */
const flush = () => new Promise(r => setTimeout(r));

describe('PropertyService', () => {
  let store: PropertyService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    store = TestBed.inject(PropertyService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loadWith(list: SavedProperty[]): Promise<void> {
    const done = store.load();
    http.expectOne('/api/properties').flush(list);
    await done;
  }

  it('loads properties and selects the first one', async () => {
    await loadWith([saved(1), saved(2)]);
    expect(store.status()).toBe('ready');
    expect(store.properties().map(p => p.id)).toEqual([1, 2]);
    expect(store.activeId()).toBe(1);
    expect(store.feature()?.geometry).toBe(store.properties()[0].geometry);
  });

  it('migrates the legacy localStorage polygon once', async () => {
    localStorage.setItem('adaptive-farming.property.v1', JSON.stringify({ type: 'Feature', properties: {}, geometry: square(-83.9) }));
    const done = store.load();
    http.expectOne('/api/properties').flush([]);
    await flush();
    const req = http.expectOne(r => r.method === 'POST');
    expect(req.request.body.name).toBe('My property');
    req.flush(saved(7, 'My property'));
    await done;
    expect(store.activeId()).toBe(7);
    expect(localStorage.getItem('adaptive-farming.property.v1')).toBeNull();
  });

  it('creates a property and selects it', async () => {
    await loadWith([saved(1)]);
    const done = store.create({ type: 'Feature', properties: {}, geometry: square(-83.8) });
    const req = http.expectOne(r => r.method === 'POST');
    expect(req.request.body.name).toBe('Property 2');
    req.flush(saved(2, 'Property 2'));
    await done;
    expect(store.activeId()).toBe(2);
    expect(store.properties()).toHaveLength(2);
  });

  it('rejects a self-intersecting polygon without calling the API', async () => {
    await loadWith([]);
    const bowtie: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-83.92, 9.86],
          [-83.91, 9.87],
          [-83.91, 9.86],
          [-83.92, 9.87],
          [-83.92, 9.86],
        ],
      ],
    };
    expect(await store.create({ type: 'Feature', properties: {}, geometry: bowtie })).toBeNull();
  });

  it('keeps the local geometry object on success and rolls back on failure', async () => {
    await loadWith([saved(1)]);
    const original = store.properties()[0].geometry;
    const edited = square(-83.85);

    let done = store.updateGeometry(1, edited);
    expect(store.feature()?.geometry).toBe(edited); // optimistic
    http.expectOne('/api/properties/1').flush({ ...saved(1), geometry: square(-83.85), areaM2: 42 });
    await done;
    expect(store.properties()[0].geometry).toBe(edited); // not replaced by the server copy
    expect(store.properties()[0].areaM2).toBe(42);

    done = store.updateGeometry(1, square(-83.5));
    http.expectOne('/api/properties/1').flush('boom', { status: 500, statusText: 'Server Error' });
    await done;
    expect(store.properties()[0].geometry).toBe(edited);
    expect(original).not.toBe(edited);
  });

  it('removing the active property selects its neighbour', async () => {
    await loadWith([saved(1), saved(2), saved(3)]);
    store.select(2);
    const done = store.remove(2);
    expect(store.activeId()).toBe(3);
    http.expectOne('/api/properties/2').flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(store.properties().map(p => p.id)).toEqual([1, 3]);
  });

  it('reports a missing dev proxy (HTML instead of JSON) as no-proxy', async () => {
    const api = TestBed.inject(PropertyApiService);
    const html = { 'content-type': 'text/html' };

    // GET: the dev server answers index.html with 200 (the fetch backend fails parsing it).
    let pending = api.list().catch((e: unknown) => e);
    http
      .expectOne('/api/properties')
      .error(new ProgressEvent('parse'), { status: 200, statusText: 'OK', headers: html });
    expect(((await pending) as ApiError).reason).toBe('no-proxy');

    // POST: the dev server answers 404 with an HTML page.
    pending = api.create({ name: 'A', geometry: square(-83.9) }).catch((e: unknown) => e);
    http.expectOne(r => r.method === 'POST').flush('<!doctype html>', { status: 404, statusText: 'Not Found', headers: html });
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).reason).toBe('no-proxy');
  });

  it('parses every polygon of a GeoJSON file with names', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Lote A' }, geometry: square(-83.9) },
        {
          type: 'Feature',
          properties: { nombre: 'Lote B' },
          geometry: { type: 'MultiPolygon', coordinates: [square(-83.8).coordinates, square(-83.7).coordinates] },
        },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-83.9, 9.8] } },
      ],
    };
    const parsed = store.parseGeoJson(JSON.stringify(fc));
    expect(parsed.map(p => p.name)).toEqual(['Lote A', 'Lote B (1)', 'Lote B (2)']);
    expect(store.parseGeoJson('not json')).toEqual([]);
  });
});
