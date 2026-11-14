import type {
  CentralMissionState,
  LocalWaypoint,
  MarsLocation,
  MissionSnapshot,
  NasaDatasetRecord,
  RouteOption,
  RoutePlanSummary,
  ScienceSite,
  SnapshotValidationResult,
  SurvivalInputs,
  SurvivalResults,
} from '../types/mars';
import { MARTIAN_SOL_HOURS } from './survivalCalculator';

let snapshotCounter = 0;

export function buildCentralMissionState(params: {
  selectedLocation: MarsLocation;
  originWaypoint: LocalWaypoint;
  destWaypoint: LocalWaypoint;
  routePlan: RoutePlanSummary;
  activeRoute: RouteOption;
  survivalInputs: SurvivalInputs;
  survivalResults: SurvivalResults;
  nearbyScience: ScienceSite[];
  datasets: NasaDatasetRecord[];
}): CentralMissionState {
  const {
    selectedLocation,
    originWaypoint,
    destWaypoint,
    routePlan,
    activeRoute,
    survivalInputs,
    survivalResults,
    nearbyScience,
    datasets,
  } = params;

  const criticalZonesCount = routePlan.hazards.filter((h) => h.riskLevel === 'CRITICAL').length;
  const highZonesCount = routePlan.hazards.filter((h) => h.riskLevel === 'HIGH').length;
  const moderateZonesCount = routePlan.hazards.filter((h) => h.riskLevel === 'MODERATE').length;
  const intersectingHazardZonesCount = routePlan.hazards.filter(
    (h) => h.routeRelation === 'INTERSECTING',
  ).length;
  const nearRouteHazardZonesCount = routePlan.hazards.filter(
    (h) => h.routeRelation === 'NEAR_ROUTE',
  ).length;
  const avoidedHazardZonesCount = routePlan.hazards.filter(
    (h) => h.routeRelation === 'AVOIDED',
  ).length;

  const diffClass: CentralMissionState['terrainDifficulty']['classificationLabel'] =
    survivalResults.terrainDifficultyUsed >= 55
      ? 'DEMANDING'
      : survivalResults.terrainDifficultyUsed >= 32
        ? 'MODERATE'
        : 'FAVORABLE';

  return {
    missionName: survivalInputs.missionName.trim() || `${selectedLocation.name} Surface EVA`,
    region: {
      id: selectedLocation.id,
      name: selectedLocation.name,
      region: selectedLocation.region,
      lat: selectedLocation.lat,
      lon: selectedLocation.lon,
      elevationM: selectedLocation.elevationM,
      type: selectedLocation.type,
      primaryMission: selectedLocation.primaryMission,
      thermalInertiaTIU: selectedLocation.thermalInertiaTIU,
    },
    startingLocation: {
      id: originWaypoint.id,
      name: originWaypoint.name,
      lat: originWaypoint.lat,
      lon: originWaypoint.lon,
      elevationM: originWaypoint.elevationM,
      localXKm: originWaypoint.localXKm,
      localYKm: originWaypoint.localYKm,
    },
    destination: {
      id: destWaypoint.id,
      name: destWaypoint.name,
      lat: destWaypoint.lat,
      lon: destWaypoint.lon,
      elevationM: destWaypoint.elevationM,
      localXKm: destWaypoint.localXKm,
      localYKm: destWaypoint.localYKm,
    },
    objective: routePlan.objective,
    routePreference: routePlan.routePreference,
    activeRouteId: activeRoute.id,
    activeRouteProfile: activeRoute.profile,
    activeRouteLabel: activeRoute.label,
    routeCoordinates: activeRoute.waypoints,
    distanceKm: activeRoute.distanceKm,
    calculatorDistanceKm: survivalResults.routeDistanceKm,
    distanceSyncMode: survivalInputs.useRouteSync ? 'SYNCED_WITH_ROUTE' : 'MANUAL_OVERRIDE',
    elevationGainM: activeRoute.elevationGainM,
    elevationLossM: activeRoute.elevationLossM,
    terrainDifficulty: {
      routeMeanDifficulty: activeRoute.meanDifficulty,
      calculatorDifficultyUsed: survivalResults.terrainDifficultyUsed,
      maxAcceptableDifficulty: routePlan.maxAcceptableDifficulty,
      passesMaxDifficulty: activeRoute.passesMaxDifficulty,
      meanSlopeDeg: activeRoute.meanSlopeDeg,
      maxSlopeDeg: activeRoute.maxSlopeDeg,
      slopeMetabolicFactor: survivalResults.slopeMetabolicFactor,
      terrainDifficultyFactor: survivalResults.terrainDifficultyFactor,
      classificationLabel: diffClass,
    },
    hazardRisk: {
      overallRiskScore: activeRoute.overallRiskScore,
      overallRiskLevel: activeRoute.overallRiskLevel,
      safetyScore: activeRoute.safetyScore,
      moderateSectionCount: activeRoute.hazardExposure.moderateSectionCount,
      highSectionCount: activeRoute.hazardExposure.highSectionCount,
      criticalSectionCount: activeRoute.hazardExposure.criticalSectionCount,
      flaggedRegionalZonesCount: routePlan.hazards.length,
      intersectingHazardZonesCount,
      nearRouteHazardZonesCount,
      avoidedHazardZonesCount,
      criticalZonesCount,
      highZonesCount,
      moderateZonesCount,
    },
    safetyScore: activeRoute.safetyScore,
    crewSize: Math.max(1, Math.round(survivalInputs.astronautCount)),
    walkingSpeedKmh: survivalInputs.walkingSpeedKmh,
    timing: {
      durationMode: survivalInputs.durationMode,
      baseWalkingTimeHr: survivalResults.baseWalkingDurationHr,
      terrainDelayHr: survivalResults.terrainTimePenaltyHr,
      terrainAdjustedWalkingTimeHr: survivalResults.walkingDurationHr,
      restTimeHr: survivalResults.restDurationHr,
      scientificActivityTimeHr: survivalResults.additionalActivityHr,
      scheduleBufferHr: survivalResults.scheduleBufferHr,
      calculatedActivityDurationHr: survivalResults.calculatedActivityDurationHr,
      nominalDurationHr: survivalResults.nominalDurationHr,
      emergencyContingencyPct: survivalInputs.emergencyExtensionPct,
      emergencyContingencyTimeHr: survivalResults.emergencyContingencyHr,
      totalMissionDurationHr: survivalResults.effectiveMissionDurationHr,
      totalMissionDurationSols: survivalResults.effectiveMissionDurationSols,
      martianSolHours: MARTIAN_SOL_HOURS,
      explanation: survivalResults.durationExplanation,
    },
    oxygen: {
      rateKgPerPersonHr: survivalInputs.oxygenRateKgPerPersonHr,
      baseKg: survivalResults.baseOxygenKg,
      perAstronautBaseKg: survivalResults.oxygenPerAstronautKg,
      reserveKg: survivalResults.reserveOxygenKg,
      totalRequiredKg: survivalResults.totalOxygenRequiredKg,
      totalPerAstronautKg: survivalResults.totalOxygenPerAstronautKg,
      loadedSupplyKg: survivalInputs.availableOxygenSupplyKg,
      marginKg: survivalResults.remainingOxygenReserveKg,
      status: survivalResults.oxygenStatus,
    },
    energy: {
      suitPowerKwPerAstronaut: survivalInputs.suitPowerKwPerAstronaut,
      sharedEquipmentKw: survivalInputs.equipmentPowerKw,
      totalLoadKw: survivalResults.totalPowerLoadKw,
      baseKwh: survivalResults.baseEnergyKwh,
      perAstronautKwh: survivalResults.energyPerAstronautKwh,
      reserveKwh: survivalResults.reserveEnergyKwh,
      totalRequiredKwh: survivalResults.totalEnergyRequiredKwh,
      totalPerAstronautKwh: survivalResults.totalEnergyPerAstronautKwh,
      loadedSupplyKwh: survivalInputs.availableEnergySupplyKwh,
      marginKwh: survivalResults.remainingEnergyReserveKwh,
      status: survivalResults.energyStatus,
    },
    water: {
      dailyRateLPerPersonSol: survivalInputs.dailyWaterLitersPerPerson,
      baseL: survivalResults.baseWaterL,
      perAstronautBaseL: survivalResults.waterPerAstronautL,
      reserveL: survivalResults.reserveWaterL,
      totalRequiredL: survivalResults.totalWaterRequiredL,
      totalPerAstronautL: survivalResults.totalWaterPerAstronautL,
      loadedSupplyL: survivalInputs.availableWaterSupplyL,
      marginL: survivalResults.remainingWaterReserveL,
      status: survivalResults.waterStatus,
    },
    loadedSupplies: {
      oxygenKg: survivalInputs.availableOxygenSupplyKg,
      energyKwh: survivalInputs.availableEnergySupplyKwh,
      waterL: survivalInputs.availableWaterSupplyL,
    },
    emergencyReserves: {
      safetyReservePct: survivalInputs.safetyReservePct,
      oxygenReserveKg: survivalResults.reserveOxygenKg,
      energyReserveKwh: survivalResults.reserveEnergyKwh,
      waterReserveL: survivalResults.reserveWaterL,
      activeExtensionPct: survivalInputs.emergencyExtensionPct,
      scenarios: survivalResults.emergencyScenarios,
    },
    missionReadiness: {
      score: survivalResults.missionReadinessScore,
      classification: survivalResults.readinessClassification,
      overallResourceStatus: survivalResults.overallResourceStatus,
      hasInsufficientResource: survivalResults.hasInsufficientResource,
      insufficientResources: survivalResults.insufficientResources,
      limitedResources: survivalResults.limitedResources,
      warnings: survivalResults.readinessWarnings,
      breakdown: survivalResults.readinessBreakdown,
      disclaimer:
        'Planning readiness indicator only — NOT an astronaut life-support certification or official NASA flight clearance.',
    },
    selectedLocation,
    routePlan,
    activeRoute,
    scienceWaypoints: (routePlan.viaWaypoints || []).map((v) => ({
      id: v.id,
      name: v.name,
      lat: v.lat,
      lon: v.lon,
      elevationM: v.elevationM,
    })),
    survivalInputs,
    survivalResults,
    nearbyScience,
    datasets,
  };
}

