/**
 * All UI copy lives here (English). A Spanish (es-CR) copy can be added with the same shape.
 */
export const STRINGS = {
  appTitle: 'Adaptive Farming',
  appSubtitle: 'Cartago · climate & vegetation',

  header: {
    variable: 'Variable',
    period: 'Period',
    typicalMonth: 'Typical month',
    annualNormal: 'Annual normal',
    month: 'Month',
    renderMode: 'Map colors',
    classes: 'Classes',
    continuous: 'Continuous',
  },

  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsLong: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],

  legend: {
    title: 'Legend',
    provisional: 'Thresholds are provisional',
    noData: 'No data',
    cellNote: 'Each square = one data point (~5 km cell)',
    clipNote: 'Colors are clipped to the selected property',
    fullCells: 'Show full cells',
  },

  map: {
    loading: 'Loading data…',
    drawHint: 'Use the polygon tool (top-left) or “New property” to draw a property',
    aoi: 'Data area (Cartago)',
  },

  tooltip: {
    point: 'Point',
    coords: 'Lat / Lon',
    elevation: 'Elevation',
    period: 'Period',
    propertyShare: 'Share of property',
  },

  dashboard: {
    regionBanner: 'Showing entire region; select or draw a property to focus.',
    propertyTitle: 'Your property',
    regionTitle: 'Entire region',
    area: 'Area',
    cells: 'Data cells',
    cellsSub: (n: number) => (n === 1 ? '1 cell covers the property' : `${n} cells cover the property`),
    regionCellsSub: 'grid points (~5 km apart)',
    meanNdvi: 'Mean NDVI',
    meanTemp: 'Mean temperature',
    rain: 'Rainfall',
    balance: 'Water balance',
    frost: 'Frost risk',
    stressed: 'Stressed area',
    stressedSub: 'NDVI < 0.4',
    waterDeficit: 'Water-deficit area',
    waterDeficitSub: 'rain − ETo < 0',
    distribution: 'Class distribution',
    distributionSub: '% of area per class',
    histogram: 'Distribution across the region',
    histogramSub: 'Number of cells per value range; line = your property',
    profile: 'Typical year',
    profileSub: 'Monthly profile · click a month to select it',
    cellsTable: 'Cells covering the property',
    share: 'Share',
    value: 'Value',
    propertyMarker: 'Property',
    weightingNote:
      'Data is a ~5 km grid. Property values are area-weighted by how much of the property falls in each cell.',
    resolutionNote: (n: number) =>
      `Values come from ${n === 1 ? '1 cell' : `${n} cells`} of ~5 km. Climate comes from a ~10 km grid (NASA POWER, ~50 km), ` +
      'and NDVI / elevation are sampled at each cell’s center, so they do not yet vary inside the property.',
    emptyTitle: 'No data inside your property',
    emptyDescription: 'The polygon does not overlap the data area (Cartago). Draw it inside the colored cells.',
    loadingError: 'Could not load the data',
  },

  toasts: {
    selfIntersection: 'The polygon crosses itself. Please redraw it.',
    outsideBbox: 'Part of the property is outside the data area.',
    fullyOutside: 'The property is outside the data area (Cartago).',
    importError: 'Could not read that file. Use a GeoJSON with a Polygon.',
    imported: 'Property imported',
    importedMany: (n: number) => `${n} properties imported`,
    saved: 'Property saved',
    deleted: (name: string) => `“${name}” deleted`,
    apiOffline: 'Cannot reach the server, so changes are not saved. Is the API running?',
    apiNoProxy: 'The dev server is not forwarding /api to the API. Stop `npm start` (Ctrl+C) and start it again.',
    saveError: 'Could not save the change',
    dataError: 'Data failed to load',
  },

  properties: {
    title: 'Properties',
    newProperty: 'New property',
    import: 'Import',
    exportOne: 'Export',
    exportAll: 'Export all',
    region: 'Entire region',
    regionSub: 'No property selected',
    loading: 'Loading properties…',
    emptyTitle: 'No properties yet',
    emptyDescription: 'Draw a polygon on the map, or import a GeoJSON file.',
    offlineTitle: 'Cannot reach the server',
    offlineDescription: 'Start the API (see README) and retry. The map still works.',
    noProxyDescription:
      'The web dev server is not forwarding /api to the API. Stop `npm start` (Ctrl+C), start it again, then reload. The map still works.',
    retry: 'Retry',
    rename: 'Rename',
    delete: 'Delete',
    confirmDelete: (name: string) => `Delete “${name}”? This cannot be undone.`,
    defaultName: (n: number) => `Property ${n}`,
    legacyName: 'My property',
  },

  units: {
    ha: 'ha',
    mz: 'mz',
  },
} as const;
