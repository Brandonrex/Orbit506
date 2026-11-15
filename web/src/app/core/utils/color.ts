import { type ClassDef, classesFor, type VarDef } from '../config/indices';
import type { Period, Range } from '../models';

/** Index of the class the value falls in, or -1 for null. */
export function classIndex(value: number | null | undefined, classes: ClassDef[]): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return -1;
  }
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    if ((c.min === undefined || value >= c.min) && (c.max === undefined || value < c.max)) {
      return i;
    }
  }
  return -1;
}

export function classColor(value: number | null | undefined, def: VarDef, period: Period): string | null {
  const classes = classesFor(def, period);
  const i = classIndex(value, classes);
  return i < 0 ? null : classes[i].color;
}

interface Stop {
  value: number;
  rgb: [number, number, number];
}

/** Color stops for continuous mode: each class color sits at its class mid-point. */
export function rampStops(def: VarDef, period: Period, range: Range | undefined): Stop[] {
  const classes = classesFor(def, period);
  const lo = range?.min ?? classes[0]?.max ?? 0;
  const hi = range?.max ?? classes[classes.length - 1]?.min ?? 1;
  return classes.map(c => {
    const a = c.min ?? Math.min(lo, c.max ?? lo);
    const b = c.max ?? Math.max(hi, c.min ?? hi);
    return { value: (a + b) / 2, rgb: hexToRgb(c.color) };
  });
}

export function rampColor(value: number | null | undefined, stops: Stop[]): string | null {
  if (value === null || value === undefined || Number.isNaN(value) || stops.length === 0) {
    return null;
  }
  if (value <= stops[0].value) {
    return rgbToHex(stops[0].rgb);
  }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (value <= b.value) {
      const t = (value - a.value) / (b.value - a.value || 1);
      return rgbToHex([
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ]);
    }
  }
  return rgbToHex(stops[stops.length - 1].rgb);
}

/** CSS linear-gradient for the continuous legend. */
export function rampGradient(def: VarDef, period: Period): string {
  const colors = classesFor(def, period).map(c => c.color);
  return `linear-gradient(to right, ${colors.join(', ')})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Black or white text, whichever reads better on the given hex background. */
export function readableTextOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111827' : '#ffffff';
}

/** Reads a CSS custom property (Zard / Tailwind token) so canvas layers can use theme colors. */
export function cssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
