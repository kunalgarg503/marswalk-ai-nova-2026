import type {
  CentralMissionState,
  DataProvenance,
  NavSection,
  RouteOption,
  RoutePreference,
  SurvivalInputs,
  SurvivalResults,
} from '../types/mars';
import { planMartianRoute } from './routePlanner';
import { calculateSurvivalEstimate } from './survivalCalculator';
import { computeSciencePriority } from './scienceEngine';

export interface WhatIfSimulationInput {
  astronautCount: number;
  walkingSpeedKmh: number;
  routePreference: RoutePreference;
  durationOverrideHr: number | null;
  availableOxygenSupplyKg: number;
  availableEnergySupplyKwh: number;
  availableWaterSupplyL: number;
}

export interface WhatIfSimulationOutcome {
  label: 'SIMULATED SCENARIO';
  isModified: boolean;
  inputs: WhatIfSimulationInput;
  simulatedInputs: SurvivalInputs;
  simulatedRoute: RouteOption;
  simulatedSurvival: SurvivalResults;
  deltas: {
    distanceKm: number;
    safetyScore: number;
    durationHr: number;
    oxygenRequiredKg: number;
    energyRequiredKwh: number;
    waterRequiredL: number;
    oxygenMarginKg: number;
    energyMarginKwh: number;
    waterMarginL: number;
    readinessScore: number;
  };
  newWarnings: string[];
  resolvedWarnings: string[];
}

export interface DangerousRouteSegment {
  segmentIndex: number;
  startDistKm: number;
  endDistKm: number;
  lat: number;
  lon: number;
  elevationM: number;
  slopeDeg: number;
  roughnessIdx: number;
  craterProximityKm: number;
  difficultyScore: number;
  hazardLevel: RouteOption['overallRiskLevel'];
}

export interface SmartRecommendation {
  id: string;
  category: 'route' | 'slope' | 'crater' | 'energy' | 'oxygen' | 'water' | 'duration' | 'science';
  title: string;
  severity: 'CRITICAL' | 'WARNING' | 'ADVISORY' | 'OPPORTUNITY';
  reason: string;
  supportingData: string;
  provenance: DataProvenance;
  actionLabel?: string;
  actionType?: 'switch-route' | 'navigate' | 'ask-ai' | 'open-what-if';
  targetRouteId?: string;
  targetSection?: NavSection;
  promptHint: string;
}

const r2 = (n: number): number => Number(n.toFixed(2));

export function createInitialWhatIfInput(missionState: CentralMissionState): WhatIfSimulationInput {
  return {
    astronautCount: missionState.crewSize,
    walkingSpeedKmh: missionState.walkingSpeedKmh,
    routePreference: missionState.routePreference,
    durationOverrideHr:
      missionState.survivalInputs.durationMode === 'manual'
        ? missionState.survivalInputs.missionDurationHr
        : null,
    availableOxygenSupplyKg: missionState.loadedSupplies.oxygenKg,
    availableEnergySupplyKwh: missionState.loadedSupplies.energyKwh,
    availableWaterSupplyL: missionState.loadedSupplies.waterL,
  };
}

