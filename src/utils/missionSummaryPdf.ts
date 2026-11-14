import { jsPDF } from 'jspdf';
import type {
  CentralMissionState,
  MissionSnapshot,
  SnapshotValidationResult,
} from '../types/mars';
import { computeSciencePriority } from '../engine/scienceEngine';
import { createMissionSnapshot, validateMissionSnapshot } from '../engine/missionState';

export interface ReportExportResult {
  ok: boolean;
  snapshotId: string;
  generatedAtIso: string;
  validation: SnapshotValidationResult;
  errors: string[];
}

function resolveSnapshot(
  source: MissionSnapshot | CentralMissionState,
  latestAssistantAnalysis?: string,
): MissionSnapshot {
  if ('snapshotId' in source && 'state' in source) {
    return source;
  }
  return createMissionSnapshot(source, latestAssistantAnalysis);
}

function formatCoordSummary(state: CentralMissionState): string {
  const coords = state.routeCoordinates;
  if (coords.length === 0) return 'No coordinates generated.';
  const start = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const end = coords[coords.length - 1];
  return `${coords.length} grid nodes: Start (${start.lat.toFixed(4)}°, ${start.lon.toFixed(4)}°) -> Mid (${mid.lat.toFixed(4)}°, ${mid.lon.toFixed(4)}°) -> End (${end.lat.toFixed(4)}°, ${end.lon.toFixed(4)}°)`;
}

/**
 * Report 1 (Markdown preview / AI Mission Assistant dossier): reads strictly from MissionSnapshot.
 */
