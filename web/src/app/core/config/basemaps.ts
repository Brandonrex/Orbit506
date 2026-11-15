export interface BasemapDef {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
}

export const BASEMAPS: BasemapDef[] = [
  {
    id: 'esri-imagery',
    label: 'Satellite (Esri World Imagery)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
];

export const LABELS_OVERLAY: BasemapDef = {
  id: 'esri-labels',
  label: 'Place labels',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Labels &copy; Esri',
  maxZoom: 19,
};

/** 1 manzana = 6,987 m² (Costa Rica / Central America). */
export const M2_PER_MANZANA = 6987;
export const M2_PER_HECTARE = 10000;
