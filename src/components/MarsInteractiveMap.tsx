import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, LocateFixed, Minus, Plus, Route, X } from 'lucide-react';
import type {
  CraterFeature,
  HazardZone,
  MarsLocation,
  MarsMapLayerId,
  RiskLevel,
  RouteOption,
  RoverSiteMarker,
  ScienceSite,
  TerrainAnalysisResult,
} from '../types/mars';
import {
  computeSciencePriority,
  GEOLOGICAL_CATEGORIES,
  GEOLOGICAL_CATEGORY_META,
  type MarkerShape,
} from '../engine/scienceEngine';

export type SelectedMapFeature =
  | { kind: 'location'; data: MarsLocation }
  | { kind: 'crater'; data: CraterFeature }
  | { kind: 'rover'; data: RoverSiteMarker }
  | { kind: 'science'; data: ScienceSite }
  | { kind: 'hazard'; data: HazardZone };

interface MarsInteractiveMapProps {
  centerLat: number;
  centerLon: number;
  zoom: number;
  onViewportChange: (lat: number, lon: number, zoom: number) => void;
  layers: Record<MarsMapLayerId, boolean>;
  locations: MarsLocation[];
  selectedLocation: MarsLocation;
  craters: CraterFeature[];
  rovers: RoverSiteMarker[];
  scienceSites: ScienceSite[];
  scienceStopIds?: string[];
  terrain?: TerrainAnalysisResult;
  hazards: HazardZone[];
  routes?: RouteOption[];
  activeRoute?: RouteOption;
  selectedFeature?: SelectedMapFeature;
  onSelectFeature: (feature: SelectedMapFeature) => void;
  onSelectRouteId?: (id: string) => void;
  onAddScienceWaypoint?: (site: ScienceSite) => void;
  onOpenScienceExplorer?: (site: ScienceSite) => void;
  heightClass?: string;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 9;
const MAX_UPSTREAM_TILE_ZOOM = 7;

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boxesOverlap(a: LabelBox, b: LabelBox, pad = 3): boolean {
  return !(a.x2 + pad < b.x1 || a.x1 - pad > b.x2 || a.y2 + pad < b.y1 || a.y1 - pad > b.y2);
}

function tryPlaceLabel(
  placed: LabelBox[],
  candidates: Array<{ x: number; y: number; w: number; h: number }>,
  maxW: number,
  maxH: number,
): { x: number; y: number; w: number; h: number } | null {
  for (const c of candidates) {
    if (c.x < 4 || c.y < 4 || c.x + c.w > maxW - 4 || c.y + c.h > maxH - 4) continue;
    const box: LabelBox = { x1: c.x, y1: c.y, x2: c.x + c.w, y2: c.y + c.h };
    if (!placed.some((p) => boxesOverlap(p, box))) {
      placed.push(box);
      return c;
    }
  }
  return null;
}

function wrapLon(lon: number): number {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180 && lon > 0) l = 180;
  return l;
}

function clampLat(lat: number): number {
  return Math.max(-84, Math.min(84, lat));
}

function roughnessColorRgba(roughnessIdx: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, roughnessIdx / 100));
  if (t < 0.35) {
    const k = t / 0.35;
    return [
      Math.round(16 + (234 - 16) * k),
      Math.round(185 + (179 - 185) * k),
      Math.round(129 + (8 - 129) * k),
      Math.round(150 + 35 * k),
    ];
  }
  if (t < 0.68) {
    const k = (t - 0.35) / 0.33;
    return [
      Math.round(234 + (249 - 234) * k),
      Math.round(179 + (115 - 179) * k),
      Math.round(8 + (22 - 8) * k),
      Math.round(185 + 25 * k),
    ];
  }
  const k = (t - 0.68) / 0.32;
  return [
    Math.round(249 + (239 - 249) * k),
    Math.round(115 + (44 - 115) * k),
    Math.round(22 + (44 - 22) * k),
    Math.round(210 + 28 * k),
  ];
}

function ScienceMarkerGlyph({ shape, colorHex }: { shape: MarkerShape; colorHex: string }) {
  switch (shape) {
    case 'diamond':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow">
          <polygon points="8,1 15,8 8,15 1,8" fill={colorHex} stroke="#05070B" strokeWidth="1.4" />
        </svg>
      );
    case 'square':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" className="drop-shadow">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill={colorHex} stroke="#05070B" strokeWidth="1.4" />
        </svg>
      );
    case 'ring':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow">
          <circle cx="8" cy="8" r="6" fill="#05070B" stroke={colorHex} strokeWidth="2.4" />
          <circle cx="8" cy="8" r="2" fill={colorHex} />
        </svg>
      );
    case 'triangle':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow">
          <polygon points="8,1.5 14.5,13.5 1.5,13.5" fill={colorHex} stroke="#05070B" strokeWidth="1.4" />
        </svg>
      );
    case 'channel':
      return (
        <svg width="18" height="14" viewBox="0 0 18 14" className="drop-shadow">
          <rect x="1" y="3" width="16" height="8" rx="2" fill={colorHex} stroke="#05070B" strokeWidth="1.4" />
          <line x1="3.5" y1="7" x2="14.5" y2="7" stroke="#05070B" strokeWidth="1.3" />
        </svg>
      );
    case 'hexagon':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow">
          <polygon points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5" fill={colorHex} stroke="#05070B" strokeWidth="1.4" />
        </svg>
      );
    case 'star':
      return (
        <svg width="17" height="17" viewBox="0 0 16 16" className="drop-shadow">
          <polygon
            points="8,1 10,5.6 15,6.1 11.2,9.5 12.4,14.5 8,11.8 3.6,14.5 4.8,9.5 1,6.1 6,5.6"
            fill={colorHex}
            stroke="#05070B"
            strokeWidth="1.2"
          />
        </svg>
      );
  }
}