export function buildMissionSummaryMarkdown(
  source: MissionSnapshot | CentralMissionState,
  latestAssistantAnalysis?: string,
): string {
  const snapshot = resolveSnapshot(source, latestAssistantAnalysis);
  const s = snapshot.state;

  const criticalHazards = s.routePlan.hazards.filter((h) => h.riskLevel === 'CRITICAL');
  const highHazards = s.routePlan.hazards.filter((h) => h.riskLevel === 'HIGH');
  const topHazards = s.routePlan.hazards.slice(0, 5);
  const safestRoute = s.routePlan.routes.find((r) => r.profile === 'safest');

  return [
    `### Mission Overview`,
    `- **Snapshot ID & Timestamp:** \`${snapshot.snapshotId}\` · ${snapshot.generatedAtIso}`,
    `- **Mission Name:** ${s.missionName}`,
    `- **Objective:** ${s.objective.replace(/-/g, ' ').toUpperCase()}`,
    `- **Martian Region:** ${s.region.name} (${s.region.region}) — ${s.region.lat.toFixed(3)}°, ${s.region.lon.toFixed(3)}° · ${s.region.elevationM} m MOLA`,
    `- **Starting Location:** ${s.startingLocation.name} (${s.startingLocation.lat.toFixed(4)}°, ${s.startingLocation.lon.toFixed(4)}°, ${s.startingLocation.elevationM} m)`,
    ...(s.scienceWaypoints.length > 0
      ? [
          `- **Intermediate Science Waypoints (${s.scienceWaypoints.length}):** ${s.scienceWaypoints
            .map((w) => `${w.name} (${w.lat.toFixed(4)}°, ${w.lon.toFixed(4)}°)`)
            .join(' -> ')}`,
        ]
      : []),
    `- **Destination:** ${s.destination.name} (${s.destination.lat.toFixed(4)}°, ${s.destination.lon.toFixed(4)}°, ${s.destination.elevationM} m)`,
    '',
    `### Route Assessment & Coordinates`,
    `- **Route Preference & Active Profile:** ${s.routePreference.toUpperCase()} -> ${s.activeRouteLabel} (${s.activeRouteProfile.toUpperCase()})`,
    `- **Route Distance:** ${s.distanceKm.toFixed(2)} km (Elevation gain +${s.elevationGainM} m / loss -${s.elevationLossM} m · Calc Mode: ${s.distanceSyncMode === 'SYNCED_WITH_ROUTE' ? 'Synced with Route' : `Manual Override ${s.calculatorDistanceKm.toFixed(2)} km`})`,
    `- **Route Coordinates:** ${formatCoordSummary(s)}`,
    `- **Safety & Hazard Risk:** Safety Score **${s.safetyScore}/100** · Hazard Risk **${s.hazardRisk.overallRiskScore}/100** (**${s.hazardRisk.overallRiskLevel}**) · Crit/High Sections: ${s.hazardRisk.criticalSectionCount}/${s.hazardRisk.highSectionCount}`,
    `- **Terrain Difficulty:** Route Mean ${s.terrainDifficulty.routeMeanDifficulty}/100 (${s.terrainDifficulty.classificationLabel}) · Peak Slope ${s.terrainDifficulty.maxSlopeDeg.toFixed(1)}° · Tolerance <= ${s.terrainDifficulty.maxAcceptableDifficulty}/100 (${s.terrainDifficulty.passesMaxDifficulty ? 'WITHIN TOLERANCE' : 'EXCEEDS TOLERANCE'})`,
    safestRoute && safestRoute.id !== s.activeRouteId
      ? `- **Safer Alternative:** ${safestRoute.label} offers ${safestRoute.safetyScore}/100 safety over ${safestRoute.distanceKm.toFixed(2)} km.`
      : '',
    '',
    `### Hazard Warnings`,
    criticalHazards.length > 0 || s.hazardRisk.criticalSectionCount > 0
      ? `> **WARNING:** On Active Route: ${s.hazardRisk.criticalSectionCount} critical and ${s.hazardRisk.highSectionCount} high-risk path steps (${s.hazardRisk.moderateSectionCount} moderate). Regional 25 km Map: ${criticalHazards.length} critical and ${highHazards.length} high-risk clustered sectors (${s.hazardRisk.intersectingHazardZonesCount} intersecting, ${s.hazardRisk.nearRouteHazardZonesCount} near <= 1.1 km, ${s.hazardRisk.avoidedHazardZonesCount} avoided by active route).`
      : `> **CAUTION:** On Active Route: ${s.hazardRisk.criticalSectionCount} critical, ${s.hazardRisk.highSectionCount} high, ${s.hazardRisk.moderateSectionCount} moderate steps. Regional 25 km Map: ${highHazards.length} high-risk clustered sectors (${s.hazardRisk.intersectingHazardZonesCount} intersecting, ${s.hazardRisk.nearRouteHazardZonesCount} near <= 1.1 km, ${s.hazardRisk.avoidedHazardZonesCount} avoided by active route).`,
    ...topHazards.map(
      (h) =>
        `- **[${h.riskLevel}${h.routeRelation ? ` · ${h.routeRelation.replace('_', ' ')}` : ''}] ${h.category}** (${h.lat.toFixed(3)}°, ${h.lon.toFixed(3)}°, slope ${h.slopeDeg.toFixed(1)}°): ${h.mitigation}`,
    ),
    '',
    `### Crew, Duration & Consumable Requirements`,
    `- **Crew & Speed:** ${s.crewSize} astronaut(s) · ${s.walkingSpeedKmh.toFixed(1)} km/h walking speed`,
    `- **Mission Duration (${s.timing.durationMode}):** **${s.timing.totalMissionDurationHr.toFixed(2)} hr (${s.timing.totalMissionDurationSols.toFixed(2)} Martian sols)** [Base Walk ${s.timing.baseWalkingTimeHr.toFixed(2)}h + Terrain Delay ${s.timing.terrainDelayHr.toFixed(2)}h + Rest ${s.timing.restTimeHr.toFixed(2)}h + Science ${s.timing.scientificActivityTimeHr.toFixed(2)}h + Buffer ${s.timing.scheduleBufferHr.toFixed(2)}h + Contingency ${s.timing.emergencyContingencyTimeHr.toFixed(2)}h (+${s.timing.emergencyContingencyPct}%)]`,
    `- **Oxygen (O2):** ${s.oxygen.totalRequiredKg.toFixed(2)} kg required (Base ${s.oxygen.baseKg.toFixed(2)} kg @ ${s.oxygen.rateKgPerPersonHr.toFixed(3)} kg/person/hr + ${s.emergencyReserves.safetyReservePct}% reserve ${s.oxygen.reserveKg.toFixed(2)} kg) vs ${s.loadedSupplies.oxygenKg.toFixed(2)} kg loaded -> **${s.oxygen.status}** (${s.oxygen.marginKg >= 0 ? '+' : ''}${s.oxygen.marginKg.toFixed(2)} kg)`,
    `- **Energy:** ${s.energy.totalRequiredKwh.toFixed(2)} kWh required (Base ${s.energy.baseKwh.toFixed(2)} kWh @ ${s.energy.totalLoadKw.toFixed(2)} kW total load + ${s.emergencyReserves.safetyReservePct}% reserve ${s.energy.reserveKwh.toFixed(2)} kWh) vs ${s.loadedSupplies.energyKwh.toFixed(2)} kWh loaded -> **${s.energy.status}** (${s.energy.marginKwh >= 0 ? '+' : ''}${s.energy.marginKwh.toFixed(2)} kWh)`,
    `- **Water:** ${s.water.totalRequiredL.toFixed(2)} L required (Base ${s.water.baseL.toFixed(2)} L @ ${s.water.dailyRateLPerPersonSol.toFixed(1)} L/person/sol, 1 sol = ${s.timing.martianSolHours} hr + ${s.emergencyReserves.safetyReservePct}% reserve ${s.water.reserveL.toFixed(2)} L) vs ${s.loadedSupplies.waterL.toFixed(2)} L loaded -> **${s.water.status}** (${s.water.marginL >= 0 ? '+' : ''}${s.water.marginL.toFixed(2)} L)`,
    `- **Mission Readiness:** **${s.missionReadiness.score}/100 — ${s.missionReadiness.classification}** (Resources ${s.missionReadiness.breakdown.resourceSufficiencyScore}/40 · Safety ${s.missionReadiness.breakdown.routeSafetyScore}/20 · Terrain ${s.missionReadiness.breakdown.terrainDifficultyScore}/15 · Reserves ${s.missionReadiness.breakdown.emergencyReserveScore}/15 · Duration ${s.missionReadiness.breakdown.missionDurationScore}/10)`,
    ...(s.missionReadiness.warnings.length > 0
      ? s.missionReadiness.warnings.map((w) => `> **ALERT:** ${w}`)
      : []),
    '',
    `### Scientific Opportunities`,
    ...(s.nearbyScience.length > 0
      ? s.nearbyScience.map((site) => {
          const pri = computeSciencePriority(site, 'explore-ancient-deltas', {
            route: s.activeRoute,
            location: s.selectedLocation,
          });
          return `- **${site.title}** (${site.geologicalCategory}, Prototype Priority ${pri.totalScore}/100, ${site.confidenceLevel} confidence) — ${site.nasaMission} (${site.instrument})`;
        })
      : ['- No cataloged science targets inside this specific region boundary.']),
    '',
    `### Data Sources & Important Limitations`,
    `- **NASA data successfully retrieved:** Live runtime feeds when reachable (PDS ODE HiRISE/CTX footprints, JPL Mars 2020/MSL raw frames, MEDA/REMS archives, NASA Image Library).`,
    `- **NASA archival reference:** ${s.datasets.filter((d) => d.credibilityClass === 'PUBLISHED SCIENTIFIC DATASET').map((d) => `${d.name} (${d.mission})`).join('; ')}.`,
    `- **Derived analysis:** 8-connected A* routes, slope/TRI terrain metrics, Safety/Risk Score, 5-factor Science Priority Score, and survival calculations.`,
    `- **Simulated demonstration data:** MARSWALK 25x25 km synthetic terrain grid (500 m cells) anchored to MOLA/THEMIS macro parameters.`,
    `- **Prototype Notice & Limitations:** MARSWALK AI is a **research and mission-planning prototype — NOT an operational flight system or safety certification**. Synthetic 500 m terrain cannot resolve meter-scale rocks or certify EVA routes; O2/energy/water equations are parametric planning estimates only.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Report 2 (TXT): Mission Resource & Survival Planning Report generated from the exact same MissionSnapshot.
 */
export function buildResourcePlanningReportText(
  source: MissionSnapshot | CentralMissionState,
): { text: string; snapshot: MissionSnapshot; validation: SnapshotValidationResult } {
  const snapshot = resolveSnapshot(source);
  const validation = validateMissionSnapshot(snapshot);
  const s = snapshot.state;

  const lines = [
    '========================================================================',
    'MARSWALK AI — MISSION RESOURCE & SURVIVAL PLANNING REPORT',
    '========================================================================',
    `Snapshot ID:          ${snapshot.snapshotId}`,
    `Generated UTC:        ${snapshot.generatedAtIso}`,
    `Generated Local:      ${snapshot.generatedAtLocal}`,
    `Validation Status:    ${validation.valid ? 'PASSED (6/6 SYNCHRONISATION CHECKS)' : `FAILED (${validation.errors.length} ERROR(S))`}`,
    '',
    '0. MISSION OVERVIEW & ROUTE SYNCHRONISATION',
    `   Mission Name:          ${s.missionName}`,
    `   Objective:             ${s.objective.replace(/-/g, ' ').toUpperCase()}`,
    `   Martian Region:        ${s.region.name} (${s.region.lat.toFixed(4)} deg, ${s.region.lon.toFixed(4)} deg | ${s.region.elevationM} m MOLA)`,
    `   Starting Location:     ${s.startingLocation.name} (${s.startingLocation.lat.toFixed(4)} deg, ${s.startingLocation.lon.toFixed(4)} deg)`,
    ...(s.scienceWaypoints.length > 0
      ? [
          `   Science Waypoints:     ${s.scienceWaypoints.map((w) => w.name).join(' -> ')}`,
        ]
      : []),
    `   Destination:           ${s.destination.name} (${s.destination.lat.toFixed(4)} deg, ${s.destination.lon.toFixed(4)} deg)`,
    `   Route Preference:      ${s.routePreference.toUpperCase()} (${s.activeRouteLabel})`,
    `   Route Coordinates:     ${formatCoordSummary(s)}`,
    `   Route Distance:        ${s.distanceKm.toFixed(2)} km (Elev +${s.elevationGainM} m / -${s.elevationLossM} m)`,
    `   Calculator Input Mode: ${s.distanceSyncMode === 'SYNCED_WITH_ROUTE' ? `Auto-Synced with Route (${s.calculatorDistanceKm.toFixed(2)} km)` : `Manual Override (${s.calculatorDistanceKm.toFixed(2)} km, Difficulty ${s.terrainDifficulty.calculatorDifficultyUsed}/100)`}`,
    `   Terrain Difficulty:    ${s.terrainDifficulty.routeMeanDifficulty}/100 route (${s.terrainDifficulty.classificationLabel}) | Peak Slope ${s.terrainDifficulty.maxSlopeDeg.toFixed(1)} deg`,
    `   Hazard Risk & Safety:  Safety Score ${s.safetyScore}/100 | Risk Score ${s.hazardRisk.overallRiskScore}/100 (${s.hazardRisk.overallRiskLevel}) | On-Route Steps: ${s.hazardRisk.criticalSectionCount} Crit / ${s.hazardRisk.highSectionCount} High / ${s.hazardRisk.moderateSectionCount} Mod`,
    `   Regional 25km Hazards: ${s.hazardRisk.flaggedRegionalZonesCount} flagged sectors (${s.hazardRisk.intersectingHazardZonesCount} intersecting, ${s.hazardRisk.nearRouteHazardZonesCount} near <= 1.1 km, ${s.hazardRisk.avoidedHazardZonesCount} avoided by route)`,
    '',
    '1. CREW & MISSION DURATION BREAKDOWN',
    `   Crew Size:                 ${s.crewSize} astronaut(s)`,
    `   Walking Speed:             ${s.walkingSpeedKmh.toFixed(1)} km/h`,
    `   Duration Mode:             ${s.timing.durationMode === 'manual' ? 'Manual Duration Override' : 'Activity-Derived Schedule'}`,
    `   Base Walking Time:         ${s.timing.baseWalkingTimeHr.toFixed(2)} hr (= ${s.calculatorDistanceKm.toFixed(2)} km / ${s.walkingSpeedKmh.toFixed(1)} km/h)`,
    `   Terrain & Slope Delay:     +${s.timing.terrainDelayHr.toFixed(2)} hr (Slope Factor x${s.terrainDifficulty.slopeMetabolicFactor}, Difficulty Factor x${s.terrainDifficulty.terrainDifficultyFactor})`,
    `   Terrain-Adjusted Walk:     ${s.timing.terrainAdjustedWalkingTimeHr.toFixed(2)} hr`,
    `   Rest Time:                 ${s.timing.restTimeHr.toFixed(2)} hr`,
    `   Scientific Activity Time:  ${s.timing.scientificActivityTimeHr.toFixed(2)} hr`,
    `   Schedule Safety Buffer:    ${s.timing.scheduleBufferHr.toFixed(2)} hr`,
    `   Nominal Baseline Duration: ${s.timing.nominalDurationHr.toFixed(2)} hr`,
    `   Emergency Contingency:     +${s.timing.emergencyContingencyTimeHr.toFixed(2)} hr (+${s.timing.emergencyContingencyPct}% scenario)`,
    `   Total Mission Duration:    ${s.timing.totalMissionDurationHr.toFixed(2)} hr (${s.timing.totalMissionDurationSols.toFixed(2)} Martian sols @ ${s.timing.martianSolHours} hr/sol)`,
    `   Timeline Note:             ${s.timing.explanation}`,
    '',
    '2. OXYGEN PLANNING ESTIMATE (NOT A NASA SPACESUIT SPECIFICATION)',
    `   Formula:                   Base = Crew x Duration x Rate; Reserve = Base x Reserve%; Total = Base + Reserve`,
    `   Configured Inputs:         ${s.crewSize} crew x ${s.timing.totalMissionDurationHr.toFixed(2)} hr x ${s.oxygen.rateKgPerPersonHr.toFixed(3)} kg/person/hr`,
    `   Base O2 Requirement:       ${s.oxygen.baseKg.toFixed(2)} kg (${s.oxygen.perAstronautBaseKg.toFixed(2)} kg/astronaut)`,
    `   Emergency Reserve (${s.emergencyReserves.safetyReservePct}%):   ${s.oxygen.reserveKg.toFixed(2)} kg`,
    `   Total O2 Required:         ${s.oxygen.totalRequiredKg.toFixed(2)} kg (${s.oxygen.totalPerAstronautKg.toFixed(2)} kg/astronaut)`,
    `   Loaded O2 Supply:          ${s.loadedSupplies.oxygenKg.toFixed(2)} kg | Status: ${s.oxygen.status} (${s.oxygen.marginKg >= 0 ? '+' : ''}${s.oxygen.marginKg.toFixed(2)} kg)`,
    '',
    '3. ENERGY PLANNING ESTIMATE',
    `   Formula:                   Base = (Crew x Suit_kW + Shared_kW) x Duration; Reserve = Base x Reserve%; Total = Base + Reserve`,
    `   Configured Power Load:     (${s.crewSize} x ${s.energy.suitPowerKwPerAstronaut.toFixed(2)} kW suit + ${s.energy.sharedEquipmentKw.toFixed(2)} kW shared) = ${s.energy.totalLoadKw.toFixed(2)} kW`,
    `   Base Energy Requirement:   ${s.energy.baseKwh.toFixed(2)} kWh (${s.energy.perAstronautKwh.toFixed(2)} kWh/astronaut share)`,
    `   Emergency Reserve (${s.emergencyReserves.safetyReservePct}%):   ${s.energy.reserveKwh.toFixed(2)} kWh`,
    `   Total Energy Required:     ${s.energy.totalRequiredKwh.toFixed(2)} kWh (${s.energy.totalPerAstronautKwh.toFixed(2)} kWh/astronaut share)`,
    `   Loaded Battery Supply:     ${s.loadedSupplies.energyKwh.toFixed(2)} kWh | Status: ${s.energy.status} (${s.energy.marginKwh >= 0 ? '+' : ''}${s.energy.marginKwh.toFixed(2)} kWh)`,
    '',
    '4. WATER PLANNING ESTIMATE (NOT AN OFFICIAL NASA MISSION REQUIREMENT)',
    `   Formula:                   Base = Crew x (Duration / 24.623 sol_hr) x Daily_L; Reserve = Base x Reserve%; Total = Base + Reserve`,
    `   Configured Inputs:         ${s.crewSize} crew x (${s.timing.totalMissionDurationHr.toFixed(2)} / ${s.timing.martianSolHours}) sols x ${s.water.dailyRateLPerPersonSol.toFixed(1)} L/sol`,
    `   Base Water Requirement:    ${s.water.baseL.toFixed(2)} L (${s.water.perAstronautBaseL.toFixed(2)} L/astronaut)`,
    `   Emergency Reserve (${s.emergencyReserves.safetyReservePct}%):   ${s.water.reserveL.toFixed(2)} L`,
    `   Total Water Required:      ${s.water.totalRequiredL.toFixed(2)} L (${s.water.totalPerAstronautL.toFixed(2)} L/astronaut)`,
    `   Loaded Water Supply:       ${s.loadedSupplies.waterL.toFixed(2)} L | Status: ${s.water.status} (${s.water.marginL >= 0 ? '+' : ''}${s.water.marginL.toFixed(2)} L)`,
    '',
    '5. EMERGENCY DURATION SCENARIOS (RELATIVE TO NOMINAL DURATION)',
    ...s.emergencyReserves.scenarios.map(
      (sc) =>
        `   +${sc.extraPct}% (${sc.durationHr.toFixed(2)} hr / ${sc.durationSols.toFixed(2)} sols): O2 ${sc.totalOxygenKg.toFixed(2)} kg (+${sc.oxygenDeltaKg.toFixed(2)}) | Energy ${sc.totalEnergyKwh.toFixed(2)} kWh (+${sc.energyDeltaKwh.toFixed(2)}) | Water ${sc.totalWaterL.toFixed(2)} L (+${sc.waterDeltaL.toFixed(2)}) | Supplies Cover: ${sc.allSufficient ? 'YES' : 'SHORTFALL'}`,
    ),
    '',
    '6. MISSION READINESS (PLANNING INDICATOR ONLY — NOT SAFETY CERTIFICATION)',
    `   Overall Resource Status:   ${s.missionReadiness.overallResourceStatus}`,
    `   Mission Readiness Score:   ${s.missionReadiness.score} / 100 (${s.missionReadiness.classification})`,
    `   Component Breakdown:       Resource Sufficiency ${s.missionReadiness.breakdown.resourceSufficiencyScore}/40 | Route Safety ${s.missionReadiness.breakdown.routeSafetyScore}/20 | Terrain Difficulty ${s.missionReadiness.breakdown.terrainDifficultyScore}/15 | Emergency Reserves ${s.missionReadiness.breakdown.emergencyReserveScore}/15 | Mission Duration ${s.missionReadiness.breakdown.missionDurationScore}/10`,
    ...(s.missionReadiness.breakdown.capAppliedReason
      ? [`   Readiness Guardrail:       ${s.missionReadiness.breakdown.capAppliedReason}`]
      : []),
    ...(s.missionReadiness.warnings.length > 0
      ? [
          '   ACTIVE WARNINGS:',
          ...s.missionReadiness.warnings.map((w) => `     - ${w}`),
        ]
      : ['   Active Warnings:           None (all configured margins covered).']),
    '',
    '7. NASA DATASET PROVENANCE, ASSUMPTIONS & LIMITATIONS',
    '   - Prototype Disclaimer: MARSWALK AI is a research and mission-planning prototype, NOT an operational flight system.',
    '   - NASA data successfully retrieved: PDS ODE georeferenced HiRISE/CTX footprints, JPL Mars 2020/MSL feeds, MEDA/REMS archives, NASA Image Library (subject to live endpoint availability).',
    '   - NASA archival reference: MGS MOLA shaded relief (WMTS), Viking MDIM 2.1 (WMTS), Odyssey THEMIS IR (WMS), IAU crater coordinates.',
    '   - Derived analysis: A* route distance/elevation/safety, finite-difference slope & TRI, O2/energy/water/readiness estimates.',
    '   - Simulated demonstration data: 25x25 km synthetic terrain grid (500 m/cell) anchored to MOLA/THEMIS baselines.',
    '   - Oxygen, energy, water, and readiness scores are parametric planning estimates ONLY — NOT official NASA spacesuit/PLSS specifications or EVA safety certifications.',
  ];

  return { text: lines.join('\n'), snapshot, validation };
}

function createStyledPdfDoc(title: string, snapshot: MissionSnapshot): {
  doc: jsPDF;
  addHeading: (text: string) => void;
  addLines: (lines: string[], fontSize?: number) => void;
  addWarningBox: (lines: string[]) => void;
  addGap: (px?: number) => void;
} {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFillColor(12, 16, 24);
  doc.rect(0, 0, pageWidth, 74, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(title, margin, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(180, 192, 210);
  doc.text(
    `Snapshot ID: ${snapshot.snapshotId}  |  Generated UTC: ${snapshot.generatedAtIso}`,
    margin,
    46,
  );
  doc.text(
    `MARSWALK AI — NASA Space Apps Challenge 2026 | Planning Estimate (Not Safety Certification)`,
    margin,
    60,
  );
  y = 94;

  const addHeading = (heading: string) => {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(232, 93, 42);
    doc.text(heading.toUpperCase(), margin, y);
    y += 5;
    doc.setDrawColor(210, 214, 222);
    doc.line(margin, y, pageWidth - margin, y);
    y += 13;
  };

  const addLines = (lines: string[], fontSize = 9.2) => {
    doc.setFontSize(fontSize);
    doc.setTextColor(30, 35, 45);
    doc.setFont('helvetica', 'normal');
    for (const raw of lines) {
      const wrapped = doc.splitTextToSize(raw, maxWidth) as string[];
      ensureSpace(wrapped.length * (fontSize + 3.2) + 4);
      doc.text(wrapped, margin, y);
      y += wrapped.length * (fontSize + 3.2) + 2;
    }
  };

  const addWarningBox = (lines: string[]) => {
    if (lines.length === 0) return;
    doc.setFontSize(9);
    const wrappedAll: string[] = [];
    for (const l of lines) {
      wrappedAll.push(...(doc.splitTextToSize(`! ${l}`, maxWidth - 16) as string[]));
    }
    const boxH = wrappedAll.length * 12 + 14;
    ensureSpace(boxH + 8);
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(220, 38, 38);
    doc.rect(margin, y - 8, maxWidth, boxH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(153, 27, 27);
    doc.text(wrappedAll, margin + 8, y + 5);
    y += boxH + 6;
  };

  const addGap = (px = 6) => {
    y += px;
  };

  return { doc, addHeading, addLines, addWarningBox, addGap };
}

/**
 * Download Report 1: Mission Summary PDF (with mandatory pre-export validation).
 */
export function downloadMissionSummaryPdf(
  source: MissionSnapshot | CentralMissionState,
  latestAssistantAnalysis?: string,
): ReportExportResult {
  const snapshot = resolveSnapshot(source, latestAssistantAnalysis);
  const validation = validateMissionSnapshot(snapshot);
  if (!validation.valid) {
    return {
      ok: false,
      snapshotId: snapshot.snapshotId,
      generatedAtIso: snapshot.generatedAtIso,
      validation,
      errors: validation.errors,
    };
  }

  const s = snapshot.state;
  const { doc, addHeading, addLines, addWarningBox, addGap } = createStyledPdfDoc(
    'MARSWALK AI — MISSION SUMMARY REPORT',
    snapshot,
  );

  if (s.missionReadiness.warnings.length > 0) {
    addWarningBox(s.missionReadiness.warnings);
  }

  addHeading('1. Mission Objective, Sector & Endpoints');
  addLines([
    `Mission Name: ${s.missionName}`,
    `Mission Objective: ${s.objective.replace(/-/g, ' ').toUpperCase()}`,
    `Martian Region: ${s.region.name} (${s.region.region}) | ${s.region.lat.toFixed(4)} deg lat, ${s.region.lon.toFixed(4)} deg lon | ${s.region.elevationM} m MOLA`,
    `Starting Location: ${s.startingLocation.name} (${s.startingLocation.lat.toFixed(4)} deg, ${s.startingLocation.lon.toFixed(4)} deg | ${s.startingLocation.elevationM} m)`,
    ...(s.scienceWaypoints.length > 0
      ? [
          `Intermediate Science Waypoints: ${s.scienceWaypoints.map((w) => w.name).join(' -> ')}`,
        ]
      : []),
    `Destination: ${s.destination.name} (${s.destination.lat.toFixed(4)} deg, ${s.destination.lon.toFixed(4)} deg | ${s.destination.elevationM} m)`,
  ]);
  addGap();

  addHeading('2. Planned Route, Coordinates & Terrain Difficulty');
  addLines([
    `Route Preference & Active Profile: ${s.routePreference.toUpperCase()} -> ${s.activeRouteLabel} (${s.activeRouteProfile.toUpperCase()})`,
    `Route Coordinates: ${formatCoordSummary(s)}`,
    `Route Distance: ${s.distanceKm.toFixed(2)} km | Elevation Gain: +${s.elevationGainM} m / Loss: -${s.elevationLossM} m | Calculator Sync: ${s.distanceSyncMode === 'SYNCED_WITH_ROUTE' ? 'Synced with Route' : `Manual (${s.calculatorDistanceKm.toFixed(2)} km)`}`,
    `Terrain Difficulty: ${s.terrainDifficulty.routeMeanDifficulty}/100 (${s.terrainDifficulty.classificationLabel}) | Max acceptable tolerance: ${s.terrainDifficulty.maxAcceptableDifficulty}/100 (${s.terrainDifficulty.passesMaxDifficulty ? 'PASS' : 'EXCEEDS TOLERANCE'})`,
    `Peak / Mean Slope: ${s.terrainDifficulty.maxSlopeDeg.toFixed(1)} deg peak / ${s.terrainDifficulty.meanSlopeDeg.toFixed(1)} deg mean`,
    `Safety & Hazard Risk: Safety Score ${s.safetyScore}/100 | Hazard Risk ${s.hazardRisk.overallRiskScore}/100 (${s.hazardRisk.overallRiskLevel}) | Crit/High Corridor Sections: ${s.hazardRisk.criticalSectionCount}/${s.hazardRisk.highSectionCount}`,
    `Route Selection Rationale: ${s.routePlan.selectionExplanation}`,
  ]);
  addGap();

  addHeading('3. Major Terrain Hazards');
  if (s.routePlan.hazards.length === 0) {
    addLines(['No major hazard cells detected along the active corridor.']);
  } else {
    addLines(
      s.routePlan.hazards.slice(0, 8).map(
        (h, i) =>
          `${i + 1}. [${h.riskLevel}] ${h.category} (${h.lat.toFixed(3)} deg, ${h.lon.toFixed(3)} deg | Slope ${h.slopeDeg.toFixed(1)} deg | ${h.dataOrigin}): ${h.reason} Mitigation: ${h.mitigation}`,
      ),
    );
  }
  addGap();

  addHeading('4. Duration, Consumables, Emergency Reserves & Readiness');
  addLines([
    `Crew Size: ${s.crewSize} astronaut(s) | Walking Speed: ${s.walkingSpeedKmh.toFixed(1)} km/h | Duration Mode: ${s.timing.durationMode}`,
    `Timing Breakdown: Base Walk ${s.timing.baseWalkingTimeHr.toFixed(2)} hr + Terrain Delay ${s.timing.terrainDelayHr.toFixed(2)} hr = Walk ${s.timing.terrainAdjustedWalkingTimeHr.toFixed(2)} hr + Rest ${s.timing.restTimeHr.toFixed(2)} hr + Science ${s.timing.scientificActivityTimeHr.toFixed(2)} hr + Buffer ${s.timing.scheduleBufferHr.toFixed(2)} hr = Nominal ${s.timing.nominalDurationHr.toFixed(2)} hr (+${s.timing.emergencyContingencyTimeHr.toFixed(2)} hr contingency [${s.timing.emergencyContingencyPct}%])`,
    `Total Mission Duration: ${s.timing.totalMissionDurationHr.toFixed(2)} hr (${s.timing.totalMissionDurationSols.toFixed(2)} Martian sols @ ${s.timing.martianSolHours} hr/sol)`,
    `Oxygen (O2): ${s.oxygen.totalRequiredKg.toFixed(2)} kg req (Base ${s.oxygen.baseKg.toFixed(2)} kg @ ${s.oxygen.rateKgPerPersonHr.toFixed(3)} kg/p/hr + ${s.emergencyReserves.safetyReservePct}% reserve ${s.oxygen.reserveKg.toFixed(2)} kg) | Loaded: ${s.loadedSupplies.oxygenKg.toFixed(2)} kg [${s.oxygen.status}, margin ${s.oxygen.marginKg >= 0 ? '+' : ''}${s.oxygen.marginKg.toFixed(2)} kg]`,
    `Energy: ${s.energy.totalRequiredKwh.toFixed(2)} kWh req (Base ${s.energy.baseKwh.toFixed(2)} kWh @ ${s.energy.totalLoadKw.toFixed(2)} kW + ${s.emergencyReserves.safetyReservePct}% reserve ${s.energy.reserveKwh.toFixed(2)} kWh) | Loaded: ${s.loadedSupplies.energyKwh.toFixed(2)} kWh [${s.energy.status}, margin ${s.energy.marginKwh >= 0 ? '+' : ''}${s.energy.marginKwh.toFixed(2)} kWh]`,
    `Water: ${s.water.totalRequiredL.toFixed(2)} L req (Base ${s.water.baseL.toFixed(2)} L @ ${s.water.dailyRateLPerPersonSol.toFixed(1)} L/p/sol + ${s.emergencyReserves.safetyReservePct}% reserve ${s.water.reserveL.toFixed(2)} L) | Loaded: ${s.loadedSupplies.waterL.toFixed(2)} L [${s.water.status}, margin ${s.water.marginL >= 0 ? '+' : ''}${s.water.marginL.toFixed(2)} L]`,
    `Mission Readiness (Planning Indicator): ${s.missionReadiness.score}/100 (${s.missionReadiness.classification}) | Overall Resources: ${s.missionReadiness.overallResourceStatus}`,
    `Readiness Breakdown: Resource ${s.missionReadiness.breakdown.resourceSufficiencyScore}/40 | Safety ${s.missionReadiness.breakdown.routeSafetyScore}/20 | Terrain ${s.missionReadiness.breakdown.terrainDifficultyScore}/15 | Reserves ${s.missionReadiness.breakdown.emergencyReserveScore}/15 | Duration ${s.missionReadiness.breakdown.missionDurationScore}/10`,
  ]);
  addGap();

  addHeading('5. Scientific Objectives & Nearby Targets');
  if (s.nearbyScience.length === 0) {
    addLines(['No cataloged geological science targets in the active region.']);
  } else {
    addLines(
      s.nearbyScience.map((site, i) => {
        const pri = computeSciencePriority(site, 'explore-ancient-deltas', {
          route: s.activeRoute,
          location: s.selectedLocation,
        });
        return `${i + 1}. ${site.title} [${site.geologicalCategory}] — Priority Score* ${pri.totalScore}/100 | Confidence: ${site.confidenceLevel} | Water Evidence: ${site.waterEnvironmentEvidence} | Source: ${site.nasaMission} (${site.instrument})`;
      }),
    );
  }
  addGap();

  if (snapshot.latestAssistantAnalysis && snapshot.latestAssistantAnalysis.trim().length > 0) {
    addHeading('6. AI Mission Assistant Assessment Excerpt');
    const cleanText = snapshot.latestAssistantAnalysis
      .replace(/[#>*`]/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 18);
    addLines(cleanText, 8.8);
    addGap();
  }

  addHeading('7. Data Provenance, Prototype Notice & Scientific Limitations');
  addLines([
    'Research Prototype Notice: MARSWALK AI is a research and mission-planning prototype — NOT an operational flight system or NASA EVA certification tool.',
    'NASA data successfully retrieved (when live upstream responds): PDS ODE HiRISE/CTX footprints, JPL Mars 2020/MSL raw feeds, MEDA/REMS weather archives, NASA Image Library.',
    `NASA archival reference: ${s.datasets.filter((d) => d.credibilityClass === 'PUBLISHED SCIENTIFIC DATASET').map((d) => `${d.name} [${d.mission}, ${d.coveragePeriod}]`).join(' | ')}`,
    'Derived analysis: A* routes, slope/TRI terrain metrics, Safety/Risk Score, 5-Factor Science Priority Score, and O2/energy/water/readiness formulas.',
    'Simulated demonstration data & limitations: Terrain grid (25x25 km, 500 m cells) is a synthetic demonstration model calibrated to MOLA/THEMIS macro baselines; meter-scale boulders require 0.25 m/px HiRISE stereo verification. Consumable & readiness scores are parametric planning estimates only.',
  ]);

  const slug = s.region.id || 'marswalk';
  doc.save(`marswalk-mission-summary-${slug}-${snapshot.snapshotId.slice(-9)}.pdf`);

  return {
    ok: true,
    snapshotId: snapshot.snapshotId,
    generatedAtIso: snapshot.generatedAtIso,
    validation,
    errors: [],
  };
}