export function runWhatIfSimulation(
  missionState: CentralMissionState,
  whatIf: WhatIfSimulationInput,
): WhatIfSimulationOutcome {
  const safeCrew = Math.max(1, Math.min(12, Math.round(whatIf.astronautCount)));
  const safeSpeed = Math.max(0.5, Math.min(8.0, Number(whatIf.walkingSpeedKmh) || 3.2));
  const safeO2 = Math.max(0, Number(whatIf.availableOxygenSupplyKg) || 0);
  const safeEnergy = Math.max(0, Number(whatIf.availableEnergySupplyKwh) || 0);
  const safeWater = Math.max(0, Number(whatIf.availableWaterSupplyL) || 0);

  // Re-run route planner if walking speed or route preference changed; otherwise reuse active routePlan
  const speedChanged = Math.abs(safeSpeed - missionState.walkingSpeedKmh) > 1e-4;
  const simPlan = speedChanged
    ? planMartianRoute({
        location: missionState.selectedLocation,
        originWaypoint: {
          ...missionState.selectedLocation.localWaypoints[0],
          id: missionState.startingLocation.id,
          name: missionState.startingLocation.name,
          lat: missionState.startingLocation.lat,
          lon: missionState.startingLocation.lon,
          elevationM: missionState.startingLocation.elevationM,
          localXKm: missionState.startingLocation.localXKm,
          localYKm: missionState.startingLocation.localYKm,
        },
        destWaypoint: {
          ...missionState.selectedLocation.localWaypoints[
            missionState.selectedLocation.localWaypoints.length - 1
          ],
          id: missionState.destination.id,
          name: missionState.destination.name,
          lat: missionState.destination.lat,
          lon: missionState.destination.lon,
          elevationM: missionState.destination.elevationM,
          localXKm: missionState.destination.localXKm,
          localYKm: missionState.destination.localYKm,
        },
        objective: missionState.objective,
        routePreference: whatIf.routePreference,
        maxAcceptableDifficulty: missionState.terrainDifficulty.maxAcceptableDifficulty,
        walkingSpeedKmh: safeSpeed,
      })
    : missionState.routePlan;

  const simulatedRoute =
    simPlan.routes.find((r) => r.profile === whatIf.routePreference) ||
    simPlan.routes.find((r) => r.id === missionState.activeRouteId) ||
    simPlan.routes[0];

  const useManualDuration =
    whatIf.durationOverrideHr !== null && Number.isFinite(whatIf.durationOverrideHr);

  const simulatedInputs: SurvivalInputs = {
    ...missionState.survivalInputs,
    astronautCount: safeCrew,
    walkingSpeedKmh: safeSpeed,
    durationMode: useManualDuration ? 'manual' : 'activity-derived',
    missionDurationHr: useManualDuration
      ? Math.max(0.5, Number(whatIf.durationOverrideHr))
      : missionState.survivalInputs.missionDurationHr,
    availableOxygenSupplyKg: safeO2,
    availableEnergySupplyKwh: safeEnergy,
    availableWaterSupplyL: safeWater,
  };

  const baseDist = missionState.survivalInputs.useRouteSync
    ? simulatedRoute.distanceKm
    : missionState.survivalInputs.manualDistanceKm;
  const baseDiff = missionState.survivalInputs.useRouteSync
    ? simulatedRoute.meanDifficulty
    : missionState.survivalInputs.manualTerrainDifficulty;

  const simulatedSurvival = calculateSurvivalEstimate(
    simulatedInputs,
    baseDist,
    simulatedRoute.elevationGainM,
    baseDiff,
    simulatedRoute.overallRiskScore,
    missionState.terrainDifficulty.maxAcceptableDifficulty,
  );

  const baselineWarnings = new Set(missionState.missionReadiness.warnings);
  const simWarningsSet = new Set(simulatedSurvival.readinessWarnings);

  const newWarnings = simulatedSurvival.readinessWarnings.filter((w) => !baselineWarnings.has(w));
  const resolvedWarnings = missionState.missionReadiness.warnings.filter(
    (w) => !simWarningsSet.has(w),
  );

  const isModified =
    safeCrew !== missionState.crewSize ||
    speedChanged ||
    whatIf.routePreference !== missionState.routePreference ||
    useManualDuration !== (missionState.survivalInputs.durationMode === 'manual') ||
    (useManualDuration &&
      Math.abs(
        (whatIf.durationOverrideHr ?? 0) - missionState.timing.totalMissionDurationHr,
      ) > 1e-2) ||
    Math.abs(safeO2 - missionState.loadedSupplies.oxygenKg) > 1e-3 ||
    Math.abs(safeEnergy - missionState.loadedSupplies.energyKwh) > 1e-3 ||
    Math.abs(safeWater - missionState.loadedSupplies.waterL) > 1e-3;

  return {
    label: 'SIMULATED SCENARIO',
    isModified,
    inputs: {
      astronautCount: safeCrew,
      walkingSpeedKmh: safeSpeed,
      routePreference: whatIf.routePreference,
      durationOverrideHr: whatIf.durationOverrideHr,
      availableOxygenSupplyKg: safeO2,
      availableEnergySupplyKwh: safeEnergy,
      availableWaterSupplyL: safeWater,
    },
    simulatedInputs,
    simulatedRoute,
    simulatedSurvival,
    deltas: {
      distanceKm: r2(simulatedRoute.distanceKm - missionState.distanceKm),
      safetyScore: Math.round(simulatedRoute.safetyScore - missionState.safetyScore),
      durationHr: r2(
        simulatedSurvival.effectiveMissionDurationHr - missionState.timing.totalMissionDurationHr,
      ),
      oxygenRequiredKg: r2(
        simulatedSurvival.totalOxygenRequiredKg - missionState.oxygen.totalRequiredKg,
      ),
      energyRequiredKwh: r2(
        simulatedSurvival.totalEnergyRequiredKwh - missionState.energy.totalRequiredKwh,
      ),
      waterRequiredL: r2(
        simulatedSurvival.totalWaterRequiredL - missionState.water.totalRequiredL,
      ),
      oxygenMarginKg: r2(
        simulatedSurvival.remainingOxygenReserveKg - missionState.oxygen.marginKg,
      ),
      energyMarginKwh: r2(
        simulatedSurvival.remainingEnergyReserveKwh - missionState.energy.marginKwh,
      ),
      waterMarginL: r2(simulatedSurvival.remainingWaterReserveL - missionState.water.marginL),
      readinessScore: Math.round(
        simulatedSurvival.missionReadinessScore - missionState.missionReadiness.score,
      ),
    },
    newWarnings,
    resolvedWarnings,
  };
}