export function MarsInteractiveMap({
  centerLat,
  centerLon,
  zoom,
  onViewportChange,
  layers,
  locations,
  selectedLocation,
  craters,
  rovers,
  scienceSites,
  scienceStopIds = [],
  terrain,
  hazards,
  routes = [],
  activeRoute,
  selectedFeature,
  onSelectFeature,
  onSelectRouteId,
  onAddScienceWaypoint,
  onOpenScienceExplorer,
  heightClass = 'h-[560px]',
}: MarsInteractiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const roughnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 820, height: 560 });
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [tileErrors, setTileErrors] = useState<number>(0);
  const [hoveredScienceId, setHoveredScienceId] = useState<string | null>(null);
  const [dismissedSciencePopupId, setDismissedSciencePopupId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState<boolean>(false);
  const [hoveredRouteSeg, setHoveredRouteSeg] = useState<{
    routeId: string;
    profile: RouteOption['profile'];
    segIdx: number;
    lat: number;
    lon: number;
    elevationM: number;
    difficultyScore: number;
    slopeDeg: number;
    roughnessIdx: number;
    cumulativeDistKm: number;
    hazardLevel: RiskLevel;
    sx: number;
    sy: number;
  } | null>(null);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startLat: number;
    startLon: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startLat: centerLat,
    startLon: centerLon,
  });

  useEffect(() => {
    setTileErrors(0);
  }, [zoom, layers.surface, layers.elevation, layers.terrain, layers['themis-night']]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setSize({
        width: el.clientWidth || 820,
        height: el.clientHeight || 560,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tileZ = Math.min(MAX_UPSTREAM_TILE_ZOOM, zoom);
  const overzoomScale = Math.pow(2, zoom - tileZ);
  const displayTileSize = TILE_SIZE * overzoomScale;
  const matrixW = Math.pow(2, tileZ + 1);
  const matrixH = Math.pow(2, tileZ);
  const worldW = matrixW * displayTileSize;
  const worldH = matrixH * displayTileSize;

  const lonToWorldX = useCallback(
    (lon: number) => ((wrapLon(lon) + 180) / 360) * worldW,
    [worldW],
  );
  const latToWorldY = useCallback(
    (lat: number) => ((90 - clampLat(lat)) / 180) * worldH,
    [worldH],
  );

  const centerWorldX = lonToWorldX(centerLon);
  const centerWorldY = latToWorldY(centerLat);

  const screenToLatLon = useCallback(
    (sx: number, sy: number) => {
      const wx = centerWorldX + (sx - size.width / 2);
      const wy = centerWorldY + (sy - size.height / 2);
      const lon = wrapLon((wx / worldW) * 360 - 180);
      const lat = Math.max(-90, Math.min(90, 90 - (wy / worldH) * 180));
      return { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) };
    },
    [centerWorldX, centerWorldY, size.width, size.height, worldW, worldH],
  );

  const latLonToScreen = useCallback(
    (lat: number, lon: number) => {
      let dLon = wrapLon(lon) - wrapLon(centerLon);
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      const sx = size.width / 2 + (dLon / 360) * worldW;
      const sy = size.height / 2 + ((centerLat - lat) / 180) * worldH;
      return { sx, sy };
    },
    [centerLat, centerLon, size.width, size.height, worldW, worldH],
  );

  const visibleTiles = useMemo(() => {
    const minTileX = Math.floor((centerWorldX - size.width / 2) / displayTileSize);
    const maxTileX = Math.floor((centerWorldX + size.width / 2) / displayTileSize);
    const minTileY = Math.max(0, Math.floor((centerWorldY - size.height / 2) / displayTileSize));
    const maxTileY = Math.min(matrixH - 1, Math.floor((centerWorldY + size.height / 2) / displayTileSize));

    const tiles: Array<{ key: string; tx: number; ty: number; wrappedX: number; left: number; top: number }> = [];
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const wrappedX = ((tx % matrixW) + matrixW) % matrixW;
        const left = Math.round(size.width / 2 + (tx * displayTileSize - centerWorldX));
        const top = Math.round(size.height / 2 + (ty * displayTileSize - centerWorldY));
        tiles.push({ key: `${tileZ}-${tx}-${ty}`, tx, ty, wrappedX, left, top });
      }
    }
    return tiles;
  }, [centerWorldX, centerWorldY, size.width, size.height, matrixW, matrixH, tileZ, displayTileSize]);

  const roughnessLayerData = useMemo(() => {
    if (!terrain || terrain.gridSize < 2) return null;
    const n = terrain.gridSize;
    const offscreen = document.createElement('canvas');
    offscreen.width = n;
    offscreen.height = n;
    const octx = offscreen.getContext('2d');
    if (!octx) return null;

    const img = octx.createImageData(n, n);
    for (let gy = 0; gy < n; gy++) {
      // Map south-up terrain row (gy=0) to bottom image row (py = n - 1 - gy)
      const py = n - 1 - gy;
      for (let gx = 0; gx < n; gx++) {
        const cell = terrain.cells[gy][gx];
        const [r, g, b, a] = roughnessColorRgba(cell.roughnessIdx);
        const idx = (py * n + gx) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = a;
      }
    }
    octx.putImageData(img, 0, 0);

    const southCellLat = terrain.cells[0][0].lat;
    const northCellLat = terrain.cells[n - 1][0].lat;
    const westCellLon = terrain.cells[0][0].lon;
    const eastCellLon = terrain.cells[0][n - 1].lon;
    const dLat = (northCellLat - southCellLat) / (n - 1);
    const dLon = (eastCellLon - westCellLon) / (n - 1);

    return {
      offscreen,
      n,
      southLat: southCellLat - dLat * 0.5,
      northLat: northCellLat + dLat * 0.5,
      westLon: westCellLon - dLon * 0.5,
      eastLon: eastCellLon + dLon * 0.5,
    };
  }, [terrain]);

  useEffect(() => {
    const canvas = roughnessCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!layers.roughness || !roughnessLayerData) return;

    const { offscreen, northLat, southLat, westLon, eastLon } = roughnessLayerData;
    const topLeft = latLonToScreen(northLat, westLon);
    const bottomRight = latLonToScreen(southLat, eastLon);
    const drawW = bottomRight.sx - topLeft.sx;
    const drawH = bottomRight.sy - topLeft.sy;

    if (
      drawW <= 0 ||
      drawH <= 0 ||
      bottomRight.sx < 0 ||
      topLeft.sx > size.width ||
      bottomRight.sy < 0 ||
      topLeft.sy > size.height
    ) {
      return;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, topLeft.sx, topLeft.sy, drawW, drawH);

    // Crisp 25x25 km sector boundary frame
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(topLeft.sx, topLeft.sy, drawW, drawH);
    ctx.setLineDash([]);

    ctx.font = '10px "IBM Plex Mono", monospace';
    const tag = `${terrain?.regionName || 'Sector'} · ${terrain?.spanKm ?? 25} km Roughness`;
    const tagW = ctx.measureText(tag).width + 10;
    const labelY = Math.max(18, topLeft.sy - 6);
    ctx.fillStyle = 'rgba(9, 12, 18, 0.88)';
    ctx.fillRect(topLeft.sx, labelY - 12, tagW, 15);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(tag, topLeft.sx + 5, labelY - 1);
    ctx.restore();
  }, [layers.roughness, roughnessLayerData, latLonToScreen, size.width, size.height, terrain]);

  const hoveredRoughnessCell = useMemo(() => {
    if (!layers.roughness || !terrain || !roughnessLayerData || !cursorCoords) return null;
    const { northLat, southLat, westLon, eastLon, n } = roughnessLayerData;
    if (
      cursorCoords.lat < southLat ||
      cursorCoords.lat > northLat ||
      cursorCoords.lon < westLon ||
      cursorCoords.lon > eastLon
    ) {
      return null;
    }
    const u = (cursorCoords.lon - westLon) / (eastLon - westLon);
    const v = (cursorCoords.lat - southLat) / (northLat - southLat);
    const gx = Math.max(0, Math.min(n - 1, Math.floor(u * n)));
    const gy = Math.max(0, Math.min(n - 1, Math.floor(v * n)));
    return terrain.cells[gy]?.[gx] ?? null;
  }, [layers.roughness, terrain, roughnessLayerData, cursorCoords]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startLat: centerLat,
      startLon: centerLon,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorCoords(screenToLatLon(e.clientX - rect.left, e.clientY - rect.top));
    }
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.hypot(dx, dy) > 3) dragRef.current.moved = true;

    const dLon = -(dx / worldW) * 360;
    const dLat = (dy / worldH) * 180;
    onViewportChange(
      clampLat(dragRef.current.startLat + dLat),
      wrapLon(dragRef.current.startLon + dLon),
      zoom,
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const viewportRef = useRef({ centerLat, centerLon, zoom, onViewportChange });
  viewportRef.current = { centerLat, centerLon, zoom, onViewportChange };
  const lastWheelAtRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelAtRef.current < 95) return;
      if (Math.abs(e.deltaY) < 4) return;
      lastWheelAtRef.current = now;
      const { centerLat: lat, centerLon: lon, zoom: curZoom, onViewportChange: cb } =
        viewportRef.current;
      const nextZoom =
        e.deltaY < 0 ? Math.min(MAX_ZOOM, curZoom + 1) : Math.max(MIN_ZOOM, curZoom - 1);
      if (nextZoom !== curZoom) {
        cb(lat, lon, nextZoom);
      }
    };
    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', onNativeWheel);
  }, []);

  const activeRasterLayers: Array<{ id: 'surface' | 'elevation' | 'terrain' | 'themis-night'; opacity: number }> = [];
  if (layers.surface) activeRasterLayers.push({ id: 'surface', opacity: 1 });
  if (layers.elevation) activeRasterLayers.push({ id: 'elevation', opacity: layers.surface ? 0.58 : 1 });
  if (layers.terrain) activeRasterLayers.push({ id: 'terrain', opacity: layers.surface || layers.elevation ? 0.5 : 1 });
  if (layers['themis-night']) {
    activeRasterLayers.push({
      id: 'themis-night',
      opacity: layers.surface || layers.elevation || layers.terrain ? 0.52 : 1,
    });
  }

  const kmPerPixel = 21344 / worldW;
  const targetBarPx = 90;
  const rawKm = kmPerPixel * targetBarPx;
  const niceSteps = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
  const scaleKm = niceSteps.reduce((prev, curr) =>
    Math.abs(curr - rawKm) < Math.abs(prev - rawKm) ? curr : prev,
  );
  const scaleBarWidth = Math.max(36, Math.round(scaleKm / kmPerPixel));

  const gratStep = zoom >= 5 ? 5 : zoom >= 3 ? 15 : 30;
  const latLines: number[] = [];
  for (let lat = -75; lat <= 75; lat += gratStep) latLines.push(lat);
  const lonLines: number[] = [];
  for (let lon = -180; lon < 180; lon += gratStep) lonLines.push(lon);

  // De-conflicted marker layout & collision-free label placement
  const markerLayout = useMemo(() => {
    const placedBoxes: LabelBox[] = [
      // Reserve top-left HUD & top-right zoom controls
      { x1: 0, y1: 0, x2: 290, y2: 95 },
      { x1: Math.max(0, size.width - 60), y1: 0, x2: size.width, y2: 140 },
    ];

    const roverScreenPoints: Array<{ sx: number; sy: number; id: string }> = [];
    if (layers.rovers) {
      for (const rv of rovers) {
        const { sx, sy } = latLonToScreen(rv.lat, rv.lon);
        if (sx >= -40 && sx <= size.width + 40 && sy >= -40 && sy <= size.height + 40) {
          roverScreenPoints.push({ sx, sy, id: rv.id });
          const w = rv.name.split(' ')[0].length * 6.5 + 24;
          placedBoxes.push({ x1: sx - w / 2, y1: sy - 11, x2: sx + w / 2, y2: sy + 11 });
        }
      }
    }

    // Reserve START / DEST pins if route is visible
    if (layers.route && activeRoute && activeRoute.waypoints.length >= 2) {
      const startPt = latLonToScreen(activeRoute.waypoints[0].lat, activeRoute.waypoints[0].lon);
      const endPt = latLonToScreen(
        activeRoute.waypoints[activeRoute.waypoints.length - 1].lat,
        activeRoute.waypoints[activeRoute.waypoints.length - 1].lon,
      );
      placedBoxes.push({ x1: startPt.sx - 8, y1: startPt.sy - 8, x2: startPt.sx + 44, y2: startPt.sy + 10 });
      placedBoxes.push({ x1: endPt.sx - 8, y1: endPt.sy - 8, x2: endPt.sx + 40, y2: endPt.sy + 10 });
    }

    // De-conflict Science markers so nearby targets never stack invisibly on top of each other or rover pills
    const placedScienceIcons: Array<{ sx: number; sy: number }> = [];
    const scienceNodes = layers.science
      ? scienceSites
          .map((site) => {
            const truePt = latLonToScreen(site.lat, site.lon);
            if (
              truePt.sx < -30 ||
              truePt.sx > size.width + 30 ||
              truePt.sy < -30 ||
              truePt.sy > size.height + 30
            ) {
              return null;
            }
            const isSelected = selectedFeature?.kind === 'science' && selectedFeature.data.id === site.id;
            const priority = computeSciencePriority(site, 'explore-ancient-deltas', {
              route: activeRoute,
              location: selectedLocation,
            });
            return { site, truePt, isSelected, priority };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => (a.isSelected ? -1 : b.isSelected ? 1 : b.priority.totalScore - a.priority.totalScore))
      : [];

    // Cluster close science targets at low zoom (zoom <= 5) so overlapping markers stay legible
    const scienceClusters: Array<{
      id: string;
      centerLat: number;
      centerLon: number;
      drawX: number;
      drawY: number;
      items: typeof scienceNodes;
      topPriority: number;
      colorHex: string;
    }> = [];
    let unclusteredScienceNodes = scienceNodes;

    if (layers.science && zoom <= 5 && scienceNodes.length > 0) {
      const assigned = new Set<string>();
      const singles: typeof scienceNodes = [];
      for (let i = 0; i < scienceNodes.length; i++) {
        const seed = scienceNodes[i];
        if (assigned.has(seed.site.id)) continue;
        assigned.add(seed.site.id);
        const members = [seed];
        for (let j = i + 1; j < scienceNodes.length; j++) {
          const cand = scienceNodes[j];
          if (assigned.has(cand.site.id)) continue;
          if (Math.hypot(cand.truePt.sx - seed.truePt.sx, cand.truePt.sy - seed.truePt.sy) <= 28) {
            assigned.add(cand.site.id);
            members.push(cand);
          }
        }
        if (members.length === 1) {
          singles.push(seed);
        } else {
          const avgLat = members.reduce((s, m) => s + m.site.lat, 0) / members.length;
          const avgLon = members.reduce((s, m) => s + m.site.lon, 0) / members.length;
          const avgX = members.reduce((s, m) => s + m.truePt.sx, 0) / members.length;
          const avgY = members.reduce((s, m) => s + m.truePt.sy, 0) / members.length;
          const topItem = members.reduce(
            (best, cur) => (cur.priority.totalScore > best.priority.totalScore ? cur : best),
            members[0],
          );
          scienceClusters.push({
            id: `cluster-${seed.site.id}`,
            centerLat: avgLat,
            centerLon: avgLon,
            drawX: avgX,
            drawY: avgY,
            items: members,
            topPriority: topItem.priority.totalScore,
            colorHex: GEOLOGICAL_CATEGORY_META[topItem.site.geologicalCategory].colorHex,
          });
          placedBoxes.push({ x1: avgX - 20, y1: avgY - 12, x2: avgX + 20, y2: avgY + 12 });
        }
      }
      unclusteredScienceNodes = singles;
    }

    const positionedScience = unclusteredScienceNodes.map((item) => {
      let drawX = item.truePt.sx;
      let drawY = item.truePt.sy;
      const collidesWithIconOrRover = (x: number, y: number) =>
        placedScienceIcons.some((p) => Math.hypot(p.sx - x, p.sy - y) < 22) ||
        roverScreenPoints.some((r) => Math.hypot(r.sx - x, r.sy - y) < 26);

      if (collidesWithIconOrRover(drawX, drawY)) {
        const angles = [-Math.PI / 4, Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4, 0, Math.PI / 2, Math.PI, -Math.PI / 2];
        outer: for (const radius of [22, 36, 50]) {
          for (const ang of angles) {
            const cx = item.truePt.sx + Math.cos(ang) * radius;
            const cy = item.truePt.sy + Math.sin(ang) * radius;
            if (cx > 16 && cx < size.width - 16 && cy > 16 && cy < size.height - 16 && !collidesWithIconOrRover(cx, cy)) {
              drawX = cx;
              drawY = cy;
              break outer;
            }
          }
        }
      }

      placedScienceIcons.push({ sx: drawX, sy: drawY });
      placedBoxes.push({ x1: drawX - 10, y1: drawY - 10, x2: drawX + 10, y2: drawY + 10 });
      const displaced = Math.hypot(drawX - item.truePt.sx, drawY - item.truePt.sy) > 3;

      const catMeta = GEOLOGICAL_CATEGORY_META[item.site.geologicalCategory];
      const labelText = `${catMeta.shortTag} · ${item.priority.totalScore}`;
      const labelW = labelText.length * 5.8 + 12;
      const labelH = 15;
      let labelPos: { x: number; y: number } | null = null;

      if (item.isSelected || hoveredScienceId === item.site.id || zoom >= 6) {
        const cands = [
          { x: drawX + 12, y: drawY - 8, w: labelW, h: labelH },
          { x: drawX - labelW - 12, y: drawY - 8, w: labelW, h: labelH },
          { x: drawX - labelW / 2, y: drawY - 24, w: labelW, h: labelH },
          { x: drawX - labelW / 2, y: drawY + 12, w: labelW, h: labelH },
        ];
        if (item.isSelected || hoveredScienceId === item.site.id) {
          labelPos = { x: drawX + 12, y: drawY - 8 };
          placedBoxes.push({
            x1: labelPos.x,
            y1: labelPos.y,
            x2: labelPos.x + labelW,
            y2: labelPos.y + labelH,
          });
        } else {
          const placed = tryPlaceLabel(placedBoxes, cands, size.width, size.height);
          if (placed) labelPos = { x: placed.x, y: placed.y };
        }
      }

      return {
        ...item,
        catMeta,
        drawX,
        drawY,
        displaced,
        labelText,
        labelPos,
      };
    });

    // Collision-checked labels for local waypoints (zoom >= 6)
    const visibleWaypointLabels: Record<string, boolean> = {};
    if (layers.rovers && zoom >= 6) {
      for (const wp of selectedLocation.localWaypoints) {
        const { sx, sy } = latLonToScreen(wp.lat, wp.lon);
        if (sx < 10 || sx > size.width - 10 || sy < 10 || sy > size.height - 10) continue;
        const shortName = wp.name.replace(/\s*\([^)]+\)/, '').slice(0, 22);
        const w = shortName.length * 5.6 + 10;
        const placed = tryPlaceLabel(
          placedBoxes,
          [
            { x: sx + 8, y: sy - 7, w, h: 14 },
            { x: sx - w - 8, y: sy - 7, w, h: 14 },
            { x: sx - w / 2, y: sy + 8, w, h: 14 },
          ],
          size.width,
          size.height,
        );
        visibleWaypointLabels[wp.id] = Boolean(placed);
      }
    }

    return { positionedScience, scienceClusters, visibleWaypointLabels };
  }, [
    size.width,
    size.height,
    layers.rovers,
    layers.route,
    layers.science,
    rovers,
    activeRoute,
    scienceSites,
    selectedFeature,
    hoveredScienceId,
    zoom,
    selectedLocation.localWaypoints,
    latLonToScreen,
  ]);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setCursorCoords(null)}
      className={`relative w-full ${heightClass} rounded border border-white/10 bg-[#05070B] overflow-hidden select-none cursor-grab active:cursor-grabbing`}
    >
      {/* Raster Tile Stack */}
      {activeRasterLayers.map((rLayer) => (
        <div
          key={rLayer.id}
          style={{ opacity: rLayer.opacity }}
          className="absolute inset-0 pointer-events-none"
        >
          {visibleTiles.map((tile) => (
            <img
              key={`${rLayer.id}-${tile.key}`}
              src={`/api/mars/tile?layer=${rLayer.id}&z=${tileZ}&x=${tile.wrappedX}&y=${tile.ty}`}
              alt=""
              draggable={false}
              onError={() => setTileErrors((c) => c + 1)}
              style={{
                position: 'absolute',
                left: `${tile.left}px`,
                top: `${tile.top}px`,
                width: `${displayTileSize}px`,
                height: `${displayTileSize}px`,
                imageRendering: overzoomScale > 1 ? 'auto' : undefined,
              }}
            />
          ))}
        </div>
      ))}

      {/* Terrain Roughness Heatmap Canvas Overlay */}
      <canvas
        ref={roughnessCanvasRef}
        width={size.width}
        height={size.height}
        className="absolute inset-0 w-full h-full pointer-events-none z-[2]"
      />

      {/* Coordinate Graticule & Route Polyline */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-[15]">
        {latLines.map((lat) => {
          const { sy } = latLonToScreen(lat, centerLon);
          if (sy < -20 || sy > size.height + 20) return null;
          return (
            <g key={`lat-${lat}`}>
              <line
                x1={0}
                y1={sy}
                x2={size.width}
                y2={sy}
                stroke="rgba(56, 189, 248, 0.22)"
                strokeDasharray="3 4"
              />
              <text x={8} y={sy - 4} fill="rgba(148, 163, 184, 0.7)" fontSize="10" fontFamily="IBM Plex Mono">
                {lat}°
              </text>
            </g>
          );
        })}
        {lonLines.map((lon) => {
          const { sx } = latLonToScreen(centerLat, lon);
          if (sx < -20 || sx > size.width + 20) return null;
          return (
            <g key={`lon-${lon}`}>
              <line
                x1={sx}
                y1={0}
                x2={sx}
                y2={size.height}
                stroke="rgba(56, 189, 248, 0.22)"
                strokeDasharray="3 4"
              />
              <text x={sx + 4} y={size.height - 8} fill="rgba(148, 163, 184, 0.7)" fontSize="10" fontFamily="IBM Plex Mono">
                {lon}°
              </text>
            </g>
          );
        })}

        {layers.route && (() => {
          const profileMeta: Record<
            RouteOption['profile'],
            { color: string; dash: string; offsetPx: number; tag: string }
          > = {
            shortest: { color: '#f87171', dash: '6 4', offsetPx: -3.2, tag: 'SHORT' },
            balanced: { color: '#38bdf8', dash: '10 3 2 3', offsetPx: 0, tag: 'BAL' },
            safest: { color: '#34d399', dash: '3 3', offsetPx: 3.2, tag: 'SAFE' },
          };
          const riskRank: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
          const hazColor = (lvl: RiskLevel) =>
            lvl === 'CRITICAL' ? '#ef4444' : lvl === 'HIGH' ? '#f97316' : lvl === 'MODERATE' ? '#f59e0b' : '#10b981';

          const allRoutes = routes.length > 0 ? routes : activeRoute ? [activeRoute] : [];
          const ordered = [...allRoutes].sort((a, b) =>
            a.id === activeRoute?.id ? 1 : b.id === activeRoute?.id ? -1 : 0,
          );

          const offsetPts = (
            raw: Array<{ sx: number; sy: number }>,
            offsetPx: number,
          ): Array<{ sx: number; sy: number }> => {
            if (raw.length < 2 || Math.abs(offsetPx) < 0.01) return raw;
            const n = raw.length;
            return raw.map((pt, i) => {
              const factor = i === 0 || i === n - 1 ? 0.25 : 1;
              const prev = raw[Math.max(0, i - 1)];
              const next = raw[Math.min(n - 1, i + 1)];
              const dx = next.sx - prev.sx;
              const dy = next.sy - prev.sy;
              const len = Math.hypot(dx, dy);
              if (len < 0.001) return pt;
              return {
                sx: pt.sx + (-dy / len) * offsetPx * factor,
                sy: pt.sy + (dx / len) * offsetPx * factor,
              };
            });
          };

          const startWp = activeRoute?.waypoints[0];
          const endWp = activeRoute?.waypoints[activeRoute.waypoints.length - 1];
          const startPt = startWp ? latLonToScreen(startWp.lat, startWp.lon) : null;
          const endPt = endWp ? latLonToScreen(endWp.lat, endWp.lon) : null;

          // Compute representative inline segment labels for active route when zoomed into corridor (zoom >= 7)
          const activeLabels: Array<{
            x: number;
            y: number;
            text: string;
            color: string;
            idx: number;
          }> = [];
          if (zoom >= 7 && activeRoute && activeRoute.waypoints.length >= 2) {
            const aPts = offsetPts(
              activeRoute.waypoints.map((wp) => latLonToScreen(wp.lat, wp.lon)),
              profileMeta[activeRoute.profile].offsetPx,
            );
            const cands = aPts.slice(1).map((p2, idx) => {
              const p1 = aPts[idx];
              const w1 = activeRoute.waypoints[idx];
              const w2 = activeRoute.waypoints[idx + 1];
              const risk: RiskLevel =
                riskRank[w2.hazardLevel] >= riskRank[w1.hazardLevel] ? w2.hazardLevel : w1.hazardLevel;
              const diff = Math.round(Math.max(w1.difficultyScore, w2.difficultyScore));
              return {
                x: (p1.sx + p2.sx) / 2,
                y: (p1.sy + p2.sy) / 2,
                diff,
                risk,
                priority: riskRank[risk] * 100 + diff,
                idx,
              };
            });
            cands.sort((a, b) => b.priority - a.priority);
            for (const c of cands) {
              if (activeLabels.length >= 2) break;
              if (
                c.x > 40 &&
                c.x < size.width - 110 &&
                c.y > 40 &&
                c.y < size.height - 40 &&
                activeLabels.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= 85)
              ) {
                const tag = c.risk === 'MODERATE' ? 'MOD' : c.risk;
                activeLabels.push({
                  x: c.x,
                  y: c.y,
                  text: `Diff ${c.diff} · ${tag}`,
                  color: hazColor(c.risk),
                  idx: c.idx,
                });
              }
            }
          }

          return (
            <g>
              {ordered.map((r) => {
                if (r.waypoints.length < 2) return null;
                const isSelected = r.id === activeRoute?.id;
                const pMeta = profileMeta[r.profile];
                const rawScreen = r.waypoints.map((wp) => latLonToScreen(wp.lat, wp.lon));
                const pts = offsetPts(rawScreen, pMeta.offsetPx);
                const pointsStr = pts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');

                return (
                  <g key={r.id}>
                    {/* Outer hazard-level halo on active route so hazard intensity and route color both remain visible */}
                    {isSelected &&
                      r.waypoints.slice(1).map((wp, idx) => {
                        const prevWp = r.waypoints[idx];
                        const segRisk: RiskLevel =
                          riskRank[wp.hazardLevel] >= riskRank[prevWp.hazardLevel]
                            ? wp.hazardLevel
                            : prevWp.hazardLevel;
                        if (segRisk === 'LOW') return null;
                        const p1 = pts[idx];
                        const p2 = pts[idx + 1];
                        return (
                          <line
                            key={`route-halo-${idx}`}
                            x1={p1.sx}
                            y1={p1.sy}
                            x2={p2.sx}
                            y2={p2.sy}
                            stroke={hazColor(segRisk)}
                            strokeWidth={segRisk === 'CRITICAL' ? 8.2 : segRisk === 'HIGH' ? 7.4 : 6.4}
                            strokeLinecap="round"
                          />
                        );
                      })}

                    <polyline
                      fill="none"
                      stroke={isSelected ? 'rgba(5, 7, 11, 0.96)' : 'rgba(5, 7, 11, 0.72)'}
                      strokeWidth={isSelected ? 6.2 : 4.0}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={pointsStr}
                    />
                    <polyline
                      fill="none"
                      stroke={pMeta.color}
                      strokeWidth={isSelected ? 3.6 : 2.3}
                      strokeDasharray={isSelected ? undefined : pMeta.dash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={pointsStr}
                    />

                    {isSelected &&
                      r.waypoints.slice(1).map((wp, idx) => {
                        if (wp.hazardLevel !== 'CRITICAL' && wp.hazardLevel !== 'HIGH') return null;
                        const p2 = pts[idx + 1];
                        return (
                          <circle
                            key={`route-node-${idx}`}
                            cx={p2.sx}
                            cy={p2.sy}
                            r={3.2}
                            fill={hazColor(wp.hazardLevel)}
                            stroke="#05070B"
                            strokeWidth={1}
                          />
                        );
                      })}

                    {/* Highlight hovered route segment */}
                    {hoveredRouteSeg &&
                      hoveredRouteSeg.routeId === r.id &&
                      pts[hoveredRouteSeg.segIdx] &&
                      pts[hoveredRouteSeg.segIdx + 1] && (
                        <line
                          x1={pts[hoveredRouteSeg.segIdx].sx}
                          y1={pts[hoveredRouteSeg.segIdx].sy}
                          x2={pts[hoveredRouteSeg.segIdx + 1].sx}
                          y2={pts[hoveredRouteSeg.segIdx + 1].sy}
                          stroke="#ffffff"
                          strokeWidth={4.8}
                          strokeLinecap="round"
                        />
                      )}

                    {/* Interactive hover & click hit targets along route segments */}
                    {pts.slice(1).map((p2, idx) => {
                      const p1 = pts[idx];
                      const prevWp = r.waypoints[idx];
                      const currWp = r.waypoints[idx + 1];
                      const segRisk: RiskLevel =
                        riskRank[currWp.hazardLevel] >= riskRank[prevWp.hazardLevel]
                          ? currWp.hazardLevel
                          : prevWp.hazardLevel;
                      const midLat = (prevWp.lat + currWp.lat) / 2;
                      const midLon = (prevWp.lon + currWp.lon) / 2;
                      const midElev = Math.round((prevWp.elevationM + currWp.elevationM) / 2);
                      const midDiff = Math.round((prevWp.difficultyScore + currWp.difficultyScore) / 2);
                      const midSlope = (prevWp.slopeDeg + currWp.slopeDeg) / 2;
                      const midRough = (prevWp.roughnessIdx + currWp.roughnessIdx) / 2;
                      const midDist = (prevWp.cumulativeDistKm + currWp.cumulativeDistKm) / 2;
                      return (
                        <line
                          key={`hit-${r.id}-${idx}`}
                          x1={p1.sx}
                          y1={p1.sy}
                          x2={p2.sx}
                          y2={p2.sy}
                          stroke="transparent"
                          strokeWidth={12}
                          pointerEvents="stroke"
                          className="cursor-pointer"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (onSelectRouteId && r.id !== activeRoute?.id) {
                              onSelectRouteId(r.id);
                            }
                          }}
                          onMouseEnter={() =>
                            setHoveredRouteSeg({
                              routeId: r.id,
                              profile: r.profile,
                              segIdx: idx,
                              lat: midLat,
                              lon: midLon,
                              elevationM: midElev,
                              difficultyScore: midDiff,
                              slopeDeg: midSlope,
                              roughnessIdx: midRough,
                              cumulativeDistKm: midDist,
                              hazardLevel: segRisk,
                              sx: (p1.sx + p2.sx) / 2,
                              sy: (p1.sy + p2.sy) / 2,
                            })
                          }
                          onMouseLeave={() =>
                            setHoveredRouteSeg((cur) =>
                              cur && cur.routeId === r.id && cur.segIdx === idx ? null : cur,
                            )
                          }
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* Inline SVG segment labels for zoomed corridor view */}
              {activeLabels.map((lbl) => (
                <g key={`seglbl-${lbl.idx}`}>
                  <line
                    x1={lbl.x}
                    y1={lbl.y}
                    x2={lbl.x + 12}
                    y2={lbl.y - 14}
                    stroke={lbl.color}
                    strokeWidth={1}
                  />
                  <circle cx={lbl.x} cy={lbl.y} r={2.5} fill={lbl.color} />
                  <rect
                    x={lbl.x + 12}
                    y={lbl.y - 25}
                    width={lbl.text.length * 5.8 + 10}
                    height={14}
                    rx={2}
                    fill="rgba(5, 7, 11, 0.92)"
                    stroke={lbl.color}
                    strokeWidth={1}
                  />
                  <text
                    x={lbl.x + 17}
                    y={lbl.y - 15}
                    fill="#f8fafc"
                    fontSize="9"
                    fontWeight="bold"
                    fontFamily="IBM Plex Mono"
                  >
                    {lbl.text}
                  </text>
                </g>
              ))}

              {startPt && endPt && (
                <>
                  <circle cx={startPt.sx} cy={startPt.sy} r={5.5} fill="#22c55e" stroke="#05070B" strokeWidth={1.5} />
                  <text
                    x={startPt.sx + 8}
                    y={startPt.sy - 6}
                    fill="#86efac"
                    fontSize="10"
                    fontWeight="bold"
                    fontFamily="IBM Plex Mono"
                  >
                    START
                  </text>
                  <circle cx={endPt.sx} cy={endPt.sy} r={5.5} fill="#E85D2A" stroke="#05070B" strokeWidth={1.5} />
                  <text
                    x={endPt.sx + 8}
                    y={endPt.sy + 12}
                    fill="#fdba74"
                    fontSize="10"
                    fontWeight="bold"
                    fontFamily="IBM Plex Mono"
                  >
                    DEST
                  </text>
                </>
              )}
            </g>
          );
        })()}

        {/* De-confliction leader lines connecting displaced Science markers back to exact coordinates */}
        {layers.science &&
          markerLayout.positionedScience.map((item) =>
            item.displaced ? (
              <g key={`leader-${item.site.id}`}>
                <circle cx={item.truePt.sx} cy={item.truePt.sy} r={2} fill={item.catMeta.colorHex} />
                <line
                  x1={item.truePt.sx}
                  y1={item.truePt.sy}
                  x2={item.drawX}
                  y2={item.drawY}
                  stroke={item.catMeta.colorHex}
                  strokeOpacity={0.7}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              </g>
            ) : null,
          )}
      </svg>

      {/* Layer: Craters */}
      {layers.craters &&
        craters.map((c) => {
          const { sx, sy } = latLonToScreen(c.lat, c.lon);
          if (sx < -60 || sx > size.width + 60 || sy < -60 || sy > size.height + 60) return null;
          const radiusPx = Math.max(8, Math.min(72, c.diameterKm / 2 / kmPerPixel));
          const isSelected = selectedFeature?.kind === 'crater' && selectedFeature.data.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectFeature({ kind: 'crater', data: c })}
              style={{
                left: `${sx}px`,
                top: `${sy}px`,
                width: `${radiusPx * 2}px`,
                height: `${radiusPx * 2}px`,
              }}
              title={`${c.name} (Ø ${c.diameterKm} km)`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors flex items-end justify-center ${
                isSelected
                  ? 'border-white bg-amber-400/20'
                  : 'border-amber-400/75 bg-amber-400/5 hover:bg-amber-400/20'
              }`}
            >
              <span className="translate-y-4 text-[10px] font-mono text-amber-200 bg-[#05070B]/85 px-1 rounded whitespace-nowrap">
                {c.name.replace(' Crater', '')} ({c.diameterKm} km)
              </span>
            </button>
          );
        })}

      {/* Layer: Interactive 4-Level Simulated/Derived Hazard Risk Zones */}
      {layers.hazards &&
        hazards.map((h) => {
          const { sx, sy } = latLonToScreen(h.lat, h.lon);
          if (sx < -24 || sx > size.width + 24 || sy < -24 || sy > size.height + 24) return null;
          const isSelected = selectedFeature?.kind === 'hazard' && selectedFeature.data.id === h.id;
          const zoneColor =
            h.riskLevel === 'CRITICAL'
              ? 'border-red-500 bg-red-500/30'
              : h.riskLevel === 'HIGH'
                ? 'border-orange-500 bg-orange-500/25'
                : h.riskLevel === 'MODERATE'
                  ? 'border-amber-400 bg-amber-400/20'
                  : 'border-emerald-400 bg-emerald-400/20';
          const coreColor =
            h.riskLevel === 'CRITICAL'
              ? 'bg-red-500'
              : h.riskLevel === 'HIGH'
                ? 'bg-orange-500'
                : h.riskLevel === 'MODERATE'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400';

          const footprintPx = h.riskLevel === 'CRITICAL' ? 24 : h.riskLevel === 'HIGH' ? 20 : 15;

          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onSelectFeature({ kind: 'hazard', data: h })}
              style={{
                left: `${sx}px`,
                top: `${sy}px`,
                width: `${footprintPx}px`,
                height: `${footprintPx}px`,
              }}
              title={`[Simulated DEM Hazard] ${h.riskLevel} RISK · ${h.category} · Slope ${h.slopeDeg.toFixed(1)}°`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md flex items-center justify-center hover:scale-125 transition-transform z-[18] ${zoneColor} ${
                isSelected ? 'ring-2 ring-white scale-125' : ''
              }`}
            >
              <span className={`w-2 h-2 rounded-full border border-black ${coreColor}`} />
              {isSelected && (
                <span className="absolute left-full ml-1.5 px-1.5 py-0.5 rounded bg-[#05070B]/95 border border-red-400/60 text-[9px] font-mono text-red-200 whitespace-nowrap pointer-events-none">
                  {h.riskLevel} · {h.category} (Sim)
                </span>
              )}
            </button>
          );
        })}

      {/* Layer: Science Clusters (zoom <= 5) & Unclustered Scientific Targets */}
      {layers.science &&
        markerLayout.scienceClusters.map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            onClick={() =>
              onViewportChange(
                cluster.centerLat,
                cluster.centerLon,
                Math.min(MAX_ZOOM, Math.max(zoom + 2, 7)),
              )
            }
            style={{ left: `${cluster.drawX}px`, top: `${cluster.drawY}px`, borderColor: cluster.colorHex }}
            title={`${cluster.items.length} science targets (${cluster.items.map((i) => i.site.title).join(', ')}) — Click to zoom`}
            className="absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-[#07090E]/92 border-2 text-[10px] font-mono font-bold text-white shadow-lg hover:scale-110 transition-transform z-20 flex items-center gap-1 whitespace-nowrap"
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cluster.colorHex }} />
            <span>{cluster.items.length} targets</span>
          </button>
        ))}

      {layers.science &&
        markerLayout.positionedScience.map((item) => (
          <button
            key={item.site.id}
            type="button"
            onClick={() => {
              setDismissedSciencePopupId(null);
              onSelectFeature({ kind: 'science', data: item.site });
            }}
            onMouseEnter={() => setHoveredScienceId(item.site.id)}
            onMouseLeave={() => setHoveredScienceId((cur) => (cur === item.site.id ? null : cur))}
            style={{ left: `${item.drawX}px`, top: `${item.drawY}px` }}
            title={`${item.site.title} · ${item.site.geologicalCategory} · Priority ${item.priority.totalScore}/100 (${item.site.confidenceLevel} confidence)`}
            className={`absolute -translate-x-1/2 -translate-y-1/2 p-1 rounded-full transition-transform z-20 ${
              item.isSelected
                ? 'ring-2 ring-cyan-300 bg-[#05070B]/85 scale-125 z-30'
                : 'hover:scale-125'
            }`}
          >
            <ScienceMarkerGlyph shape={item.catMeta.shape} colorHex={item.catMeta.colorHex} />
            {item.labelPos && (
              <span
                style={{
                  left: `${item.labelPos.x - item.drawX + 12}px`,
                  top: `${item.labelPos.y - item.drawY + 8}px`,
                }}
                className={`absolute px-1.5 py-0.5 rounded bg-[#05070B]/92 border text-[9px] font-mono whitespace-nowrap pointer-events-none ${
                  item.isSelected
                    ? 'border-cyan-400 text-cyan-100 font-semibold'
                    : 'border-white/15 text-slate-200'
                }`}
              >
                {item.labelText}
              </span>
            )}
          </button>
        ))}

      {/* Exploration Region Markers */}
      {locations.map((loc) => {
        const { sx, sy } = latLonToScreen(loc.lat, loc.lon);
        if (sx < -40 || sx > size.width + 40 || sy < -40 || sy > size.height + 40) return null;
        const isSelected = loc.id === selectedLocation.id;
        return (
          <button
            key={loc.id}
            type="button"
            onClick={() => onSelectFeature({ kind: 'location', data: loc })}
            style={{ left: `${sx}px`, top: `${sy}px` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group"
          >
            <span
              className={`w-3.5 h-3.5 rounded-full border-2 ${
                isSelected
                  ? 'bg-[#E85D2A] border-white scale-110'
                  : 'bg-[#0D1016] border-[#E85D2A] group-hover:scale-110'
              } transition-transform`}
            />
            {zoom <= 6 && (
              <span className="mt-1 px-1.5 py-0.5 rounded bg-[#05070B]/90 border border-white/15 text-[10px] font-mono text-white whitespace-nowrap">
                {loc.name}
              </span>
            )}
          </button>
        );
      })}

      {/* Layer: Rover Locations */}
      {layers.rovers &&
        rovers.map((rv) => {
          const { sx, sy } = latLonToScreen(rv.lat, rv.lon);
          if (sx < -40 || sx > size.width + 40 || sy < -40 || sy > size.height + 40) return null;
          const isSelected = selectedFeature?.kind === 'rover' && selectedFeature.data.id === rv.id;
          return (
            <button
              key={rv.id}
              type="button"
              onClick={() => onSelectFeature({ kind: 'rover', data: rv })}
              style={{ left: `${sx}px`, top: `${sy}px` }}
              title={rv.name}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 bg-emerald-500/90 hover:bg-emerald-400 text-black font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border shadow z-20 ${
                isSelected ? 'border-white ring-2 ring-emerald-300' : 'border-black'
              }`}
            >
              <span>◆ {rv.name.split(' ')[0]}</span>
            </button>
          );
        })}

      {layers.rovers &&
        zoom >= 6 &&
        selectedLocation.localWaypoints.map((wp) => {
          const { sx, sy } = latLonToScreen(wp.lat, wp.lon);
          if (sx < -20 || sx > size.width + 20 || sy < -20 || sy > size.height + 20) return null;
          const shortName = wp.name.replace(/\s*\([^)]+\)/, '');
          const showLabel = markerLayout.visibleWaypointLabels[wp.id];
          return (
            <div
              key={wp.id}
              style={{ left: `${sx}px`, top: `${sy}px` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-300 border border-black" />
              {showLabel && (
                <span className="text-[9px] font-mono text-yellow-200 bg-black/80 px-1 rounded whitespace-nowrap">
                  {shortName}
                </span>
              )}
            </div>
          );
        })}

      {/* Top-Left Coordinate Readout */}
      <div className="pointer-events-none absolute top-3 left-3 bg-[#090C12]/90 border border-white/15 rounded px-3 py-2 space-y-0.5 text-[11px] font-mono z-30">
        <div className="text-[#E85D2A] uppercase tracking-wider">
          Center: {centerLat.toFixed(3)}°{centerLat >= 0 ? 'N' : 'S'},{' '}
          {Math.abs(centerLon).toFixed(3)}°{centerLon >= 0 ? 'E' : 'W'} · Zoom {zoom}/{MAX_ZOOM}
        </div>
        <div className="text-cyan-300 tabular-nums">
          {cursorCoords
            ? `Cursor: ${cursorCoords.lat.toFixed(3)}°, ${cursorCoords.lon.toFixed(3)}°`
            : 'Drag to pan · Scroll or +/- to zoom'}
        </div>
        {hoveredRoughnessCell && (
          <div className="text-amber-300 tabular-nums">
            Roughness: {hoveredRoughnessCell.roughnessIdx.toFixed(1)}/100 · Slope{' '}
            {hoveredRoughnessCell.slopeDeg.toFixed(1)}°
          </div>
        )}
        {tileErrors > 0 && (
          <div className="text-amber-400 text-[10px]">
            Note: {tileErrors} tile request(s) failed upstream; vector overlay active.
          </div>
        )}
      </div>

      {/* Top-Right Zoom Controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-30">
        <button
          type="button"
          onClick={() => onViewportChange(centerLat, centerLon, Math.min(MAX_ZOOM, zoom + 1))}
          aria-label="Zoom in Mars map"
          className="w-8 h-8 rounded bg-[#090C12]/90 hover:bg-[#E85D2A] border border-white/15 text-white flex items-center justify-center transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onViewportChange(centerLat, centerLon, Math.max(MIN_ZOOM, zoom - 1))}
          aria-label="Zoom out Mars map"
          className="w-8 h-8 rounded bg-[#090C12]/90 hover:bg-[#E85D2A] border border-white/15 text-white flex items-center justify-center transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onViewportChange(selectedLocation.lat, selectedLocation.lon, 5)}
          aria-label="Center on active region"
          title="Center on selected site"
          className="w-8 h-8 rounded bg-[#090C12]/90 hover:bg-[#E85D2A] border border-white/15 text-white flex items-center justify-center transition-colors"
        >
          <LocateFixed className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom-Left Scale Bar */}
      <div className="pointer-events-none absolute bottom-3 left-3 bg-[#090C12]/85 border border-white/10 rounded px-2.5 py-1.5 flex items-center gap-2 text-[10px] font-mono text-slate-300 z-30">
        <div className="h-1.5 border-b-2 border-l-2 border-r-2 border-white" style={{ width: `${scaleBarWidth}px` }} />
        <span className="tabular-nums">{scaleKm} km</span>
      </div>

      {/* Floating Clickable Science Marker Info Popup */}
      {layers.science &&
        selectedFeature?.kind === 'science' &&
        dismissedSciencePopupId !== selectedFeature.data.id && (() => {
          const site = selectedFeature.data;
          const pos = markerLayout.positionedScience.find((p) => p.site.id === site.id);
          if (!pos) return null;
          const catMeta = GEOLOGICAL_CATEGORY_META[site.geologicalCategory];
          const isViaStop = Boolean(
            site.linkedWaypointId && scienceStopIds.includes(site.linkedWaypointId),
          );
          const popupLeft = Math.min(Math.max(12, pos.drawX + 16), Math.max(12, size.width - 282));
          const popupTop = Math.min(Math.max(12, pos.drawY - 24), Math.max(12, size.height - 178));
          return (
            <div
              style={{ left: `${popupLeft}px`, top: `${popupTop}px` }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute z-40 w-[268px] rounded bg-[#07090E]/96 border border-cyan-400/50 p-3 shadow-2xl space-y-2 text-[11px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span
                    className={`inline-block text-[9px] font-mono px-1.5 py-0.5 rounded border ${catMeta.bgClass} ${catMeta.borderClass} ${catMeta.textClass}`}
                  >
                    {site.geologicalCategory}
                  </span>
                  <div className="font-display font-bold text-white text-xs mt-1 leading-snug">
                    {site.title}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close science marker popup"
                  onClick={() => setDismissedSciencePopupId(site.id)}
                  className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-[10px] font-mono text-slate-300 tabular-nums">
                {site.lat.toFixed(4)}°, {site.lon.toFixed(4)}° · {site.elevationM} m · Priority{' '}
                <strong className="text-cyan-300">{pos.priority.totalScore}/100</strong>
              </div>
              <div className="text-[10px] font-mono text-emerald-300">
                Provenance: {site.provenanceClass || 'NASA archival reference'}
              </div>
              <p className="text-[10px] text-slate-300 line-clamp-2 leading-relaxed">
                {site.evidenceSummary}
              </p>
              <div className="flex items-center gap-1.5 pt-1">
                {onAddScienceWaypoint && (
                  <button
                    type="button"
                    disabled={isViaStop}
                    onClick={() => onAddScienceWaypoint(site)}
                    className={`flex-1 px-2 py-1 rounded text-[10px] font-mono font-semibold flex items-center justify-center gap-1 ${
                      isViaStop
                        ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 cursor-default'
                        : 'bg-[#E85D2A] hover:bg-[#d14e1e] text-white'
                    }`}
                  >
                    <Route className="w-3 h-3" />
                    {isViaStop ? 'On Active Route' : 'Add Waypoint'}
                  </button>
                )}
                {onOpenScienceExplorer && (
                  <button
                    type="button"
                    onClick={() => onOpenScienceExplorer(site)}
                    className="px-2 py-1 rounded bg-white/[0.08] hover:bg-white/15 border border-white/15 text-[10px] font-mono text-slate-200"
                  >
                    Details
                  </button>
                )}
              </div>
            </div>
          );
        })()}

      {/* Floating Route Segment Tooltip (2D Mars Map) */}
      {layers.route && hoveredRouteSeg && (
        <div
          style={{
            left: `${Math.min(Math.max(10, hoveredRouteSeg.sx + 12), Math.max(10, size.width - 250))}px`,
            top: `${Math.max(10, hoveredRouteSeg.sy - 84)}px`,
          }}
          className="pointer-events-none absolute z-30 w-[240px] rounded bg-[#07090E]/95 border border-white/20 px-2.5 py-2 text-[10px] font-mono shadow-xl space-y-0.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="uppercase font-bold text-white">
              {hoveredRouteSeg.profile} · Seg #{hoveredRouteSeg.segIdx + 1}
            </span>
            <span
              className={`font-bold ${
                hoveredRouteSeg.hazardLevel === 'CRITICAL'
                  ? 'text-red-400'
                  : hoveredRouteSeg.hazardLevel === 'HIGH'
                    ? 'text-orange-400'
                    : hoveredRouteSeg.hazardLevel === 'MODERATE'
                      ? 'text-amber-300'
                      : 'text-emerald-400'
              }`}
            >
              {hoveredRouteSeg.hazardLevel} HAZARD
            </span>
          </div>
          <div className="text-slate-300 tabular-nums">
            {hoveredRouteSeg.lat.toFixed(4)}°, {hoveredRouteSeg.lon.toFixed(4)}° · {hoveredRouteSeg.elevationM} m
          </div>
          <div className="text-slate-400 tabular-nums">
            Traverse: {hoveredRouteSeg.cumulativeDistKm.toFixed(2)} km · TRI {hoveredRouteSeg.roughnessIdx.toFixed(0)}/100
          </div>
          <div className="text-cyan-300 tabular-nums pt-0.5 border-t border-white/10">
            Terrain Diff: {hoveredRouteSeg.difficultyScore}/100 · Slope {hoveredRouteSeg.slopeDeg.toFixed(1)}°
          </div>
        </div>
      )}

      {/* Bottom-Right Collapsible Legends */}
      {(layers.roughness || layers.hazards || layers.science || layers.route) && (
        <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col items-end gap-1.5 max-w-[330px] z-30">
          {legendOpen && (
            <div className="flex flex-col items-end gap-1.5 max-h-[360px] overflow-y-auto">
              {layers.route && activeRoute && (
                <div className="bg-[#090C12]/94 border border-white/15 rounded px-3 py-1.5 text-[10px] font-mono space-y-0.5 w-full">
                  <div className="text-white uppercase tracking-wider">
                    Active: {activeRoute.profile} · {activeRoute.distanceKm.toFixed(1)} km
                  </div>
                  <div className="text-slate-300 text-[9px]">
                    Red: Shortest · Cyan: Balanced · Emerald: Safest
                  </div>
                  <div className="text-slate-400 text-[9px]">
                    Amber/Orange/Red segments: Mod/High/Crit Hazard
                  </div>
                </div>
              )}

              {layers.roughness && terrain && (
                <div className="bg-[#090C12]/94 border border-white/15 rounded px-3 py-2 text-[10px] font-mono space-y-1.5 w-full">
                  <div className="text-cyan-300 uppercase tracking-wider">
                    Roughness ({terrain.spanKm} km TRI · Simulated DEM)
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">0</span>
                    <div className="flex-1 h-2 rounded-sm border border-white/15 bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500" />
                    <span className="text-red-400">100</span>
                  </div>
                  <div className="text-[9px] text-slate-400 tabular-nums">
                    Mean {terrain.meanRoughness}/100 · Peak {terrain.maxRoughness}/100
                  </div>
                </div>
              )}

              {layers.science && (
                <div className="bg-[#090C12]/94 border border-white/15 rounded px-3 py-2 text-[10px] font-mono space-y-1.5 w-full">
                  <div className="text-cyan-300 uppercase tracking-wider">
                    Science Targets · NASA / Published Data
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {GEOLOGICAL_CATEGORIES.map((cat) => {
                      const meta = GEOLOGICAL_CATEGORY_META[cat];
                      return (
                        <span key={cat} className="flex items-center gap-1.5 text-slate-300 truncate">
                          <span className="shrink-0 flex items-center">
                            <ScienceMarkerGlyph shape={meta.shape} colorHex={meta.colorHex} />
                          </span>
                          <span className="truncate">{meta.shortTag}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {layers.hazards && (
                <div className="bg-[#090C12]/94 border border-white/15 rounded px-3 py-2 text-[10px] font-mono space-y-1 w-full">
                  <div className="text-slate-300 uppercase tracking-wider">
                    Hazard Zones · Simulated DEM (Not NASA Alert)
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" /> Low
                    </span>
                    <span className="flex items-center gap-1 text-amber-400">
                      <span className="w-2 h-2 rounded-full bg-amber-400" /> Moderate
                    </span>
                    <span className="flex items-center gap-1 text-orange-400">
                      <span className="w-2 h-2 rounded-full bg-orange-500" /> High
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                      <span className="w-2 h-2 rounded-full bg-red-500" /> Critical
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="px-2.5 py-1.5 rounded bg-[#090C12]/92 hover:bg-[#111723] border border-white/20 text-[11px] font-mono text-slate-200 flex items-center gap-1.5 shadow-lg transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-[#E85D2A]" />
            <span>Map Legend</span>
            {legendOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
