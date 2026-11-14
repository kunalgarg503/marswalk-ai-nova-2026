import type {
  EmergencyScenarioOutcome,
  ResourceStatusLevel,
  SurvivalInputs,
  SurvivalResults,
} from '../types/mars';

export const MARTIAN_SOL_HOURS = 24.623;

const round2 = (n: number): number =>
  Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
const round3 = (n: number): number =>
  Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 1000) / 1000;

export function classifySupply(available: number, required: number): ResourceStatusLevel {
  if (available + 1e-6 < required) return 'INSUFFICIENT';
  if (available + 1e-6 < required * 1.15) return 'LIMITED';
  return 'SUFFICIENT';
}

function worstStatus(statuses: ResourceStatusLevel[]): ResourceStatusLevel {
  if (statuses.includes('INSUFFICIENT')) return 'INSUFFICIENT';
  if (statuses.includes('LIMITED')) return 'LIMITED';
  return 'SUFFICIENT';
}

/**
 * Shared terrain-adjusted walking time formula used across Smart Route Planner
 * and Survival Calculator so walking traverse time is consistent everywhere.
 */
export function computeWalkingDurationDetails(params: {
  distanceKm: number;
  walkingSpeedKmh: number;
  elevationGainM: number;
  terrainDifficulty: number;
}): {
  baseWalkingDurationHr: number;
  slopeMetabolicFactor: number;
  terrainDifficultyFactor: number;
  combinedTerrainTimeFactor: number;
  terrainAdjustedWalkingHr: number;
  terrainTimePenaltyHr: number;
} {
  const safeDistance = Math.max(0.1, params.distanceKm);
  const safeSpeed = Math.max(0.5, params.walkingSpeedKmh);
  const safeDifficulty = Math.max(0, Math.min(100, params.terrainDifficulty));
  const safeGain = Math.max(0, params.elevationGainM);

  const slopeMetabolicFactor = round3(1 + Math.min(0.45, safeGain / 2500));
  const terrainDifficultyFactor = round3(1 + (safeDifficulty / 100) * 0.35);
  const combinedTerrainTimeFactor = round3(
    (1 + (slopeMetabolicFactor - 1) * 0.5) * terrainDifficultyFactor,
  );

  const baseWalkingDurationHr = round2(safeDistance / safeSpeed);
  const terrainAdjustedWalkingHr = round2(baseWalkingDurationHr * combinedTerrainTimeFactor);
  const terrainTimePenaltyHr = round2(Math.max(0, terrainAdjustedWalkingHr - baseWalkingDurationHr));

  return {
    baseWalkingDurationHr,
    slopeMetabolicFactor,
    terrainDifficultyFactor,
    combinedTerrainTimeFactor,
    terrainAdjustedWalkingHr,
    terrainTimePenaltyHr,
  };
}

/**
 * Deterministic parametric planning estimator for Martian EVA / surface exploration.
 * Every formula is transparent, auditable by hand, and clearly labeled as a planning estimate
 * (NOT an official NASA spacesuit specification or astronaut safety certification).
 */