export function extractDangerousRouteSegments(route: RouteOption): DangerousRouteSegment[] {
  const rank: Record<RouteOption['overallRiskLevel'], number> = {
    LOW: 0,
    MODERATE: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  const nodes = route.waypoints;
  const segments: DangerousRouteSegment[] = [];

  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    const worse = rank[curr.hazardLevel] >= rank[prev.hazardLevel] ? curr : prev;
    segments.push({
      segmentIndex: i,
      startDistKm: prev.cumulativeDistKm,
      endDistKm: curr.cumulativeDistKm,
      lat: Number(((prev.lat + curr.lat) / 2).toFixed(4)),
      lon: Number(((prev.lon + curr.lon) / 2).toFixed(4)),
      elevationM: Math.round((prev.elevationM + curr.elevationM) / 2),
      slopeDeg: Number(Math.max(prev.slopeDeg, curr.slopeDeg).toFixed(1)),
      roughnessIdx: Math.round(Math.max(prev.roughnessIdx, curr.roughnessIdx)),
      craterProximityKm: Number(Math.min(prev.craterProximityKm, curr.craterProximityKm).toFixed(2)),
      difficultyScore: Math.round(Math.max(prev.difficultyScore, curr.difficultyScore)),
      hazardLevel: worse.hazardLevel,
    });
  }

  return segments.sort((a, b) => {
    const rDiff = rank[b.hazardLevel] - rank[a.hazardLevel];
    if (rDiff !== 0) return rDiff;
    const dDiff = b.difficultyScore - a.difficultyScore;
    if (dDiff !== 0) return dDiff;
    return b.slopeDeg - a.slopeDeg;
  });
}

