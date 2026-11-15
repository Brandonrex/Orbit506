import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Polygon } from 'geojson';
import { firstValueFrom, type Observable } from 'rxjs';

import type { PropertyPatch, SavedProperty } from '../models';

const BASE = '/api/properties';

/** Why the API rejected a geometry (HTTP 422), or a transport failure. */
export type ApiErrorReason = 'self-intersection' | 'invalid' | 'not-found' | 'offline' | 'no-proxy' | 'unknown';

export class ApiError extends Error {
  constructor(
    readonly reason: ApiErrorReason,
    message: string,
  ) {
    super(message);
  }
}

/** Thin wrapper over the FastAPI endpoints in api/app/main.py. */
@Injectable({ providedIn: 'root' })
export class PropertyApiService {
  private readonly http = inject(HttpClient);

  async list(): Promise<SavedProperty[]> {
    const list = await call(this.http.get<SavedProperty[]>(BASE));
    if (!Array.isArray(list)) {
      // Something other than the API answered (e.g. the dev server's index.html).
      throw new ApiError('no-proxy', 'Unexpected response from /api/properties');
    }
    return list;
  }

  create(body: { name: string; notes?: string; geometry: Polygon }): Promise<SavedProperty> {
    return call(this.http.post<SavedProperty>(BASE, body));
  }

  update(id: number, patch: PropertyPatch): Promise<SavedProperty> {
    return call(this.http.patch<SavedProperty>(`${BASE}/${id}`, patch));
  }

  remove(id: number): Promise<void> {
    return call(this.http.delete<void>(`${BASE}/${id}`));
  }
}

async function call<T>(obs: Observable<T>): Promise<T> {
  try {
    return await firstValueFrom(obs);
  } catch (err) {
    throw toApiError(err);
  }
}

function toApiError(err: unknown): ApiError {
  if (!(err instanceof HttpErrorResponse)) {
    return new ApiError('unknown', String(err));
  }
  // 0 = no connection; 502/504 = the dev proxy could not reach the API.
  if (err.status === 0 || err.status === 502 || err.status === 504) {
    return new ApiError('offline', err.message);
  }
  // An HTML page instead of JSON: the dev server is not proxying /api (started without
  // proxy.conf.json, e.g. before it existed). Restarting `npm start` fixes it.
  // (The fetch backend only reports a bare SyntaxError there, so check the content type.)
  if (err.headers?.get('content-type')?.includes('text/html')) {
    return new ApiError('no-proxy', err.message);
  }
  if (err.status === 404) {
    return new ApiError('not-found', err.message);
  }
  const reason = (err.error as { detail?: { reason?: string } } | null)?.detail?.reason;
  if (err.status === 422 && (reason === 'self-intersection' || reason === 'invalid')) {
    return new ApiError(reason, err.message);
  }
  return new ApiError('unknown', err.message);
}
