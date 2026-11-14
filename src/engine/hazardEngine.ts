import type {
  HazardCategory,
  HazardZone,
  RiskLevel,
  RouteOption,
  RouteRiskAnalysisReport,
  RouteWaypointNode,
  TerrainAnalysisResult,
  TerrainGridCell,
} from '../types/mars';

function classifyCellCategory(cell: TerrainGridCell): HazardCategory {
  if (cell.craterProximityKm < 0.55) return 'Crater Edges & Depressions';
  if (cell.slopeDeg >= 16) return 'Steep Slopes';
  if (cell.thermalInertia < 160) return 'Uncertain Terrain';
  if (cell.rockAbundancePct >= 25 || cell.roughnessIdx >= 48) return 'Rocky or Rough Terrain';
  return 'Potentially Difficult Navigation Zones';
}

function getClassificationRule(cell: TerrainGridCell, risk: RiskLevel): string {
  if (risk === 'CRITICAL') {
    if (cell.slopeDeg >= 23) return `Rule: Slope ${cell.slopeDeg.toFixed(1)}° ≥ 23° threshold → CRITICAL RISK`;
    if (cell.craterProximityKm < 0.35 && cell.slopeDeg >= 17) {
      return `Rule: Crater edge < 350 m (${(cell.craterProximityKm * 1000).toFixed(0)} m) with ${cell.slopeDeg.toFixed(1)}° slope → CRITICAL RISK`;
    }
    return `Rule: Composite difficulty ${cell.difficultyScore}/100 ≥ 74 threshold → CRITICAL RISK`;
  }
  if (risk === 'HIGH') {
    if (cell.slopeDeg >= 16) return `Rule: Slope ${cell.slopeDeg.toFixed(1)}° in [16°, 23°) → HIGH RISK`;
    if (cell.craterProximityKm < 0.45) return `Rule: Crater rim < 450 m with ${cell.slopeDeg.toFixed(1)}° slope → HIGH RISK`;
    return `Rule: Composite difficulty ${cell.difficultyScore}/100 in [54, 74) → HIGH RISK`;
  }
  if (risk === 'MODERATE') {
    if (cell.thermalInertia < 160) return `Rule: Low thermal inertia (${cell.thermalInertia} TIU < 160) → MODERATE RISK (Uncertain dust)`;
    if (cell.rockAbundancePct >= 25) return `Rule: Rock cover ${cell.rockAbundancePct.toFixed(0)}% ≥ 25% → MODERATE RISK`;
    return `Rule: Slope ${cell.slopeDeg.toFixed(1)}° in [10°, 16°) or Difficulty ${cell.difficultyScore}/100 → MODERATE RISK`;
  }
  return 'Rule: Slope < 10°, Difficulty < 34, Firm regolith → LOW RISK';
}

function buildMitigation(category: HazardCategory, risk: RiskLevel): string {
  switch (category) {
    case 'Steep Slopes':
      return risk === 'CRITICAL'
        ? 'Avoid sector completely; reroute around contour bench because gradient ≥ 23° exceeds EVA boot/rover traction envelope.'
        : 'Traverse diagonally along contours at reduced speed with surface traction checks.';
    case 'Crater Edges & Depressions':
      return 'Maintain >= 500 m standoff from crater rim inflection; unconsolidated ejecta and depression walls pose collapse/rollover risk.';
    case 'Rocky or Rough Terrain':
      return 'Inspect local path corridor with high-resolution HiRISE imagery prior to traverse; increase obstacle clearance margin.';
    case 'Uncertain Terrain':
      return 'Low thermal inertia indicates fine dust or unverified sub-grid regolith; avoid abrupt braking or sharp steering.';
    default:
      return 'Compound slope and roughness elevate metabolic/power cost; verify alternate corridor before commitment.';
  }
}

