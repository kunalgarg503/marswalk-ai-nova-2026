import type {
  CraterFeature,
  GeologicalFeatureCategory,
  LocalWaypoint,
  MarsLocation,
  MissionObjective,
  RouteOption,
  RoutePreference,
  RoverSiteMarker,
  ScienceExplorationObjective,
  ScienceSite,
  SurvivalInputs,
  SurvivalResults,
} from '../types/mars';
import { planMartianRoute } from './routePlanner';
import { calculateSurvivalEstimate } from './survivalCalculator';

export interface ScienceObjectiveMeta {
  id: ScienceExplorationObjective;
  label: string;
  shortLabel: string;
  description: string;
}

export const SCIENCE_OBJECTIVES: ScienceObjectiveMeta[] = [
  {
    id: 'explore-ancient-deltas',
    label: 'Explore ancient delta deposits',
    shortLabel: 'Ancient Deltas',
    description:
      'Prioritizes curvilinear river delta fans, paleolake mudstones, and ancient inflow channels.',
  },
  {
    id: 'investigate-sedimentary',
    label: 'Investigate sedimentary formations',
    shortLabel: 'Sedimentary Strata',
    description:
      'Prioritizes layered sedimentary rock, clay-bearing sequences, and mineral-rich evaporative beds.',
  },
  {
    id: 'visit-rover-sites',
    label: 'Visit nearby rover observation sites',
    shortLabel: 'Rover Sites',
    description:
      'Prioritizes targets with direct Perseverance or Curiosity in-situ rover spectroscopy and imaging.',
  },
  {
    id: 'examine-geological-diversity',
    label: 'Examine geological diversity',
    shortLabel: 'Geological Diversity',
    description:
      'Balances ancient water formations, impact crater cross-sections, layered bedrock, and mineral diversity.',
  },
];

export const GEOLOGICAL_CATEGORIES: GeologicalFeatureCategory[] = [
  'Ancient River Deltas',
  'Sedimentary Deposits',
  'Crater Formations',
  'Layered Rock Formations',
  'Ancient Water Channels',
  'Clay-Bearing Regions',
  'Mineral-Rich Regions',
];

export type MarkerShape = 'diamond' | 'square' | 'ring' | 'triangle' | 'channel' | 'hexagon' | 'star';

export const GEOLOGICAL_CATEGORY_META: Record<
  GeologicalFeatureCategory,
  {
    shape: MarkerShape;
    colorHex: string;
    textClass: string;
    bgClass: string;
    borderClass: string;
    shortTag: string;
  }
> = {
  'Ancient River Deltas': {
    shape: 'diamond',
    colorHex: '#22d3ee',
    textClass: 'text-cyan-300',
    bgClass: 'bg-cyan-500/15',
    borderClass: 'border-cyan-400/50',
    shortTag: 'Delta',
  },
  'Sedimentary Deposits': {
    shape: 'square',
    colorHex: '#f59e0b',
    textClass: 'text-amber-300',
    bgClass: 'bg-amber-500/15',
    borderClass: 'border-amber-400/50',
    shortTag: 'Sediment',
  },
  'Crater Formations': {
    shape: 'ring',
    colorHex: '#f97316',
    textClass: 'text-orange-300',
    bgClass: 'bg-orange-500/15',
    borderClass: 'border-orange-400/50',
    shortTag: 'Crater',
  },
  'Layered Rock Formations': {
    shape: 'triangle',
    colorHex: '#a78bfa',
    textClass: 'text-violet-300',
    bgClass: 'bg-violet-500/15',
    borderClass: 'border-violet-400/50',
    shortTag: 'Layered',
  },
  'Ancient Water Channels': {
    shape: 'channel',
    colorHex: '#38bdf8',
    textClass: 'text-sky-300',
    bgClass: 'bg-sky-500/15',
    borderClass: 'border-sky-400/50',
    shortTag: 'Channel',
  },
  'Clay-Bearing Regions': {
    shape: 'hexagon',
    colorHex: '#34d399',
    textClass: 'text-emerald-300',
    bgClass: 'bg-emerald-500/15',
    borderClass: 'border-emerald-400/50',
    shortTag: 'Clay',
  },
  'Mineral-Rich Regions': {
    shape: 'star',
    colorHex: '#fb7185',
    textClass: 'text-rose-300',
    bgClass: 'bg-rose-500/15',
    borderClass: 'border-rose-400/50',
    shortTag: 'Mineral',
  },
};

