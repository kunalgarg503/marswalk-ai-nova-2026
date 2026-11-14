import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  HazardZone,
  LandingZoneCandidate,
  LocalWaypoint,
  RiskLevel,
  RouteOption,
  RouteWaypointNode,
  ScienceSite,
  TerrainAnalysisResult,
  TerrainGridCell,
} from '../types/mars';
import { GEOLOGICAL_CATEGORY_META, type MarkerShape } from '../engine/scienceEngine';

export type TerrainColorMode =
  | 'elevation'
  | 'slope'
  | 'roughness'
  | 'crater-proximity'
  | 'thermal'
  | 'hazard'
  | 'landing';

interface TerrainMapCanvasProps {
  terrain: TerrainAnalysisResult;
  colorMode: TerrainColorMode;
  routes?: RouteOption[];
  selectedRouteId?: string;
  waypoints?: LocalWaypoint[];
  hazards?: HazardZone[];
  landingCandidates?: LandingZoneCandidate[];
  originWaypointId?: string;
  destWaypointId?: string;
  scienceSites?: ScienceSite[];
  selectedScienceSiteId?: string;
  scienceStopIds?: string[];
  showScienceMarkers?: boolean;
  onSelectScienceSite?: (site: ScienceSite) => void;
  showHazards?: boolean;
  showSegmentLabels?: boolean;
  onSelectRouteId?: (id: string) => void;
  onSelectCell?: (cell: TerrainGridCell) => void;
  height?: number;
}

interface ScreenRoutePoint {
  x: number;
  y: number;
  wp: RouteWaypointNode;
}

interface HoveredSegmentInfo {
  route: RouteOption;
  segmentIndex: number;
  lat: number;
  lon: number;
  xKm: number;
  yKm: number;
  elevationM: number;
  difficultyScore: number;
  slopeDeg: number;
  roughnessIdx: number;
  hazardLevel: RiskLevel;
  hazardReasons: string[];
  cumulativeDistKm: number;
  screenX: number;
  screenY: number;
}

const RISK_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export const ROUTE_PROFILE_STYLE: Record<
  RouteOption['profile'],
  {
    color: string;
    dimColor: string;
    dash: number[];
    offsetPx: number;
    shortTag: string;
    label: string;
  }
> = {
  shortest: {
    color: '#f87171',
    dimColor: 'rgba(248, 113, 113, 0.88)',
    dash: [6, 4],
    offsetPx: -3.5,
    shortTag: 'SHORT',
    label: 'Shortest',
  },
  balanced: {
    color: '#38bdf8',
    dimColor: 'rgba(56, 189, 248, 0.88)',
    dash: [10, 3, 2, 3],
    offsetPx: 0,
    shortTag: 'BAL',
    label: 'Balanced',
  },
  safest: {
    color: '#34d399',
    dimColor: 'rgba(52, 211, 153, 0.88)',
    dash: [3, 3],
    offsetPx: 3.5,
    shortTag: 'SAFE',
    label: 'Safest',
  },
};

function offsetPolyline(
  rawPoints: ScreenRoutePoint[],
  offsetPx: number,
): ScreenRoutePoint[] {
  if (rawPoints.length < 2 || Math.abs(offsetPx) < 0.01) return rawPoints;
  const n = rawPoints.length;
  return rawPoints.map((pt, i) => {
    // Taper offset at exact Start/Dest endpoints so routes converge cleanly on pins
    const endpointFactor = i === 0 || i === n - 1 ? 0.25 : 1;
    const prev = rawPoints[Math.max(0, i - 1)];
    const next = rawPoints[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return pt;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      x: pt.x + nx * offsetPx * endpointFactor,
      y: pt.y + ny * offsetPx * endpointFactor,
      wp: pt.wp,
    };
  });
}

function shortWaypointLabel(name: string): string {
  const paren = name.match(/\(([^)]+)\)/);
  if (paren && paren[1] && paren[1].length <= 16 && !paren[1].includes('km')) {
    return paren[1].replace('Octavia E. ', '');
  }
  const cleaned = name
    .replace(/^Jezero\s+(Crater\s+)?/i, '')
    .replace(/\s+Region$/i, '')
    .replace(/\s+Area$/i, '')
    .trim();
  const words = cleaned.split(/\s+/);
  return words.slice(0, 2).join(' ');
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * k);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * k);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * k);
  return `rgb(${r},${g},${b})`;
}

