import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  DetailComposite,
  DetailIndex,
  DetailLayer,
  DetailLayerDef,
  DetailPoint,
  DetailScene,
  DetailStat,
  DetailStatus,
} from '../models';
import { PropertyService } from './property.service';

const API = '/api';
const POLL_MS = 3000;

/** 'scene' = one satellite pass (one day); 'month' = monthly median composite. */
export type DetailView = 'scene' | 'month';

/**
 * Sentinel-2 10 m detail of the active land (api/app/detail_api): job status, the days and months
 * available, the selected layer / date, and the per-date stats. The map and the detail panel both
 * read these signals. Saving a land (or its boundary) starts a fetch job on the API; this service
 * polls the job while it runs and reloads the lists when it finishes.
 */
@Injectable({ providedIn: 'root' })
export class DetailService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PropertyService);

  readonly status = signal<DetailStatus | null>(null);
  readonly scenes = signal<DetailScene[]>([]);
  readonly composites = signal<DetailComposite[]>([]);
  /** Stats time series of the selected index (scene view). */
  readonly stats = signal<DetailStat[]>([]);
  readonly defs = signal<DetailLayerDef[]>([]);
  /** True while the API could not be reached for detail data. */
  readonly offline = signal(false);

  /** Draw the 10 m layer over the land on the map. */
  readonly onMap = signal(true);
  readonly view = signal<DetailView>('scene');
  readonly layer = signal<DetailLayer>('ndvi');
  /** Selected day (scene view), 'YYYY-MM-DD'. */
  readonly day = signal<string | null>(null);
  /** Selected month (month view), 'YYYY-MM' or 'latest'. */
  readonly month = signal<string | null>(null);

  readonly pid = computed(() => this.store.activeId());
  readonly job = computed(() => this.status()?.job ?? null);
  readonly running = computed(() => {
    const s = this.job()?.status;
    return s === 'queued' || s === 'running';
  });
  readonly validScenes = computed(() => this.scenes().filter(s => s.status === 'valid'));
  readonly hasData = computed(() => this.validScenes().length > 0);

  /** Months in the month view; 'latest' only carries days since clear. */
  readonly months = computed(() =>
    this.composites().filter(c => (this.layer() === 'days_since_clear' ? true : c.period !== 'latest')),
  );

  readonly period = computed(() => (this.view() === 'scene' ? this.day() : this.month()));
  readonly def = computed(() => this.defs().find(d => d.key === this.layer()) ?? null);
  readonly selectedStat = computed(() => (this.view() === 'scene' ? (this.stats().find(s => s.date === this.day()) ?? null) : null));
  readonly selectedScene = computed(() => this.scenes().find(s => s.date === this.day()) ?? null);

  /** XYZ URL of the 10 m layer to draw, or null when there is nothing to show. */
  readonly tileUrl = computed(() => {
    const pid = this.pid();
    const period = this.period();
    const layer = this.layer();
    if (pid === null || !period) {
      return null;
    }
    const available =
      this.view() === 'scene'
        ? this.selectedScene()?.assets[layer as DetailIndex] !== undefined
        : this.composites().find(c => c.period === period)?.assets[layer] !== undefined;
    if (!available) {
      return null;
    }
    // A reshaped land keeps the same URL; the version keeps the browser from showing cached tiles.
    const v = encodeURIComponent(this.store.active()?.updatedAt ?? '');
    return `${API}/properties/${pid}/detail/tiles/${layer}/${period}/{z}/{x}/{y}.png?v=${v}`;
  });

  private pollTimer?: ReturnType<typeof setTimeout>;
  /** Bumped on every reload so answers for a previous land are dropped. */
  private seq = 0;
  private readonly autoRequested = new Set<number>();

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
    void this.loadDefs();

    // Reload whenever the active land changes or is saved again (a save queues a new job).
    effect(() => {
      const pid = this.pid();
      this.store.active()?.updatedAt;
      untracked(() => this.reload(pid));
    });

    // Stats follow the selected index.
    effect(() => {
      const pid = this.pid();
      const layer = this.layer();
      this.scenes();
      if (pid !== null && layer !== 'days_since_clear') {
        untracked(() => void this.loadStats(pid, layer));
      }
    });
  }

  setView(v: DetailView): void {
    this.view.set(v);
    if (v === 'scene' && this.layer() === 'days_since_clear') {
      this.layer.set('ndvi');
    }
    if (v === 'month' && !this.month()) {
      this.month.set(this.lastMonth());
    }
  }

  setLayer(l: DetailLayer): void {
    this.layer.set(l);
    if (l === 'days_since_clear') {
      this.view.set('month');
      if (!this.month()) {
        this.month.set(this.lastMonth());
      }
    } else if (this.month() === 'latest') {
      this.month.set(this.lastMonth());
    }
  }

  /** Step the selected day / month through the clear ones (-1 = older). */
  step(dir: -1 | 1): void {
    if (this.view() === 'scene') {
      const days = this.validScenes().map(s => s.date);
      const i = days.indexOf(this.day() ?? '');
      const next = days[i < 0 ? days.length - 1 : i + dir];
      if (next) {
        this.day.set(next);
      }
    } else {
      const months = this.months().map(c => c.period);
      const i = months.indexOf(this.month() ?? '');
      const next = months[i < 0 ? months.length - 1 : i + dir];
      if (next) {
        this.month.set(next);
      }
    }
  }

  async refresh(): Promise<void> {
    const pid = this.pid();
    if (pid === null) {
      return;
    }
    try {
      await firstValueFrom(this.http.post(`${API}/properties/${pid}/detail/refresh`, {}));
    } catch {
      this.offline.set(true);
    }
    await this.reload(pid);
  }

  /** Values of every layer at one point of the selected day / month (map click). */
  async inspect(lon: number, lat: number): Promise<DetailPoint | null> {
    const pid = this.pid();
    const period = this.period();
    if (pid === null || !period) {
      return null;
    }
    try {
      return await firstValueFrom(
        this.http.get<DetailPoint>(`${API}/properties/${pid}/detail/point`, { params: { lon, lat, date: period } }),
      );
    } catch {
      return null;
    }
  }

  private async reload(pid: number | null): Promise<void> {
    clearTimeout(this.pollTimer);
    const seq = ++this.seq;
    if (pid === null) {
      this.status.set(null);
      this.scenes.set([]);
      this.composites.set([]);
      this.stats.set([]);
      this.day.set(null);
      this.month.set(null);
      return;
    }
    try {
      const status = await firstValueFrom(this.http.get<DetailStatus>(`${API}/properties/${pid}/detail/status`));
      if (seq !== this.seq) {
        return;
      }
      this.offline.set(false);
      if (status.job === null && !this.autoRequested.has(pid)) {
        // Land saved before the detail layer existed: fetch its imagery the first time it is opened.
        this.autoRequested.add(pid);
        await firstValueFrom(this.http.post(`${API}/properties/${pid}/detail/refresh`, {}));
        return this.reload(pid);
      }
      this.status.set(status);
      // Lists grow while a job runs (one day at a time); they are small, so reload them each poll.
      await this.loadLists(pid, seq);
      if (!this.defs().length) {
        void this.loadDefs();
      }
      if (this.running()) {
        this.pollTimer = setTimeout(() => void this.reload(pid), POLL_MS);
      }
    } catch {
      if (seq === this.seq) {
        this.offline.set(true);
      }
    }
  }

  private async loadLists(pid: number, seq: number): Promise<void> {
    const [scenes, composites] = await Promise.all([
      firstValueFrom(this.http.get<DetailScene[]>(`${API}/properties/${pid}/detail/scenes`)),
      firstValueFrom(this.http.get<DetailComposite[]>(`${API}/properties/${pid}/detail/composites`)),
    ]);
    if (seq !== this.seq) {
      return;
    }
    this.scenes.set(scenes);
    this.composites.set(composites);
    // Keep the selection when it still exists; otherwise jump to the newest clear day / month.
    const valid = scenes.filter(s => s.status === 'valid');
    if (!valid.some(s => s.date === this.day())) {
      this.day.set(valid.at(-1)?.date ?? null);
    }
    if (!composites.some(c => c.period === this.month())) {
      this.month.set(this.lastMonth());
    }
  }

  private async loadStats(pid: number, index: DetailIndex): Promise<void> {
    try {
      const stats = await firstValueFrom(
        this.http.get<DetailStat[]>(`${API}/properties/${pid}/detail/stats`, { params: { index } }),
      );
      if (this.pid() === pid && this.layer() === index) {
        this.stats.set(stats);
      }
    } catch {
      this.stats.set([]);
    }
  }

  private async loadDefs(): Promise<void> {
    try {
      this.defs.set(await firstValueFrom(this.http.get<DetailLayerDef[]>(`${API}/detail/indices`)));
    } catch {
      // Retried on the next successful reload of a land.
    }
  }

  private lastMonth(): string | null {
    const months = this.composites().filter(c => c.period !== 'latest');
    return months.at(-1)?.period ?? (this.composites().length ? 'latest' : null);
  }
}