export interface SciencePriorityScore {
  totalScore: number; // 0 to 100
  tier: 'HIGH PRIORITY' | 'MODERATE PRIORITY' | 'SECONDARY TARGET';
  breakdown: {
    scientificRelevance: number; // 0-25
    geologicalDiversity: number; // 0-20
    supportingEvidence: number; // 0-20
    objectiveRelevance: number; // 0-20
    routeAccessibility: number; // 0-15
  };
  routeDistanceKm: number | null;
  accessibilityStatus:
    | 'ON ROUTE'
    | 'NEAR CORRIDOR'
    | 'DETOUR REQUIRED'
    | 'OUT OF ACTIVE REGION'
    | 'NO ACTIVE ROUTE';
  formulaSummary: string;
  disclaimer: string;
}

export interface ScienceRouteContext {
  route?: RouteOption;
  location?: MarsLocation;
}

export function approxMarsDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const MARS_RADIUS_KM = 3389.5;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((MARS_RADIUS_KM * c).toFixed(2));
}

function computeObjectiveRelevance(
  site: ScienceSite,
  objective: ScienceExplorationObjective,
): number {
  switch (objective) {
    case 'explore-ancient-deltas':
      if (site.geologicalCategory === 'Ancient River Deltas') return 20;
      if (site.geologicalCategory === 'Ancient Water Channels') return 18;
      if (site.geologicalCategory === 'Sedimentary Deposits') return 15;
      if (site.waterEnvironmentEvidence === 'STRONG') return 13;
      return 8;
    case 'investigate-sedimentary':
      if (site.geologicalCategory === 'Sedimentary Deposits') return 20;
      if (
        site.geologicalCategory === 'Layered Rock Formations' ||
        site.geologicalCategory === 'Clay-Bearing Regions'
      ) {
        return 18;
      }
      if (
        site.geologicalCategory === 'Ancient River Deltas' ||
        site.geologicalCategory === 'Mineral-Rich Regions'
      ) {
        return 15;
      }
      return 9;
    case 'visit-rover-sites':
      if (site.roverSupport && site.confidenceLevel === 'HIGH') return 20;
      if (site.roverSupport) return 17;
      if (site.observationCoverageScore >= 12) return 10;
      return 5;
    case 'examine-geological-diversity':
      if (
        site.geologicalCategory === 'Crater Formations' ||
        site.geologicalCategory === 'Layered Rock Formations'
      ) {
        return 19;
      }
      if (
        site.geologicalCategory === 'Mineral-Rich Regions' ||
        site.geologicalCategory === 'Clay-Bearing Regions'
      ) {
        return 17;
      }
      return 15;
  }
}