function getCellColor(cell: TerrainGridCell, mode: TerrainColorMode, minElev: number, maxElev: number): string {
  if (mode === 'elevation') {
    const span = Math.max(1, maxElev - minElev);
    const t = (cell.elevationM - minElev) / span;
    if (t < 0.35) return lerpColor([20, 32, 74], [32, 128, 148], t / 0.35);
    if (t < 0.7) return lerpColor([32, 128, 148], [218, 134, 52], (t - 0.35) / 0.35);
    return lerpColor([218, 134, 52], [238, 224, 212], (t - 0.7) / 0.3);
  }
  if (mode === 'slope') {
    const t = Math.min(1, cell.slopeDeg / 26);
    if (t < 0.4) return lerpColor([18, 36, 34], [217, 119, 6], t / 0.4);
    return lerpColor([217, 119, 6], [220, 38, 38], (t - 0.4) / 0.6);
  }
  if (mode === 'roughness') {
    const t = Math.min(1, cell.roughnessIdx / 85);
    if (t < 0.45) return lerpColor([15, 23, 42], [6, 182, 212], t / 0.45);
    return lerpColor([6, 182, 212], [244, 63, 94], (t - 0.45) / 0.55);
  }
  if (mode === 'crater-proximity') {
    const t = Math.max(0, Math.min(1, 1 - cell.craterProximityKm / 2.2));
    if (t < 0.5) return lerpColor([15, 23, 42], [180, 83, 9], t / 0.5);
    return lerpColor([180, 83, 9], [239, 68, 68], (t - 0.5) / 0.5);
  }
  if (mode === 'thermal') {
    const t = Math.max(0, Math.min(1, (cell.thermalInertia - 100) / 450));
    return lerpColor([17, 24, 39], [245, 158, 11], t);
  }
  if (mode === 'landing') {
    if (cell.landingSuitability === 'SUITABLE') return '#059669';
    if (cell.landingSuitability === 'MARGINAL') return '#1e3a5f';
    return '#18181b';
  }
  if (cell.hazardLevel === 'CRITICAL') return '#991b1b';
  if (cell.hazardLevel === 'HIGH') return '#c2410c';
  if (cell.hazardLevel === 'MODERATE') return '#a16207';
  return '#132a24';
}

function hazardColorHex(level: RiskLevel): string {
  if (level === 'CRITICAL') return '#ef4444';
  if (level === 'HIGH') return '#f97316';
  if (level === 'MODERATE') return '#f59e0b';
  return '#10b981';
}

function drawScienceShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  shape: MarkerShape,
  colorHex: string,
) {
  ctx.save();
  ctx.beginPath();
  if (shape === 'diamond') {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y);
    ctx.lineTo(x, y + r + 1);
    ctx.lineTo(x - r - 1, y);
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y + r);
    ctx.lineTo(x - r - 1, y + r);
    ctx.closePath();
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + Math.cos(a) * (r + 0.5);
      const py = y + Math.sin(a) * (r + 0.5);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r + 1.5 : (r + 1.5) * 0.45;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = shape === 'ring' ? '#07090E' : colorHex;
  ctx.fill();
  ctx.strokeStyle = shape === 'ring' ? colorHex : '#05070B';
  ctx.lineWidth = shape === 'ring' ? 2.2 : 1.4;
  ctx.stroke();
  ctx.restore();
}