export function generateSmartRecommendations(
  missionState: CentralMissionState,
): SmartRecommendation[] {
  const recs: SmartRecommendation[] = [];
  const { activeRoute, routePlan, oxygen, energy, water, timing, nearbyScience } = missionState;

  // 1. Alternative Route Recommendation (only if another route strictly beats active route in safety or tolerance)
  const safestRoute = routePlan.routes.find((r) => r.profile === 'safest');
  if (
    safestRoute &&
    safestRoute.id !== activeRoute.id &&
    (safestRoute.safetyScore > activeRoute.safetyScore ||
      (!activeRoute.passesMaxDifficulty && safestRoute.passesMaxDifficulty))
  ) {
    const distDiff = r2(safestRoute.distanceKm - activeRoute.distanceKm);
    recs.push({
      id: 'rec-alternative-route',
      category: 'route',
      title: 'Consider an alternative route',
      severity: !activeRoute.passesMaxDifficulty || safestRoute.safetyScore - activeRoute.safetyScore >= 8
        ? 'WARNING'
        : 'ADVISORY',
      reason: `Switching from ${activeRoute.label} (${activeRoute.safetyScore}/100 safety) to ${safestRoute.label} (${safestRoute.safetyScore}/100 safety) reduces corridor hazard exposure${
        !activeRoute.passesMaxDifficulty && safestRoute.passesMaxDifficulty
          ? ` and meets the ≤ ${routePlan.maxAcceptableDifficulty}/100 terrain difficulty limit.`
          : '.'
      }`,
      supportingData: `Safest: ${safestRoute.distanceKm.toFixed(2)} km, max slope ${safestRoute.maxSlopeDeg.toFixed(1)}°, risk ${safestRoute.overallRiskLevel} vs Active: ${activeRoute.distanceKm.toFixed(2)} km (${distDiff >= 0 ? '+' : ''}${distDiff.toFixed(2)} km delta), max slope ${activeRoute.maxSlopeDeg.toFixed(1)}°.`,
      provenance: 'DERIVED CALCULATION',
      actionLabel: `Switch to ${safestRoute.profile.toUpperCase()} (${safestRoute.safetyScore}/100)`,
      actionType: 'switch-route',
      targetRouteId: safestRoute.id,
      promptHint: `Why is ${safestRoute.label} safer than ${activeRoute.label} for our active mission?`,
    });
  }

  // 2. High-Slope Terrain Exposure
  const dangerousSegs = extractDangerousRouteSegments(activeRoute);
  const worstSeg = dangerousSegs[0];
  const highOrCritSections =
    activeRoute.hazardExposure.criticalSectionCount + activeRoute.hazardExposure.highSectionCount;
  if (activeRoute.maxSlopeDeg >= 12 || highOrCritSections > 0) {
    recs.push({
      id: 'rec-avoid-slope',
      category: 'slope',
      title: 'Avoid high-slope terrain',
      severity: activeRoute.maxSlopeDeg >= 20 || activeRoute.hazardExposure.criticalSectionCount > 0 ? 'CRITICAL' : 'WARNING',
      reason: `Active route encounters peak slopes of ${activeRoute.maxSlopeDeg.toFixed(1)}° and ${highOrCritSections} high/critical corridor node(s), increasing suit metabolic exertion and slip hazard.`,
      supportingData: worstSeg
        ? `Worst segment #${worstSeg.segmentIndex} (${worstSeg.startDistKm.toFixed(2)}–${worstSeg.endDistKm.toFixed(2)} km @ ${worstSeg.lat}°, ${worstSeg.lon}°): ${worstSeg.slopeDeg}° slope, difficulty ${worstSeg.difficultyScore}/100 (${worstSeg.hazardLevel}).`
        : `Mean slope ${activeRoute.meanSlopeDeg.toFixed(1)}°, peak ${activeRoute.maxSlopeDeg.toFixed(1)}°, elevation gain +${activeRoute.elevationGainM} m.`,
      provenance: 'SIMULATED DEMONSTRATION',
      actionLabel: 'Inspect Hazard Zones',
      actionType: 'navigate',
      targetSection: 'hazard-detection',
      promptHint: `Which section of my route is most dangerous and how can we mitigate the ${activeRoute.maxSlopeDeg.toFixed(1)}° peak slope?`,
    });
  }

  // 3. Crater Safety Distance
  const routeMinCraterKm = activeRoute.waypoints.reduce(
    (min, w) => Math.min(min, w.craterProximityKm),
    Infinity,
  );
  const craterHazards = routePlan.hazards.filter((h) => h.category === 'Crater Edges & Depressions');
  if (routeMinCraterKm < 1.1 || craterHazards.length > 0) {
    const minDistM = Math.round(
      (Number.isFinite(routeMinCraterKm) ? routeMinCraterKm : routePlan.terrain.minCraterProximityKm) *
        1000,
    );
    recs.push({
      id: 'rec-crater-standoff',
      category: 'crater',
      title: 'Maintain crater safety distance',
      severity: minDistM < 450 ? 'CRITICAL' : 'WARNING',
      reason: `Traverse passes within ${minDistM} m of modeled crater rim topography (${craterHazards.length} regional crater-edge hazard zone(s) flagged). Loose ejecta and unconsolidated slopes increase fall risk near rims.`,
      supportingData: `Route minimum crater standoff: ${minDistM} m (Regional min: ${Math.round(routePlan.terrain.minCraterProximityKm * 1000)} m · Crater-edge zones: ${craterHazards.length}).`,
      provenance: 'SIMULATED DEMONSTRATION',
      actionLabel: 'View Crater & Relief Map',
      actionType: 'navigate',
      targetSection: 'terrain-intelligence',
      promptHint: `What crater proximity risks exist along our route at ${missionState.region.name} and what standoff distance is advisable?`,
    });
  }

  // 4. Energy Reserves Check
  const plus20Scenario = missionState.emergencyReserves.scenarios.find((s) => s.extraPct === 20);
  if (
    energy.status !== 'SUFFICIENT' ||
    (plus20Scenario && plus20Scenario.energyDeltaKwh < 0)
  ) {
    const deficit = energy.marginKwh < 0 ? Math.abs(energy.marginKwh) : 0;
    const isShort = energy.status === 'INSUFFICIENT';
    recs.push({
      id: 'rec-energy-reserves',
      category: 'energy',
      title: 'Increase energy reserves',
      severity: isShort ? 'CRITICAL' : 'WARNING',
      reason: isShort
        ? `Loaded battery energy (${energy.loadedSupplyKwh.toFixed(1)} kWh) is insufficient for the required ${energy.totalRequiredKwh.toFixed(1)} kWh (short by ${deficit.toFixed(1)} kWh including ${missionState.emergencyReserves.safetyReservePct}% reserve).`
        : energy.status === 'LIMITED'
          ? `Energy reserve margin is tight (+${energy.marginKwh.toFixed(1)} kWh, <15% buffer above required ${energy.totalRequiredKwh.toFixed(1)} kWh).`
          : `Energy is sufficient for nominal traverse (+${energy.marginKwh.toFixed(1)} kWh), but a +20% duration extension causes a ${Math.abs(plus20Scenario!.energyDeltaKwh).toFixed(1)} kWh energy shortfall.`,
      supportingData: `Required: ${energy.totalRequiredKwh.toFixed(2)} kWh (${energy.totalLoadKw.toFixed(2)} kW × ${timing.totalMissionDurationHr.toFixed(2)} hr + ${missionState.emergencyReserves.safetyReservePct}% reserve) · Loaded: ${energy.loadedSupplyKwh.toFixed(2)} kWh.`,
      provenance: 'DERIVED CALCULATION',
      actionLabel: 'Tune Supplies in Calculator',
      actionType: 'navigate',
      targetSection: 'survival-calculator',
      promptHint: `Are my available energy reserves sufficient, including a +20% contingency delay?`,
    });
  }

  // 5. Oxygen / Water Reserves Check
  if (oxygen.status !== 'SUFFICIENT' || water.status !== 'SUFFICIENT') {
    const issues: string[] = [];
    if (oxygen.status !== 'SUFFICIENT') {
      issues.push(
        `O2 ${oxygen.status} (need ${oxygen.totalRequiredKg.toFixed(2)} kg vs loaded ${oxygen.loadedSupplyKg.toFixed(2)} kg)`,
      );
    }
    if (water.status !== 'SUFFICIENT') {
      issues.push(
        `Water ${water.status} (need ${water.totalRequiredL.toFixed(2)} L vs loaded ${water.loadedSupplyL.toFixed(2)} L)`,
      );
    }
    recs.push({
      id: 'rec-life-support-supplies',
      category: oxygen.status !== 'SUFFICIENT' ? 'oxygen' : 'water',
      title:
        oxygen.status !== 'SUFFICIENT' && water.status !== 'SUFFICIENT'
          ? 'Replenish oxygen & water supplies'
          : oxygen.status !== 'SUFFICIENT'
            ? 'Increase oxygen supply'
            : 'Increase water reserves',
      severity:
        oxygen.status === 'INSUFFICIENT' || water.status === 'INSUFFICIENT'
          ? 'CRITICAL'
          : 'WARNING',
      reason: `Life-support consumables are below comfortable margin for ${missionState.crewSize} crew over ${timing.totalMissionDurationHr.toFixed(2)} hr (${timing.totalMissionDurationSols.toFixed(2)} sols).`,
      supportingData: issues.join(' · '),
      provenance: 'DERIVED CALCULATION',
      actionLabel: 'Open Survival Calculator',
      actionType: 'navigate',
      targetSection: 'survival-calculator',
      promptHint: `How much oxygen and water will my crew require and what supply adjustments are needed?`,
    });
  }

  // 6. Reduce Mission Duration (supported when duration > 8 hr OR resources are constrained)
  if (
    timing.totalMissionDurationHr >= 8 ||
    missionState.missionReadiness.hasInsufficientResource ||
    missionState.missionReadiness.overallResourceStatus === 'LIMITED'
  ) {
    const hourlyO2 = r2(
      missionState.crewSize *
        oxygen.rateKgPerPersonHr *
        (1 + missionState.emergencyReserves.safetyReservePct / 100),
    );
    const hourlyEnergy = r2(
      energy.totalLoadKw * (1 + missionState.emergencyReserves.safetyReservePct / 100),
    );
    recs.push({
      id: 'rec-reduce-duration',
      category: 'duration',
      title: 'Reduce mission duration or trim surface stops',
      severity: missionState.missionReadiness.hasInsufficientResource ? 'WARNING' : 'ADVISORY',
      reason: missionState.missionReadiness.hasInsufficientResource
        ? `Total EVA duration (${timing.totalMissionDurationHr.toFixed(2)} hr) drives consumable demand past loaded capacity; trimming 1–2 hr of discretionary activity lowers O2 and power demand immediately.`
        : `Extended surface duration (${timing.totalMissionDurationHr.toFixed(2)} hr, including ${timing.scientificActivityTimeHr.toFixed(1)} hr science + ${timing.restTimeHr.toFixed(1)} hr rest) elevates fatigue and life-support burn.`,
      supportingData: `Each 1.0 hr reduction saves ~${hourlyO2.toFixed(3)} kg O2 and ~${hourlyEnergy.toFixed(2)} kWh energy (including ${missionState.emergencyReserves.safetyReservePct}% reserve).`,
      provenance: 'DERIVED CALCULATION',
      actionLabel: 'Test in What-If Simulator',
      actionType: 'open-what-if',
      promptHint: `What happens if we reduce or extend mission duration by 2 hours?`,
    });
  }

  // 7. Prioritize Scientifically Valuable Targets (strictly from cataloged sector targets)
  if (nearbyScience.length > 0) {
    const ranked = nearbyScience
      .map((s) => ({
        site: s,
        priority: computeSciencePriority(s, 'explore-ancient-deltas'),
      }))
      .sort((a, b) => b.priority.totalScore - a.priority.totalScore);
    const top = ranked[0];
    recs.push({
      id: 'rec-prioritise-science',
      category: 'science',
      title: 'Prioritise scientifically valuable targets',
      severity: 'OPPORTUNITY',
      reason: `${top.site.title} (${top.site.geologicalCategory}) ranks #1 in ${missionState.region.name} with ${top.site.waterEnvironmentEvidence.toLowerCase()} ancient-water evidence and ${top.site.confidenceLevel.toLowerCase()} observation confidence.`,
      supportingData: `Prototype Priority: ${top.priority.totalScore}/100 · ${top.site.lat.toFixed(3)}°, ${top.site.lon.toFixed(3)}° · Source: ${top.site.supportingDataset} (${top.site.nasaMission} · ${top.site.instrument}).`,
      provenance: top.site.roverSupport ? 'ACTUAL NASA OBSERVATION' : 'PUBLISHED SCIENTIFIC DATASET',
      actionLabel: 'Open Science Explorer',
      actionType: 'navigate',
      targetSection: 'science-explorer',
      promptHint: `Which scientific targets in ${missionState.region.name} should we prioritise and what NASA observations support them?`,
    });
  }

  return recs;
}