export function computeRouteToSiteProximity(
  site: ScienceSite,
  route: RouteOption,
): { minDistanceKm: number; nearestNodeIndex: number; corridorKmMark: number } {
  if (!route || route.waypoints.length === 0) {
    return { minDistanceKm: 999, nearestNodeIndex: 0, corridorKmMark: 0 };
  }
  let bestDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < route.waypoints.length; i++) {
    const wp = route.waypoints[i];
    const d = approxMarsDistanceKm(site.lat, site.lon, wp.lat, wp.lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return {
    minDistanceKm: Number(bestDist.toFixed(2)),
    nearestNodeIndex: bestIdx,
    corridorKmMark: route.waypoints[bestIdx]?.cumulativeDistKm ?? 0,
  };
}

/**
 * Transparent 5-Factor Science Priority Score (0–100):
 *  - Scientific Relevance (0–25)
 *  - Geological Diversity (0–20)
 *  - Supporting Evidence (0–20)
 *  - Mission Objective Relevance (0–20)
 *  - Accessibility from Selected Route (0–15)
 *
 * Planning Estimate Only — Not an Official NASA Scientific Ranking.
 */
export function computeSciencePriority(
  site: ScienceSite,
  objective: ScienceExplorationObjective = 'explore-ancient-deltas',
  routeContext?: ScienceRouteContext,
): SciencePriorityScore {
  const scientificRelevance = Math.max(
    0,
    Math.min(25, Math.round((site.geologicalSignificanceScore / 30) * 25)),
  );

  const defaultDiversity =
    (site.geologicalFeatures?.length ? Math.min(8, site.geologicalFeatures.length * 2 + 2) : 4) +
    (site.waterEnvironmentEvidence === 'STRONG' ? 8 : site.waterEnvironmentEvidence === 'MODERATE' ? 5 : 2) +
    (site.roverSupport ? 4 : 2);
  const geologicalDiversity = Math.max(
    0,
    Math.min(20, site.geologicalDiversityRating ?? defaultDiversity),
  );

  const coveragePts = Math.round((Math.max(0, Math.min(15, site.observationCoverageScore)) / 15) * 11);
  const confPts = site.confidenceLevel === 'HIGH' ? 6 : site.confidenceLevel === 'MODERATE' ? 4 : 2;
  const roverBonus = site.roverSupport ? 3 : site.waterEnvironmentEvidence === 'STRONG' ? 2 : 1;
  const supportingEvidence = Math.max(0, Math.min(20, coveragePts + confPts + roverBonus));

  const objectiveRelevance = computeObjectiveRelevance(site, objective);

  let routeAccessibility = 7;
  let routeDistanceKm: number | null = null;
  let accessibilityStatus: SciencePriorityScore['accessibilityStatus'] = 'NO ACTIVE ROUTE';

  if (routeContext?.route) {
    if (routeContext.location && site.locationId !== routeContext.location.id) {
      routeAccessibility = 0;
      routeDistanceKm = approxMarsDistanceKm(
        site.lat,
        site.lon,
        routeContext.location.lat,
        routeContext.location.lon,
      );
      accessibilityStatus = 'OUT OF ACTIVE REGION';
    } else {
      const prox = computeRouteToSiteProximity(site, routeContext.route);
      routeDistanceKm = prox.minDistanceKm;
      if (prox.minDistanceKm <= 0.65) {
        routeAccessibility = 15;
        accessibilityStatus = 'ON ROUTE';
      } else if (prox.minDistanceKm <= 2.0) {
        routeAccessibility = 12;
        accessibilityStatus = 'NEAR CORRIDOR';
      } else if (prox.minDistanceKm <= 4.5) {
        routeAccessibility = 9;
        accessibilityStatus = 'DETOUR REQUIRED';
      } else if (prox.minDistanceKm <= 8.0) {
        routeAccessibility = 6;
        accessibilityStatus = 'DETOUR REQUIRED';
      } else {
        routeAccessibility = 3;
        accessibilityStatus = 'DETOUR REQUIRED';
      }
      // Adjust slightly for active route's own safety score if critical
      if (routeContext.route.overallRiskLevel === 'CRITICAL') {
        routeAccessibility = Math.max(1, routeAccessibility - 2);
      }
    }
  }

  const totalScore = Math.max(
    0,
    Math.min(
      100,
      scientificRelevance +
        geologicalDiversity +
        supportingEvidence +
        objectiveRelevance +
        routeAccessibility,
    ),
  );

  const tier: SciencePriorityScore['tier'] =
    totalScore >= 82 ? 'HIGH PRIORITY' : totalScore >= 64 ? 'MODERATE PRIORITY' : 'SECONDARY TARGET';

  return {
    totalScore,
    tier,
    breakdown: {
      scientificRelevance,
      geologicalDiversity,
      supportingEvidence,
      objectiveRelevance,
      routeAccessibility,
    },
    routeDistanceKm,
    accessibilityStatus,
    formulaSummary:
      'Total (0–100) = Scientific Relevance (/25) + Geological Diversity (/20) + Supporting Evidence (/20) + Objective Relevance (/20) + Route Accessibility (/15)',
    disclaimer:
      'Planning Estimate Only — Not an Official NASA Scientific Ranking.',
  };
}

export interface ScienceRouteRecommendation {
  site: ScienceSite;
  waypoint: LocalWaypoint;
  priority: SciencePriorityScore;
  safestRoute: RouteOption;
  passable: boolean;
  impassableReason?: string;
  combinedRankScore: number;
  reason: string;
}

export interface ScienceRouteRecommendationResult {
  objective: ScienceObjectiveMeta;
  originName: string;
  recommendations: ScienceRouteRecommendation[];
  impassableTargets: ScienceRouteRecommendation[];
}

export function resolveSiteWaypoint(site: ScienceSite, location: MarsLocation): LocalWaypoint {
  if (site.linkedWaypointId) {
    const match = location.localWaypoints.find((w) => w.id === site.linkedWaypointId);
    if (match) return match;
  }
  return {
    id: `sci-wp-${site.id}`,
    name: site.title,
    lat: site.lat,
    lon: site.lon,
    elevationM: site.elevationM,
    localXKm: site.localXKm ?? 12.5,
    localYKm: site.localYKm ?? 12.5,
    featureType: site.geologicalCategory,
    scienceValue: site.scientificSignificance,
    missionSource: site.nasaMission,
  };
}

export function recommendScienceRoutes(params: {
  location: MarsLocation;
  originWaypoint: LocalWaypoint;
  sites: ScienceSite[];
  objective: ScienceExplorationObjective;
  maxAcceptableDifficulty: number;
  walkingSpeedKmh?: number;
  activeRoute?: RouteOption;
}): ScienceRouteRecommendationResult {
  const {
    location,
    originWaypoint,
    sites,
    objective,
    maxAcceptableDifficulty,
    walkingSpeedKmh = 3.2,
    activeRoute,
  } = params;

  const objectiveMeta =
    SCIENCE_OBJECTIVES.find((o) => o.id === objective) || SCIENCE_OBJECTIVES[0];
  const regionalSites = sites.filter((s) => s.locationId === location.id);

  const evaluated: ScienceRouteRecommendation[] = regionalSites.map((site) => {
    const destWaypoint = resolveSiteWaypoint(site, location);
    const priority = computeSciencePriority(site, objective, {
      route: activeRoute,
      location,
    });

    const plan = planMartianRoute({
      location,
      originWaypoint,
      destWaypoint,
      objective: 'geological-sampling',
      routePreference: 'safest',
      maxAcceptableDifficulty,
      walkingSpeedKmh,
    });

    const safestRoute =
      plan.routes.find((r) => r.profile === 'safest') ||
      plan.routes.find((r) => r.id === plan.recommendedRouteId) ||
      plan.routes[0];

    const isImpassable =
      safestRoute.overallRiskLevel === 'CRITICAL' ||
      safestRoute.maxSlopeDeg >= 25 ||
      (!safestRoute.passesMaxDifficulty && safestRoute.overallRiskScore >= 75);

    const impassableReason = isImpassable
      ? safestRoute.maxSlopeDeg >= 25
        ? `Peak corridor slope ${safestRoute.maxSlopeDeg.toFixed(1)}° exceeds safe 25° EVA traversability threshold.`
        : `Corridor crosses ${safestRoute.hazardExposure.criticalSectionCount} critical hazard sector(s) with risk score ${safestRoute.overallRiskScore}/100.`
      : undefined;

    const combinedRankScore = Math.round(
      priority.totalScore * 0.62 + safestRoute.safetyScore * 0.38,
    );

    const reason = isImpassable
      ? `Excluded from safe recommendations: ${impassableReason}`
      : `Safest A* corridor reaches ${site.geologicalCategory.toLowerCase()} in ${safestRoute.distanceKm.toFixed(2)} km (${safestRoute.estimatedDurationHr.toFixed(1)} hr) with ${safestRoute.overallRiskLevel} terrain risk (${safestRoute.safetyScore}/100 safety) and ${priority.totalScore}/100 science priority estimate.`;

    return {
      site,
      waypoint: destWaypoint,
      priority,
      safestRoute,
      passable: !isImpassable,
      impassableReason,
      combinedRankScore,
      reason,
    };
  });

  const recommendations = evaluated
    .filter((r) => r.passable)
    .sort((a, b) => b.combinedRankScore - a.combinedRankScore);

  const impassableTargets = evaluated
    .filter((r) => !r.passable)
    .sort((a, b) => b.priority.totalScore - a.priority.totalScore);

  return {
    objective: objectiveMeta,
    originName: originWaypoint.name,
    recommendations,
    impassableTargets,
  };
}

export interface DirectVsScienceComparison {
  targetSite: ScienceSite;
  targetWaypoint: LocalWaypoint;
  alreadyIncludedInRoute: boolean;
  isOriginOrDestEndpoint: boolean;
  directRoute: RouteOption;
  scienceRoute: RouteOption;
  directSurvival: SurvivalResults;
  scienceSurvival: SurvivalResults;
  deltaDistanceKm: number;
  deltaDurationHr: number;
  deltaSafetyScore: number;
  deltaOxygenKg: number;
  deltaEnergyKwh: number;
  deltaWaterL: number;
  deltaReadinessScore: number;
}

export function compareDirectVsScienceRoute(params: {
  location: MarsLocation;
  originWaypoint: LocalWaypoint;
  destWaypoint: LocalWaypoint;
  currentScienceStops: LocalWaypoint[];
  targetSite: ScienceSite;
  missionObjective: MissionObjective;
  routePreference: RoutePreference;
  maxAcceptableDifficulty: number;
  survivalInputs: SurvivalInputs;
}): DirectVsScienceComparison | null {
  const {
    location,
    originWaypoint,
    destWaypoint,
    currentScienceStops,
    targetSite,
    missionObjective,
    routePreference,
    maxAcceptableDifficulty,
    survivalInputs,
  } = params;

  if (targetSite.locationId !== location.id) return null;

  const targetWaypoint = resolveSiteWaypoint(targetSite, location);
  const isOriginOrDestEndpoint =
    targetWaypoint.id === originWaypoint.id || targetWaypoint.id === destWaypoint.id;
  const alreadyIncludedInRoute = currentScienceStops.some((w) => w.id === targetWaypoint.id);

  // Direct route = origin -> dest with ZERO intermediate science waypoints
  const directPlan = planMartianRoute({
    location,
    originWaypoint,
    destWaypoint,
    viaWaypoints: [],
    objective: missionObjective,
    routePreference,
    maxAcceptableDifficulty,
    walkingSpeedKmh: survivalInputs.walkingSpeedKmh,
  });
  const directRoute =
    directPlan.routes.find((r) => r.profile === routePreference) || directPlan.routes[0];

  // Science-focused route = origin -> [...existing stops, targetWaypoint] -> dest
  const combinedVias = alreadyIncludedInRoute
    ? currentScienceStops
    : [...currentScienceStops, targetWaypoint];
  const sciencePlan = planMartianRoute({
    location,
    originWaypoint,
    destWaypoint,
    viaWaypoints: combinedVias,
    objective: missionObjective,
    routePreference,
    maxAcceptableDifficulty,
    walkingSpeedKmh: survivalInputs.walkingSpeedKmh,
  });
  const scienceRoute =
    sciencePlan.routes.find((r) => r.profile === routePreference) || sciencePlan.routes[0];

  const directSurvival = calculateSurvivalEstimate(
    survivalInputs,
    directRoute.distanceKm,
    directRoute.elevationGainM,
    directRoute.meanDifficulty,
    directRoute.overallRiskScore,
    maxAcceptableDifficulty,
  );
  const scienceSurvival = calculateSurvivalEstimate(
    survivalInputs,
    scienceRoute.distanceKm,
    scienceRoute.elevationGainM,
    scienceRoute.meanDifficulty,
    scienceRoute.overallRiskScore,
    maxAcceptableDifficulty,
  );

  return {
    targetSite,
    targetWaypoint,
    alreadyIncludedInRoute,
    isOriginOrDestEndpoint,
    directRoute,
    scienceRoute,
    directSurvival,
    scienceSurvival,
    deltaDistanceKm: Number((scienceRoute.distanceKm - directRoute.distanceKm).toFixed(2)),
    deltaDurationHr: Number(
      (scienceSurvival.effectiveMissionDurationHr - directSurvival.effectiveMissionDurationHr).toFixed(2),
    ),
    deltaSafetyScore: scienceRoute.safetyScore - directRoute.safetyScore,
    deltaOxygenKg: Number(
      (scienceSurvival.totalOxygenRequiredKg - directSurvival.totalOxygenRequiredKg).toFixed(2),
    ),
    deltaEnergyKwh: Number(
      (scienceSurvival.totalEnergyRequiredKwh - directSurvival.totalEnergyRequiredKwh).toFixed(2),
    ),
    deltaWaterL: Number(
      (scienceSurvival.totalWaterRequiredL - directSurvival.totalWaterRequiredL).toFixed(2),
    ),
    deltaReadinessScore:
      scienceSurvival.missionReadinessScore - directSurvival.missionReadinessScore,
  };
}

export interface NearbyOpportunity {
  id: string;
  kind: 'Science Target' | 'Rover Site' | 'Region Waypoint' | 'Named Crater';
  name: string;
  subtitle: string;
  distanceKm: number;
  lat: number;
  lon: number;
}

export function findNearbyOpportunities(
  target: ScienceSite,
  locations: MarsLocation[],
  allSites: ScienceSite[],
  rovers: RoverSiteMarker[],
  craters: CraterFeature[],
): NearbyOpportunity[] {
  const opps: NearbyOpportunity[] = [];

  for (const other of allSites) {
    if (other.id === target.id) continue;
    const dist = approxMarsDistanceKm(target.lat, target.lon, other.lat, other.lon);
    if (dist <= 120) {
      opps.push({
        id: other.id,
        kind: 'Science Target',
        name: other.title,
        subtitle: `${other.geologicalCategory} · ${other.confidenceLevel} confidence`,
        distanceKm: dist,
        lat: other.lat,
        lon: other.lon,
      });
    }
  }

  for (const rv of rovers) {
    const dist = approxMarsDistanceKm(target.lat, target.lon, rv.lat, rv.lon);
    if (dist <= 150) {
      opps.push({
        id: rv.id,
        kind: 'Rover Site',
        name: rv.name,
        subtitle: `${rv.mission} · ${rv.status}`,
        distanceKm: dist,
        lat: rv.lat,
        lon: rv.lon,
      });
    }
  }

  const loc = locations.find((l) => l.id === target.locationId);
  if (loc) {
    for (const wp of loc.localWaypoints) {
      if (wp.id === target.linkedWaypointId) continue;
      const dist = approxMarsDistanceKm(target.lat, target.lon, wp.lat, wp.lon);
      opps.push({
        id: wp.id,
        kind: 'Region Waypoint',
        name: wp.name,
        subtitle: `${wp.featureType} · ${wp.elevationM} m`,
        distanceKm: dist,
        lat: wp.lat,
        lon: wp.lon,
      });
    }
  }

  for (const cr of craters) {
    const dist = approxMarsDistanceKm(target.lat, target.lon, cr.lat, cr.lon);
    if (dist <= 150) {
      opps.push({
        id: cr.id,
        kind: 'Named Crater',
        name: cr.name,
        subtitle: `Ø ${cr.diameterKm} km · ${cr.quadrangle}`,
        distanceKm: dist,
        lat: cr.lat,
        lon: cr.lon,
      });
    }
  }

  return opps.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 6);
}
