import { ArrowRight, AlertTriangle, Bot, Compass, Globe2, HeartPulse, Microscope, Route } from 'lucide-react';
import { computeSciencePriority } from '../../engine/scienceEngine';
import type { NavSection } from '../../types/mars';
import { ProvenanceTag } from '../ProvenanceTag';

interface MissionControlViewProps {
  missionState: import('../../types/mars').CentralMissionState;
  onNavigate: (section: NavSection) => void;
}

export function MissionControlView({
  missionState,
  onNavigate,
}: MissionControlViewProps) {
  const {
    selectedLocation,
    routePlan,
    activeRoute,
    survivalResults: survival,
    nearbyScience,
    missionReadiness,
    timing,
    terrainDifficulty,
  } = missionState;

  const criticalHazards = routePlan.hazards.filter((h) => h.riskLevel === 'CRITICAL');
  const highHazards = routePlan.hazards.filter((h) => h.riskLevel === 'HIGH');
  const modHazards = routePlan.hazards.filter((h) => h.riskLevel === 'MODERATE');

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-mono text-[#E85D2A] tracking-wider uppercase">
            Explore Mars. Navigate Safely. Discover More.
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mt-1 text-balance">
            Mission Control Operations Overview
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" detail="MOLA / THEMIS / Rover Historical Baselines" />
            <ProvenanceTag type="DERIVED CALCULATION" detail="A* Pathfinding & Life-Support" />
            <ProvenanceTag type="SIMULATED DEMONSTRATION" detail="25 km Synthetic Local Grid" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('mars-explorer')}
            className="px-3.5 py-2 rounded bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs font-medium text-slate-100 flex items-center gap-2 whitespace-nowrap"
          >
            <Globe2 className="w-3.5 h-3.5 text-[#E85D2A]" />
            Open 3D Mars Globe
          </button>
          <button
            type="button"
            onClick={() => onNavigate('mission-assistant')}
            className="px-3.5 py-2 rounded bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs font-medium text-cyan-300 flex items-center gap-2 whitespace-nowrap"
          >
            <Bot className="w-3.5 h-3.5" />
            Ask AI Advisor
          </button>
          <button
            type="button"
            onClick={() => onNavigate('route-planner')}
            className="px-3.5 py-2 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white flex items-center gap-2 whitespace-nowrap"
          >
            <Route className="w-3.5 h-3.5" />
            Configure A* Route
          </button>
        </div>
      </div>

      {/* Insufficient Resource / Readiness Warning Strip */}
      {missionReadiness.hasInsufficientResource && (
        <div className="p-3.5 rounded bg-red-500/12 border border-red-500/45 flex items-start gap-2.5 text-xs text-red-200">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-mono font-semibold text-red-300 uppercase">
              Resource Sufficiency Warning — Mission Readiness {missionReadiness.score}/100 ({missionReadiness.classification})
            </div>
            <div>{missionReadiness.warnings.join(' · ')}</div>
          </div>
        </div>
      )}

      {/* Primary KPI Telemetry Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Current Martian Region
          </div>
          <div className="text-lg font-display font-semibold text-white truncate">
            {selectedLocation.name}
          </div>
          <div className="text-xs font-mono text-slate-400 tabular-nums">
            {selectedLocation.lat.toFixed(2)}°{selectedLocation.lat >= 0 ? 'N' : 'S'},{' '}
            {Math.abs(selectedLocation.lon).toFixed(2)}°{selectedLocation.lon >= 0 ? 'E' : 'W'} ·{' '}
            {selectedLocation.elevationM} m
          </div>
          <div className="pt-1">
            <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" />
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Active Destination &amp; Distance
          </div>
          <div className="text-lg font-display font-semibold text-white truncate">
            {missionState.destination.name}
          </div>
          <div className="text-xs font-mono text-slate-300 tabular-nums">
            {missionState.distanceKm.toFixed(2)} km ({missionState.routePreference.toUpperCase()}) · Total{' '}
            {timing.totalMissionDurationHr.toFixed(2)} hr (Walk {timing.terrainAdjustedWalkingTimeHr.toFixed(2)} hr)
          </div>
          {missionState.scienceWaypoints.length > 0 && (
            <div className="text-[11px] font-mono text-cyan-300 truncate">
              Via {missionState.scienceWaypoints.length} science stop{missionState.scienceWaypoints.length > 1 ? 's' : ''}:{' '}
              {missionState.scienceWaypoints.map((w) => w.name).join(' → ')}
            </div>
          )}
          <div className="pt-1">
            <ProvenanceTag type="DERIVED CALCULATION" />
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Terrain Difficulty &amp; Safety
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-white tabular-nums">
              {missionState.safetyScore}
            </span>
            <span className="text-xs font-mono text-slate-400">
              / 100 SAFETY · {terrainDifficulty.classificationLabel}
            </span>
          </div>
          <div className="text-xs font-mono text-slate-400 tabular-nums">
            Max Slope {terrainDifficulty.maxSlopeDeg}° · +{missionState.elevationGainM} m gain
          </div>
          <div className="pt-1">
            <ProvenanceTag type="SIMULATED DEMONSTRATION" />
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Mission Readiness (Planning Only)
          </div>
          <div
            className={`text-sm font-mono font-semibold pt-0.5 ${
              missionReadiness.hasInsufficientResource
                ? 'text-red-400'
                : missionReadiness.classification.startsWith('NOMINAL')
                  ? 'text-emerald-400'
                  : 'text-amber-400'
            }`}
          >
            {missionReadiness.score}/100 · {missionReadiness.classification}
          </div>
          <div className="text-xs font-mono text-slate-400 truncate">
            Origin: {missionState.startingLocation.name}
          </div>
          <div className="pt-1">
            <ProvenanceTag type="DERIVED CALCULATION" detail="Not Safety Certification" />
          </div>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Environmental Conditions + Life Support Summary */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-display font-semibold text-white">
                  Environmental Conditions (Historical Mission Baseline)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedLocation.environmentalBaseline.sourceLabel} — not live weather telemetry
                </p>
              </div>
              <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="font-mono text-slate-400 uppercase text-[10px]">Diurnal Temperature Range</div>
                <div className="font-mono text-slate-100 mt-1">{selectedLocation.environmentalBaseline.tempRangeC}</div>
              </div>
              <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="font-mono text-slate-400 uppercase text-[10px]">Surface Pressure Column</div>
                <div className="font-mono text-slate-100 mt-1">{selectedLocation.environmentalBaseline.pressureMbar}</div>
              </div>
              <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="font-mono text-slate-400 uppercase text-[10px]">Atmospheric Dust Opacity</div>
                <div className="font-mono text-slate-100 mt-1">{selectedLocation.environmentalBaseline.dustOpacityTau}</div>
              </div>
              <div className="p-3 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="font-mono text-slate-400 uppercase text-[10px]">Solar Irradiance &amp; Thermal Inertia</div>
                <div className="font-mono text-slate-100 mt-1">
                  {selectedLocation.environmentalBaseline.solarIrradianceWm2} · {selectedLocation.thermalInertiaTIU} TIU
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-display font-semibold text-white flex items-center gap-2">
                  <HeartPulse className="w-4 h-4 text-[#E85D2A]" />
                  Astronaut Survival &amp; Resource Requirements
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Illustrative engineering estimate synced with active A* traverse ({activeRoute.distanceKm.toFixed(2)} km)
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('survival-calculator')}
                className="text-xs font-mono text-[#E85D2A] hover:underline flex items-center gap-1 whitespace-nowrap"
              >
                Adjust Parameters <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="text-[10px] font-mono uppercase text-slate-400">Oxygen (incl. Reserve)</div>
                <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                  {survival.totalOxygenRequiredKg.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">kg</span>
                </div>
                <div className={`text-[11px] font-mono mt-1 ${survival.oxygenSufficient ? 'text-emerald-400' : 'text-red-400'}`}>
                  {survival.oxygenSufficient
                    ? `+${survival.remainingOxygenReserveKg.toFixed(2)} kg margin`
                    : `${survival.remainingOxygenReserveKg.toFixed(2)} kg deficit`}
                </div>
              </div>

              <div className="p-3.5 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="text-[10px] font-mono uppercase text-slate-400">Energy (incl. Reserve)</div>
                <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                  {survival.totalEnergyRequiredKwh.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">kWh</span>
                </div>
                <div className={`text-[11px] font-mono mt-1 ${survival.energySufficient ? 'text-emerald-400' : 'text-red-400'}`}>
                  {survival.energySufficient
                    ? `+${survival.remainingEnergyReserveKwh.toFixed(2)} kWh margin`
                    : `${survival.remainingEnergyReserveKwh.toFixed(2)} kWh deficit`}
                </div>
              </div>

              <div className="p-3.5 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="text-[10px] font-mono uppercase text-slate-400">Water (incl. Reserve)</div>
                <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                  {survival.totalWaterRequiredL.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">L</span>
                </div>
                <div className={`text-[11px] font-mono mt-1 ${survival.waterSufficient ? 'text-emerald-400' : 'text-red-400'}`}>
                  {survival.waterSufficient
                    ? `+${survival.remainingWaterReserveL.toFixed(2)} L margin`
                    : `${survival.remainingWaterReserveL.toFixed(2)} L deficit`}
                </div>
              </div>

              <div className="p-3.5 rounded bg-[#090B10] border border-white/[0.06]">
                <div className="text-[10px] font-mono uppercase text-slate-400">Mission Window</div>
                <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                  {survival.effectiveMissionDurationHr.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">hr</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1 tabular-nums">
                  {survival.effectiveMissionDurationSols.toFixed(2)} sol · ×{survival.slopeMetabolicFactor}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Identified Hazards + Scientific Opportunities */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-display font-semibold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Identified Traverse Hazards
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('hazard-detection')}
                className="text-xs font-mono text-[#E85D2A] hover:underline flex items-center gap-1 whitespace-nowrap"
              >
                Full Analysis <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="text-xs font-mono text-slate-400 space-y-0.5 tabular-nums">
              <div>
                On Active Route:{' '}
                <strong className="text-slate-200">
                  {activeRoute.hazardExposure.criticalSectionCount} Crit ·{' '}
                  {activeRoute.hazardExposure.highSectionCount} High ·{' '}
                  {activeRoute.hazardExposure.moderateSectionCount} Mod
                </strong>{' '}
                steps
              </div>
              <div className="text-[11px] text-slate-500">
                25 km Region Map: {criticalHazards.length} Crit · {highHazards.length} High ·{' '}
                {modHazards.length} Mod sectors (
                {missionState.hazardRisk.intersectingHazardZonesCount +
                  missionState.hazardRisk.nearRouteHazardZonesCount}{' '}
                near/on · {missionState.hazardRisk.avoidedHazardZonesCount} avoided)
              </div>
            </div>
            <div className="space-y-2.5 pt-1">
              {routePlan.hazards.slice(0, 3).map((h) => (
                <div key={h.id} className="p-3 rounded bg-[#090B10] border border-white/[0.06] space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-100 truncate">{h.title}</span>
                    <span
                      className={`font-mono font-semibold shrink-0 ${
                        h.riskLevel === 'CRITICAL'
                          ? 'text-red-400'
                          : h.riskLevel === 'HIGH'
                            ? 'text-orange-400'
                            : h.riskLevel === 'MODERATE'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                      }`}
                    >
                      {h.riskLevel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{h.reason}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-display font-semibold text-white flex items-center gap-2">
                <Microscope className="w-4 h-4 text-cyan-400" />
                Scientific Opportunities
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('science-explorer')}
                className="text-xs font-mono text-[#E85D2A] hover:underline flex items-center gap-1 whitespace-nowrap"
              >
                Science Explorer <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2.5">
              {(nearbyScience.length > 0 ? nearbyScience : []).slice(0, 2).map((s) => {
                const pri = computeSciencePriority(s, 'explore-ancient-deltas', {
                  route: activeRoute,
                  location: selectedLocation,
                });
                return (
                  <div key={s.id} className="p-3 rounded bg-[#090B10] border border-white/[0.06] space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-slate-100 truncate">{s.title}</div>
                      <span className="text-[10px] font-mono text-cyan-300 shrink-0 tabular-nums">
                        {pri.totalScore}/100
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-cyan-400">
                      {s.geologicalCategory} · {s.confidenceLevel} · {s.nasaMission}
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{s.evidenceSummary}</p>
                  </div>
                );
              })}
              {nearbyScience.length === 0 && (
                <div className="p-3 rounded bg-[#090B10] border border-white/[0.06] space-y-1">
                  <div className="text-xs font-medium text-slate-100 flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-cyan-400" />
                    {selectedLocation.primaryMission}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{selectedLocation.geologyNotes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* End-to-End Integrated Mission Workflow */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-2.5">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
          Integrated Mission Planning Pipeline
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 text-xs">
          {[
            { step: '01', label: 'Mars Explorer', sub: 'NASA WMTS & 3D Globe', nav: 'mars-explorer' as NavSection },
            { step: '02', label: 'Terrain Analysis', sub: `${routePlan.terrain.meanSlopeDeg}° mean slope`, nav: 'terrain-intelligence' as NavSection },
            { step: '03', label: 'Hazard Engine', sub: `${activeRoute.hazardExposure.criticalSectionCount + activeRoute.hazardExposure.highSectionCount} on-route / ${criticalHazards.length + highHazards.length} sector`, nav: 'hazard-detection' as NavSection },
            { step: '04', label: 'Smart Route', sub: `${activeRoute.distanceKm.toFixed(1)} km · ${activeRoute.safetyScore}/100`, nav: 'route-planner' as NavSection },
            { step: '05', label: 'Survival Calc', sub: `${survival.overallResourceStatus}`, nav: 'survival-calculator' as NavSection },
            { step: '06', label: 'Science Explorer', sub: `${nearbyScience.length} sector targets`, nav: 'science-explorer' as NavSection },
            { step: '07', label: 'AI Assistant', sub: 'Gemini + PDF Summary', nav: 'mission-assistant' as NavSection },
          ].map((item) => (
            <button
              key={item.step}
              type="button"
              onClick={() => onNavigate(item.nav)}
              className="text-left p-2.5 rounded bg-[#080A0F] hover:border-[#E85D2A]/70 border border-white/[0.08] transition-colors"
            >
              <div className="text-[10px] font-mono text-[#E85D2A]">{item.step}</div>
              <div className="font-semibold text-white truncate">{item.label}</div>
              <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{item.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
