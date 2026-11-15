/**
 * Icon set ported 1:1 from the Figma design (Field Shift prototype, node 1:3).
 * Registered with ng-icons, so use them as `<ng-icon name="fsPin" size="18" />`; they inherit `currentColor`.
 */
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;

export const DESIGN_ICONS = {
  fsLeaf: svg(
    '<path d="M5 20c7 0 13-6 14-15C10 5 5 10 5 20Z" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M5 20c2-5 5-8 10-11" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>',
  ),
  fsChevronDown: svg(
    '<path d="m8 10 4 4 4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>',
  ),
  fsArrowRight: svg(
    '<path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>',
  ),
  fsArrowLeft: svg(
    '<path d="M19 12H5m5 5-5-5 5-5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>',
  ),
  fsPlus: svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-linecap="round" stroke-width="2"/>'),
  fsClose: svg('<path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-linecap="round" stroke-width="1.9"/>'),
  fsSearch: svg(
    '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="m16 16 4 4" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>',
  ),
  fsPin: svg(
    '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>' +
      '<circle cx="12" cy="10" r="2.25" stroke="currentColor" stroke-width="1.8"/>',
  ),
  fsCrop: svg(
    '<path d="M12 21V9m0 5c-4.2 0-7-2.4-7-6 4.2 0 7 2.4 7 6Zm0-3c4.2 0 7-2.4 7-6-4.2 0-7 2.4-7 6Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/>',
  ),
  fsMore: svg(
    '<circle cx="5" cy="12" fill="currentColor" r="1.7"/><circle cx="12" cy="12" fill="currentColor" r="1.7"/><circle cx="19" cy="12" fill="currentColor" r="1.7"/>',
  ),
  fsTrash: svg(
    '<path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/>' +
      '<path d="M10 11v5M14 11v5" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/>',
  ),
  fsPolygon: svg(
    '<path d="m5 5 13 3-2 11H7L3 11 5 5Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/>' +
      '<circle cx="5" cy="5" fill="currentColor" r="1.5"/><circle cx="18" cy="8" fill="currentColor" r="1.5"/>' +
      '<circle cx="16" cy="19" fill="currentColor" r="1.5"/><circle cx="7" cy="19" fill="currentColor" r="1.5"/>' +
      '<circle cx="3" cy="11" fill="currentColor" r="1.5"/>',
  ),
  fsReset: svg(
    '<path d="M4 9V4m0 0h5M4 4l4 4a7 7 0 1 1-2 7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>',
  ),
  fsAlert: svg(
    '<path d="M12 4 3.5 19h17L12 4Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/>' +
      '<path d="M12 9v4.5M12 16.5v.1" stroke="currentColor" stroke-linecap="round" stroke-width="2"/>',
  ),
  fsInfo: svg(
    '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M12 10.5v5" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>' +
      '<circle cx="12" cy="7.5" fill="currentColor" r="1"/>',
  ),
  fsCheck: svg(
    '<path d="m5 12 4 4L19 6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>',
  ),
} as const;