export function calculateSurvivalEstimate(
  inputs: SurvivalInputs,
  routeDistanceKm: number,
  elevationGainM: number,
  routeDifficulty = 40,
  routeRiskScore = 30,
  maxAcceptableDifficulty = 55,
): SurvivalResults {
  const safeCount = Math.max(1, Math.round(inputs.astronautCount));
  const safeSpeed = Math.max(0.5, inputs.walkingSpeedKmh);
  const safeO2Rate = Math.max(0.01, inputs.oxygenRateKgPerPersonHr);
  const safeSuitPower = Math.max(0.1, inputs.suitPowerKwPerAstronaut);
  const safeEquipPower = Math.max(0, inputs.equipmentPowerKw);
  const safeWaterDaily = Math.max(0.5, inputs.dailyWaterLitersPerPerson);
  const safeReservePct = Math.max(0, inputs.safetyReservePct);
  const restDurationHr = round2(Math.max(0, inputs.restDurationHr));
  const additionalActivityHr = round2(Math.max(0, inputs.additionalActivityHr));
  const configuredBufferHr = round2(Math.max(0, inputs.scheduleBufferHr ?? 0));

  const usedDistanceKm = round2(
    Math.max(0.1, inputs.useRouteSync ? routeDistanceKm : inputs.manualDistanceKm),
  );
  const usedDifficulty = Number(
    Math.max(0, Math.min(100, inputs.useRouteSync ? routeDifficulty : inputs.manualTerrainDifficulty)).toFixed(1),
  );

  const walking = computeWalkingDurationDetails({
    distanceKm: usedDistanceKm,
    walkingSpeedKmh: safeSpeed,
    elevationGainM,
    terrainDifficulty: usedDifficulty,
  });

  // Activity-derived total vs manual duration override (transparent, never silently altered)
  const calculatedActivityDurationHr = round2(
    walking.terrainAdjustedWalkingHr + restDurationHr + additionalActivityHr,
  );

  const nominalDurationHr =
    inputs.durationMode === 'manual'
      ? round2(Math.max(0.5, inputs.missionDurationHr))
      : round2(calculatedActivityDurationHr + configuredBufferHr);

  const scheduleBufferHr =
    inputs.durationMode === 'manual'
      ? round2(Math.max(0, nominalDurationHr - calculatedActivityDurationHr))
      : configuredBufferHr;

  const manualDurationDeltaHr =
    inputs.durationMode === 'manual'
      ? round2(nominalDurationHr - calculatedActivityDurationHr)
      : configuredBufferHr;

  const emergencyContingencyHr = round2(nominalDurationHr * (inputs.emergencyExtensionPct / 100));
  const effectiveMissionDurationHr = round2(nominalDurationHr + emergencyContingencyHr);
  const effectiveMissionDurationSols = round2(effectiveMissionDurationHr / MARTIAN_SOL_HOURS);

  const durationExplanation =
    inputs.durationMode === 'manual'
      ? manualDurationDeltaHr >= 0
        ? `Manual mission duration (${nominalDurationHr.toFixed(2)} hr) includes +${manualDurationDeltaHr.toFixed(2)} hr schedule/contingency margin above activity subtotal (${calculatedActivityDurationHr.toFixed(2)} hr).`
        : `Manual mission duration (${nominalDurationHr.toFixed(2)} hr) is ${Math.abs(manualDurationDeltaHr).toFixed(2)} hr shorter than estimated walk+rest+science subtotal (${calculatedActivityDurationHr.toFixed(2)} hr) — verify EVA timeline.`
      : `Nominal duration (${nominalDurationHr.toFixed(2)} hr) = Terrain-Adjusted Walk (${walking.terrainAdjustedWalkingHr.toFixed(2)} hr = ${walking.baseWalkingDurationHr.toFixed(2)} hr base + ${walking.terrainTimePenaltyHr.toFixed(2)} hr terrain factor ×${walking.combinedTerrainTimeFactor.toFixed(3)}) + Rest (${restDurationHr.toFixed(2)} hr) + Science (${additionalActivityHr.toFixed(2)} hr) + Schedule Buffer (${scheduleBufferHr.toFixed(2)} hr).`;

  const suitPowerTotalKw = round2(safeCount * safeSuitPower);
  const totalPowerLoadKw = round2(suitPowerTotalKw + safeEquipPower);

  // Exact parametric formulas matching displayed inputs 1:1 (Base + Reserve = Total)
  const computeAtDuration = (durationHr: number) => {
    // 1. OXYGEN: Crew × Duration × Hourly O2 Rate
    const baseO2 = round2(safeCount * durationHr * safeO2Rate);
    const resO2 = round2(baseO2 * (safeReservePct / 100));
    const totO2 = round2(baseO2 + resO2);

    // 2. ENERGY: (Crew × Suit kW + Shared Equipment kW) × Duration
    const baseEn = round2((safeCount * safeSuitPower + safeEquipPower) * durationHr);
    const resEn = round2(baseEn * (safeReservePct / 100));
    const totEn = round2(baseEn + resEn);

    // 3. WATER: Crew × (Duration / 24.623 Martian Sol hr) × Daily Rate (L/sol)
    const baseWat = round2(safeCount * (durationHr / MARTIAN_SOL_HOURS) * safeWaterDaily);
    const resWat = round2(baseWat * (safeReservePct / 100));
    const totWat = round2(baseWat + resWat);

    return {
      baseO2,
      resO2,
      totO2,
      baseEn,
      resEn,
      totEn,
      baseWat,
      resWat,
      totWat,
    };
  };

  const active = computeAtDuration(effectiveMissionDurationHr);
  const baseNominal = computeAtDuration(nominalDurationHr);

  const remainingOxygenReserveKg = round2(inputs.availableOxygenSupplyKg - active.totO2);
  const remainingEnergyReserveKwh = round2(inputs.availableEnergySupplyKwh - active.totEn);
  const remainingWaterReserveL = round2(inputs.availableWaterSupplyL - active.totWat);

  const oxygenStatus = classifySupply(inputs.availableOxygenSupplyKg, active.totO2);
  const energyStatus = classifySupply(inputs.availableEnergySupplyKwh, active.totEn);
  const waterStatus = classifySupply(inputs.availableWaterSupplyL, active.totWat);
  const overallResourceStatus = worstStatus([oxygenStatus, energyStatus, waterStatus]);

  const insufficientResources: string[] = [];
  if (oxygenStatus === 'INSUFFICIENT') {
    insufficientResources.push(`Oxygen (-${Math.abs(remainingOxygenReserveKg).toFixed(2)} kg deficit)`);
  }
  if (energyStatus === 'INSUFFICIENT') {
    insufficientResources.push(`Energy (-${Math.abs(remainingEnergyReserveKwh).toFixed(2)} kWh deficit)`);
  }
  if (waterStatus === 'INSUFFICIENT') {
    insufficientResources.push(`Water (-${Math.abs(remainingWaterReserveL).toFixed(2)} L deficit)`);
  }

  const limitedResources: string[] = [];
  if (oxygenStatus === 'LIMITED') limitedResources.push('Oxygen (<15% margin)');
  if (energyStatus === 'LIMITED') limitedResources.push('Energy (<15% margin)');
  if (waterStatus === 'LIMITED') limitedResources.push('Water (<15% margin)');

  const hasInsufficientResource = insufficientResources.length > 0;

  // Emergency +10%, +20%, +30% scenarios relative to baseline nominal duration
  const emergencyScenarios: EmergencyScenarioOutcome[] = [10, 20, 30].map((extraPct) => {
    const simDurationHr = round2(nominalDurationHr * (1 + extraPct / 100));
    const sim = computeAtDuration(simDurationHr);
    return {
      extraPct,
      durationHr: simDurationHr,
      durationSols: round2(simDurationHr / MARTIAN_SOL_HOURS),
      baseOxygenKg: sim.baseO2,
      reserveOxygenKg: sim.resO2,
      totalOxygenKg: sim.totO2,
      baseEnergyKwh: sim.baseEn,
      reserveEnergyKwh: sim.resEn,
      totalEnergyKwh: sim.totEn,
      baseWaterL: sim.baseWat,
      reserveWaterL: sim.resWat,
      totalWaterL: sim.totWat,
      oxygenDeltaKg: round2(sim.totO2 - baseNominal.totO2),
      energyDeltaKwh: round2(sim.totEn - baseNominal.totEn),
      waterDeltaL: round2(sim.totWat - baseNominal.totWat),
      allSufficient:
        inputs.availableOxygenSupplyKg + 1e-6 >= sim.totO2 &&
        inputs.availableEnergySupplyKwh + 1e-6 >= sim.totEn &&
        inputs.availableWaterSupplyL + 1e-6 >= sim.totWat,
    };
  });

  // Consistent 5-component Mission Readiness Score (0-100): Planning Indicator ONLY
  const o2Ratio = Math.min(1, inputs.availableOxygenSupplyKg / Math.max(0.01, active.totO2));
  const enRatio = Math.min(1, inputs.availableEnergySupplyKwh / Math.max(0.01, active.totEn));
  const waRatio = Math.min(1, inputs.availableWaterSupplyL / Math.max(0.01, active.totWat));
  const avgCoverage = (o2Ratio + enRatio + waRatio) / 3;
  const deficitPenalty =
    (oxygenStatus === 'INSUFFICIENT' ? 10 : 0) +
    (energyStatus === 'INSUFFICIENT' ? 10 : 0) +
    (waterStatus === 'INSUFFICIENT' ? 8 : 0);

  const resourceSufficiencyScore = Math.max(0, Math.round(avgCoverage * 40 - deficitPenalty));
  const routeSafetyScore = Math.round(
    Math.max(0, Math.min(20, ((100 - Math.max(0, Math.min(100, routeRiskScore))) / 100) * 20)),
  );
  const terrainDifficultyScore = Math.round(Math.max(0, 15 - (usedDifficulty / 100) * 15));
  const emergencyReserveScore = Math.round(Math.min(15, (safeReservePct / 40) * 15));
  const missionDurationScore = Math.round(
    Math.max(0, 10 - Math.max(0, effectiveMissionDurationHr - 12) * 0.25),
  );

  const uncappedTotalScore = Math.max(
    0,
    Math.min(
      100,
      resourceSufficiencyScore +
        routeSafetyScore +
        terrainDifficultyScore +
        emergencyReserveScore +
        missionDurationScore,
    ),
  );

  const routeSafetyVal = 100 - Math.max(0, Math.min(100, routeRiskScore));
  let capAppliedReason: string | null = null;
  let missionReadinessScore = uncappedTotalScore;

  // Critical Safety Guard: Insufficient life-support resources CANNOT score as ready or nominal
  if (hasInsufficientResource) {
    missionReadinessScore = Math.min(48, uncappedTotalScore);
    capAppliedReason = `Score capped at 48/100 due to INSUFFICIENT essential resource(s): ${insufficientResources.join(', ')}.`;
  } else if (overallResourceStatus === 'LIMITED' || routeSafetyVal < 55 || usedDifficulty > maxAcceptableDifficulty) {
    missionReadinessScore = Math.min(74, uncappedTotalScore);
    capAppliedReason = `Score capped at 74/100 due to ${
      overallResourceStatus === 'LIMITED'
        ? 'tight resource reserve margin (<15%)'
        : routeSafetyVal < 55
          ? `low route safety (${routeSafetyVal}/100)`
          : `terrain difficulty (${usedDifficulty}/100) exceeding tolerance (${maxAcceptableDifficulty}/100)`
    }.`;
  }

  const readinessClassification = hasInsufficientResource
    ? 'INSUFFICIENT RESOURCE · REPLAN REQUIRED'
    : missionReadinessScore >= 75 && overallResourceStatus === 'SUFFICIENT' && routeSafetyVal >= 55
      ? 'NOMINAL PLANNING READINESS'
      : 'CAUTION · REVIEW RESERVES OR ROUTE';

  const readinessWarnings: string[] = [];
  if (oxygenStatus === 'INSUFFICIENT') {
    readinessWarnings.push(
      `INSUFFICIENT OXYGEN: Loaded ${inputs.availableOxygenSupplyKg.toFixed(2)} kg is ${Math.abs(remainingOxygenReserveKg).toFixed(2)} kg short of the ${active.totO2.toFixed(2)} kg requirement (incl. ${safeReservePct}% reserve).`,
    );
  }
  if (energyStatus === 'INSUFFICIENT') {
    readinessWarnings.push(
      `INSUFFICIENT ENERGY: Loaded ${inputs.availableEnergySupplyKwh.toFixed(2)} kWh is ${Math.abs(remainingEnergyReserveKwh).toFixed(2)} kWh short of the ${active.totEn.toFixed(2)} kWh requirement (incl. ${safeReservePct}% reserve).`,
    );
  }
  if (waterStatus === 'INSUFFICIENT') {
    readinessWarnings.push(
      `INSUFFICIENT WATER: Loaded ${inputs.availableWaterSupplyL.toFixed(2)} L is ${Math.abs(remainingWaterReserveL).toFixed(2)} L short of the ${active.totWat.toFixed(2)} L requirement (incl. ${safeReservePct}% reserve).`,
    );
  }
  if (limitedResources.length > 0) {
    readinessWarnings.push(
      `TIGHT MARGIN WARNING: ${limitedResources.join(', ')} — less than 15% buffer above reserve requirement.`,
    );
  }
  if (routeSafetyVal < 55) {
    readinessWarnings.push(
      `ROUTE SAFETY WARNING: Active route safety score is ${routeSafetyVal}/100 (elevated terrain hazard exposure).`,
    );
  }
  if (usedDifficulty > maxAcceptableDifficulty) {
    readinessWarnings.push(
      `TERRAIN TOLERANCE EXCEEDED: Difficulty ${usedDifficulty}/100 exceeds max acceptable tolerance (${maxAcceptableDifficulty}/100).`,
    );
  }
  if (inputs.durationMode === 'manual' && manualDurationDeltaHr < 0) {
    readinessWarnings.push(
      `DURATION UNDERSHOOT: Manual duration (${nominalDurationHr.toFixed(2)} hr) is shorter than estimated walk+rest+science time (${calculatedActivityDurationHr.toFixed(2)} hr).`,
    );
  }

  return {
    routeDistanceKm: usedDistanceKm,
    elevationGainM: Math.round(elevationGainM),
    terrainDifficultyUsed: usedDifficulty,
    terrainDifficultyFactor: walking.terrainDifficultyFactor,
    slopeMetabolicFactor: walking.slopeMetabolicFactor,
    combinedTerrainTimeFactor: walking.combinedTerrainTimeFactor,
    baseWalkingDurationHr: walking.baseWalkingDurationHr,
    terrainTimePenaltyHr: walking.terrainTimePenaltyHr,
    walkingDurationHr: walking.terrainAdjustedWalkingHr,
    restDurationHr,
    additionalActivityHr,
    scheduleBufferHr,
    calculatedActivityDurationHr,
    manualDurationDeltaHr,
    durationExplanation,
    estimatedTravelTimeHr: walking.terrainAdjustedWalkingHr,
    baseOxygenKg: active.baseO2,
    oxygenPerAstronautKg: round2(active.baseO2 / safeCount),
    reserveOxygenKg: active.resO2,
    totalOxygenRequiredKg: active.totO2,
    totalOxygenPerAstronautKg: round2(active.totO2 / safeCount),
    suitPowerTotalKw,
    totalPowerLoadKw,
    baseEnergyKwh: active.baseEn,
    energyPerAstronautKwh: round2(active.baseEn / safeCount),
    reserveEnergyKwh: active.resEn,
    totalEnergyRequiredKwh: active.totEn,
    totalEnergyPerAstronautKwh: round2(active.totEn / safeCount),
    baseWaterL: active.baseWat,
    waterPerAstronautL: round2(active.baseWat / safeCount),
    reserveWaterL: active.resWat,
    totalWaterRequiredL: active.totWat,
    totalWaterPerAstronautL: round2(active.totWat / safeCount),
    remainingOxygenReserveKg,
    remainingEnergyReserveKwh,
    remainingWaterReserveL,
    oxygenSufficient: oxygenStatus !== 'INSUFFICIENT',
    energySufficient: energyStatus !== 'INSUFFICIENT',
    waterSufficient: waterStatus !== 'INSUFFICIENT',
    oxygenStatus,
    energyStatus,
    waterStatus,
    overallResourceStatus,
    hasInsufficientResource,
    insufficientResources,
    limitedResources,
    effectiveMissionDurationHr,
    effectiveMissionDurationSols,
    nominalDurationHr,
    emergencyContingencyHr,
    nominalOxygenRequiredKg: baseNominal.totO2,
    nominalEnergyRequiredKwh: baseNominal.totEn,
    nominalWaterRequiredL: baseNominal.totWat,
    emergencyScenarios,
    missionReadinessScore,
    readinessClassification,
    readinessWarnings,
    readinessBreakdown: {
      resourceSufficiencyScore,
      routeSafetyScore,
      terrainDifficultyScore,
      emergencyReserveScore,
      missionDurationScore,
      uncappedTotalScore,
      capAppliedReason,
      formulaSummary:
        'Readiness (0–100) = Resource Sufficiency (0–40) + Route Safety (0–20) + Terrain Difficulty (0–15) + Emergency Reserves (0–15) + Mission Duration (0–10); capped ≤48 if any essential resource is INSUFFICIENT.',
    },
  };
}
