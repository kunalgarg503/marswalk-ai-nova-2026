import { useMemo, useState } from 'react';
import { analyzeRouteRisk } from '../../engine/hazardEngine';
import type {
  HazardCategory,
  RiskLevel,
} from '../../types/mars';
import { TerrainMapCanvas } from '../TerrainMapCanvas';
import { ProvenanceTag } from '../ProvenanceTag';

interface HazardDetectionViewProps {
  missionState: import('../../types/mars').CentralMissionState;
}

const CATEGORIES: Array<'ALL' | HazardCategory> = [
  'ALL',
  'Steep Slopes',
  'Crater Edges & Depressions',
  'Rocky or Rough Terrain',
  'Uncertain Terrain',
  'Potentially Difficult Navigation Zones',
];

function riskBadgeStyle(level: RiskLevel): string {
  switch (level) {
    case 'CRITICAL':
      return 'text-red-400';
    case 'HIGH':
      return 'text-orange-400';
    case 'MODERATE':
      return 'text-amber-400';
    default:
      return 'text-emerald-400';
  }
}

export function HazardDetectionView({ missionState }: HazardDetectionViewProps) {
  const { selectedLocation: location, routePlan, activeRoute } = missionState;
  const [riskFilter, setRiskFilter] = useState<'ALL' | RiskLevel>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | HazardCategory>('ALL');

  const filteredHazards = useMemo(() => {
    return routePlan.hazards.filter((h) => {
      if (riskFilter !== 'ALL' && h.riskLevel !== riskFilter) return false;
      if (categoryFilter !== 'ALL' && h.category !== categoryFilter) return false;
      return true;
    });
  }, [routePlan.hazards, riskFilter, categoryFilter]);

  const routeRiskReport = useMemo(
    () => analyzeRouteRisk(activeRoute, routePlan.routes, routePlan.terrain.cellSizeKm),
    [activeRoute, routePlan.routes, routePlan.terrain.cellSizeKm],
  );

  const criticalCount = routePlan.hazards.filter((h) => h.riskLevel === 'CRITICAL').length;
  const highCount = routePlan.hazards.filter((h) => h.riskLevel === 'HIGH').length;
  const modCount = routePlan.hazards.filter((h) => h.riskLevel === 'MODERATE').length;
  const intersectingZones = routePlan.hazards.filter((h) => h.routeRelation === 'INTERSECTING').length;
  const nearRouteZones = routePlan.hazards.filter((h) => h.routeRelation === 'NEAR_ROUTE').length;
  const avoidedZones = routePlan.hazards.filter((h) => h.routeRelation === 'AVOIDED').length;

  return (
    <div className="space-y-6">
      <div className="space-y-2.5 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-white">
            Hazard Detection &amp; Route Risk Analysis — {location.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-4xl">
            Transparent 4-level risk engine (LOW / MODERATE / HIGH / CRITICAL) distinguishing hazards directly intersected by your active route from regional hazards across the 25×25 km sector.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ProvenanceTag type="DERIVED CALCULATION" detail="Estimated Risk via Transparent Slope & TIU Rules" />
          <ProvenanceTag type="SIMULATED DEMONSTRATION" detail="Not an Official NASA Hazard Alert" />
        </div>
      </div>

      {/* Full-Route Risk Analysis Panel */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-display font-semibold text-white">
              Full-Route Risk Analysis — {routeRiskReport.routeLabel} ({missionState.routePreference.toUpperCase()})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{routeRiskReport.coverageStatement}</p>
          </div>
          <div className="text-right">
            <div className={`text-sm font-mono font-bold ${riskBadgeStyle(routeRiskReport.overallRiskLevel)}`}>
              {routeRiskReport.overallRiskLevel} RISK ({routeRiskReport.overallRiskScore}/100 Risk Score)
            </div>
            <div className="text-[11px] font-mono text-cyan-300 tabular-nums">
              Synced Safety Score: {missionState.safetyScore}/100 (= 100 − Risk)
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
            <div className="text-[10px] font-mono uppercase text-slate-400">On Active Route · Crit</div>
            <div className="text-lg font-mono font-bold text-red-400 mt-0.5 tabular-nums">
              {routeRiskReport.criticalRiskSections} steps
            </div>
            <div className="text-[10px] font-mono text-slate-500">Traversed directly</div>
          </div>
          <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
            <div className="text-[10px] font-mono uppercase text-slate-400">On Active Route · High</div>
            <div className="text-lg font-mono font-bold text-orange-400 mt-0.5 tabular-nums">
              {routeRiskReport.highRiskSections} steps
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              +{activeRoute.hazardExposure.moderateSectionCount} moderate steps
            </div>
          </div>
          <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
            <div className="text-[10px] font-mono uppercase text-slate-400">25km Sector Hazards</div>
            <div className="text-lg font-mono font-bold text-amber-400 mt-0.5 tabular-nums">
              {criticalCount}C · {highCount}H · {modCount}M
            </div>
            <div className="text-[10px] font-mono text-slate-500">{routePlan.hazards.length} total clusters</div>
          </div>
          <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
            <div className="text-[10px] font-mono uppercase text-slate-400">Corridor Proximity</div>
            <div className="text-sm font-mono font-bold text-cyan-300 mt-1 tabular-nums">
              {intersectingZones} on · {nearRouteZones} near · {avoidedZones} avoided
            </div>
            <div className="text-[10px] font-mono text-slate-500">Near = ≤ 1.1 km buffer</div>
          </div>
          <div className="p-3 rounded bg-[#090B10] border border-white/[0.06] col-span-2 sm:col-span-1">
            <div className="text-[10px] font-mono uppercase text-slate-400">Avg Diff / Distance</div>
            <div className="text-lg font-mono font-bold text-white mt-0.5 tabular-nums">
              {routeRiskReport.averageTerrainDifficulty}/100
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              Over {routeRiskReport.totalDistanceKm.toFixed(2)} km
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded bg-cyan-500/10 border border-cyan-500/25 text-cyan-200 leading-relaxed">
            <span className="font-semibold">Safer Alternative Assessment: </span>
            {routeRiskReport.saferAlternativeSummary}
          </div>
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/25 text-amber-200 leading-relaxed">
            <span className="font-semibold">Coverage &amp; Limitations: </span>
            {routeRiskReport.limitationsStatement}
          </div>
        </div>
      </div>

      {/* Classification Rules & Shared Safety Formula Reference */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-3.5 space-y-2 text-[11px] font-mono text-slate-300">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="text-slate-400 uppercase">Classification Rules:</span>
          <span className="text-emerald-400">LOW: Slope &lt;10° &amp; Diff &lt;34</span>
          <span className="text-amber-400">MODERATE: Slope 10–16° or Rock ≥25% or TIU &lt;160</span>
          <span className="text-orange-400">HIGH: Slope 16–23° or Crater rim &lt;450 m</span>
          <span className="text-red-400">CRITICAL: Slope ≥23° or Diff ≥74 (Avoid)</span>
        </div>
        <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>
            <strong className="text-cyan-300">Shared Safety/Risk Formula:</strong>{' '}
            Safety = clamp(5..99, 100 − 2.1·Crit% − 1.25·High% − 0.32·Mod% − min(35, 1.05·MaxSlope°) − 0.26·MeanDiff) · Risk = 100 − Safety
          </span>
          <span className="text-amber-300/90">
            500 m synthetic grid — cannot detect meter-scale rocks or certify EVA safety.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Hazard Spatial Map */}
        <div className="lg:col-span-6 bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-display font-semibold text-white">
                Spatial Hazard Risk Map &amp; Active Route
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                Red: Critical · Orange: High · Amber: Mod
              </span>
            </div>
            <ProvenanceTag type="SIMULATED DEMONSTRATION" detail="Derived Rules on Synthetic Grid" />
          </div>
          <TerrainMapCanvas
            terrain={routePlan.terrain}
            colorMode="hazard"
            routes={[activeRoute]}
            selectedRouteId={activeRoute.id}
            waypoints={location.localWaypoints}
            hazards={filteredHazards}
            height={420}
          />
        </div>

        {/* Detailed Hazard Log */}
        <div className="lg:col-span-6 bg-[#0D1016] border border-white/10 rounded p-4 flex flex-col space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-display font-semibold text-white">
              Detected Hazard Zones ({filteredHazards.length})
            </h2>
            <div className="flex items-center gap-1 bg-[#07090E] p-1 rounded border border-white/10">
              {(['ALL', 'CRITICAL', 'HIGH', 'MODERATE'] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setRiskFilter(lvl)}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                    riskFilter === lvl ? 'bg-[#E85D2A] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <select
            aria-label="Filter by hazard category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | HazardCategory)}
            className="w-full px-3 py-1.5 rounded bg-[#07090E] border border-white/10 text-xs font-mono text-slate-200 focus:outline-none focus:border-[#E85D2A]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Hazard Categories (5)' : c}
              </option>
            ))}
          </select>

          <div className="space-y-2.5 max-h-[365px] overflow-y-auto pr-1">
            {filteredHazards.map((h) => (
              <div
                key={h.id}
                className="p-3.5 rounded bg-[#090B10] border border-white/[0.07] space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white">{h.title}</div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {h.routeRelation && (
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-mono font-semibold ${
                          h.routeRelation === 'INTERSECTING'
                            ? 'border-red-500/45 bg-red-500/15 text-red-300'
                            : h.routeRelation === 'NEAR_ROUTE'
                              ? 'border-amber-500/45 bg-amber-500/15 text-amber-200'
                              : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                        }`}
                      >
                        {h.routeRelation === 'INTERSECTING'
                          ? 'ON ROUTE'
                          : h.routeRelation === 'NEAR_ROUTE'
                            ? `NEAR ROUTE (${h.minDistToRouteKm?.toFixed(2)} km)`
                            : `AVOIDED (${h.minDistToRouteKm?.toFixed(2)} km)`}
                      </span>
                    )}
                    <span className={`text-[11px] font-mono font-bold ${riskBadgeStyle(h.riskLevel)}`}>
                      {h.riskLevel} RISK
                    </span>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {h.lat.toFixed(3)}°, {h.lon.toFixed(3)}° · Slope {h.slopeDeg.toFixed(1)}° · Roughness{' '}
                  {h.roughnessIdx.toFixed(0)}/100 · Crater {(h.craterProximityKm * 1000).toFixed(0)} m
                </div>
                <div className="text-[11px] font-mono text-amber-300/90">{h.classificationRule}</div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  <span className="text-slate-400 font-medium">Cause: </span>
                  {h.reason}
                </p>
                <p className="text-xs text-cyan-300/90 leading-relaxed">
                  <span className="text-cyan-400 font-medium">Mitigation: </span>
                  {h.mitigation}
                </p>
                <div className="text-[10px] font-mono text-slate-500">
                  Origin: {h.dataOrigin} · {h.sourceNote}
                </div>
              </div>
            ))}
            {filteredHazards.length === 0 && (
              <div className="text-xs text-slate-400 py-8 text-center">
                No {riskFilter === 'ALL' ? '' : riskFilter} hazards match this category in the active regional window.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
