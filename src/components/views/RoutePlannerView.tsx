import { useState } from 'react';
import { CheckCircle2, FlaskConical, Globe2, Navigation, Route as RouteIcon, ShieldAlert, X } from 'lucide-react';
import { SCIENCE_SITES } from '../../data/scienceSites';
import { GEOLOGICAL_CATEGORIES, GEOLOGICAL_CATEGORY_META } from '../../engine/scienceEngine';
import type {
  LocalWaypoint,
  MarsLocation,
  MissionObjective,
  NavSection,
  RouteOption,
  RoutePlanSummary,
  RoutePreference,
  ScienceSite,
  TerrainGridCell,
} from '../../types/mars';
import { ROUTE_PROFILE_STYLE, TerrainMapCanvas, type TerrainColorMode } from '../TerrainMapCanvas';
import { ProvenanceTag } from '../ProvenanceTag';
import { AStarDiagnosticsPanel } from '../AStarDiagnosticsPanel';

interface RoutePlannerViewProps {
  locations: MarsLocation[];
  selectedLocation: MarsLocation;
  onSelectLocation: (loc: MarsLocation) => void;
  originWaypointId: string;
  onChangeOriginWaypoint: (id: string) => void;
  destWaypointId: string;
  onChangeDestWaypoint: (id: string) => void;
  scienceStops?: LocalWaypoint[];
  onAddScienceStop?: (site: ScienceSite) => void;
  onRemoveScienceStop?: (waypointId: string) => void;
  onClearScienceStops?: () => void;
  customOrigin: LocalWaypoint | null;
  customDest: LocalWaypoint | null;
  onSetCustomOrigin: (wp: LocalWaypoint) => void;
  onSetCustomDest: (wp: LocalWaypoint) => void;
  objective: MissionObjective;
  onChangeObjective: (obj: MissionObjective) => void;
  routePreference: RoutePreference;
  onChangeRoutePreference: (pref: RoutePreference) => void;
  maxDifficulty: number;
  onChangeMaxDifficulty: (val: number) => void;
  routePlan: RoutePlanSummary;
  selectedRouteId: string;
  onSelectRouteId: (id: string) => void;
  missionState: import('../../types/mars').CentralMissionState;
  onNavigate: (section: NavSection) => void;
}

const OBJECTIVES: Array<{ id: MissionObjective; label: string }> = [
  { id: 'geological-sampling', label: 'Geological Sampling' },
  { id: 'reconnaissance', label: 'Rapid Reconnaissance' },
  { id: 'isru-survey', label: 'ISRU Resource Survey' },
  { id: 'contingency-evac', label: 'Contingency Return' },
];

const PREFERENCES: Array<{ id: RoutePreference; label: string; hint: string }> = [
  { id: 'safest', label: 'Safest', hint: 'Prioritizes slope & hazard avoidance' },
  { id: 'balanced', label: 'Balanced', hint: 'Balances distance & terrain safety' },
  { id: 'shortest', label: 'Shortest', hint: 'Minimizes traverse distance' },
];

interface RoutePreset {
  id: string;
  label: string;
  locationId: string;
  originId: string;
  destId: string;
  preference: RoutePreference;
}

const DEMO_PRESETS: RoutePreset[] = [
  {
    id: 'preset-jezero-delta',
    label: 'Jezero: Perseverance Landing → Delta Region',
    locationId: 'jezero-crater',
    originId: 'jezero-butler',
    destId: 'jezero-delta',
    preference: 'balanced',
  },
  {
    id: 'preset-jezero-belva',
    label: 'Jezero: Delta Region → Belva Crater Rim',
    locationId: 'jezero-crater',
    originId: 'jezero-delta',
    destId: 'jezero-belva',
    preference: 'safest',
  },
  {
    id: 'preset-jezero-neretva',
    label: 'Jezero: Perseverance Landing → Neretva Vallis',
    locationId: 'jezero-crater',
    originId: 'jezero-butler',
    destId: 'jezero-neretva',
    preference: 'safest',
  },
  {
    id: 'preset-gale-gediz',
    label: 'Gale: Bradbury Landing → Gediz Vallis',
    locationId: 'gale-crater',
    originId: 'gale-bradbury',
    destId: 'gale-gediz',
    preference: 'safest',
  },
  {
    id: 'preset-elysium',
    label: 'Elysium: Homestead Hollow → Southern Graben',
    locationId: 'elysium-planitia',
    originId: 'elysium-homestead',
    destId: 'elysium-cerberus',
    preference: 'balanced',
  },
];

