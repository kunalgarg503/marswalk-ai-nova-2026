export type NavSection =
  | 'mission-control'
  | 'mars-explorer'
  | 'terrain-intelligence'
  | 'hazard-detection'
  | 'route-planner'
  | 'science-explorer'
  | 'survival-calculator'
  | 'nasa-data-centre'
  | 'mission-assistant';

export type DataProvenance =
  | 'ACTUAL NASA OBSERVATION'
  | 'PUBLISHED SCIENTIFIC DATASET'
  | 'DERIVED CALCULATION'
  | 'SIMULATED DEMONSTRATION';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type GlobeLayerId =
  | 'albedo'
  | 'mola-elevation'
  | 'themis-thermal'
  | 'terrain-roughness'
  | 'graticule'
  | 'hazards'
  | 'route';

export type MarsMapLayerId =
  | 'surface'
  | 'elevation'
  | 'terrain'
  | 'themis-night'
  | 'roughness'
  | 'route'
  | 'craters'
  | 'rovers'
  | 'science'
  | 'hazards';

export type RoutePreference = 'safest' | 'balanced' | 'shortest';

export interface CraterFeature {
  id: string;
  name: string;
  lat: number;
  lon: number;
  diameterKm: number;
  elevationM: number;
  quadrangle: string;
  summary: string;
  sourceDataset: string;
}

export interface RoverSiteMarker {
  id: string;
  name: string;
  mission: string;
  locationName: string;
  linkedLocationId?: string;
  lat: number;
  lon: number;
  elevationM: number;
  operationalPeriod: string;
  status: 'Active Mission' | 'Completed Historical Mission';
  instruments: string;
  summary: string;
  sourceUrl: string;
}

export type MissionObjective =
  | 'geological-sampling'
  | 'reconnaissance'
  | 'isru-survey'
  | 'contingency-evac';

export interface LocalWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
  localXKm: number;
  localYKm: number;
  featureType: string;
  scienceValue: string;
  missionSource: string;
}

export interface MarsLocation {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  elevationM: number;
  type: 'Crater Basin' | 'Volcanic Plains' | 'Canyon System' | 'Shield Volcano' | 'Polar / Ice Plain' | 'Outflow Channel';
  primaryMission: string;
  observationPeriod: string;
  summary: string;
  geologyNotes: string;
  thermalInertiaTIU: number;
  environmentalBaseline: {
    tempRangeC: string;
    pressureMbar: string;
    dustOpacityTau: string;
    solarIrradianceWm2: string;
    sourceLabel: string;
  };
  scienceHighlights: string[];
  localWaypoints: LocalWaypoint[];
}

export interface TerrainGridCell {
  gx: number;
  gy: number;
  xKm: number;
  yKm: number;
  lat: number;
  lon: number;
  elevationM: number;
  slopeDeg: number;
  roughnessIdx: number;
  thermalInertia: number;
  craterProximityKm: number;
  rockAbundancePct: number;
  difficultyScore: number; // 0 to 100
  hazardLevel: RiskLevel;
  hazardReasons: string[];
  landingSuitability: 'SUITABLE' | 'MARGINAL' | 'UNSUITABLE';
}

export interface LandingZoneCandidate {
  id: string;
  label: string;
  suitability: 'Landing & EVA Corridor' | 'EVA Walking Corridor';
  lat: number;
  lon: number;
  xKm: number;
  yKm: number;
  elevationM: number;
  slopeDeg: number;
  roughnessIdx: number;
  craterStandoffKm: number;
  thermalInertia: number;
  reason: string;
}

export interface TerrainAnalysisResult {
  regionId: string;
  regionName: string;
  gridSize: number;
  spanKm: number;
  cellSizeKm: number;
  cells: TerrainGridCell[][];
  minElevationM: number;
  maxElevationM: number;
  meanElevationM: number;
  meanSlopeDeg: number;
  maxSlopeDeg: number;
  meanRoughness: number;
  maxRoughness: number;
  minCraterProximityKm: number;
  meanCraterProximityKm: number;
  criticalRiskCellPct: number;
  highRiskCellPct: number;
  moderateRiskCellPct: number;
  lowRiskCellPct: number;
  landingZoneCount: number;
  landingCandidates: LandingZoneCandidate[];
}