function generateSnapshotId(now: Date): string {
  snapshotCounter = (snapshotCounter + 1) % 10000;
  const isoDigits = now
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const seq = snapshotCounter.toString().padStart(4, '0');
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `MSW-${isoDigits}-${seq}-${rand}`;
}

export function createMissionSnapshot(
  state: CentralMissionState,
  latestAssistantAnalysis?: string,
): MissionSnapshot {
  const now = new Date();
  return {
    snapshotId: generateSnapshotId(now),
    generatedAtIso: now.toISOString(),
    generatedAtLocal: now.toLocaleString(),
    state: structuredClone(state),
    latestAssistantAnalysis,
  };
}

export function validateMissionSnapshot(snapshot: MissionSnapshot): SnapshotValidationResult {
  const s = snapshot.state;
  const checks: SnapshotValidationResult['checks'] = [];

  // 1. Route distance matches selected route
  const routeDistMatch = Math.abs(s.distanceKm - s.activeRoute.distanceKm) < 0.01;
  const syncedDistMatch =
    s.distanceSyncMode === 'MANUAL_OVERRIDE' ||
    Math.abs(s.calculatorDistanceKm - s.activeRoute.distanceKm) < 0.01;
  const distPassed = routeDistMatch && syncedDistMatch;
  checks.push({
    id: 'route-distance',
    label: 'Route Distance Synchronisation',
    passed: distPassed,
    detail: distPassed
      ? `Active route (${s.activeRoute.distanceKm.toFixed(2)} km) matches central state (${s.distanceKm.toFixed(2)} km) & calculator (${s.calculatorDistanceKm.toFixed(2)} km, ${s.distanceSyncMode}).`
      : `Mismatch: Active route=${s.activeRoute.distanceKm.toFixed(2)} km, central=${s.distanceKm.toFixed(2)} km, calculator=${s.calculatorDistanceKm.toFixed(2)} km.`,
  });

  // 2. Mission duration matches calculator & timing breakdown
  const calcMatchesTiming =
    Math.abs(s.timing.totalMissionDurationHr - s.survivalResults.effectiveMissionDurationHr) < 0.01 &&
    Math.abs(s.timing.nominalDurationHr - s.survivalResults.nominalDurationHr) < 0.01;
  const sumDurationExpected = Number(
    (s.timing.nominalDurationHr + s.timing.emergencyContingencyTimeHr).toFixed(2),
  );
  const durationAdditive = Math.abs(s.timing.totalMissionDurationHr - sumDurationExpected) <= 0.02;
  const durationPassed = calcMatchesTiming && durationAdditive && s.timing.totalMissionDurationHr > 0;
  checks.push({
    id: 'mission-duration',
    label: 'Mission Duration Synchronisation',
    passed: durationPassed,
    detail: durationPassed
      ? `Total duration ${s.timing.totalMissionDurationHr.toFixed(2)} hr (${s.timing.totalMissionDurationSols.toFixed(2)} sols) = Nominal ${s.timing.nominalDurationHr.toFixed(2)} hr + Contingency ${s.timing.emergencyContingencyTimeHr.toFixed(2)} hr.`
      : `Duration mismatch: timing=${s.timing.totalMissionDurationHr} hr, survival=${s.survivalResults.effectiveMissionDurationHr} hr, expected sum=${sumDurationExpected} hr.`,
  });

  // 3. Resource formulas use the exact same duration, crew size & configured rates
  const dur = s.timing.totalMissionDurationHr;
  const expectedBaseO2 = Number((s.crewSize * dur * s.oxygen.rateKgPerPersonHr).toFixed(2));
  const expectedBaseEn = Number(
    ((s.crewSize * s.energy.suitPowerKwPerAstronaut + s.energy.sharedEquipmentKw) * dur).toFixed(2),
  );
  const expectedBaseWat = Number(
    (s.crewSize * (dur / MARTIAN_SOL_HOURS) * s.water.dailyRateLPerPersonSol).toFixed(2),
  );
  const o2MathOk =
    Math.abs(s.oxygen.baseKg - expectedBaseO2) <= 0.02 &&
    Math.abs(s.oxygen.totalRequiredKg - (s.oxygen.baseKg + s.oxygen.reserveKg)) <= 0.02;
  const enMathOk =
    Math.abs(s.energy.baseKwh - expectedBaseEn) <= 0.02 &&
    Math.abs(s.energy.totalRequiredKwh - (s.energy.baseKwh + s.energy.reserveKwh)) <= 0.02;
  const watMathOk =
    Math.abs(s.water.baseL - expectedBaseWat) <= 0.02 &&
    Math.abs(s.water.totalRequiredL - (s.water.baseL + s.water.reserveL)) <= 0.02;
  const resourcesPassed = o2MathOk && enMathOk && watMathOk;
  checks.push({
    id: 'resource-formulas',
    label: 'Resource Formulas Consistency',
    passed: resourcesPassed,
    detail: resourcesPassed
      ? `O2 (${s.oxygen.baseKg}+${s.oxygen.reserveKg}=${s.oxygen.totalRequiredKg} kg), Energy (${s.energy.baseKwh}+${s.energy.reserveKwh}=${s.energy.totalRequiredKwh} kWh), Water (${s.water.baseL}+${s.water.reserveL}=${s.water.totalRequiredL} L) verified at ${dur.toFixed(2)} hr.`
      : `Formula check failed at ${dur.toFixed(2)} hr (expected bases O2=${expectedBaseO2}, En=${expectedBaseEn}, Water=${expectedBaseWat}).`,
  });

  // 4. Safety score matches Hazard Detection
  const safetyPassed =
    s.safetyScore === s.activeRoute.safetyScore &&
    s.safetyScore === 100 - s.hazardRisk.overallRiskScore &&
    s.hazardRisk.overallRiskScore === s.activeRoute.overallRiskScore;
  checks.push({
    id: 'safety-hazard-sync',
    label: 'Safety Score & Hazard Risk Sync',
    passed: safetyPassed,
    detail: safetyPassed
      ? `Safety Score ${s.safetyScore}/100 complements Hazard Risk ${s.hazardRisk.overallRiskScore}/100 (${s.hazardRisk.overallRiskLevel}).`
      : `Safety/Risk mismatch: central=${s.safetyScore}, route=${s.activeRoute.safetyScore}, risk=${s.hazardRisk.overallRiskScore}.`,
  });

  // 5. Route preference matches Smart Route Planner
  const prefPassed =
    s.routePreference === s.routePlan.routePreference &&
    s.activeRouteProfile === s.routePreference &&
    s.activeRoute.profile === s.routePreference;
  checks.push({
    id: 'route-preference',
    label: 'Route Preference & Planner Sync',
    passed: prefPassed,
    detail: prefPassed
      ? `Route preference '${s.routePreference.toUpperCase()}' matches active route '${s.activeRouteLabel}'.`
      : `Preference mismatch: state=${s.routePreference}, plan=${s.routePlan.routePreference}, activeRoute=${s.activeRoute.profile}.`,
  });

  // 6. Mission readiness matches resource status
  const anyInsufficient =
    s.oxygen.status === 'INSUFFICIENT' ||
    s.energy.status === 'INSUFFICIENT' ||
    s.water.status === 'INSUFFICIENT';
  const readinessPassed = anyInsufficient
    ? s.missionReadiness.hasInsufficientResource &&
      s.missionReadiness.overallResourceStatus === 'INSUFFICIENT' &&
      !s.missionReadiness.classification.startsWith('NOMINAL') &&
      s.missionReadiness.score <= 48
    : !s.missionReadiness.hasInsufficientResource;
  checks.push({
    id: 'readiness-resource-status',
    label: 'Mission Readiness & Resource Guard',
    passed: readinessPassed,
    detail: readinessPassed
      ? `Readiness ${s.missionReadiness.score}/100 (${s.missionReadiness.classification}) matches resource status (${s.missionReadiness.overallResourceStatus}).`
      : `Readiness guard violation: resource insufficient=${anyInsufficient} vs classification='${s.missionReadiness.classification}'.`,
  });

  const errors = checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`);
  return {
    valid: errors.length === 0,
    errors,
    checks,
  };
}
