import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type {
  HazardZone,
  MarsLocation,
  RiskLevel,
  RouteOption,
  TerrainAnalysisResult,
} from '../../types/mars';
import { TerrainMapCanvas, type TerrainColorMode } from '../TerrainMapCanvas';
import { ProvenanceTag } from '../ProvenanceTag';

interface TerrainIntelligenceViewProps {
  location: MarsLocation;
  terrain: TerrainAnalysisResult;
  activeRoute: RouteOption;
  hazards: HazardZone[];
}

const LAYER_MODES: Array<{ id: TerrainColorMode; label: string; legend: string }> = [
  { id: 'elevation', label: 'Elevation', legend: 'Blue (Low) → Teal → Amber → White (High)' },
  { id: 'slope', label: 'Slope', legend: 'Dark Teal (0°) → Amber (12°) → Red (26°+)' },
  { id: 'roughness', label: 'Roughness', legend: 'Slate (Smooth) → Cyan → Rose (Rough)' },
  { id: 'crater-proximity', label: 'Crater Proximity', legend: 'Slate (>2 km) → Amber → Red (<0.4 km rim)' },
  { id: 'thermal', label: 'THEMIS TIU', legend: 'Navy (Dusty <150 TIU) → Amber (Bedrock >400 TIU)' },
  { id: 'hazard', label: 'Risk Class', legend: 'Green (Low) · Amber (Mod) · Orange (High) · Red (Critical)' },
  { id: 'landing', label: 'Landing & Walk', legend: 'Emerald: Qualifying flat low-roughness corridors' },
];