export type HazardCategory =
  | 'Steep Slopes'
  | 'Crater Edges & Depressions'
  | 'Rocky or Rough Terrain'
  | 'Uncertain Terrain'
  | 'Potentially Difficult Navigation Zones';

export interface HazardZone {
  id: string;
  title: string;
  riskLevel: RiskLevel;
  category: HazardCategory;
  lat: number;
  lon: number;
  xKm: number;
  yKm: number;
  slopeDeg: number;
  roughnessIdx: number;
  craterProximityKm: number;
  difficultyScore: number;
  reason: string;
  classificationRule: string;
  mitigation: string;
  minDistToRouteKm?: number;
  routeRelation?: 'INTERSECTING' | 'NEAR_ROUTE' | 'AVOIDED';
  dataOrigin: 'NASA-Derived Baseline' | 'Derived Terrain Analysis' | 'Simulated Demonstration Grid';
  sourceNote: string;
}

export interface RouteWaypointNode {
  gx: number;
  gy: number;
  xKm: number;
  yKm: number;
  lat: number;
  lon: number;
  elevationM: number;
  slopeDeg: number;
  roughnessIdx: number;
  craterProximityKm: number;
  difficultyScore: number;
  hazardLevel: RiskLevel;
  cumulativeDistKm: number;
}

export interface AStarStepCostNode {
  stepIndex: number;
  cumulativeDistKm: number;
  cumulativeGCost: number;
  baseDistanceCost: number;
  slopePenaltyCost: number;
  roughnessPenaltyCost: number;
  climbPenaltyCost: number;
  toleranceOverflowCost: number;
  terrainDifficultyCost: number;
  hazardAvoidanceCost: number;
  objectiveDiscountApplied: number;
  netStepCost: number;
  hazardLevel: RiskLevel;
  slopeDeg: number;
  roughnessIdx: number;
  difficultyScore: number;
}

export interface AStarWeightConfig {
  slopeWeight: number;
  roughnessWeight: number;
  climbWeight: number;
  toleranceMultiplier: number;
  criticalHazardPenalty: number;
  highHazardPenalty: number;
  modHazardPenalty: number;
  scienceBonus: number;
}

export interface AStarCostDiagnostics {
  profile: 'shortest' | 'balanced' | 'safest';
  profileLabel: string;
  heuristicFormula: string;
  heuristicWeight: number;
  initialHeuristicKm: number;
  gridSize: number;
  totalGridNodes: number;
  gridResolutionM: number;
  nodesExpanded: number;
  nodesExpandedPct: number;
  totalGCost: number;
  baseDistanceCost: number;
  slopePenaltyCost: number;
  roughnessPenaltyCost: number;
  climbPenaltyCost: number;
  toleranceOverflowCost: number;
  terrainDifficultyCost: number;
  hazardAvoidanceCost: number;
  objectiveDiscountApplied: number;
  weights: AStarWeightConfig;
  stepBreakdown: AStarStepCostNode[];
}

export interface RouteOption {
  id: string;
  profile: 'shortest' | 'balanced' | 'safest';
  label: string;
  waypoints: RouteWaypointNode[];
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  meanDifficulty: number;
  estimatedDurationHr: number;
  hazardExposure: {
    lowPct: number;
    moderatePct: number;
    highPct: number;
    criticalPct: number;
    moderateSectionCount: number;
    highSectionCount: number;
    criticalSectionCount: number;
    flaggedHazardCount: number;
  };
  overallRiskScore: number; // 0 to 100 (higher = riskier)
  overallRiskLevel: RiskLevel;
  safetyScore: number; // 0 to 100 (higher = safer)
  coverageNote: string;
  passesMaxDifficulty: boolean;
  recommended: boolean;
  reasoning: string;
  costDiagnostics: AStarCostDiagnostics;
}