export function detectHazards(
  terrain: TerrainAnalysisResult,
  routeWaypoints?: RouteWaypointNode[],
): HazardZone[] {
  const candidates: Array<{
    cell: TerrainGridCell;
    priorityScore: number;
    minRouteDistKm: number;
    routeRelation: 'INTERSECTING' | 'NEAR_ROUTE' | 'AVOIDED';
  }> = [];

  for (let gy = 1; gy < terrain.gridSize - 1; gy++) {
    for (let gx = 1; gx < terrain.gridSize - 1; gx++) {
      const cell = terrain.cells[gy][gx];
      if (cell.hazardLevel === 'LOW') continue;

      let minRouteDistKm = 99;
      if (routeWaypoints && routeWaypoints.length > 0) {
        for (const wp of routeWaypoints) {
          const d = Math.hypot(wp.xKm - cell.xKm, wp.yKm - cell.yKm);
          if (d < minRouteDistKm) minRouteDistKm = d;
        }
      }
      const intersectThresh = terrain.cellSizeKm * 0.75;
      const nearThresh = terrain.cellSizeKm * 2.2;
      const routeRelation: 'INTERSECTING' | 'NEAR_ROUTE' | 'AVOIDED' =
        minRouteDistKm <= intersectThresh
          ? 'INTERSECTING'
          : minRouteDistKm <= nearThresh
            ? 'NEAR_ROUTE'
            : 'AVOIDED';
      const riskWeight =
        cell.hazardLevel === 'CRITICAL' ? 150 : cell.hazardLevel === 'HIGH' ? 95 : 40;
      const proximityBoost =
        routeRelation === 'INTERSECTING'
          ? 85
          : routeRelation === 'NEAR_ROUTE'
            ? 55
            : Math.max(0, 25 - minRouteDistKm * 2.5);

      candidates.push({
        cell,
        priorityScore: riskWeight + cell.difficultyScore + proximityBoost,
        minRouteDistKm: Number(minRouteDistKm.toFixed(2)),
        routeRelation,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (a.cell.gy !== b.cell.gy) return a.cell.gy - b.cell.gy;
    return a.cell.gx - b.cell.gx;
  });

  const selected: HazardZone[] = [];
  for (const item of candidates) {
    if (selected.length >= 16) break;
    const tooClose = selected.some(
      (z) => Math.hypot(z.xKm - item.cell.xKm, z.yKm - item.cell.yKm) < 2.2,
    );
    if (tooClose) continue;

    const category = classifyCellCategory(item.cell);
    const reasonText =
      item.cell.hazardReasons.length > 0
        ? item.cell.hazardReasons.join('; ')
        : `Elevated terrain difficulty (${item.cell.difficultyScore}/100) with ${item.cell.slopeDeg.toFixed(1)}° slope.`;

    const relationNote =
      routeWaypoints && routeWaypoints.length > 0
        ? item.routeRelation === 'INTERSECTING'
          ? ` — intersects active route (${item.minRouteDistKm.toFixed(2)} km).`
          : item.routeRelation === 'NEAR_ROUTE'
            ? ` — near active route (${item.minRouteDistKm.toFixed(2)} km lateral buffer).`
            : ` — avoided by active route (${item.minRouteDistKm.toFixed(2)} km away).`
        : '';

    selected.push({
      id: `haz-${item.cell.gx}-${item.cell.gy}`,
      title: `${category} (${item.cell.xKm.toFixed(1)}, ${item.cell.yKm.toFixed(1)} km)`,
      riskLevel: item.cell.hazardLevel,
      category,
      lat: item.cell.lat,
      lon: item.cell.lon,
      xKm: item.cell.xKm,
      yKm: item.cell.yKm,
      slopeDeg: item.cell.slopeDeg,
      roughnessIdx: item.cell.roughnessIdx,
      craterProximityKm: item.cell.craterProximityKm,
      difficultyScore: item.cell.difficultyScore,
      reason: `${reasonText}${relationNote}`,
      classificationRule: getClassificationRule(item.cell, item.cell.hazardLevel),
      mitigation: buildMitigation(category, item.cell.hazardLevel),
      minDistToRouteKm: item.minRouteDistKm,
      routeRelation: item.routeRelation,
      dataOrigin: 'Derived Terrain Analysis',
      sourceNote:
        'Estimated risk derived from synthetic local DEM anchored to published NASA MOLA elevation & Odyssey THEMIS thermal inertia (not an official NASA hazard alert).',
    });
  }

  return selected;
}

export function analyzeRouteRisk(
  activeRoute: RouteOption,
  allRoutes: RouteOption[],
  cellSizeKm: number,
): RouteRiskAnalysisReport {
  const cellStepMeters = Math.round(cellSizeKm * 1000);
  const saferAlt = allRoutes
    .filter((r) => r.id !== activeRoute.id && r.overallRiskScore < activeRoute.overallRiskScore)
    .sort((a, b) => a.overallRiskScore - b.overallRiskScore)[0];

  const saferAlternativeAvailable = Boolean(saferAlt);
  const saferAlternativeSummary = saferAlt
    ? `${saferAlt.label} reduces overall route risk score from ${activeRoute.overallRiskScore}/100 to ${saferAlt.overallRiskScore}/100 (eliminating ${Math.max(0, activeRoute.hazardExposure.criticalSectionCount - saferAlt.hazardExposure.criticalSectionCount)} critical and ${Math.max(0, activeRoute.hazardExposure.highSectionCount - saferAlt.hazardExposure.highSectionCount)} high-risk sections) for a ${(saferAlt.distanceKm - activeRoute.distanceKm).toFixed(2)} km distance delta.`
    : 'No lower-risk alternative exists among computed A* route profiles for this origin-destination pair.';

  return {
    routeLabel: activeRoute.label,
    totalDistanceKm: activeRoute.distanceKm,
    sampledNodesCount: activeRoute.waypoints.length,
    cellStepMeters,
    highRiskSections: activeRoute.hazardExposure.highSectionCount,
    criticalRiskSections: activeRoute.hazardExposure.criticalSectionCount,
    averageTerrainDifficulty: activeRoute.meanDifficulty,
    overallRiskScore: activeRoute.overallRiskScore,
    overallRiskLevel: activeRoute.overallRiskLevel,
    coverageStatement: `Full-route evaluation across all ${activeRoute.waypoints.length} sequential A* grid nodes (~${cellStepMeters} m step spacing) from origin to destination — not just endpoints.`,
    limitationsStatement: `Analysis relies on a ${cellStepMeters} m synthetic demonstration grid anchored to MOLA/THEMIS macro parameters; sub-grid boulders (< ${cellStepMeters} m), sand ripples, and overhang shadows require MRO HiRISE (0.25 m/px) stereo verification before actual EVA execution.`,
    saferAlternativeAvailable,
    saferAlternativeSummary,
  };
}