export function TerrainIntelligenceView({
  location,
  terrain,
  activeRoute,
  hazards,
}: TerrainIntelligenceViewProps) {
  const [colorMode, setColorMode] = useState<TerrainColorMode>('elevation');
  const [copiedReport, setCopiedReport] = useState(false);

  const wps = activeRoute.waypoints;
  const maxDist = Math.max(0.1, activeRoute.distanceKm);
  const elevs = wps.map((w) => w.elevationM);
  const minE = Math.min(...elevs) - 15;
  const maxE = Math.max(...elevs) + 15;
  const eSpan = Math.max(10, maxE - minE);

  const svgW = 680;
  const svgH = 175;
  const padX = 44;
  const padY = 20;
  const plotW = svgW - padX * 2;
  const plotH = svgH - padY * 2;

  const points = wps
    .map((w) => {
      const x = padX + (w.cumulativeDistKm / maxDist) * plotW;
      const y = padY + (1 - (w.elevationM - minE) / eSpan) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPoints = `${padX},${padY + plotH} ${points} ${padX + plotW},${padY + plotH}`;

  const flatCount = terrain.cells.flat().filter((c) => c.slopeDeg < 10).length;
  const gentleCount = terrain.cells.flat().filter((c) => c.slopeDeg >= 10 && c.slopeDeg < 16).length;
  const steepCount = terrain.cells.flat().filter((c) => c.slopeDeg >= 16 && c.slopeDeg < 23).length;
  const criticalSlopeCount = terrain.cells.flat().filter((c) => c.slopeDeg >= 23).length;
  const totalCells = terrain.gridSize * terrain.gridSize;

  const overallRegionalRisk: RiskLevel =
    terrain.criticalRiskCellPct >= 5
      ? 'CRITICAL'
      : terrain.highRiskCellPct >= 14
        ? 'HIGH'
        : terrain.moderateRiskCellPct >= 28
          ? 'MODERATE'
          : 'LOW';

  const activeLayerMeta = LAYER_MODES.find((m) => m.id === colorMode)!;
  const cellResolutionM = Math.round(terrain.cellSizeKm * 1000);

  const handleCopyReport = () => {
    const reportText = [
      `MARSWALK AI — TERRAIN INTELLIGENCE REPORT`,
      `Location: ${location.name} (${location.region})`,
      `Coordinates: ${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E`,
      `Elevation (MOLA Reference): ${location.elevationM} m (Modeled Regional Range: ${terrain.minElevationM} m to ${terrain.maxElevationM} m, Mean ${terrain.meanElevationM} m)`,
      `Terrain Characteristics: Mean Slope ${terrain.meanSlopeDeg}° (Max ${terrain.maxSlopeDeg}°), Mean Roughness ${terrain.meanRoughness}/100, Min Crater Proximity ${terrain.minCraterProximityKm} km, ${terrain.landingZoneCount} qualifying landing/walking cells`,
      `Risk Breakdown: LOW ${terrain.lowRiskCellPct}% | MODERATE ${terrain.moderateRiskCellPct}% | HIGH ${terrain.highRiskCellPct}% | CRITICAL ${terrain.criticalRiskCellPct}%`,
      `Overall Regional Risk Level: ${overallRegionalRisk} RISK`,
      `Detected Hazards: ${hazards.length} clustered zones (${hazards.filter((h) => h.riskLevel === 'CRITICAL').length} CRITICAL, ${hazards.filter((h) => h.riskLevel === 'HIGH').length} HIGH)`,
      `Data Sources: NASA MGS MOLA Datum Anchor (${location.elevationM} m), Mars Odyssey THEMIS Thermal Inertia Anchor (${location.thermalInertiaTIU} TIU), Synthetic ${terrain.gridSize}x${terrain.gridSize} Demonstration Grid (${cellResolutionM} m/cell).`,
      `Confidence & Limitations: Macro elevation and thermal anchors come from published NASA orbital datasets; meter-scale terrain slopes and crater rims are synthetic demonstration models and cannot substitute for MRO HiRISE (0.25 m/px) stereo DTMs.`,
    ].join('\n');

    navigator.clipboard
      ?.writeText(reportText)
      .then(() => {
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2000);
      })
      .catch(() => {
        setCopiedReport(false);
      });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2.5 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-white">
            Terrain Intelligence — {location.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-4xl">
            25 km × 25 km regional terrain engine ({terrain.gridSize}×{terrain.gridSize} cells, {cellResolutionM} m/cell) anchored to published MOLA elevation ({location.elevationM} m) and THEMIS thermal inertia ({location.thermalInertiaTIU} TIU).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" detail="MOLA Elevation & THEMIS TIU Anchors" />
          <ProvenanceTag type="DERIVED CALCULATION" detail="Finite-Difference Slope, TRI & Landing Filter" />
          <ProvenanceTag type="SIMULATED DEMONSTRATION" detail={`${cellResolutionM} m Synthetic Regional Grid`} />
        </div>
      </div>

      {/* Top Scientific Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Elevation Span</div>
          <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
            {terrain.minElevationM}..{terrain.maxElevationM} m
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">Mean {terrain.meanElevationM} m</div>
        </div>
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Mean / Max Slope</div>
          <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
            {terrain.meanSlopeDeg}° / {terrain.maxSlopeDeg}°
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">Gradient |∇z|</div>
        </div>
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Surface Roughness</div>
          <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
            {terrain.meanRoughness} / 100
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">Peak {terrain.maxRoughness}/100</div>
        </div>
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Crater Proximity</div>
          <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
            {terrain.meanCraterProximityKm} km avg
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">Min {terrain.minCraterProximityKm} km</div>
        </div>
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Landing / Walk Cells</div>
          <div className="text-base font-mono font-bold text-emerald-400 mt-1 tabular-nums">
            {terrain.landingZoneCount} sectors
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">Slope ≤ 5.5° · Firm TIU</div>
        </div>
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase">Critical + High Risk</div>
          <div className="text-base font-mono font-bold text-red-400 mt-1 tabular-nums">
            {(terrain.criticalRiskCellPct + terrain.highRiskCellPct).toFixed(1)}%
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
            Crit {terrain.criticalRiskCellPct}% · High {terrain.highRiskCellPct}%
          </div>
        </div>
      </div>

      {/* Main Visual Analysis Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-display font-semibold text-white">
                Spatial Terrain Layer Inspector
              </h2>
              <span className="text-[11px] font-mono text-slate-400">{activeLayerMeta.legend}</span>
            </div>
            <ProvenanceTag
              type={
                colorMode === 'elevation' || colorMode === 'thermal'
                  ? 'SIMULATED DEMONSTRATION'
                  : 'DERIVED CALCULATION'
              }
              detail={
                colorMode === 'elevation'
                  ? 'MOLA Datum + Synthetic 500 m DEM'
                  : colorMode === 'thermal'
                    ? 'THEMIS TIU Baseline + Synthetic Grid'
                    : 'Computed from Synthetic 500 m DEM'
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 bg-[#07090E] p-1 rounded border border-white/10">
            {LAYER_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setColorMode(mode.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors whitespace-nowrap ${
                  colorMode === mode.id
                    ? 'bg-[#E85D2A] text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <TerrainMapCanvas
            terrain={terrain}
            colorMode={colorMode}
            routes={[activeRoute]}
            selectedRouteId={activeRoute.id}
            waypoints={location.localWaypoints}
            landingCandidates={colorMode === 'landing' ? terrain.landingCandidates : []}
            height={380}
          />
        </div>

        <div className="lg:col-span-5 space-y-5">
          {/* Elevation Profile */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-white">
                Active Route Elevation Cross-Section
              </h2>
              <span className="text-[11px] font-mono text-amber-400 tabular-nums">
                +{activeRoute.elevationGainM} m / -{activeRoute.elevationLossM} m
              </span>
            </div>

            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-auto bg-[#07090E] rounded border border-white/[0.06]"
            >
              <defs>
                <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E85D2A" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#E85D2A" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((f) => {
                const y = padY + f * plotH;
                const val = Math.round(maxE - f * eSpan);
                return (
                  <g key={f}>
                    <line x1={padX} y1={y} x2={padX + plotW} y2={y} stroke="rgba(255,255,255,0.07)" />
                    <text x={6} y={y + 3} fill="#64748b" fontSize="10" fontFamily="IBM Plex Mono">
                      {val}m
                    </text>
                  </g>
                );
              })}
              <polygon points={areaPoints} fill="url(#elevFill)" />
              <polyline points={points} fill="none" stroke="#E85D2A" strokeWidth="2.5" />
              <text x={padX} y={svgH - 4} fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono">
                0.0 km
              </text>
              <text x={padX + plotW - 42} y={svgH - 4} fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono">
                {maxDist.toFixed(1)} km
              </text>
            </svg>
          </div>

          {/* 4-Tier Slope & Difficulty Classification */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
            <h2 className="text-sm font-display font-semibold text-white">
              4-Level Risk &amp; Slope Classification Distribution
            </h2>
            <div className="space-y-2.5 text-xs font-mono">
              {[
                { label: 'LOW RISK (0°–10° · Safe Terrain)', pct: terrain.lowRiskCellPct, color: 'bg-emerald-500' },
                { label: 'MODERATE RISK (10°–16° · Caution)', pct: terrain.moderateRiskCellPct, color: 'bg-amber-500' },
                { label: 'HIGH RISK (16°–23° · Difficult)', pct: terrain.highRiskCellPct, color: 'bg-orange-500' },
                { label: 'CRITICAL RISK (≥23° · Avoid)', pct: terrain.criticalRiskCellPct, color: 'bg-red-500' },
              ].map((b) => (
                <div key={b.label} className="space-y-1">
                  <div className="flex justify-between text-slate-300">
                    <span>{b.label}</span>
                    <span className="tabular-nums">{b.pct}%</span>
                  </div>
                  <div className="h-2 rounded bg-white/[0.06] overflow-hidden">
                    <div className={`h-full ${b.color}`} style={{ width: `${b.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-1 text-[11px] font-mono text-slate-400">
              Raw Slope Bins: &lt;10° ({((flatCount / totalCells) * 100).toFixed(0)}%) · 10–16° (
              {((gentleCount / totalCells) * 100).toFixed(0)}%) · 16–23° (
              {((steepCount / totalCells) * 100).toFixed(0)}%) · ≥23° (
              {((criticalSlopeCount / totalCells) * 100).toFixed(0)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Potential Landing & Walking Areas + Readable Terrain Report */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Potential Landing & Walking Corridors */}
        <div className="lg:col-span-5 bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-white">
              Potential Landing &amp; Walking Areas
            </h2>
            <button
              type="button"
              onClick={() => setColorMode('landing')}
              className="text-[11px] font-mono text-emerald-400 hover:underline"
            >
              Highlight on Map
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Qualifying low-risk sectors (slope ≤ 5.5°, roughness ≤ 22, crater standoff ≥ 1.1 km, firm regolith ≥ 180 TIU).
          </p>

          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {terrain.landingCandidates.length > 0 ? (
              terrain.landingCandidates.map((lc) => (
                <div
                  key={lc.id}
                  className="p-3 rounded bg-[#090B10] border border-white/[0.06] space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{lc.label}</span>
                    <span className="text-[10px] font-mono text-emerald-400">{lc.suitability}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {lc.lat.toFixed(3)}°, {lc.lon.toFixed(3)}° · {lc.elevationM} m · Slope {lc.slopeDeg}°
                  </div>
                  <p className="text-[11px] text-slate-400">{lc.reason}</p>
                </div>
              ))
            ) : (
              <div className="p-4 rounded bg-[#090B10] border border-white/[0.06] text-xs text-amber-300">
                No sectors in this 25 km window meet strict ≤ 5.5° flat landing criteria; inspect steep slopes in Hazard Detection.
              </div>
            )}
          </div>
        </div>

        {/* Readable Scientific Terrain Report */}
        <div className="lg:col-span-7 bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-display font-semibold text-white">
              Terrain Assessment Report — {location.name}
            </h2>
            <button
              type="button"
              onClick={handleCopyReport}
              className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-mono text-slate-200 flex items-center gap-1.5"
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedReport ? 'Copied Report' : 'Copy Report'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
              <div className="font-mono text-[10px] uppercase text-slate-400">Selected Location &amp; Elevation</div>
              <div className="text-slate-200 mt-1">
                {location.name} ({location.lat.toFixed(2)}°, {location.lon.toFixed(2)}°). Reference MOLA datum:{' '}
                <span className="font-mono text-white">{location.elevationM} m</span>. Local modeled span:{' '}
                <span className="font-mono text-white">
                  {terrain.minElevationM} m to {terrain.maxElevationM} m
                </span>
                .
              </div>
            </div>

            <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
              <div className="font-mono text-[10px] uppercase text-slate-400">Overall Risk &amp; Detected Hazards</div>
              <div className="text-slate-200 mt-1">
                Regional Level:{' '}
                <span
                  className={`font-mono font-bold ${
                    overallRegionalRisk === 'CRITICAL'
                      ? 'text-red-400'
                      : overallRegionalRisk === 'HIGH'
                        ? 'text-orange-400'
                        : overallRegionalRisk === 'MODERATE'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                  }`}
                >
                  {overallRegionalRisk} RISK
                </span>
                . {hazards.length} distinct hazard zones flagged ({hazards.filter((h) => h.riskLevel === 'CRITICAL').length}{' '}
                critical, {hazards.filter((h) => h.riskLevel === 'HIGH').length} high).
              </div>
            </div>

            <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
              <div className="font-mono text-[10px] uppercase text-slate-400">Terrain Characteristics</div>
              <div className="text-slate-300 mt-1 leading-relaxed">
                Mean slope {terrain.meanSlopeDeg}° (peak {terrain.maxSlopeDeg}°), mean roughness {terrain.meanRoughness}/100,
                nearest crater rim {terrain.minCraterProximityKm} km, and {terrain.landingZoneCount} flat candidate sectors.
              </div>
            </div>

            <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
              <div className="font-mono text-[10px] uppercase text-slate-400">Data Sources &amp; Provenance</div>
              <div className="text-slate-300 mt-1 leading-relaxed">
                NASA MGS MOLA datum ({location.elevationM} m) &amp; Odyssey THEMIS thermal baseline ({location.thermalInertiaTIU} TIU) combined with a simulated {cellResolutionM} m local demonstration grid.
              </div>
            </div>
          </div>

          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 leading-relaxed">
            <span className="font-semibold">Confidence &amp; Limitations: </span>
            Regional MOLA/THEMIS anchors reflect published planetary datasets; however, the 25 km local slope, crater edge, and boulder estimates are simulated demonstration outputs at {cellResolutionM} m resolution. Sub-meter hazards (rocks &lt; {cellResolutionM} m, steep scarps, loose sand ripples) require MRO HiRISE (0.25 m/px) stereo DTM verification before actual surface operations.
          </div>
        </div>
      </div>
    </div>
  );
}