export interface RouteRiskAnalysisReport {
  routeLabel: string;
  totalDistanceKm: number;
  sampledNodesCount: number;
  cellStepMeters: number;
  highRiskSections: number;
  criticalRiskSections: number;
  averageTerrainDifficulty: number;
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  coverageStatement: string;
  limitationsStatement: string;
  saferAlternativeAvailable: boolean;
  saferAlternativeSummary: string;
}

export interface RoutePlanSummary {
  mode: 'local-eva' | 'regional-traverse';
  originName: string;
  destinationName: string;
  originLat: number;
  originLon: number;
  destLat: number;
  destLon: number;
  viaWaypoints?: Array<{
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevationM: number;
    localXKm: number;
    localYKm: number;
  }>;
  objective: MissionObjective;
  routePreference: RoutePreference;
  maxAcceptableDifficulty: number;
  terrain: TerrainAnalysisResult;
  hazards: HazardZone[];
  routes: RouteOption[];
  recommendedRouteId: string;
  selectionExplanation: string;
}

export type GeologicalFeatureCategory =
  | 'Ancient River Deltas'
  | 'Sedimentary Deposits'
  | 'Crater Formations'
  | 'Layered Rock Formations'
  | 'Ancient Water Channels'
  | 'Clay-Bearing Regions'
  | 'Mineral-Rich Regions';

export type ScienceExplorationObjective =
  | 'explore-ancient-deltas'
  | 'investigate-sedimentary'
  | 'visit-rover-sites'
  | 'examine-geological-diversity';

export type ScienceProvenanceClass =
  | 'NASA observation retrieved'
  | 'NASA archival reference'
  | 'Derived analysis'
  | 'Simulated demonstration data'
  | 'Unverified information';

export interface ScienceMissionConnection {
  mission: string;
  instruments: string[];
  role: string;
  provenanceClass: ScienceProvenanceClass;
  sourceName: string;
  sourceUrl?: string;
  date?: string;
}

export interface ScienceSite {
  id: string;
  title: string;
  locationId: string;
  locationName: string;
  mineralClass:
    | 'Ancient Water Evidence'
    | 'Clay-Bearing Minerals'
    | 'Sulfate Formations'
    | 'Geological Structures'
    | 'Rover Observations';
  geologicalCategory: GeologicalFeatureCategory;
  waterEnvironmentEvidence: 'STRONG' | 'MODERATE' | 'LOW';
  roverSupport: boolean;
  confidenceLevel: 'HIGH' | 'MODERATE' | 'PRELIMINARY';
  confidenceNote: string;
  supportingDataset: string;
  dataOrigin: 'NASA Orbital / Rover Observation' | 'Published Planetary Dataset';
  provenanceClass?: ScienceProvenanceClass;
  linkedWaypointId?: string;
  localXKm?: number;
  localYKm?: number;
  geologicalSignificanceScore: number; // 0-30
  geologicalDiversityRating?: number; // 0-20
  waterActivityScore: number; // 0-25
  observationCoverageScore: number; // 0-15
  lat: number;
  lon: number;
  elevationM: number;
  evidenceSummary: string;
  scientificSignificance: string;
  geologicalContext?: string;
  geologicalFeatures?: string[];
  investigatorRationale?: string;
  suggestedActivities?: string[];
  limitations?: string;
  missionConnections?: ScienceMissionConnection[];
  nasaMission: string;
  instrument: string;
  observationPeriod: string;
  sourceDate?: string;
  sourceUrl: string;
}

export type ResourceStatusLevel = 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';

export type DurationMode = 'activity-derived' | 'manual';

export interface EmergencyScenarioOutcome {
  extraPct: number;
  durationHr: number;
  durationSols: number;
  baseOxygenKg: number;
  reserveOxygenKg: number;
  totalOxygenKg: number;
  baseEnergyKwh: number;
  reserveEnergyKwh: number;
  totalEnergyKwh: number;
  baseWaterL: number;
  reserveWaterL: number;
  totalWaterL: number;
  oxygenDeltaKg: number;
  energyDeltaKwh: number;
  waterDeltaL: number;
  allSufficient: boolean;
}