export function TerrainMapCanvas({
  terrain,
  colorMode,
  routes = [],
  selectedRouteId,
  waypoints = [],
  hazards = [],
  landingCandidates = [],
  originWaypointId,
  destWaypointId,
  scienceSites = [],
  selectedScienceSiteId,
  scienceStopIds = [],
  showScienceMarkers = false,
  onSelectScienceSite,
  showHazards = true,
  showSegmentLabels = true,
  onSelectRouteId,
  onSelectCell,
  height = 400,
}: TerrainMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(640);
  const [hoveredCell, setHoveredCell] = useState<TerrainGridCell | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<HoveredSegmentInfo | null>(null);
  const [hoveredScienceSite, setHoveredScienceSite] = useState<ScienceSite | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const syncWidth = () => {
      if (canvas.clientWidth > 0) setCanvasWidth(canvas.clientWidth);
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const pad = 28;
  const plotW = Math.max(100, canvasWidth - pad * 2);
  const plotH = Math.max(100, height - pad * 2);

  const projectedRoutes = useMemo(() => {
    const toPx = (xKm: number, yKm: number) => ({
      x: pad + (xKm / terrain.spanKm) * plotW,
      y: pad + (1 - yKm / terrain.spanKm) * plotH,
    });
    return routes.map((r) => {
      const style = ROUTE_PROFILE_STYLE[r.profile];
      const rawPts: ScreenRoutePoint[] = r.waypoints.map((wp) => {
        const p = toPx(wp.xKm, wp.yKm);
        return { x: p.x, y: p.y, wp };
      });
      const pts = offsetPolyline(rawPts, style.offsetPx);
      return { route: r, style, pts };
    });
  }, [routes, terrain.spanKm, plotW, plotH]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || canvasWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const N = terrain.gridSize;
    const cellW = plotW / N;
    const cellH = plotH / N;

    ctx.fillStyle = '#07090E';
    ctx.fillRect(0, 0, width, height);

    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const cell = terrain.cells[gy][gx];
        ctx.fillStyle = getCellColor(cell, colorMode, terrain.minElevationM, terrain.maxElevationM);
        const px = pad + gx * cellW;
        const py = pad + (N - 1 - gy) * cellH;
        ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let km = 0; km <= terrain.spanKm; km += 5) {
      const fx = pad + (km / terrain.spanKm) * plotW;
      const fy = pad + (1 - km / terrain.spanKm) * plotH;
      ctx.beginPath();
      ctx.moveTo(fx, pad);
      ctx.lineTo(fx, pad + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pad, fy);
      ctx.lineTo(pad + plotW, fy);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(`${km}km`, fx - 10, pad + plotH + 14);
    }

    const toPx = (xKm: number, yKm: number) => ({
      x: pad + (xKm / terrain.spanKm) * plotW,
      y: pad + (1 - yKm / terrain.spanKm) * plotH,
    });

    // Landing/walking candidate circles
    for (const lc of landingCandidates) {
      const p = toPx(lc.xKm, lc.yKm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Hazard markers (toggleable)
    if (showHazards) {
      for (const h of hazards) {
        const p = toPx(h.xKm, h.yKm);
        ctx.beginPath();
        ctx.arc(p.x, p.y, h.riskLevel === 'CRITICAL' ? 5.5 : h.riskLevel === 'HIGH' ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = hazardColorHex(h.riskLevel);
        ctx.fill();
        ctx.strokeStyle = '#06070a';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Draw non-selected routes first with distinct lane offsets, colors & dashes, then selected route on top
    const orderedProjected = [...projectedRoutes].sort((a, b) =>
      a.route.id === selectedRouteId ? 1 : b.route.id === selectedRouteId ? -1 : 0,
    );

    for (const item of orderedProjected) {
      const { route: r, style, pts } = item;
      if (pts.length < 2) continue;
      const isSelected = r.id === selectedRouteId;
      ctx.save();

      // Dark casing under all routes so each line pops against bright elevation/hazard tiles
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = isSelected ? 'rgba(5, 7, 11, 0.92)' : 'rgba(5, 7, 11, 0.65)';
      ctx.lineWidth = isSelected ? 6 : 3.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      if (isSelected) {
        // Outer hazard-level halo along elevated-risk segments so hazard severity and route color are both clear
        for (let i = 1; i < pts.length; i++) {
          const prevPt = pts[i - 1];
          const currPt = pts[i];
          const segRisk: RiskLevel =
            RISK_RANK[currPt.wp.hazardLevel] >= RISK_RANK[prevPt.wp.hazardLevel]
              ? currPt.wp.hazardLevel
              : prevPt.wp.hazardLevel;
          if (segRisk === 'LOW') continue;

          ctx.beginPath();
          ctx.moveTo(prevPt.x, prevPt.y);
          ctx.lineTo(currPt.x, currPt.y);
          ctx.strokeStyle = hazardColorHex(segRisk);
          ctx.lineWidth = segRisk === 'CRITICAL' ? 8.2 : segRisk === 'HIGH' ? 7.4 : 6.4;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Dark separator casing so the distinct route core color stays sharp over hazard halos
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = 'rgba(5, 7, 11, 0.92)';
        ctx.lineWidth = 4.6;
        ctx.stroke();

        // Active route primary line in distinct profile color (Shortest Red / Balanced Cyan / Safest Emerald)
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = style.color;
        ctx.lineWidth = 2.8;
        ctx.stroke();

        // Node risk markers on HIGH / CRITICAL waypoints along the corridor
        for (let i = 1; i < pts.length; i++) {
          const currPt = pts[i];
          if (currPt.wp.hazardLevel === 'CRITICAL' || currPt.wp.hazardLevel === 'HIGH') {
            ctx.beginPath();
            ctx.arc(currPt.x, currPt.y, 3.3, 0, Math.PI * 2);
            ctx.fillStyle = currPt.wp.hazardLevel === 'CRITICAL' ? '#ef4444' : '#f97316';
            ctx.fill();
            ctx.strokeStyle = '#05070B';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      } else {
        // Alternate generated routes: clearly visible distinct color + unique dash pattern
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.setLineDash(style.dash);
        ctx.strokeStyle = style.dimColor;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Highlight actively hovered route segment
    if (hoveredSegment) {
      const match = projectedRoutes.find((p) => p.route.id === hoveredSegment.route.id);
      const segA = match?.pts[hoveredSegment.segmentIndex];
      const segB = match?.pts[hoveredSegment.segmentIndex + 1];
      if (segA && segB) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(segA.x, segA.y);
        ctx.lineTo(segB.x, segB.y);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6.5;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(segA.x, segA.y);
        ctx.lineTo(segB.x, segB.y);
        ctx.strokeStyle = hazardColorHex(hoveredSegment.hazardLevel);
        ctx.lineWidth = 3.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(hoveredSegment.screenX, hoveredSegment.screenY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#05070B';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Collision-checked label registry (Start/Dest waypoints get top priority, then segment labels, then other waypoints)
    const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    const placeBox = (
      lx: number,
      ly: number,
      w: number,
      h: number,
    ): { lx: number; ly: number } | null => {
      const x1 = Math.max(pad + 2, Math.min(pad + plotW - w - 2, lx));
      const y1 = Math.max(pad + 2, Math.min(pad + plotH - h - 2, ly));
      const box = { x1, y1, x2: x1 + w, y2: y1 + h };
      const overlaps = placedBoxes.some(
        (b) => !(box.x2 + 3 < b.x1 || box.x1 - 3 > b.x2 || box.y2 + 3 < b.y1 || box.y1 - 3 > b.y2),
      );
      if (overlaps) return null;
      placedBoxes.push(box);
      return { lx: x1, ly: y1 };
    };

    const orderedWps = [...waypoints].sort((a, b) => {
      const aPri = a.id === originWaypointId || a.id === destWaypointId ? 1 : 0;
      const bPri = b.id === originWaypointId || b.id === destWaypointId ? 1 : 0;
      return bPri - aPri;
    });

    // Reserve start, destination, and active intermediate science stop markers first
    const scienceStopSet = new Set(scienceStopIds);
    for (const wp of orderedWps) {
      const isOrigin = wp.id === originWaypointId;
      const isDest = wp.id === destWaypointId;
      const isVia = scienceStopSet.has(wp.id);
      if (!isOrigin && !isDest && !isVia) continue;
      const p = toPx(wp.localXKm, wp.localYKm);
      placedBoxes.push({ x1: p.x - 9, y1: p.y - 9, x2: p.x + 9, y2: p.y + 9 });
    }

    // Draw Start/Dest/Via pins & labels first, then other waypoints
    for (const wp of orderedWps) {
      const p = toPx(wp.localXKm, wp.localYKm);
      const isOrigin = wp.id === originWaypointId;
      const isDest = wp.id === destWaypointId;
      const isVia = !isOrigin && !isDest && scienceStopSet.has(wp.id);

      ctx.beginPath();
      ctx.arc(p.x, p.y, isOrigin || isDest ? 6.5 : isVia ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isOrigin ? '#22c55e' : isDest ? '#e85d2a' : isVia ? '#22d3ee' : '#e2e8f0';
      ctx.fill();
      ctx.strokeStyle = '#06070a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const baseLabel = shortWaypointLabel(wp.name);
      const label = isOrigin
        ? `START · ${baseLabel}`
        : isDest
          ? `DEST · ${baseLabel}`
          : isVia
            ? `STOP · ${baseLabel}`
            : baseLabel;
      ctx.font =
        isOrigin || isDest || isVia
          ? 'bold 10px "IBM Plex Mono", monospace'
          : '10px "IBM Plex Mono", monospace';
      const textW = ctx.measureText(label).width + 8;
      const textH = 14;

      const candidates = [
        { lx: p.x + 9, ly: p.y - 7 },
        { lx: p.x - textW - 9, ly: p.y - 7 },
        { lx: p.x - textW / 2, ly: p.y - 22 },
        { lx: p.x - textW / 2, ly: p.y + 10 },
      ];

      for (const cand of candidates) {
        const chosen = placeBox(cand.lx, cand.ly, textW, textH);
        if (chosen) {
          ctx.fillStyle = 'rgba(5, 7, 11, 0.88)';
          ctx.fillRect(chosen.lx, chosen.ly, textW, textH);
          ctx.fillStyle = isOrigin
            ? '#86efac'
            : isDest
              ? '#fdba74'
              : isVia
                ? '#67e8f9'
                : '#e2e8f0';
          ctx.fillText(label, chosen.lx + 4, chosen.ly + 10.5);
          break;
        }
      }
    }

    // Draw clickable Science Discovery Markers (distinct shape + color per geological category)
    if (showScienceMarkers && scienceSites.length > 0) {
      for (const site of scienceSites) {
        if (typeof site.localXKm !== 'number' || typeof site.localYKm !== 'number') continue;
        const p = toPx(site.localXKm, site.localYKm);
        const catMeta = GEOLOGICAL_CATEGORY_META[site.geologicalCategory];
        const isSelectedSci = site.id === selectedScienceSiteId;
        const isActiveStop = Boolean(site.linkedWaypointId && scienceStopSet.has(site.linkedWaypointId));

        if (isSelectedSci || isActiveStop) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.strokeStyle = isSelectedSci ? '#ffffff' : '#22d3ee';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }

        drawScienceShape(ctx, p.x, p.y, isSelectedSci ? 6.5 : 5.5, catMeta.shape, catMeta.colorHex);

        // Place short science label without overlapping pins or existing labels
        const sciLabel = site.title.length > 18 ? `${site.title.slice(0, 16)}…` : site.title;
        ctx.font = isSelectedSci ? 'bold 9.5px "IBM Plex Mono", monospace' : '9px "IBM Plex Mono", monospace';
        const tw = ctx.measureText(sciLabel).width + 8;
        const th = 13;
        const sciCands = [
          { lx: p.x + 11, ly: p.y - 6 },
          { lx: p.x - tw - 11, ly: p.y - 6 },
          { lx: p.x - tw / 2, ly: p.y - 23 },
          { lx: p.x - tw / 2, ly: p.y + 11 },
        ];
        for (const cand of sciCands) {
          const chosen = placeBox(cand.lx, cand.ly, tw, th);
          if (chosen) {
            ctx.fillStyle = 'rgba(5, 7, 11, 0.9)';
            ctx.fillRect(chosen.lx, chosen.ly, tw, th);
            ctx.strokeStyle = isSelectedSci ? '#22d3ee' : catMeta.colorHex;
            ctx.lineWidth = 0.9;
            ctx.strokeRect(chosen.lx, chosen.ly, tw, th);
            ctx.fillStyle = isSelectedSci ? '#cffafe' : '#f1f5f9';
            ctx.fillText(sciLabel, chosen.lx + 4, chosen.ly + 9.5);
            break;
          }
        }
      }
    }

    // Draw inline segment labels (terrain difficulty & hazard level) + route profile tags
    if (showSegmentLabels && projectedRoutes.length > 0) {
      const selectedProj = projectedRoutes.find((p) => p.route.id === selectedRouteId) || projectedRoutes[0];
      if (selectedProj && selectedProj.pts.length >= 2) {
        interface SegCandidate {
          midX: number;
          midY: number;
          difficulty: number;
          risk: RiskLevel;
          priority: number;
          segIdx: number;
        }
        const segCands: SegCandidate[] = [];
        for (let i = 1; i < selectedProj.pts.length; i++) {
          const a = selectedProj.pts[i - 1];
          const b = selectedProj.pts[i];
          const risk: RiskLevel =
            RISK_RANK[b.wp.hazardLevel] >= RISK_RANK[a.wp.hazardLevel]
              ? b.wp.hazardLevel
              : a.wp.hazardLevel;
          const difficulty = Math.round(Math.max(a.wp.difficultyScore, b.wp.difficultyScore));
          segCands.push({
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2,
            difficulty,
            risk,
            priority: RISK_RANK[risk] * 100 + difficulty,
            segIdx: i - 1,
          });
        }

        // Always try to show peak hazard/difficulty segment + midpoint nominal context (up to 3 non-overlapping callouts)
        const sortedSegs = [...segCands].sort((a, b) => b.priority - a.priority);
        const midSeg = segCands[Math.floor(segCands.length / 2)];
        const pickedSegs: SegCandidate[] = [];
        for (const s of sortedSegs) {
          if (pickedSegs.length >= 3) break;
          if (pickedSegs.every((p) => Math.hypot(p.midX - s.midX, p.midY - s.midY) >= 64)) {
            pickedSegs.push(s);
          }
        }
        if (
          midSeg &&
          pickedSegs.length < 3 &&
          pickedSegs.every((p) => Math.hypot(p.midX - midSeg.midX, p.midY - midSeg.midY) >= 56)
        ) {
          pickedSegs.push(midSeg);
        }

        for (const s of pickedSegs) {
          const riskTag = s.risk === 'MODERATE' ? 'MOD' : s.risk;
          const text = `Diff ${s.difficulty} · ${riskTag}`;
          ctx.font = 'bold 9.5px "IBM Plex Mono", monospace';
          const tw = ctx.measureText(text).width + 10;
          const th = 14;
          const offsets = [
            { lx: s.midX + 10, ly: s.midY - 18 },
            { lx: s.midX - tw - 10, ly: s.midY - 18 },
            { lx: s.midX + 10, ly: s.midY + 6 },
            { lx: s.midX - tw - 10, ly: s.midY + 6 },
          ];
          for (const off of offsets) {
            const chosen = placeBox(off.lx, off.ly, tw, th);
            if (chosen) {
              const cx = chosen.lx + tw / 2;
              const cy = chosen.ly + th / 2;
              ctx.beginPath();
              ctx.moveTo(s.midX, s.midY);
              ctx.lineTo(cx, cy);
              ctx.strokeStyle = hazardColorHex(s.risk);
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(s.midX, s.midY, 2.5, 0, Math.PI * 2);
              ctx.fillStyle = hazardColorHex(s.risk);
              ctx.fill();

              ctx.fillStyle = 'rgba(5, 7, 11, 0.92)';
              ctx.fillRect(chosen.lx, chosen.ly, tw, th);
              ctx.strokeStyle = hazardColorHex(s.risk);
              ctx.lineWidth = 1;
              ctx.strokeRect(chosen.lx, chosen.ly, tw, th);
              ctx.fillStyle = '#f8fafc';
              ctx.fillText(text, chosen.lx + 5, chosen.ly + 10);
              break;
            }
          }
        }
      }

      // Place concise route profile tags for each distinct route corridor
      const anchorFractions: Record<RouteOption['profile'], number> = {
        shortest: 0.28,
        balanced: 0.52,
        safest: 0.74,
      };
      for (const item of projectedRoutes) {
        if (item.pts.length < 2) continue;
        const idx = Math.min(
          item.pts.length - 1,
          Math.max(1, Math.floor(item.pts.length * anchorFractions[item.route.profile])),
        );
        const anchor = item.pts[idx];
        const tag = `${item.style.shortTag} ${item.route.distanceKm.toFixed(1)}km`;
        ctx.font = 'bold 9px "IBM Plex Mono", monospace';
        const tw = ctx.measureText(tag).width + 8;
        const th = 13;
        const cands = [
          { lx: anchor.x - tw / 2, ly: anchor.y - 20 },
          { lx: anchor.x + 10, ly: anchor.y - 6 },
          { lx: anchor.x - tw - 10, ly: anchor.y - 6 },
          { lx: anchor.x - tw / 2, ly: anchor.y + 10 },
        ];
        for (const cand of cands) {
          const chosen = placeBox(cand.lx, cand.ly, tw, th);
          if (chosen) {
            ctx.fillStyle = 'rgba(5, 7, 11, 0.9)';
            ctx.fillRect(chosen.lx, chosen.ly, tw, th);
            ctx.strokeStyle = item.style.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(chosen.lx, chosen.ly, tw, th);
            ctx.fillStyle = item.style.color;
            ctx.fillText(tag, chosen.lx + 4, chosen.ly + 9.5);
            break;
          }
        }
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, plotW, plotH);
  }, [
    terrain,
    colorMode,
    projectedRoutes,
    selectedRouteId,
    waypoints,
    hazards,
    landingCandidates,
    originWaypointId,
    destWaypointId,
    scienceSites,
    selectedScienceSiteId,
    scienceStopIds,
    showScienceMarkers,
    showHazards,
    showSegmentLabels,
    hoveredSegment,
    canvasWidth,
    plotW,
    plotH,
    height,
  ]);

  const getCellFromMouseEvent = (e: React.MouseEvent<HTMLCanvasElement>): TerrainGridCell | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - pad;
    const my = e.clientY - rect.top - pad;
    if (mx < 0 || mx > plotW || my < 0 || my > plotH) {
      return null;
    }
    const gx = Math.max(0, Math.min(terrain.gridSize - 1, Math.floor((mx / plotW) * terrain.gridSize)));
    const gy = Math.max(
      0,
      Math.min(terrain.gridSize - 1, terrain.gridSize - 1 - Math.floor((my / plotH) * terrain.gridSize)),
    );
    return terrain.cells[gy]?.[gx] || null;
  };

  const getNearestSegmentFromMouseEvent = (
    e: React.MouseEvent<HTMLCanvasElement>,
  ): HoveredSegmentInfo | null => {
    const canvas = canvasRef.current;
    if (!canvas || projectedRoutes.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let best: { dist: number; info: HoveredSegmentInfo; priorityBoost: number } | null = null;
    for (const item of projectedRoutes) {
      const pts = item.pts;
      const isSelected = item.route.id === selectedRouteId;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const lenSq = vx * vx + vy * vy;
        const t =
          lenSq > 0.0001
            ? Math.max(0, Math.min(1, ((mx - a.x) * vx + (my - a.y) * vy) / lenSq))
            : 0;
        const px = a.x + t * vx;
        const py = a.y + t * vy;
        const dist = Math.hypot(mx - px, my - py);
        if (dist > 10) continue;

        // Slight preference for selected route when routes are right next to each other
        const effectiveScore = dist - (isSelected ? 1.8 : 0);
        if (!best || effectiveScore < best.priorityBoost) {
          const domWp = RISK_RANK[b.wp.hazardLevel] >= RISK_RANK[a.wp.hazardLevel] ? b.wp : a.wp;
          const terrainCell = terrain.cells[domWp.gy]?.[domWp.gx];
          const segHazard: RiskLevel =
            terrainCell && RISK_RANK[terrainCell.hazardLevel] > RISK_RANK[domWp.hazardLevel]
              ? terrainCell.hazardLevel
              : domWp.hazardLevel;
          best = {
            dist,
            priorityBoost: effectiveScore,
            info: {
              route: item.route,
              segmentIndex: i - 1,
              lat: a.wp.lat + (b.wp.lat - a.wp.lat) * t,
              lon: a.wp.lon + (b.wp.lon - a.wp.lon) * t,
              xKm: a.wp.xKm + (b.wp.xKm - a.wp.xKm) * t,
              yKm: a.wp.yKm + (b.wp.yKm - a.wp.yKm) * t,
              elevationM: Math.round(
                a.wp.elevationM + (b.wp.elevationM - a.wp.elevationM) * t,
              ),
              difficultyScore: Math.round(
                a.wp.difficultyScore + (b.wp.difficultyScore - a.wp.difficultyScore) * t,
              ),
              slopeDeg: a.wp.slopeDeg + (b.wp.slopeDeg - a.wp.slopeDeg) * t,
              roughnessIdx: a.wp.roughnessIdx + (b.wp.roughnessIdx - a.wp.roughnessIdx) * t,
              hazardLevel: segHazard,
              hazardReasons: terrainCell?.hazardReasons || [],
              cumulativeDistKm:
                a.wp.cumulativeDistKm + (b.wp.cumulativeDistKm - a.wp.cumulativeDistKm) * t,
              screenX: px,
              screenY: py,
            },
          };
        }
      }
    }
    return best ? best.info : null;
  };

  const getNearestScienceFromMouseEvent = (
    e: React.MouseEvent<HTMLCanvasElement>,
  ): ScienceSite | null => {
    if (!showScienceMarkers || scienceSites.length === 0) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: { dist: number; site: ScienceSite } | null = null;
    for (const s of scienceSites) {
      if (typeof s.localXKm !== 'number' || typeof s.localYKm !== 'number') continue;
      const sx = pad + (s.localXKm / terrain.spanKm) * plotW;
      const sy = pad + (1 - s.localYKm / terrain.spanKm) * plotH;
      const dist = Math.hypot(mx - sx, my - sy);
      if (dist <= 13 && (!best || dist < best.dist)) {
        best = { dist, site: s };
      }
    }
    return best ? best.site : null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setHoveredCell(getCellFromMouseEvent(e));
    setHoveredSegment(getNearestSegmentFromMouseEvent(e));
    setHoveredScienceSite(getNearestScienceFromMouseEvent(e));
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sci = getNearestScienceFromMouseEvent(e);
    if (sci && onSelectScienceSite) {
      onSelectScienceSite(sci);
      return;
    }
    const cell = getCellFromMouseEvent(e);
    if (onSelectCell && cell) {
      onSelectCell(cell);
    }
    const seg = getNearestSegmentFromMouseEvent(e);
    if (seg && onSelectRouteId && seg.route.id !== selectedRouteId) {
      onSelectRouteId(seg.route.id);
    }
  };

  const tooltipLeft = hoveredSegment
    ? Math.min(Math.max(8, hoveredSegment.screenX + 14), Math.max(8, canvasWidth - 266))
    : 0;
  const tooltipTop = hoveredSegment
    ? hoveredSegment.screenY > height * 0.54
      ? Math.max(8, hoveredSegment.screenY - 126)
      : Math.min(height - 126, hoveredSegment.screenY + 12)
    : 0;

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={() => {
          setHoveredCell(null);
          setHoveredSegment(null);
          setHoveredScienceSite(null);
        }}
        style={{ height: `${height}px` }}
        className={`w-full block rounded border border-white/10 ${
          hoveredScienceSite ? 'cursor-pointer' : 'cursor-crosshair'
        }`}
      />

      {/* Floating Route Segment Tooltip displaying local terrain difficulty & hazard level at coordinates */}
      {hoveredSegment && (
        <div
          style={{ left: `${tooltipLeft}px`, top: `${tooltipTop}px` }}
          className="pointer-events-none absolute z-20 w-[254px] rounded bg-[#07090E]/95 border border-white/20 px-3 py-2 shadow-xl text-[10px] font-mono space-y-1"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="font-bold uppercase"
              style={{ color: ROUTE_PROFILE_STYLE[hoveredSegment.route.profile].color }}
            >
              {ROUTE_PROFILE_STYLE[hoveredSegment.route.profile].label} · Seg #{hoveredSegment.segmentIndex + 1}
            </span>
            <span
              className="px-1.5 py-0.5 rounded font-bold text-[9px]"
              style={{
                backgroundColor: `${hazardColorHex(hoveredSegment.hazardLevel)}22`,
                color: hazardColorHex(hoveredSegment.hazardLevel),
                border: `1px solid ${hazardColorHex(hoveredSegment.hazardLevel)}66`,
              }}
            >
              {hoveredSegment.hazardLevel} HAZARD
            </span>
          </div>
          <div className="text-slate-300 tabular-nums">
            Coords: {hoveredSegment.lat.toFixed(4)}°, {hoveredSegment.lon.toFixed(4)}° · {hoveredSegment.elevationM} m
          </div>
          <div className="text-slate-400 tabular-nums">
            Grid ({hoveredSegment.xKm.toFixed(1)}, {hoveredSegment.yKm.toFixed(1)} km) · {hoveredSegment.cumulativeDistKm.toFixed(2)} km
          </div>
          <div className="flex items-center justify-between pt-0.5 border-t border-white/10 text-slate-200 tabular-nums">
            <span>
              Terrain Diff: <strong className="text-cyan-300">{hoveredSegment.difficultyScore}/100</strong>
            </span>
            <span>
              Slope {hoveredSegment.slopeDeg.toFixed(1)}° · TRI {hoveredSegment.roughnessIdx.toFixed(0)}
            </span>
          </div>
          {hoveredSegment.hazardReasons.length > 0 && (
            <div className="text-[9px] text-amber-300/90 truncate">
              {hoveredSegment.hazardReasons[0]}
            </div>
          )}
        </div>
      )}

      {(hoveredSegment || hoveredCell) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-slate-300 bg-[#0D1016] border border-white/10 rounded px-3 py-2">
          {hoveredSegment ? (
            <>
              <span
                className="font-semibold"
                style={{ color: ROUTE_PROFILE_STYLE[hoveredSegment.route.profile].color }}
              >
                {ROUTE_PROFILE_STYLE[hoveredSegment.route.profile].label} Segment #{hoveredSegment.segmentIndex + 1}
              </span>
              <span className="tabular-nums">
                {hoveredSegment.lat.toFixed(4)}°, {hoveredSegment.lon.toFixed(4)}° ({hoveredSegment.xKm.toFixed(1)},{' '}
                {hoveredSegment.yKm.toFixed(1)} km)
              </span>
              <span className="text-cyan-300 tabular-nums">
                Difficulty: {hoveredSegment.difficultyScore}/100
              </span>
              <span className="tabular-nums">Slope: {hoveredSegment.slopeDeg.toFixed(1)}°</span>
              <span className="tabular-nums">Roughness: {hoveredSegment.roughnessIdx.toFixed(0)}/100</span>
              <span
                className="font-semibold"
                style={{ color: hazardColorHex(hoveredSegment.hazardLevel) }}
              >
                Hazard: {hoveredSegment.hazardLevel}
              </span>
            </>
          ) : (
            hoveredCell && (
              <>
                <span className="text-[#E85D2A]">
                  Grid ({hoveredCell.xKm.toFixed(1)}, {hoveredCell.yKm.toFixed(1)} km)
                </span>
                <span>
                  Lat {hoveredCell.lat.toFixed(3)}° · Lon {hoveredCell.lon.toFixed(3)}°
                </span>
                <span>Elev: {hoveredCell.elevationM} m</span>
                <span>Diff: {hoveredCell.difficultyScore}/100</span>
                <span>Slope: {hoveredCell.slopeDeg.toFixed(1)}°</span>
                <span>Roughness: {hoveredCell.roughnessIdx.toFixed(0)}/100</span>
                <span
                  className={
                    hoveredCell.hazardLevel === 'CRITICAL'
                      ? 'text-red-400 font-semibold'
                      : hoveredCell.hazardLevel === 'HIGH'
                        ? 'text-orange-400 font-semibold'
                        : hoveredCell.hazardLevel === 'MODERATE'
                          ? 'text-amber-400 font-semibold'
                          : 'text-emerald-400 font-semibold'
                  }
                >
                  Risk: {hoveredCell.hazardLevel}
                </span>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