/**
 * Download Report 2 (PDF): Mission Resource & Survival Planning Report generated from the exact same MissionSnapshot.
 */
export function downloadResourcePlanningPdf(
  source: MissionSnapshot | CentralMissionState,
): ReportExportResult {
  const snapshot = resolveSnapshot(source);
  const validation = validateMissionSnapshot(snapshot);
  if (!validation.valid) {
    return {
      ok: false,
      snapshotId: snapshot.snapshotId,
      generatedAtIso: snapshot.generatedAtIso,
      validation,
      errors: validation.errors,
    };
  }

  const s = snapshot.state;
  const { doc, addHeading, addLines, addWarningBox, addGap } = createStyledPdfDoc(
    'MARSWALK AI — RESOURCE & SURVIVAL PLANNING REPORT',
    snapshot,
  );

  if (s.missionReadiness.warnings.length > 0) {
    addWarningBox(s.missionReadiness.warnings);
  }

  addHeading('1. Mission & Route Synchronisation Summary');
  addLines([
    `Mission Name: ${s.missionName} | Objective: ${s.objective.replace(/-/g, ' ').toUpperCase()}`,
    `Martian Region: ${s.region.name} (${s.region.lat.toFixed(4)} deg, ${s.region.lon.toFixed(4)} deg | ${s.region.elevationM} m MOLA)`,
    `Starting Location: ${s.startingLocation.name} (${s.startingLocation.lat.toFixed(4)} deg, ${s.startingLocation.lon.toFixed(4)} deg)`,
    ...(s.scienceWaypoints.length > 0
      ? [
          `Intermediate Science Waypoints: ${s.scienceWaypoints.map((w) => w.name).join(' -> ')}`,
        ]
      : []),
    `Destination: ${s.destination.name} (${s.destination.lat.toFixed(4)} deg, ${s.destination.lon.toFixed(4)} deg)`,
    `Route Preference & Profile: ${s.routePreference.toUpperCase()} -> ${s.activeRouteLabel}`,
    `Route Coordinates: ${formatCoordSummary(s)}`,
    `Route Distance: ${s.distanceKm.toFixed(2)} km (+${s.elevationGainM} m / -${s.elevationLossM} m) | Calculator Mode: ${s.distanceSyncMode === 'SYNCED_WITH_ROUTE' ? 'Synced with Route' : `Manual (${s.calculatorDistanceKm.toFixed(2)} km)`}`,
    `Terrain Difficulty: ${s.terrainDifficulty.routeMeanDifficulty}/100 (${s.terrainDifficulty.classificationLabel}) | Peak Slope ${s.terrainDifficulty.maxSlopeDeg.toFixed(1)} deg`,
    `Safety & Hazard Risk: Safety Score ${s.safetyScore}/100 | Hazard Risk ${s.hazardRisk.overallRiskScore}/100 (${s.hazardRisk.overallRiskLevel}) | Crit/High Sections ${s.hazardRisk.criticalSectionCount}/${s.hazardRisk.highSectionCount}`,
  ]);
  addGap();

  addHeading('2. Crew & Mission Duration Breakdown');
  addLines([
    `Crew Size: ${s.crewSize} astronaut(s) | Walking Speed: ${s.walkingSpeedKmh.toFixed(1)} km/h | Duration Mode: ${s.timing.durationMode}`,
    `Base Walking Time: ${s.timing.baseWalkingTimeHr.toFixed(2)} hr (${s.calculatorDistanceKm.toFixed(2)} km / ${s.walkingSpeedKmh.toFixed(1)} km/h)`,
    `Terrain & Slope Delay: +${s.timing.terrainDelayHr.toFixed(2)} hr (Slope x${s.terrainDifficulty.slopeMetabolicFactor}, Terrain x${s.terrainDifficulty.terrainDifficultyFactor}) -> Terrain-Adjusted Walk: ${s.timing.terrainAdjustedWalkingTimeHr.toFixed(2)} hr`,
    `Rest Time: ${s.timing.restTimeHr.toFixed(2)} hr | Scientific Activity Time: ${s.timing.scientificActivityTimeHr.toFixed(2)} hr | Schedule Buffer: ${s.timing.scheduleBufferHr.toFixed(2)} hr`,
    `Nominal Duration: ${s.timing.nominalDurationHr.toFixed(2)} hr | Emergency Contingency (+${s.timing.emergencyContingencyPct}%): +${s.timing.emergencyContingencyTimeHr.toFixed(2)} hr`,
    `Total Mission Duration: ${s.timing.totalMissionDurationHr.toFixed(2)} hr (${s.timing.totalMissionDurationSols.toFixed(2)} Martian sols @ ${s.timing.martianSolHours} hr/sol)`,
    `Timeline Explanation: ${s.timing.explanation}`,
  ]);
  addGap();

  addHeading('3. Transparent Resource Calculations (O2, Energy, Water)');
  addLines([
    `OXYGEN: Base = ${s.crewSize} crew x ${s.timing.totalMissionDurationHr.toFixed(2)} hr x ${s.oxygen.rateKgPerPersonHr.toFixed(3)} kg/p/hr = ${s.oxygen.baseKg.toFixed(2)} kg | +${s.emergencyReserves.safetyReservePct}% Reserve = ${s.oxygen.reserveKg.toFixed(2)} kg | Total = ${s.oxygen.totalRequiredKg.toFixed(2)} kg | Loaded = ${s.loadedSupplies.oxygenKg.toFixed(2)} kg [${s.oxygen.status}, ${s.oxygen.marginKg >= 0 ? '+' : ''}${s.oxygen.marginKg.toFixed(2)} kg]`,
    `ENERGY: Load = (${s.crewSize} x ${s.energy.suitPowerKwPerAstronaut.toFixed(2)} kW suit + ${s.energy.sharedEquipmentKw.toFixed(2)} kW gear) = ${s.energy.totalLoadKw.toFixed(2)} kW | Base = ${s.energy.totalLoadKw.toFixed(2)} x ${s.timing.totalMissionDurationHr.toFixed(2)} hr = ${s.energy.baseKwh.toFixed(2)} kWh | +${s.emergencyReserves.safetyReservePct}% Reserve = ${s.energy.reserveKwh.toFixed(2)} kWh | Total = ${s.energy.totalRequiredKwh.toFixed(2)} kWh | Loaded = ${s.loadedSupplies.energyKwh.toFixed(2)} kWh [${s.energy.status}, ${s.energy.marginKwh >= 0 ? '+' : ''}${s.energy.marginKwh.toFixed(2)} kWh]`,
    `WATER: Base = ${s.crewSize} crew x (${s.timing.totalMissionDurationHr.toFixed(2)} / ${s.timing.martianSolHours}) sols x ${s.water.dailyRateLPerPersonSol.toFixed(1)} L/sol = ${s.water.baseL.toFixed(2)} L | +${s.emergencyReserves.safetyReservePct}% Reserve = ${s.water.reserveL.toFixed(2)} L | Total = ${s.water.totalRequiredL.toFixed(2)} L | Loaded = ${s.loadedSupplies.waterL.toFixed(2)} L [${s.water.status}, ${s.water.marginL >= 0 ? '+' : ''}${s.water.marginL.toFixed(2)} L]`,
  ]);
  addGap();

  addHeading('4. Emergency Duration Scenarios (vs Nominal Baseline)');
  addLines(
    s.emergencyReserves.scenarios.map(
      (sc) =>
        `+${sc.extraPct}% (${sc.durationHr.toFixed(2)} hr / ${sc.durationSols.toFixed(2)} sol): O2 ${sc.totalOxygenKg.toFixed(2)} kg (+${sc.oxygenDeltaKg.toFixed(2)}) | Energy ${sc.totalEnergyKwh.toFixed(2)} kWh (+${sc.energyDeltaKwh.toFixed(2)}) | Water ${sc.totalWaterL.toFixed(2)} L (+${sc.waterDeltaL.toFixed(2)}) | Covered: ${sc.allSufficient ? 'YES' : 'SHORTFALL'}`,
    ),
  );
  addGap();

  addHeading('5. Mission Readiness (Planning Indicator Only)');
  addLines([
    `Overall Resource Status: ${s.missionReadiness.overallResourceStatus}`,
    `Mission Readiness Score: ${s.missionReadiness.score}/100 (${s.missionReadiness.classification})`,
    `Separated Components: Resource Sufficiency ${s.missionReadiness.breakdown.resourceSufficiencyScore}/40 | Route Safety ${s.missionReadiness.breakdown.routeSafetyScore}/20 | Terrain Difficulty ${s.missionReadiness.breakdown.terrainDifficultyScore}/15 | Emergency Reserves ${s.missionReadiness.breakdown.emergencyReserveScore}/15 | Mission Duration ${s.missionReadiness.breakdown.missionDurationScore}/10`,
    ...(s.missionReadiness.breakdown.capAppliedReason
      ? [`Readiness Guardrail: ${s.missionReadiness.breakdown.capAppliedReason}`]
      : []),
    s.missionReadiness.disclaimer,
  ]);
  addGap();

  addHeading('6. NASA Dataset Provenance & Prototype Limitations');
  addLines([
    'Research Prototype Notice: MARSWALK AI is a research and mission-planning prototype — NOT an operational system or NASA spacesuit/EVA safety certification.',
    'NASA data successfully retrieved (live when upstream responds): PDS ODE HiRISE/CTX footprints, JPL Mars 2020/MSL feeds, MEDA/REMS archives, NASA Image Library.',
    'NASA archival reference: MGS MOLA relief (WMTS), Viking MDIM 2.1 (WMTS), Odyssey THEMIS IR (WMS), IAU crater database.',
    'Derived analysis & Simulated demonstration data: Parametric O2/energy/water/readiness estimates evaluated on a 25x25 km synthetic terrain demonstration grid (500 m cells).',
  ]);

  const slug =
    s.missionName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'marswalk';
  doc.save(`${slug}-resource-report-${snapshot.snapshotId.slice(-9)}.pdf`);

  return {
    ok: true,
    snapshotId: snapshot.snapshotId,
    generatedAtIso: snapshot.generatedAtIso,
    validation,
    errors: [],
  };
}