export interface SurvivalInputs {
  missionName: string;
  astronautCount: number;
  useRouteSync: boolean;
  durationMode: DurationMode;
  manualDistanceKm: number;
  manualTerrainDifficulty: number;
  missionDurationHr: number;
  restDurationHr: number;
  additionalActivityHr: number;
  scheduleBufferHr: number;
  walkingSpeedKmh: number;
  oxygenRateKgPerPersonHr: number;
  suitPowerKwPerAstronaut: number;
  equipmentPowerKw: number;
  dailyWaterLitersPerPerson: number;
  safetyReservePct: number;
  emergencyExtensionPct: 0 | 10 | 20 | 30;
  availableOxygenSupplyKg: number;
  availableEnergySupplyKwh: number;
  availableWaterSupplyL: number;
}

export interface MissionReadinessBreakdown {
  resourceSufficiencyScore: number; // 0-40
  routeSafetyScore: number; // 0-20
  terrainDifficultyScore: number; // 0-15
  emergencyReserveScore: number; // 0-15
  missionDurationScore: number; // 0-10
  uncappedTotalScore: number;
  capAppliedReason: string | null;
  formulaSummary: string;
}

export interface SurvivalResults {
  routeDistanceKm: number;
  elevationGainM: number;
  terrainDifficultyUsed: number;
  terrainDifficultyFactor: number;
  slopeMetabolicFactor: number;
  combinedTerrainTimeFactor: number;
  baseWalkingDurationHr: number;
  terrainTimePenaltyHr: number;
  walkingDurationHr: number;
  restDurationHr: number;
  additionalActivityHr: number;
  scheduleBufferHr: number;
  calculatedActivityDurationHr: number;
  manualDurationDeltaHr: number;
  durationExplanation: string;
  estimatedTravelTimeHr: number;
  baseOxygenKg: number;
  oxygenPerAstronautKg: number;
  reserveOxygenKg: number;
  totalOxygenRequiredKg: number;
  totalOxygenPerAstronautKg: number;
  suitPowerTotalKw: number;
  totalPowerLoadKw: number;
  baseEnergyKwh: number;
  energyPerAstronautKwh: number;
  reserveEnergyKwh: number;
  totalEnergyRequiredKwh: number;
  totalEnergyPerAstronautKwh: number;
  baseWaterL: number;
  waterPerAstronautL: number;
  reserveWaterL: number;
  totalWaterRequiredL: number;
  totalWaterPerAstronautL: number;
  remainingOxygenReserveKg: number;
  remainingEnergyReserveKwh: number;
  remainingWaterReserveL: number;
  oxygenSufficient: boolean;
  energySufficient: boolean;
  waterSufficient: boolean;
  oxygenStatus: ResourceStatusLevel;
  energyStatus: ResourceStatusLevel;
  waterStatus: ResourceStatusLevel;
  overallResourceStatus: ResourceStatusLevel;
  hasInsufficientResource: boolean;
  insufficientResources: string[];
  limitedResources: string[];
  effectiveMissionDurationHr: number;
  effectiveMissionDurationSols: number;
  nominalDurationHr: number;
  emergencyContingencyHr: number;
  nominalOxygenRequiredKg: number;
  nominalEnergyRequiredKwh: number;
  nominalWaterRequiredL: number;
  emergencyScenarios: EmergencyScenarioOutcome[];
  missionReadinessScore: number;
  readinessClassification: string;
  readinessWarnings: string[];
  readinessBreakdown: MissionReadinessBreakdown;
}