function buildElevationProfilePath(route: RouteOption, width: number, height: number): {
  linePath: string;
  areaPath: string;
  minElev: number;
  maxElev: number;
  points: Array<{
    x: number;
    y: number;
    risk: string;
    elev: number;
    dist: number;
    diff: number;
    slope: number;
    lat: number;
    lon: number;
  }>;
} {
  const wps = route.waypoints;
  if (wps.length < 2) {
    return { linePath: '', areaPath: '', minElev: 0, maxElev: 0, points: [] };
  }
  const padX = 12;
  const padY = 14;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const maxDist = Math.max(0.1, wps[wps.length - 1].cumulativeDistKm);
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const w of wps) {
    if (w.elevationM < minElev) minElev = w.elevationM;
    if (w.elevationM > maxElev) maxElev = w.elevationM;
  }
  const elevSpan = Math.max(10, maxElev - minElev);

  const points = wps.map((w) => {
    const x = padX + (w.cumulativeDistKm / maxDist) * plotW;
    const y = padY + (1 - (w.elevationM - minElev) / elevSpan) * plotH;
    return {
      x,
      y,
      risk: w.hazardLevel,
      elev: w.elevationM,
      dist: w.cumulativeDistKm,
      diff: w.difficultyScore,
      slope: w.slopeDeg,
      lat: w.lat,
      lon: w.lon,
    };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padY + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padY + plotH).toFixed(1)} Z`;
  return { linePath, areaPath, minElev, maxElev, points };
}

export function RoutePlannerView({
  locations,
  selectedLocation,
  onSelectLocation,
  originWaypointId,
  onChangeOriginWaypoint,
  destWaypointId,
  onChangeDestWaypoint,
  scienceStops = [],
  onAddScienceStop,
  onRemoveScienceStop,
  onClearScienceStops,
  customOrigin,
  customDest,
  onSetCustomOrigin,
  onSetCustomDest,
  objective,
  onChangeObjective,
  routePreference,
  onChangeRoutePreference,
  maxDifficulty,
  onChangeMaxDifficulty,
  routePlan,
  selectedRouteId,
  onSelectRouteId,
  missionState,
  onNavigate,
}: RoutePlannerViewProps) {
  const [mapColorMode, setMapColorMode] = useState<TerrainColorMode>('elevation');
  const [showHazards, setShowHazards] = useState<boolean>(true);
  const [showSegmentLabels, setShowSegmentLabels] = useState<boolean>(true);
  const [showScienceMarkers, setShowScienceMarkers] = useState<boolean>(true);
  const [selectedMapScience, setSelectedMapScience] = useState<ScienceSite | null>(null);
  const [hoveredProfileIdx, setHoveredProfileIdx] = useState<number | null>(null);
  const [clickMode, setClickMode] = useState<'inspect' | 'set-start' | 'set-dest'>('inspect');
  const [generatedBanner, setGeneratedBanner] = useState<string | null>(null);

  const regionalScienceSites = SCIENCE_SITES.filter((s) => s.locationId === selectedLocation.id);

  const activeRoute: RouteOption =
    routePlan.routes.find((r) => r.id === selectedRouteId) || routePlan.routes[0];

  const handleApplyPreset = (preset: RoutePreset) => {
    const loc = locations.find((l) => l.id === preset.locationId);
    if (loc && loc.id !== selectedLocation.id) {
      onSelectLocation(loc);
    }
    onChangeOriginWaypoint(preset.originId);
    onChangeDestWaypoint(preset.destId);
    onChangeRoutePreference(preset.preference);
    setGeneratedBanner(`Loaded preset: ${preset.label} (${preset.preference.toUpperCase()})`);
  };

  const handleGenerateRoute = () => {
    const targetId = `route-${routePreference}`;
    const targetRoute = routePlan.routes.find((r) => r.id === targetId) || activeRoute;
    onSelectRouteId(targetId);
    setGeneratedBanner(
      `Generated ${routePreference.toUpperCase()} A* route: ${routePlan.originName} → ${routePlan.destinationName} (${targetRoute.distanceKm.toFixed(2)} km · ${targetRoute.waypoints.length} nodes evaluated)`,
    );
  };

  const handleMapCellClick = (cell: TerrainGridCell) => {
    if (clickMode === 'inspect') return;
    const customWp: LocalWaypoint = {
      id: clickMode === 'set-start' ? 'custom-start' : 'custom-dest',
      name:
        clickMode === 'set-start'
          ? `Custom Start (${cell.xKm.toFixed(1)}, ${cell.yKm.toFixed(1)} km)`
          : `Custom Dest (${cell.xKm.toFixed(1)}, ${cell.yKm.toFixed(1)} km)`,
      lat: cell.lat,
      lon: cell.lon,
      elevationM: cell.elevationM,
      localXKm: cell.xKm,
      localYKm: cell.yKm,
      featureType: 'User-Selected Grid Coordinate',
      scienceValue: `Slope ${cell.slopeDeg.toFixed(1)}° · Roughness ${cell.roughnessIdx.toFixed(0)}/100`,
      missionSource: 'Interactive Grid Selection',
    };
    if (clickMode === 'set-start') {
      onSetCustomOrigin(customWp);
      setGeneratedBanner(`Start coordinate placed at (${cell.xKm.toFixed(1)}, ${cell.yKm.toFixed(1)} km)`);
    } else {
      onSetCustomDest(customWp);
      setGeneratedBanner(`Destination coordinate placed at (${cell.xKm.toFixed(1)}, ${cell.yKm.toFixed(1)} km)`);
    }
    setClickMode('inspect');
  };

  const waypointsForMap: LocalWaypoint[] = [
    ...selectedLocation.localWaypoints,
    ...(customOrigin ? [customOrigin] : []),
    ...(customDest ? [customDest] : []),
  ];

  const profile = buildElevationProfilePath(activeRoute, 540, 128);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2.5 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-white">
            Smart Mars Route Planner
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-4xl">
            8-connected A* surface pathfinding evaluating slope, TRI roughness, crater rim proximity, and difficulty tolerance across a 25×25 km demonstration grid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ProvenanceTag type="DERIVED CALCULATION" detail="A* Graph Search & Tobler-Adapted Traverse" />
          <ProvenanceTag type="SIMULATED DEMONSTRATION" detail="25×25 km Synthetic Terrain Grid" />
        </div>
      </div>

      {/* Jezero & Regional Preset Demonstration Bar */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Preset Demonstration Traverses (Jezero Crater &amp; Reference Regions)
          </span>
          <button
            type="button"
            onClick={() => onNavigate('mars-explorer')}
            className="text-[11px] font-mono text-cyan-400 hover:underline flex items-center gap-1"
          >
            <Globe2 className="w-3.5 h-3.5" />
            Inspect Route on Mars Explorer
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DEMO_PRESETS.map((preset) => {
            const isActive =
              selectedLocation.id === preset.locationId &&
              originWaypointId === preset.originId &&
              destWaypointId === preset.destId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className={`px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#E85D2A]/20 border-[#E85D2A] text-white font-semibold'
                    : 'bg-[#07090E] border-white/10 text-slate-300 hover:text-white hover:border-white/25'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Route Planner Control Deck */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1.5">
              Martian Region
            </label>
            <select
              value={selectedLocation.id}
              onChange={(e) => {
                const loc = locations.find((l) => l.id === e.target.value);
                if (loc) onSelectLocation(loc);
              }}
              className="w-full px-3 py-2 rounded bg-[#07090E] border border-white/15 text-xs text-white focus:outline-none focus:border-[#E85D2A]"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1.5">
              Starting Location
            </label>
            <select
              value={originWaypointId}
              onChange={(e) => onChangeOriginWaypoint(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[#07090E] border border-white/15 text-xs text-white focus:outline-none focus:border-[#E85D2A]"
            >
              {customOrigin && (
                <option value={customOrigin.id}>{customOrigin.name}</option>
              )}
              {selectedLocation.localWaypoints.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {wp.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1.5">
              Destination
            </label>
            <select
              value={destWaypointId}
              onChange={(e) => onChangeDestWaypoint(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[#07090E] border border-white/15 text-xs text-white focus:outline-none focus:border-[#E85D2A]"
            >
              {customDest && (
                <option value={customDest.id}>{customDest.name}</option>
              )}
              {selectedLocation.localWaypoints.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {wp.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1.5">
              Mission Objective
            </label>
            <select
              value={objective}
              onChange={(e) => onChangeObjective(e.target.value as MissionObjective)}
              className="w-full px-3 py-2 rounded bg-[#07090E] border border-white/15 text-xs text-white focus:outline-none focus:border-[#E85D2A]"
            >
              {OBJECTIVES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Route Preference + Terrain Tolerance + Generate Route Button */}
        <div className="pt-3 border-t border-white/10 grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-5 space-y-1.5">
            <div className="text-[11px] font-mono uppercase text-slate-400">
              Route Preference
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {PREFERENCES.map((pref) => {
                const active = routePreference === pref.id;
                return (
                  <button
                    key={pref.id}
                    type="button"
                    title={pref.hint}
                    onClick={() => onChangeRoutePreference(pref.id)}
                    className={`px-3 py-2 rounded border text-xs font-mono transition-colors ${
                      active
                        ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                        : 'bg-[#07090E] border-white/15 text-slate-300 hover:text-white'
                    }`}
                  >
                    {pref.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase text-slate-400">
              <span>Terrain Difficulty Tolerance</span>
              <span className="text-white tabular-nums">≤ {maxDifficulty} / 100</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={20}
                max={90}
                step={5}
                value={maxDifficulty}
                onChange={(e) => onChangeMaxDifficulty(Number(e.target.value))}
                aria-label="Terrain difficulty tolerance"
                className="flex-1 accent-[#E85D2A]"
              />
              <div className="flex gap-1 shrink-0">
                {[
                  { label: 'Strict', val: 35 },
                  { label: 'Std', val: 55 },
                  { label: 'High', val: 75 },
                ].map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => onChangeMaxDifficulty(t.val)}
                    className={`px-2 py-1 rounded text-[10px] font-mono border ${
                      maxDifficulty === t.val
                        ? 'border-cyan-400 text-cyan-300 bg-cyan-400/10'
                        : 'border-white/10 text-slate-400 bg-[#07090E] hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 flex items-center justify-end">
            <button
              type="button"
              onClick={handleGenerateRoute}
              className="w-full px-4 py-2.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-mono font-semibold text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Navigation className="w-3.5 h-3.5" />
              Generate Route
            </button>
          </div>
        </div>

        {/* Active Intermediate Science Waypoints Strip */}
        {(scienceStops.length > 0 || regionalScienceSites.length > 0) && (
          <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-cyan-300 flex items-center gap-1 uppercase">
                <FlaskConical className="w-3.5 h-3.5" />
                Science Stops ({scienceStops.length}):
              </span>
              {scienceStops.length === 0 ? (
                <span className="text-slate-400">
                  Direct traverse (click any science marker on the map or add from Science Explorer)
                </span>
              ) : (
                scienceStops.map((stop) => (
                  <span
                    key={stop.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/50 text-cyan-200"
                  >
                    <span>{stop.name}</span>
                    {onRemoveScienceStop && (
                      <button
                        type="button"
                        aria-label={`Remove science stop ${stop.name}`}
                        onClick={() => onRemoveScienceStop(stop.id)}
                        className="hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              {scienceStops.length > 0 && onClearScienceStops && (
                <button
                  type="button"
                  onClick={onClearScienceStops}
                  className="text-amber-300 hover:underline"
                >
                  Clear Stops
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('science-explorer')}
                className="text-[#E85D2A] hover:underline"
              >
                Open Science Explorer →
              </button>
            </div>
          </div>
        )}

        {generatedBanner && (
          <div className="px-3 py-2 rounded bg-[#07090E] border border-emerald-500/30 text-[11px] font-mono text-emerald-300 flex items-center justify-between gap-2">
            <span>{generatedBanner}</span>
            <button
              type="button"
              onClick={() => setGeneratedBanner(null)}
              className="text-slate-400 hover:text-white text-[10px]"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Map + Elevation Profile + Recommendation & Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-display font-semibold text-white">
                  A* Multi-Route Comparison Overlay
                </h2>
                <div className="text-[11px] font-mono text-slate-400">
                  Distinct offset lanes · Hover any segment for local difficulty &amp; hazard tooltip
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'elevation', label: 'Elevation' },
                    { id: 'hazard', label: 'Hazards' },
                    { id: 'slope', label: 'Slope' },
                    { id: 'roughness', label: 'Roughness' },
                  ] as Array<{ id: TerrainColorMode; label: string }>
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMapColorMode(m.id)}
                    className={`px-2 py-1 rounded text-[10px] font-mono border ${
                      mapColorMode === m.id
                        ? 'bg-[#E85D2A]/20 border-[#E85D2A] text-white'
                        : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowHazards((v) => !v)}
                  className={`px-2 py-1 rounded text-[10px] font-mono border ${
                    showHazards
                      ? 'bg-red-500/15 border-red-400/60 text-red-200'
                      : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {showHazards ? '✓ Hazards Overlay' : 'Hazards Hidden'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSegmentLabels((v) => !v)}
                  className={`px-2 py-1 rounded text-[10px] font-mono border ${
                    showSegmentLabels
                      ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-200'
                      : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {showSegmentLabels ? '✓ Segment Labels' : 'Labels Hidden'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowScienceMarkers((v) => !v)}
                  className={`px-2 py-1 rounded text-[10px] font-mono border ${
                    showScienceMarkers
                      ? 'bg-emerald-500/15 border-emerald-400/60 text-emerald-200'
                      : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {showScienceMarkers ? '✓ Science Targets' : 'Science Hidden'}
                </button>
              </div>
            </div>

            {/* Interactive Route Differentiation Legend (Shortest / Balanced / Safest) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[10px] font-mono">
              {routePlan.routes.map((r) => {
                const st = ROUTE_PROFILE_STYLE[r.profile];
                const isSelected = r.id === activeRoute.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRouteId(r.id)}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-left transition-colors ${
                      isSelected
                        ? 'bg-white/[0.08] border-white/35 text-white'
                        : 'bg-[#07090E] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <svg width="24" height="8" viewBox="0 0 24 8" className="shrink-0">
                        <line
                          x1="0"
                          y1="4"
                          x2="24"
                          y2="4"
                          stroke={st.color}
                          strokeWidth={isSelected ? '3' : '2'}
                          strokeDasharray={isSelected ? undefined : st.dash.join(' ')}
                        />
                      </svg>
                      <span className="font-semibold truncate" style={{ color: st.color }}>
                        {st.label}
                      </span>
                    </span>
                    <span className="tabular-nums text-slate-300 shrink-0">
                      {r.distanceKm.toFixed(1)}km · S{r.safetyScore}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Map Click Mode:</span>
                {(
                  [
                    { id: 'inspect', label: 'Inspect Cell' },
                    { id: 'set-start', label: 'Pick Start on Map' },
                    { id: 'set-dest', label: 'Pick Destination on Map' },
                  ] as const
                ).map((cm) => (
                  <button
                    key={cm.id}
                    type="button"
                    onClick={() => setClickMode(cm.id)}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      clickMode === cm.id
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                        : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {cm.label}
                  </button>
                ))}
              </div>
              {clickMode !== 'inspect' && (
                <span className="text-cyan-300">
                  Click any point on the 25 km terrain grid below...
                </span>
              )}
            </div>

            <TerrainMapCanvas
              terrain={routePlan.terrain}
              colorMode={mapColorMode}
              routes={routePlan.routes}
              selectedRouteId={activeRoute.id}
              waypoints={waypointsForMap}
              hazards={routePlan.hazards}
              originWaypointId={originWaypointId}
              destWaypointId={destWaypointId}
              scienceSites={regionalScienceSites}
              selectedScienceSiteId={selectedMapScience?.id}
              scienceStopIds={scienceStops.map((s) => s.id)}
              showScienceMarkers={showScienceMarkers}
              onSelectScienceSite={(site) => setSelectedMapScience(site)}
              showHazards={showHazards}
              showSegmentLabels={showSegmentLabels}
              onSelectRouteId={clickMode === 'inspect' ? onSelectRouteId : undefined}
              onSelectCell={handleMapCellClick}
              height={390}
            />

            {showScienceMarkers && (
              <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.08] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                  <span className="text-emerald-300 font-semibold">
                    Science Markers ({regionalScienceSites.length} in sector): Click any marker to inspect or add as route waypoint
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-slate-400">
                    {GEOLOGICAL_CATEGORIES.map((cat) => {
                      const meta = GEOLOGICAL_CATEGORY_META[cat];
                      return (
                        <span key={cat} className="inline-flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-sm inline-block"
                            style={{ backgroundColor: meta.colorHex }}
                          />
                          <span>{meta.shortTag}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                {selectedMapScience && (
                  <div className="pt-2 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display font-semibold text-white">
                          {selectedMapScience.title}
                        </span>
                        <span className="text-[10px] font-mono text-cyan-300">
                          {selectedMapScience.geologicalCategory} · {selectedMapScience.confidenceLevel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 line-clamp-1">
                        {selectedMapScience.evidenceSummary}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {onAddScienceStop &&
                        (() => {
                          const linkedWpId = selectedMapScience.linkedWaypointId || `sci-wp-${selectedMapScience.id}`;
                          const isStop = scienceStops.some((s) => s.id === linkedWpId);
                          return isStop && onRemoveScienceStop ? (
                            <button
                              type="button"
                              onClick={() => onRemoveScienceStop(linkedWpId)}
                              className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-[11px] font-mono text-emerald-200 hover:bg-emerald-500/30"
                            >
                              ✓ Waypoint Added (Remove)
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onAddScienceStop(selectedMapScience)}
                              className="px-2.5 py-1 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-[11px] font-mono font-semibold text-white"
                            >
                              + Add Route Waypoint
                            </button>
                          );
                        })()}
                      <button
                        type="button"
                        onClick={() => onNavigate('science-explorer')}
                        className="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/10 border border-white/15 text-[11px] font-mono text-cyan-300"
                      >
                        Dossier
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedMapScience(null)}
                        className="p-1 text-slate-400 hover:text-white"
                        title="Close science marker banner"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400 pt-1">
              <span>
                Active hazard segments: Amber Mod · Orange High · Red Critical (Hover or click routes to switch)
              </span>
              <span>
                Hazards: Simulated DEM Grid (not live NASA alert) · Waypoints: NASA Reference Sites
              </span>
            </div>
          </div>

          {/* Elevation & Hazard Traverse Profile */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                <RouteIcon className="w-3.5 h-3.5 text-[#E85D2A]" />
                Elevation &amp; Hazard Profile — {activeRoute.label}
              </h3>
              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                {profile.minElev} m to {profile.maxElev} m MOLA · {activeRoute.distanceKm.toFixed(2)} km
              </div>
            </div>
            <svg
              viewBox="0 0 540 128"
              onMouseLeave={() => setHoveredProfileIdx(null)}
              className="w-full h-32 bg-[#07090E] border border-white/[0.06] rounded"
            >
              {profile.areaPath && (
                <path
                  d={profile.areaPath}
                  fill={`${ROUTE_PROFILE_STYLE[activeRoute.profile].color}22`}
                />
              )}
              {profile.linePath && (
                <path
                  d={profile.linePath}
                  fill="none"
                  stroke={ROUTE_PROFILE_STYLE[activeRoute.profile].color}
                  strokeWidth="2.2"
                />
              )}
              {profile.points.map((pt, idx) => {
                const dotColor =
                  pt.risk === 'CRITICAL'
                    ? '#ef4444'
                    : pt.risk === 'HIGH'
                      ? '#f97316'
                      : pt.risk === 'MODERATE'
                        ? '#f59e0b'
                        : '#10b981';
                const isHovered = hoveredProfileIdx === idx;
                return (
                  <g key={idx}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 4.5 : 2.6}
                      fill={dotColor}
                      stroke={isHovered ? '#ffffff' : 'none'}
                      strokeWidth={1.2}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={9}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredProfileIdx(idx)}
                    >
                      <title>
                        {`${pt.dist.toFixed(2)} km · ${pt.lat.toFixed(4)}°, ${pt.lon.toFixed(4)}° · Elev ${pt.elev} m · Diff ${pt.diff}/100 · Slope ${pt.slope.toFixed(1)}° · ${pt.risk} HAZARD`}
                      </title>
                    </circle>
                  </g>
                );
              })}
            </svg>
            {hoveredProfileIdx !== null && profile.points[hoveredProfileIdx] ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono bg-[#07090E] border border-white/10 rounded px-2.5 py-1.5 text-slate-200 tabular-nums">
                <span>
                  Node #{hoveredProfileIdx + 1} · {profile.points[hoveredProfileIdx].dist.toFixed(2)} km (
                  {profile.points[hoveredProfileIdx].lat.toFixed(4)}°,{' '}
                  {profile.points[hoveredProfileIdx].lon.toFixed(4)}°)
                </span>
                <span className="text-cyan-300">
                  Diff: {profile.points[hoveredProfileIdx].diff}/100 · Slope{' '}
                  {profile.points[hoveredProfileIdx].slope.toFixed(1)}° · {profile.points[hoveredProfileIdx].elev} m
                </span>
                <span
                  className={
                    profile.points[hoveredProfileIdx].risk === 'CRITICAL'
                      ? 'text-red-400 font-bold'
                      : profile.points[hoveredProfileIdx].risk === 'HIGH'
                        ? 'text-orange-400 font-bold'
                        : profile.points[hoveredProfileIdx].risk === 'MODERATE'
                          ? 'text-amber-300 font-bold'
                          : 'text-emerald-400 font-bold'
                  }
                >
                  {profile.points[hoveredProfileIdx].risk} HAZARD
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                <span>Hover profile nodes for coordinate difficulty &amp; hazard details</span>
                <span>{activeRoute.coverageNote}</span>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Recommendation Callout */}
          <div className="bg-[#0D1016] border border-[#E85D2A]/40 rounded p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#E85D2A]">
                <CheckCircle2 className="w-4 h-4" />
                Route Planner Analysis ({routePreference})
              </div>
              <span
                className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                  activeRoute.passesMaxDifficulty
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                    : 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                }`}
              >
                {activeRoute.passesMaxDifficulty ? 'Within Tolerance' : 'Tolerance Exceeded'}
              </span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">{routePlan.selectionExplanation}</p>
            <div className="pt-1 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
              <span>
                Walk Traverse: <strong className="text-white">{missionState.timing.terrainAdjustedWalkingTimeHr.toFixed(2)} hr</strong>
              </span>
              <span>
                Total Mission Window: <strong className="text-cyan-300">{missionState.timing.totalMissionDurationHr.toFixed(2)} hr</strong>
              </span>
              <span>
                Readiness: <strong className={missionState.missionReadiness.hasInsufficientResource ? 'text-red-400' : 'text-emerald-400'}>{missionState.missionReadiness.score}/100</strong>
              </span>
            </div>
          </div>

          {/* Comparative Route Cards */}
          <div className="space-y-2.5 flex-1">
            {(() => {
              const shortestBaseline =
                routePlan.routes.find((rt) => rt.profile === 'shortest') || routePlan.routes[0];
              return routePlan.routes.map((route) => {
                const isSelected = route.id === activeRoute.id;
                const dDistKm = route.distanceKm - shortestBaseline.distanceKm;
                const dDistPct =
                  shortestBaseline.distanceKm > 0
                    ? (dDistKm / shortestBaseline.distanceKm) * 100
                    : 0;
                const dTimeMin = Math.round(
                  (route.estimatedDurationHr - shortestBaseline.estimatedDurationHr) * 60,
                );
                const riskReductionPts = route.safetyScore - shortestBaseline.safetyScore;
                const avoidedHazards =
                  shortestBaseline.hazardExposure.criticalSectionCount +
                  shortestBaseline.hazardExposure.highSectionCount -
                  (route.hazardExposure.criticalSectionCount +
                    route.hazardExposure.highSectionCount);
                return (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => onSelectRouteId(route.id)}
                    className={`w-full text-left p-3.5 rounded border transition-colors space-y-2 ${
                      isSelected
                        ? 'bg-[#E85D2A]/12 border-[#E85D2A] text-white'
                        : 'bg-[#0D1016] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-display font-semibold text-white flex items-center gap-2">
                        <span>{route.label}</span>
                        {route.recommended && (
                          <span className="text-[10px] font-mono uppercase text-[#E85D2A]">
                            · Preferred
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono font-bold text-white tabular-nums">
                        Safety {route.safetyScore}/100
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-[11px] font-mono text-slate-300">
                      <div>
                        <div className="text-slate-500 text-[10px]">Dist</div>
                        <div className="tabular-nums">{route.distanceKm.toFixed(2)} km</div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-[10px]">Time</div>
                        <div className="tabular-nums">{route.estimatedDurationHr.toFixed(2)} hr</div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-[10px]">Climb</div>
                        <div className="tabular-nums">+{route.elevationGainM} m</div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-[10px]">Max Slope</div>
                        <div className="tabular-nums">{route.maxSlopeDeg}°</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono pt-0.5">
                      <span className="text-slate-400">
                        On-Path: Crit {route.hazardExposure.criticalSectionCount} / High{' '}
                        {route.hazardExposure.highSectionCount} / Mod{' '}
                        {route.hazardExposure.moderateSectionCount}
                      </span>
                      <span className={route.passesMaxDifficulty ? 'text-emerald-400' : 'text-amber-400'}>
                        {route.passesMaxDifficulty ? 'Passes Tolerance' : 'Exceeds Tolerance'}
                      </span>
                    </div>

                    {route.profile !== 'shortest' && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono text-cyan-300 bg-[#07090E]/80 border border-white/[0.06] rounded px-2 py-1 tabular-nums">
                        <span>
                          vs Shortest: {dDistKm >= 0 ? '+' : ''}
                          {dDistKm.toFixed(2)} km ({dDistPct >= 0 ? '+' : ''}
                          {dDistPct.toFixed(1)}%)
                        </span>
                        <span>
                          {dTimeMin >= 0 ? `+${dTimeMin}` : dTimeMin} min
                        </span>
                        <span className={riskReductionPts > 0 ? 'text-emerald-300 font-semibold' : ''}>
                          Risk Reduction: {riskReductionPts >= 0 ? '+' : ''}
                          {riskReductionPts} safety pts
                          {avoidedHazards > 0 ? ` (−${avoidedHazards} Crit/High steps)` : ''}
                        </span>
                      </div>
                    )}

                    <p className="text-[11px] text-slate-400 leading-relaxed">{route.reasoning}</p>
                  </button>
                );
              });
            })()}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('hazard-detection')}
            className="w-full px-3 py-2 rounded bg-[#0D1016] hover:bg-white/[0.06] border border-white/15 text-xs font-mono text-slate-200 flex items-center justify-center gap-2 transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Open Full-Route Hazard &amp; Risk Breakdown
          </button>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="bg-[#0D1016] border border-white/10 rounded overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-display font-semibold text-white">
            Quantitative Alternative Route Comparison Matrix (vs Shortest Baseline)
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            Deterministic Safety = 100 − 2.1·Crit% − 1.25·High% − 0.32·Mod% − 1.05·MaxSlope − 0.26·MeanDiff
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#090B10] text-slate-400 border-b border-white/10">
              <tr>
                <th className="px-3.5 py-2.5">Route Profile</th>
                <th className="px-3.5 py-2.5">Distance (Δ vs Short)</th>
                <th className="px-3.5 py-2.5">Est. Time (Δ)</th>
                <th className="px-3.5 py-2.5">Elev Gain / Loss</th>
                <th className="px-3.5 py-2.5">Mean / Max Slope</th>
                <th className="px-3.5 py-2.5">On-Path C / H / M</th>
                <th className="px-3.5 py-2.5">Risk Reduction</th>
                <th className="px-3.5 py-2.5">Safety Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {(() => {
                const shortestBaseline =
                  routePlan.routes.find((rt) => rt.profile === 'shortest') || routePlan.routes[0];
                return routePlan.routes.map((r) => {
                  const dDistKm = r.distanceKm - shortestBaseline.distanceKm;
                  const dDistPct =
                    shortestBaseline.distanceKm > 0
                      ? (dDistKm / shortestBaseline.distanceKm) * 100
                      : 0;
                  const dTimeMin = Math.round(
                    (r.estimatedDurationHr - shortestBaseline.estimatedDurationHr) * 60,
                  );
                  const riskRed = r.safetyScore - shortestBaseline.safetyScore;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onSelectRouteId(r.id)}
                      className={`cursor-pointer transition-colors ${
                        r.id === activeRoute.id ? 'bg-[#E85D2A]/10 text-white' : 'text-slate-300 hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className="px-3.5 py-2.5 font-sans font-medium whitespace-nowrap">
                        {r.label}
                        {r.recommended ? ' (Preferred)' : ''}
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">
                        {r.distanceKm.toFixed(2)} km
                        {r.profile !== 'shortest' && (
                          <span className="text-slate-400 ml-1.5 text-[11px]">
                            ({dDistKm >= 0 ? '+' : ''}
                            {dDistKm.toFixed(2)} km / {dDistPct >= 0 ? '+' : ''}
                            {dDistPct.toFixed(1)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">
                        {r.estimatedDurationHr.toFixed(2)} hr
                        {r.profile !== 'shortest' && (
                          <span className="text-slate-400 ml-1.5 text-[11px]">
                            ({dTimeMin >= 0 ? `+${dTimeMin}` : dTimeMin}m)
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">
                        +{r.elevationGainM} / -{r.elevationLossM} m
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">
                        {r.meanSlopeDeg}° / {r.maxSlopeDeg}°
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">
                        {r.hazardExposure.criticalSectionCount} / {r.hazardExposure.highSectionCount} /{' '}
                        {r.hazardExposure.moderateSectionCount}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 tabular-nums whitespace-nowrap ${
                          r.profile === 'shortest'
                            ? 'text-slate-500'
                            : riskRed > 0
                              ? 'text-emerald-400 font-semibold'
                              : 'text-amber-300'
                        }`}
                      >
                        {r.profile === 'shortest'
                          ? 'Baseline (0 pts)'
                          : `${riskRed >= 0 ? '+' : ''}${riskRed} pts (${r.overallRiskLevel})`}
                      </td>
                      <td className="px-3.5 py-2.5 font-bold tabular-nums whitespace-nowrap">
                        {r.safetyScore}/100
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* A* Cost Function & Heuristic Diagnostic Panel */}
      <AStarDiagnosticsPanel
        routes={routePlan.routes}
        activeRoute={activeRoute}
        objective={objective}
        maxAcceptableDifficulty={maxDifficulty}
        onSelectRouteId={onSelectRouteId}
      />

      {/* Explicit Resolution & Non-Certification Disclaimer */}
      <div className="p-3.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono font-semibold text-amber-300 uppercase mr-2">
            Prototype Scope &amp; Safety Notice:
          </span>
          Routes are derived on a 500 m/cell synthetic terrain demonstration grid calibrated to published MOLA elevation and THEMIS thermal inertia baselines. This prototype cannot detect meter-scale boulders or regolith traps, and does <strong className="text-white">not</strong> certify any EVA corridor as safe for astronauts.
        </div>
      </div>
    </div>
  );
}