export interface CentralMissionState {
  missionName: string;
  region: {
    id: string;
    name: string;
    region: string;
    lat: number;
    lon: number;
    elevationM: number;
    type: MarsLocation['type'];
    primaryMission: string;
    thermalInertiaTIU: number;
  };
  startingLocation: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevationM: number;
    localXKm: number;
    localYKm: number;
  };
  destination: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevationM: number;
    localXKm: number;
    localYKm: number;
  };
  objective: MissionObjective;
  routePreference: RoutePreference;
  activeRouteId: string;
  activeRouteProfile: RouteOption['profile'];
  activeRouteLabel: string;
  routeCoordinates: RouteWaypointNode[];
  distanceKm: number; // active planned route distance
  calculatorDistanceKm: number; // distance used in calculator (synced or manual)
  distanceSyncMode: 'SYNCED_WITH_ROUTE' | 'MANUAL_OVERRIDE';
  elevationGainM: number;
  elevationLossM: number;
  terrainDifficulty: {
    routeMeanDifficulty: number;
    calculatorDifficultyUsed: number;
    maxAcceptableDifficulty: number;
    passesMaxDifficulty: boolean;
    meanSlopeDeg: number;
    maxSlopeDeg: number;
    slopeMetabolicFactor: number;
    terrainDifficultyFactor: number;
    classificationLabel: 'FAVORABLE' | 'MODERATE' | 'DEMANDING';
  };
  hazardRisk: {
    overallRiskScore: number;
    overallRiskLevel: RiskLevel;
    safetyScore: number;
    moderateSectionCount: number;
    highSectionCount: number;
    criticalSectionCount: number;
    flaggedRegionalZonesCount: number;
    intersectingHazardZonesCount: number;
    nearRouteHazardZonesCount: number;
    avoidedHazardZonesCount: number;
    criticalZonesCount: number;
    highZonesCount: number;
    moderateZonesCount: number;
  };
  safetyScore: number;
  crewSize: number;
  walkingSpeedKmh: number;
  timing: {
    durationMode: DurationMode;
    baseWalkingTimeHr: number;
    terrainDelayHr: number;
    terrainAdjustedWalkingTimeHr: number;
    restTimeHr: number;
    scientificActivityTimeHr: number;
    scheduleBufferHr: number;
    calculatedActivityDurationHr: number;
    nominalDurationHr: number;
    emergencyContingencyPct: 0 | 10 | 20 | 30;
    emergencyContingencyTimeHr: number;
    totalMissionDurationHr: number;
    totalMissionDurationSols: number;
    martianSolHours: number;
    explanation: string;
  };
  oxygen: {
    rateKgPerPersonHr: number;
    baseKg: number;
    perAstronautBaseKg: number;
    reserveKg: number;
    totalRequiredKg: number;
    totalPerAstronautKg: number;
    loadedSupplyKg: number;
    marginKg: number;
    status: ResourceStatusLevel;
  };
  energy: {
    suitPowerKwPerAstronaut: number;
    sharedEquipmentKw: number;
    totalLoadKw: number;
    baseKwh: number;
    perAstronautKwh: number;
    reserveKwh: number;
    totalRequiredKwh: number;
    totalPerAstronautKwh: number;
    loadedSupplyKwh: number;
    marginKwh: number;
    status: ResourceStatusLevel;
  };
  water: {
    dailyRateLPerPersonSol: number;
    baseL: number;
    perAstronautBaseL: number;
    reserveL: number;
    totalRequiredL: number;
    totalPerAstronautL: number;
    loadedSupplyL: number;
    marginL: number;
    status: ResourceStatusLevel;
  };
  loadedSupplies: {
    oxygenKg: number;
    energyKwh: number;
    waterL: number;
  };
  emergencyReserves: {
    safetyReservePct: number;
    oxygenReserveKg: number;
    energyReserveKwh: number;
    waterReserveL: number;
    activeExtensionPct: 0 | 10 | 20 | 30;
    scenarios: EmergencyScenarioOutcome[];
  };
  missionReadiness: {
    score: number;
    classification: string;
    overallResourceStatus: ResourceStatusLevel;
    hasInsufficientResource: boolean;
    insufficientResources: string[];
    limitedResources: string[];
    warnings: string[];
    breakdown: MissionReadinessBreakdown;
    disclaimer: string;
  };
  selectedLocation: MarsLocation;
  routePlan: RoutePlanSummary;
  activeRoute: RouteOption;
  scienceWaypoints: Array<{
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevationM: number;
  }>;
  survivalInputs: SurvivalInputs;
  survivalResults: SurvivalResults;
  nearbyScience: ScienceSite[];
  datasets: NasaDatasetRecord[];
}

export interface MissionSnapshot {
  snapshotId: string;
  generatedAtIso: string;
  generatedAtLocal: string;
  state: CentralMissionState;
  latestAssistantAnalysis?: string;
}

export interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
}

export type NasaEndpointKey =
  | 'trek-mola'
  | 'trek-viking'
  | 'usgs-themis'
  | 'nasa-images'
  | 'jpl-mars2020'
  | 'jpl-msl'
  | 'meda-weather'
  | 'rems-weather'
  | 'pds-ode';

export type RetrievalBadgeStatus = 'VERIFIED' | 'CONNECTED' | 'UNAVAILABLE' | 'SIMULATED';

export interface NasaEndpointProbe {
  key: NasaEndpointKey;
  status: RetrievalBadgeStatus;
  httpStatus?: number;
  retrievedAt?: string;
  lastSuccessfulAt?: string;
  observationDate?: string;
  recordCount?: number;
  bytes?: number;
  latencyMs?: number;
  detail: string;
  error?: string;
  cached?: boolean;
}

export interface NasaEnvironmentSolRecord {
  mission: 'Mars 2020 Perseverance' | 'MSL Curiosity';
  instrument: 'MEDA' | 'REMS';
  locationName: string;
  sol: string;
  terrestrialDate: string;
  season: string;
  ls: string;
  minTempC: string;
  maxTempC: string;
  pressurePa: string;
  pressureMbar: string;
  opacity?: string;
  uvIndex?: string;
  sunrise?: string;
  sunset?: string;
}

export interface NasaEnvironmentResponse {
  retrievedAt: string;
  cached: boolean;
  meda: {
    status: RetrievalBadgeStatus;
    latestObservationDate?: string;
    latestSol?: string;
    sourceUrl: string;
    error?: string;
    note: string;
    records: NasaEnvironmentSolRecord[];
  };
  rems: {
    status: RetrievalBadgeStatus;
    latestObservationDate?: string;
    latestSol?: string;
    sourceUrl: string;
    error?: string;
    note: string;
    records: NasaEnvironmentSolRecord[];
  };
}

export interface PdsOrbitalProduct {
  productId: string;
  mission: string;
  instrument: string;
  productType: string;
  observationDate: string;
  centerLat: number;
  centerLon: number;
  distanceKm?: number;
  geographicMatch?: 'IN_SECTOR' | 'ADJACENT_REGION' | 'OUT_OF_SECTOR';
  description: string;
  sourceUrl: string;
  labelUrl?: string;
}

export interface NasaDatasetRecord {
  id: string;
  name: string;
  mission: string;
  instrument: string;
  dataType: string;
  officialSourceLabel: string;
  sourceUrl: string;
  endpointKey?: NasaEndpointKey;
  geographicCoverage: string;
  coveragePeriod: string;
  spatialResolution: string;
  integrationMethod: string;
  dataNature: 'Historical Archive' | 'Ongoing Archival Feed' | 'Published Reference' | 'Simulated Model';
  limitations: string;
  credibilityClass: DataProvenance;
  description: string;
}

export interface NasaImageryItem {
  id: string;
  title: string;
  mission: string;
  instrument: string;
  observationDate: string;
  sol?: number;
  imageUrl: string;
  sourceUrl: string;
  description: string;
  isFallback: boolean;
  locationMatch?: 'REGIONAL_MATCH' | 'CROSS_SITE_REFERENCE' | 'ARCHIVAL_REFERENCE';
  locationNote?: string;
}

