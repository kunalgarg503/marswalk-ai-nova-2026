import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  FileDown,
  FileText,
  FlaskConical,
  Mountain,
  RotateCcw,
  Route,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { MARTIAN_CRATERS, ROVER_EXPLORATION_SITES } from '../../data/marsFeatures';
import { createMissionSnapshot } from '../../engine/missionState';
import { computeRouteToSiteProximity, computeSciencePriority } from '../../engine/scienceEngine';
import {
  createInitialWhatIfInput,
  extractDangerousRouteSegments,
  generateSmartRecommendations,
  runWhatIfSimulation,
  type SmartRecommendation,
  type WhatIfSimulationInput,
} from '../../engine/missionAdvisor';
import type {
  CentralMissionState,
  NasaEndpointProbe,
  NavSection,
  PdsOrbitalProduct,
  RoutePreference,
  SurvivalInputs,
} from '../../types/mars';
import {
  buildMissionSummaryMarkdown,
  downloadMissionSummaryPdf,
} from '../../utils/missionSummaryPdf';
import { ProvenanceTag } from '../ProvenanceTag';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  timestamp: string;
  model?: string;
  mode?: AssistantRequestMode;
}

type AssistantRequestMode = 'chat' | 'quick-action' | 'summary' | 'risk-analysis' | 'what-if';

interface MissionAssistantViewProps {
  missionState: CentralMissionState;
  onNavigate?: (section: NavSection) => void;
  onSelectRouteId?: (id: string) => void;
  onApplyWhatIfScenario?: (patch: {
    survivalInputs: SurvivalInputs;
    routePreference: RoutePreference;
  }) => void;
}

const formatSigned = (value: number, unit: string, decimals = 2): string => {
  const fixed = value.toFixed(decimals);
  return `${value > 0 ? '+' : ''}${fixed} ${unit}`;
};

export function MissionAssistantView({
  missionState,
  onNavigate,
  onSelectRouteId,
  onApplyWhatIfScenario,
}: MissionAssistantViewProps) {
  const {
    selectedLocation,
    routePlan,
    activeRoute,
    survivalInputs,
    survivalResults: survival,
    nearbyScience,
    datasets,
    timing,
    missionReadiness,
  } = missionState;

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      text: '',
      timestamp: new Date().toLocaleTimeString(),
      model: 'System Grounding',
    },
  ]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSummaryDrawer, setShowSummaryDrawer] = useState(false);
  const [showWhatIfPanel, setShowWhatIfPanel] = useState(false);
  const [whatIfAppliedBanner, setWhatIfAppliedBanner] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [lastExportMeta, setLastExportMeta] = useState<{
    snapshotId: string;
    generatedAtIso: string;
  } | null>(null);

  const [liveNasaProbes, setLiveNasaProbes] = useState<NasaEndpointProbe[]>([]);
  const [livePdsProducts, setLivePdsProducts] = useState<PdsOrbitalProduct[]>([]);
  const [liveNasaError, setLiveNasaError] = useState<string | null>(null);

  const [whatIfInput, setWhatIfInput] = useState<WhatIfSimulationInput>(() =>
    createInitialWhatIfInput(missionState),
  );

  const baselineSyncKey = `${selectedLocation.id}|${missionState.startingLocation.id}|${missionState.destination.id}`;
  const prevBaselineKeyRef = useRef(baselineSyncKey);
  useEffect(() => {
    if (prevBaselineKeyRef.current !== baselineSyncKey) {
      prevBaselineKeyRef.current = baselineSyncKey;
      setWhatIfInput(createInitialWhatIfInput(missionState));
      setWhatIfAppliedBanner(null);
    }
  }, [baselineSyncKey, missionState]);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const whatIfSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { geminiConfigured?: boolean } | null) => {
        if (!cancelled && typeof data?.geminiConfigured === 'boolean') {
          setGeminiConfigured(data.geminiConfigured);
        }
      })
      .catch((err) => {
        console.warn('Mission assistant health check failed:', err);
        if (!cancelled) setGeminiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLiveNasaError(null);

    const statusFetch = fetch('/api/nasa/status')
      .then((r) => {
        if (!r.ok) throw new Error(`Status HTTP ${r.status}`);
        return r.json() as Promise<{ probes?: Record<string, NasaEndpointProbe> }>;
      })
      .then((data) => {
        if (!cancelled && data.probes) {
          setLiveNasaProbes(Object.values(data.probes));
        }
      });

    const pdsFetch = fetch(
      `/api/nasa/pds-products?lat=${selectedLocation.lat}&lon=${selectedLocation.lon}&site=${encodeURIComponent(selectedLocation.name)}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`PDS ODE HTTP ${r.status}`);
        return r.json() as Promise<{ products?: PdsOrbitalProduct[] }>;
      })
      .then((data) => {
        if (!cancelled && Array.isArray(data.products)) {
          setLivePdsProducts(data.products);
        }
      });

    Promise.allSettled([statusFetch, pdsFetch]).then((results) => {
      if (cancelled) return;
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      if (rejected.length > 0) {
        setLiveNasaError(
          rejected
            .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
            .join('; '),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedLocation.id, selectedLocation.lat, selectedLocation.lon, selectedLocation.name]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const whatIfOutcome = useMemo(
    () => runWhatIfSimulation(missionState, whatIfInput),
    [missionState, whatIfInput],
  );

  const dangerousSegments = useMemo(
    () => extractDangerousRouteSegments(activeRoute),
    [activeRoute],
  );

  const routeMinCraterProximityKm = useMemo(() => {
    const minKm = activeRoute.waypoints.reduce(
      (min, w) => Math.min(min, w.craterProximityKm),
      Infinity,
    );
    return Number.isFinite(minKm)
      ? Number(minKm.toFixed(3))
      : routePlan.terrain.minCraterProximityKm;
  }, [activeRoute.waypoints, routePlan.terrain.minCraterProximityKm]);

  const smartRecommendations = useMemo(
    () => generateSmartRecommendations(missionState),
    [missionState],
  );

  const suggestedQuestions = useMemo(
    () => [
      'Is my selected route suitable for a Marswalk?',
      'Which section of my route is most dangerous?',
      'Why is the safest route different from the shortest route?',
      'How much oxygen does my crew require?',
      'Are my available energy reserves sufficient?',
      'Which scientific targets should we prioritise?',
      'What happens if our mission takes 2 additional hours?',
      `What risks exist in ${selectedLocation.name}?`,
      'Should we choose a safer alternative route?',
      `What NASA observations support ${selectedLocation.name}?`,
    ],
    [selectedLocation.name],
  );

  const liveWelcomeText = useMemo(() => {
    return [
      `### MARSWALK AI Mission Advisor Ready`,
      `Connected to live Central Mission State for **${missionState.missionName}** at **${selectedLocation.name}** (${selectedLocation.lat.toFixed(2)}°, ${selectedLocation.lon.toFixed(2)}° · ${selectedLocation.elevationM} m MOLA).`,
      `- **Corridor:** ${missionState.startingLocation.name} -> ${missionState.destination.name}`,
      `- **Active Route:** ${missionState.routePreference.toUpperCase()} -> ${activeRoute.label} (${missionState.distanceKm.toFixed(2)} km, Safety **${missionState.safetyScore}/100**, Risk **${missionState.hazardRisk.overallRiskLevel}**)`,
      `- **Crew & Duration:** ${missionState.crewSize} astronaut(s) @ ${missionState.walkingSpeedKmh.toFixed(1)} km/h · **${timing.totalMissionDurationHr.toFixed(2)} hr (${timing.totalMissionDurationSols.toFixed(2)} sols)**`,
      `- **Consumables:** ${missionState.oxygen.totalRequiredKg.toFixed(2)} kg O2 (${missionState.oxygen.status}) · ${missionState.energy.totalRequiredKwh.toFixed(2)} kWh Energy (${missionState.energy.status}) · ${missionState.water.totalRequiredL.toFixed(2)} L Water (${missionState.water.status})`,
      `- **Mission Readiness:** **${missionReadiness.score}/100 (${missionReadiness.classification})**`,
      `- **Science Targets in Sector:** ${nearbyScience.length} documented planetary geology target(s)`,
      '',
      `Use a **Quick Mission Action** (including **Mission Risk Analysis**), adjust parameters in the **What-If Simulator**, inspect **Smart Recommendations**, or ask any mission question below.`,
    ].join('\n');
  }, [missionState, selectedLocation, activeRoute, timing, missionReadiness, nearbyScience.length]);

  const highOrCriticalCount = useMemo(
    () =>
      routePlan.hazards.filter((h) => h.riskLevel === 'HIGH' || h.riskLevel === 'CRITICAL').length,
    [routePlan.hazards],
  );

  // Full cross-module context built strictly from CentralMissionState + live NASA verification
  const missionContext = useMemo(() => {
    const hazardCountsByLevel = {
      CRITICAL: missionState.hazardRisk.criticalZonesCount,
      HIGH: missionState.hazardRisk.highZonesCount,
      MODERATE: missionState.hazardRisk.moderateZonesCount,
      LOW: routePlan.hazards.filter((h) => h.riskLevel === 'LOW').length,
    };

    const hazardCountsByCategory: Record<string, number> = {};
    for (const h of routePlan.hazards) {
      hazardCountsByCategory[h.category] = (hazardCountsByCategory[h.category] || 0) + 1;
    }

    const activeScenarioBlock = whatIfOutcome.isModified
      ? {
          label: whatIfOutcome.label,
          nonMutationNote:
            'Hypothetical What-If simulation only. Active CentralMissionState is UNCHANGED unless crew explicitly clicks Confirm & Apply Scenario.',
          inputs: whatIfOutcome.inputs,
          modifiedValues: {
            routeLabel: whatIfOutcome.simulatedRoute.label,
            routeProfile: whatIfOutcome.simulatedRoute.profile,
            distanceKm: whatIfOutcome.simulatedRoute.distanceKm,
            safetyScore: whatIfOutcome.simulatedRoute.safetyScore,
            overallRiskLevel: whatIfOutcome.simulatedRoute.overallRiskLevel,
            effectiveDurationHr: whatIfOutcome.simulatedSurvival.effectiveMissionDurationHr,
            effectiveDurationSols: whatIfOutcome.simulatedSurvival.effectiveMissionDurationSols,
            oxygenRequiredKg: whatIfOutcome.simulatedSurvival.totalOxygenRequiredKg,
            oxygenMarginKg: whatIfOutcome.simulatedSurvival.remainingOxygenReserveKg,
            oxygenStatus: whatIfOutcome.simulatedSurvival.oxygenStatus,
            energyRequiredKwh: whatIfOutcome.simulatedSurvival.totalEnergyRequiredKwh,
            energyMarginKwh: whatIfOutcome.simulatedSurvival.remainingEnergyReserveKwh,
            energyStatus: whatIfOutcome.simulatedSurvival.energyStatus,
            waterRequiredL: whatIfOutcome.simulatedSurvival.totalWaterRequiredL,
            waterMarginL: whatIfOutcome.simulatedSurvival.remainingWaterReserveL,
            waterStatus: whatIfOutcome.simulatedSurvival.waterStatus,
            overallResourceStatus: whatIfOutcome.simulatedSurvival.overallResourceStatus,
            readinessScore: whatIfOutcome.simulatedSurvival.missionReadinessScore,
            readinessClassification: whatIfOutcome.simulatedSurvival.readinessClassification,
          },
          deltas: whatIfOutcome.deltas,
          newWarnings: whatIfOutcome.newWarnings,
          resolvedWarnings: whatIfOutcome.resolvedWarnings,
        }
      : undefined;

    return {
      centralMissionStateSummary: {
        missionName: missionState.missionName,
        region: missionState.region,
        startingLocation: missionState.startingLocation,
        destination: missionState.destination,
        routePreference: missionState.routePreference,
        activeRouteLabel: missionState.activeRouteLabel,
        distanceKm: missionState.distanceKm,
        elevationGainM: missionState.elevationGainM,
        elevationLossM: missionState.elevationLossM,
        terrainDifficulty: missionState.terrainDifficulty,
        hazardRisk: missionState.hazardRisk,
        safetyScore: missionState.safetyScore,
        crewSize: missionState.crewSize,
        walkingSpeedKmh: missionState.walkingSpeedKmh,
        timing: missionState.timing,
        oxygen: missionState.oxygen,
        energy: missionState.energy,
        water: missionState.water,
        loadedSupplies: missionState.loadedSupplies,
        emergencyReserves: {
          safetyReservePct: missionState.emergencyReserves.safetyReservePct,
          activeExtensionPct: missionState.emergencyReserves.activeExtensionPct,
          oxygenReserveKg: missionState.emergencyReserves.oxygenReserveKg,
          energyReserveKwh: missionState.emergencyReserves.energyReserveKwh,
          waterReserveL: missionState.emergencyReserves.waterReserveL,
        },
        missionReadiness: missionState.missionReadiness,
      },
      marsExplorerRegion: {
        id: selectedLocation.id,
        name: selectedLocation.name,
        region: selectedLocation.region,
        type: selectedLocation.type,
        lat: selectedLocation.lat,
        lon: selectedLocation.lon,
        elevationM: selectedLocation.elevationM,
        primaryMission: selectedLocation.primaryMission,
        thermalInertiaTIU: selectedLocation.thermalInertiaTIU,
        environmentalBaseline: selectedLocation.environmentalBaseline,
        geologyNotes: selectedLocation.geologyNotes,
        scienceHighlights: selectedLocation.scienceHighlights,
        localWaypoints: selectedLocation.localWaypoints.map((w) => ({
          id: w.id,
          name: w.name,
          lat: w.lat,
          lon: w.lon,
          elevationM: w.elevationM,
          featureType: w.featureType,
          scienceValue: w.scienceValue,
        })),
      },
      terrainIntelligence: {
        regionName: routePlan.terrain.regionName,
        gridSize: `${routePlan.terrain.gridSize}x${routePlan.terrain.gridSize}`,
        spanKm: routePlan.terrain.spanKm,
        cellSizeKm: routePlan.terrain.cellSizeKm,
        minElevationM: routePlan.terrain.minElevationM,
        maxElevationM: routePlan.terrain.maxElevationM,
        meanElevationM: routePlan.terrain.meanElevationM,
        meanSlopeDeg: routePlan.terrain.meanSlopeDeg,
        maxSlopeDeg: routePlan.terrain.maxSlopeDeg,
        meanRoughness: routePlan.terrain.meanRoughness,
        maxRoughness: routePlan.terrain.maxRoughness,
        minCraterProximityKm: routePlan.terrain.minCraterProximityKm,
        riskDistributionPct: {
          low: routePlan.terrain.lowRiskCellPct,
          moderate: routePlan.terrain.moderateRiskCellPct,
          high: routePlan.terrain.highRiskCellPct,
          critical: routePlan.terrain.criticalRiskCellPct,
        },
        landingZoneCount: routePlan.terrain.landingZoneCount,
        topLandingCandidates: routePlan.terrain.landingCandidates.slice(0, 3),
        provenanceNote:
          'SIMULATED DEMONSTRATION: 25x25 km synthetic terrain grid anchored to published MOLA elevation and thermal inertia baselines; NOT raw HiRISE 0.25 m/px DTM elevation telemetry.',
      },
      hazardDetection: {
        onActiveRouteSteps: {
          critical: activeRoute.hazardExposure.criticalSectionCount,
          high: activeRoute.hazardExposure.highSectionCount,
          moderate: activeRoute.hazardExposure.moderateSectionCount,
        },
        regional25kmZones: {
          totalFlaggedZones: routePlan.hazards.length,
          intersectingActiveRoute: missionState.hazardRisk.intersectingHazardZonesCount,
          nearActiveRouteWithin1_1Km: missionState.hazardRisk.nearRouteHazardZonesCount,
          avoidedByActiveRoute: missionState.hazardRisk.avoidedHazardZonesCount,
        },
        totalFlaggedZones: routePlan.hazards.length,
        countsByLevel: hazardCountsByLevel,
        countsByCategory: hazardCountsByCategory,
        topHazards: routePlan.hazards.slice(0, 8).map((h) => ({
          title: h.title,
          riskLevel: h.riskLevel,
          routeRelation: h.routeRelation,
          minDistToRouteKm: h.minDistToRouteKm,
          category: h.category,
          lat: h.lat,
          lon: h.lon,
          slopeDeg: h.slopeDeg,
          roughnessIdx: h.roughnessIdx,
          craterProximityKm: h.craterProximityKm,
          reason: h.reason,
          mitigation: h.mitigation,
          dataOrigin: h.dataOrigin,
        })),
      },
      smartRoutePlanner: {
        originName: routePlan.originName,
        destinationName: routePlan.destinationName,
        originCoords: { lat: routePlan.originLat, lon: routePlan.originLon },
        destCoords: { lat: routePlan.destLat, lon: routePlan.destLon },
        objective: routePlan.objective,
        routePreference: routePlan.routePreference,
        maxAcceptableDifficulty: routePlan.maxAcceptableDifficulty,
        selectionExplanation: routePlan.selectionExplanation,
        routeMinCraterProximityKm,
        mostDangerousRouteSegments: dangerousSegments.slice(0, 6),
        activeRoute: {
          id: activeRoute.id,
          label: activeRoute.label,
          profile: activeRoute.profile,
          distanceKm: activeRoute.distanceKm,
          estimatedDurationHr: activeRoute.estimatedDurationHr,
          elevationGainM: activeRoute.elevationGainM,
          elevationLossM: activeRoute.elevationLossM,
          maxSlopeDeg: activeRoute.maxSlopeDeg,
          meanSlopeDeg: activeRoute.meanSlopeDeg,
          meanDifficulty: activeRoute.meanDifficulty,
          safetyScore: activeRoute.safetyScore,
          overallRiskScore: activeRoute.overallRiskScore,
          overallRiskLevel: activeRoute.overallRiskLevel,
          passesMaxDifficulty: activeRoute.passesMaxDifficulty,
          hazardExposure: activeRoute.hazardExposure,
          costWeights: activeRoute.costDiagnostics?.weights,
        },
        allRouteAlternatives: routePlan.routes.map((r) => ({
          id: r.id,
          profile: r.profile,
          label: r.label,
          recommended: r.recommended,
          distanceKm: r.distanceKm,
          estimatedDurationHr: r.estimatedDurationHr,
          elevationGainM: r.elevationGainM,
          maxSlopeDeg: r.maxSlopeDeg,
          meanDifficulty: r.meanDifficulty,
          safetyScore: r.safetyScore,
          overallRiskLevel: r.overallRiskLevel,
          passesMaxDifficulty: r.passesMaxDifficulty,
          hazardExposure: r.hazardExposure,
          reasoning: r.reasoning,
        })),
      },
      survivalCalculator: {
        missionName: survivalInputs.missionName,
        crewCount: survivalInputs.astronautCount,
        useRouteSync: survivalInputs.useRouteSync,
        durationMode: survivalInputs.durationMode,
        walkingSpeedKmh: survivalInputs.walkingSpeedKmh,
        safetyReservePct: survivalInputs.safetyReservePct,
        activeEmergencyExtensionPct: survivalInputs.emergencyExtensionPct,
        timingBreakdown: timing,
        assumptions: {
          oxygenRateKgPerPersonHr: survivalInputs.oxygenRateKgPerPersonHr,
          suitPowerKwPerAstronaut: survivalInputs.suitPowerKwPerAstronaut,
          equipmentPowerKw: survivalInputs.equipmentPowerKw,
          dailyWaterLitersPerPerson: survivalInputs.dailyWaterLitersPerPerson,
          martianSolHours: timing.martianSolHours,
          exactFormulas: [
            'Base_O2 = Crew * Total_Duration_hr * O2_Rate_kg_per_person_hr',
            'Base_Energy = (Crew * Suit_kW + Shared_Equipment_kW) * Total_Duration_hr',
            'Base_Water = Crew * (Total_Duration_hr / 24.623) * Daily_Water_L_per_sol',
            'Reserve = Base * (Safety_Reserve_Pct / 100); Total = Base + Reserve',
          ],
        },
        availableCapacities: {
          oxygenKg: survivalInputs.availableOxygenSupplyKg,
          energyKwh: survivalInputs.availableEnergySupplyKwh,
          waterL: survivalInputs.availableWaterSupplyL,
        },
        calculatedRequirements: {
          effectiveDurationHr: survival.effectiveMissionDurationHr,
          effectiveDurationSols: survival.effectiveMissionDurationSols,
          nominalDurationHr: survival.nominalDurationHr,
          totalOxygenRequiredKg: survival.totalOxygenRequiredKg,
          baseOxygenKg: survival.baseOxygenKg,
          reserveOxygenKg: survival.reserveOxygenKg,
          remainingOxygenKg: survival.remainingOxygenReserveKg,
          oxygenStatus: survival.oxygenStatus,
          totalEnergyRequiredKwh: survival.totalEnergyRequiredKwh,
          baseEnergyKwh: survival.baseEnergyKwh,
          reserveEnergyKwh: survival.reserveEnergyKwh,
          remainingEnergyKwh: survival.remainingEnergyReserveKwh,
          energyStatus: survival.energyStatus,
          totalWaterRequiredL: survival.totalWaterRequiredL,
          baseWaterL: survival.baseWaterL,
          reserveWaterL: survival.reserveWaterL,
          remainingWaterL: survival.remainingWaterReserveL,
          waterStatus: survival.waterStatus,
          overallResourceStatus: survival.overallResourceStatus,
          missionReadinessScore: survival.missionReadinessScore,
          readinessClassification: survival.readinessClassification,
          readinessBreakdown: survival.readinessBreakdown,
          readinessWarnings: survival.readinessWarnings,
        },
        emergencyDurationScenarios: survival.emergencyScenarios,
        disclaimer:
          'Parametric planning estimates using configurable engineering assumptions; NOT validated NASA spacesuit specifications or flight certifications.',
      },
      scienceDiscoveryExplorer: {
        activeScienceWaypoints: missionState.scienceWaypoints,
        nearbyTargetsCount: nearbyScience.length,
        nearbyScienceSites: nearbyScience.map((s) => {
          const pri = computeSciencePriority(s, 'explore-ancient-deltas', {
            route: activeRoute,
            location: selectedLocation,
          });
          const prox = computeRouteToSiteProximity(s, activeRoute);
          return {
            id: s.id,
            title: s.title,
            geologicalCategory: s.geologicalCategory,
            lat: s.lat,
            lon: s.lon,
            elevationM: s.elevationM,
            waterEnvironmentEvidence: s.waterEnvironmentEvidence,
            roverSupport: s.roverSupport,
            confidenceLevel: s.confidenceLevel,
            provenanceClass: s.provenanceClass || 'NASA archival reference',
            prototypePriorityScore: pri.totalScore,
            priorityBreakdown: pri.breakdown,
            corridorProximityKm: prox.minDistanceKm,
            corridorStatus: pri.accessibilityStatus,
            geologicalContext: s.geologicalContext || 'Data not available',
            investigatorRationale: s.investigatorRationale || 'Data not available',
            limitations: s.limitations || 'Data not available',
            supportingDataset: s.supportingDataset,
            nasaMission: s.nasaMission,
            instrument: s.instrument,
            evidenceSummary: s.evidenceSummary,
            scientificSignificance: s.scientificSignificance,
            sourceUrl: s.sourceUrl,
          };
        }),
        nearbyRovers: ROVER_EXPLORATION_SITES.filter(
          (r) => r.linkedLocationId === selectedLocation.id,
        ),
        regionalCraters: MARTIAN_CRATERS.filter(
          (c) => Math.abs(c.lat - selectedLocation.lat) < 12 && Math.abs(c.lon - selectedLocation.lon) < 12,
        ),
      },
      nasaDataCatalog: datasets.map((d) => ({
        id: d.id,
        name: d.name,
        mission: d.mission,
        instrument: d.instrument,
        officialSourceLabel: d.officialSourceLabel,
        sourceUrl: d.sourceUrl,
        geographicCoverage: d.geographicCoverage,
        coveragePeriod: d.coveragePeriod,
        spatialResolution: d.spatialResolution,
        integrationMethod: d.integrationMethod,
        dataNature: d.dataNature,
        limitations: d.limitations,
        credibilityClass: d.credibilityClass,
      })),
      liveNasaTelemetryContext: {
        endpointVerificationStatus: liveNasaProbes.map((p) => ({
          key: p.key,
          status: p.status,
          observationDate: p.observationDate,
          detail: p.detail,
        })),
        pdsOrbitalFootprintsAtRegion: livePdsProducts.map((p) => ({
          productId: p.productId,
          instrument: p.instrument,
          productType: p.productType,
          observationDate: p.observationDate,
          centerLat: p.centerLat,
          centerLon: p.centerLon,
          sourceUrl: p.sourceUrl,
        })),
        unavailableDataNote: [
          selectedLocation.id !== 'jezero-crater' && selectedLocation.id !== 'gale-crater'
            ? `No live rover environmental station (MEDA/REMS) exists at ${selectedLocation.name}; atmospheric values here are published regional baselines, NOT live rover telemetry.`
            : `Surface weather feeds (MEDA/REMS) are archival JPL/CAB mission records (not real-time instantaneous telemetry).`,
          'Raw numeric MOLA elevation REST raster queries and 0.25 m/px HiRISE stereo DTM rasters are NOT downloaded directly into the A* router; local grids are 500 m synthetic demonstration cells anchored to published MOLA spot values.',
          ...(liveNasaError ? [`Live endpoint probe note: ${liveNasaError}`] : []),
        ],
      },
      activeSmartRecommendations: smartRecommendations.map((r) => ({
        title: r.title,
        severity: r.severity,
        provenance: r.provenance,
        reason: r.reason,
        supportingData: r.supportingData,
      })),
      ...(activeScenarioBlock ? { whatIfScenario: activeScenarioBlock } : {}),
    };
  }, [
    missionState,
    selectedLocation,
    routePlan,
    activeRoute,
    dangerousSegments,
    routeMinCraterProximityKm,
    survivalInputs,
    survival,
    timing,
    nearbyScience,
    datasets,
    liveNasaProbes,
    livePdsProducts,
    liveNasaError,
    smartRecommendations,
    whatIfOutcome,
  ]);

  const sendQuestion = async (
    questionText: string,
    mode: AssistantRequestMode = 'chat',
  ) => {
    const trimmed = questionText.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString(),
      mode,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const historyPayload = messages
      .filter((m) => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
      .slice(-6)
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }));

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          missionContext,
          history: historyPayload,
          mode,
        }),
      });

      const data = (await res.json()) as {
        answer?: string;
        error?: string;
        model?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Server error (${res.status})`);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: data.answer || 'No response received.',
          timestamp: new Date().toLocaleTimeString(),
          model: data.model || 'gemini-4-hydrogen',
          mode,
        },
      ]);
    } catch (err) {
      const errorDetail =
        err instanceof Error ? err.message : 'Failed to contact Mission Assistant backend.';
      const verifiedProbes = liveNasaProbes.filter((p) => p.status === 'VERIFIED').map((p) => p.key);
      const localFallbackText = [
        `> **WARNING:** **LOCAL DETERMINISTIC FALLBACK (NOT FROM GEMINI AI)** — Upstream Gemini endpoint unavailable (${errorDetail}). Below is an unassisted deterministic briefing read strictly from Central Mission State.`,
        '',
        `### Active Mission Briefing — ${missionState.missionName} (${selectedLocation.name})`,
        `- **Route (` + `${routePlan.originName} → ${routePlan.destinationName}` + `):** ${activeRoute.label} (${activeRoute.distanceKm.toFixed(2)} km, +${activeRoute.elevationGainM} / -${activeRoute.elevationLossM} m, Safety **${activeRoute.safetyScore}/100**, Risk **${activeRoute.overallRiskLevel}**). *[DERIVED CALCULATION on SIMULATED DEMONSTRATION 500 m grid]*`,
        `- **Hazard Exposure:** ${activeRoute.hazardExposure.criticalSectionCount} critical & ${activeRoute.hazardExposure.highSectionCount} high corridor steps; peak slope ${activeRoute.maxSlopeDeg.toFixed(1)}°, min crater proximity ${routeMinCraterProximityKm} km.`,
        `- **Consumables (${missionState.crewSize} crew · ${timing.totalMissionDurationHr.toFixed(2)} hr):** O2 **${missionState.oxygen.totalRequiredKg.toFixed(2)} kg** (Loaded ${missionState.loadedSupplies.oxygenKg.toFixed(2)} kg · ${missionState.oxygen.status}) · Energy **${missionState.energy.totalRequiredKwh.toFixed(2)} kWh** (Loaded ${missionState.loadedSupplies.energyKwh.toFixed(2)} kWh · ${missionState.energy.status}) · Water **${missionState.water.totalRequiredL.toFixed(2)} L** (Loaded ${missionState.loadedSupplies.waterL.toFixed(2)} L · ${missionState.water.status}). *[DERIVED CALCULATION]*`,
        `- **Readiness:** **${missionReadiness.score}/100 (${missionReadiness.classification})**${missionReadiness.warnings.length > 0 ? ` — Warnings: ${missionReadiness.warnings.join('; ')}` : ''}`,
        `- **NASA Data Feeds:** ${verifiedProbes.length > 0 ? `Verified structured feeds: ${verifiedProbes.join(', ')}` : 'Live structured NASA probes pending or unavailable; using NASA archival reference baselines'}.`,
        `- **Limitations:** MARSWALK AI is a planning prototype — not a flight-certified EVA system.`,
      ].join('\n');

      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'error',
          text: `${errorDetail} — Showing local deterministic fallback below (not generated by Gemini).`,
          timestamp: new Date().toLocaleTimeString(),
        },
        {
          id: `fb-${Date.now() + 1}`,
          role: 'assistant',
          text: localFallbackText,
          timestamp: new Date().toLocaleTimeString(),
          model: 'LOCAL FALLBACK (NO GEMINI)',
          mode,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (
    action: 'route' | 'resources' | 'hazards' | 'science' | 'risk-analysis' | 'summary',
  ) => {
    if (action === 'route') {
      void sendQuestion(
        `Analyse my current planned route (${activeRoute.label} from ${routePlan.originName} to ${routePlan.destinationName}). Compare Shortest, Balanced, and Safest alternatives in a Markdown table, identify the most dangerous corridor segments, check terrain difficulty tolerance (${routePlan.maxAcceptableDifficulty}/100), and recommend whether we should switch routes.`,
        'quick-action',
      );
    } else if (action === 'resources') {
      void sendQuestion(
        `Check mission survival resources for ${missionState.crewSize} astronaut(s) over ${timing.totalMissionDurationHr.toFixed(2)} hours (${timing.totalMissionDurationSols.toFixed(2)} sols). Compare required vs loaded Oxygen, Energy, and Water with exact formulas, evaluate the +10%, +20%, and +30% emergency duration scenarios in a table, check Readiness (${missionReadiness.score}/100 - ${missionReadiness.classification}), and recommend any supply or reserve adjustments.`,
        'quick-action',
      );
    } else if (action === 'hazards') {
      void sendQuestion(
        `Identify all nearby terrain and corridor hazards in ${selectedLocation.name} using Terrain Intelligence, Hazard Detection, and dangerous route segments. Highlight CRITICAL and HIGH risk zones with warning callouts, distinguish NASA baselines from derived/simulated grid metrics, and provide specific mitigations.`,
        'quick-action',
      );
    } else if (action === 'science') {
      void sendQuestion(
        `Find and prioritize scientific opportunities in ${selectedLocation.name} using Science Discovery Explorer data. Include prototype priority scores, geological categories, water evidence, NASA missions/instruments, and recommend targets with the best balance of safety and scientific return.`,
        'quick-action',
      );
    } else if (action === 'risk-analysis') {
      void sendQuestion(
        `Conduct a comprehensive Mission Risk Analysis for our active mission "${missionState.missionName}" in ${selectedLocation.name} (${activeRoute.label}). Evaluate all 9 dimensions: (1) terrain difficulty, (2) slope exposure, (3) surface roughness, (4) crater proximity, (5) hazard distribution along the route, (6) resource sufficiency, (7) mission duration, (8) emergency reserves, and (9) scientific objectives. Structure your response under the 5 headings: Overall Assessment, Major Risks, Supporting Evidence, Recommended Actions, and Remaining Uncertainties.`,
        'risk-analysis',
      );
    } else {
      setShowSummaryDrawer(true);
      void sendQuestion(
        `Generate a complete structured Mission Summary covering Mission Overview, Route Assessment, Terrain Conditions, Hazard Warnings, Resource Requirements (O2, energy, water, emergency reserves, readiness), Scientific Opportunities, Recommendations, and Data Limitations.`,
        'summary',
      );
    }
  };

  const handleOpenWhatIf = () => {
    setShowWhatIfPanel(true);
    setTimeout(() => {
      whatIfSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleApplyWhatIfToMission = () => {
    if (!onApplyWhatIfScenario || !whatIfOutcome.isModified) return;
    onApplyWhatIfScenario({
      survivalInputs: whatIfOutcome.simulatedInputs,
      routePreference: whatIfOutcome.inputs.routePreference,
    });
    setWhatIfAppliedBanner(
      `Applied What-If scenario (${whatIfOutcome.inputs.astronautCount} crew, ${whatIfOutcome.inputs.routePreference.toUpperCase()} route @ ${whatIfOutcome.inputs.walkingSpeedKmh.toFixed(1)} km/h, ${whatIfOutcome.simulatedSurvival.effectiveMissionDurationHr.toFixed(2)} hr) to Active Central Mission State.`,
    );
  };

  const handleRecommendationAction = (rec: SmartRecommendation) => {
    if (rec.actionType === 'switch-route' && rec.targetRouteId && onSelectRouteId) {
      onSelectRouteId(rec.targetRouteId);
      return;
    }
    if (rec.actionType === 'open-what-if') {
      handleOpenWhatIf();
      return;
    }
    if (rec.actionType === 'navigate' && rec.targetSection && onNavigate) {
      onNavigate(rec.targetSection);
      return;
    }
    void sendQuestion(rec.promptHint, 'chat');
  };

  const handleClearConversation = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        text: '',
        timestamp: new Date().toLocaleTimeString(),
        model: 'System Grounding',
      },
    ]);
  };

  const handleCopyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard API may be unavailable in restricted iframe contexts
    }
  };

  const latestAssistantAnswer = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.id !== 'welcome');
    return last?.text;
  }, [messages]);

  const localSummaryMarkdown = useMemo(
    () => buildMissionSummaryMarkdown(missionState, latestAssistantAnswer),
    [missionState, latestAssistantAnswer],
  );

  const handleExportPdf = () => {
    const snapshot = createMissionSnapshot(missionState, latestAssistantAnswer);
    const result = downloadMissionSummaryPdf(snapshot);
    if (!result.ok) {
      setValidationErrors(result.errors);
      return;
    }
    setValidationErrors([]);
    setLastExportMeta({
      snapshotId: result.snapshotId,
      generatedAtIso: result.generatedAtIso,
    });
  };

  const safestRoute = routePlan.routes.find((r) => r.profile === 'safest');
  const showSwitchToSafest =
    onSelectRouteId &&
    safestRoute &&
    activeRoute.id !== safestRoute.id &&
    activeRoute.safetyScore < safestRoute.safetyScore;

  const effectiveWhatIfDurationDisplay =
    whatIfInput.durationOverrideHr !== null
      ? whatIfInput.durationOverrideHr
      : whatIfOutcome.simulatedSurvival.effectiveMissionDurationHr;

  return (
    <div className="mission-assistant-view flex-1 flex-grow w-full min-w-0 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 border-b border-white/10 pb-4 w-full">
        <div className="flex-1 min-w-0 space-y-1.5">
          <h1 className="text-2xl font-display font-bold text-white">AI Mission Assistant</h1>
          <p className="text-xs text-slate-400 max-w-4xl">
            Context-aware Gemini mission advisor connected directly to Central Mission State across Mars Explorer, Terrain Intelligence, Hazard Detection, Smart Route Planner, Survival Calculator, Science Explorer, and NASA Data Centre.
          </p>
          <div className="pt-0.5">
            <ProvenanceTag type="DERIVED CALCULATION" detail="Central Mission State" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            className={`px-2.5 py-1 rounded border text-[11px] font-mono whitespace-nowrap ${
              geminiConfigured === true
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : geminiConfigured === false
                  ? 'border-red-500/40 bg-red-500/15 text-red-300'
                  : 'border-white/15 bg-[#0D1016] text-slate-300'
            }`}
          >
            {geminiConfigured === true
              ? 'Gemini Live (gemini-4-hydrogen)'
              : geminiConfigured === false
                ? 'Gemini Key Not Set'
                : 'Checking Gemini Status'}
          </span>
          <button
            type="button"
            onClick={handleExportPdf}
            className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-mono font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5" />
            Download PDF Summary
          </button>
        </div>
      </div>

      {/* Pre-export Validation Error Banner */}
      {validationErrors.length > 0 && (
        <div
          role="alert"
          className="p-3.5 rounded bg-red-500/12 border border-red-500/45 text-xs text-red-200 space-y-1.5"
        >
          <div className="font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5 text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Report Export Blocked — Pre-Export Validation Failed
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-[11px] font-mono">
            {validationErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Last Verified Snapshot Confirmation */}
      {lastExportMeta && validationErrors.length === 0 && (
        <div className="px-3.5 py-2.5 rounded bg-emerald-500/10 border border-emerald-500/35 text-[11px] font-mono text-emerald-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Mission Summary PDF exported &amp; verified against Central Mission State · Snapshot{' '}
              <strong className="text-white">{lastExportMeta.snapshotId}</strong>
            </span>
          </div>
          <span className="text-slate-400">{lastExportMeta.generatedAtIso}</span>
        </div>
      )}

      {/* Live Cross-Module Context Bar (Responsive Flex-Wrap Mission Stats) */}
      <div className="flex flex-wrap gap-2.5 w-full">
        <button
          type="button"
          onClick={() => onNavigate?.('mars-explorer')}
          className="flex-1 min-w-[180px] text-left p-3 rounded bg-[#0D1016] hover:border-[#E85D2A]/60 border border-white/10 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <Compass className="w-3 h-3 text-[#E85D2A]" />
            Mars Region
          </div>
          <div className="text-xs font-semibold text-white mt-0.5 truncate">
            {selectedLocation.name}
          </div>
          <div className="text-[10px] font-mono text-slate-400 tabular-nums">
            {selectedLocation.lat.toFixed(2)}°, {selectedLocation.lon.toFixed(2)}° ·{' '}
            {livePdsProducts.length} PDS footprint(s)
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate?.('route-planner')}
          className="flex-1 min-w-[180px] text-left p-3 rounded bg-[#0D1016] hover:border-[#E85D2A]/60 border border-white/10 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <Route className="w-3 h-3 text-cyan-400" />
            Active A* Route
          </div>
          <div className="text-xs font-semibold text-white mt-0.5 truncate">
            {activeRoute.label}
          </div>
          <div className="text-[10px] font-mono text-cyan-300 tabular-nums">
            {missionState.distanceKm.toFixed(2)} km · Safety {missionState.safetyScore}/100
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate?.('hazard-detection')}
          className="flex-1 min-w-[180px] text-left p-3 rounded bg-[#0D1016] hover:border-[#E85D2A]/60 border border-white/10 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-amber-400" />
            Hazards &amp; Terrain
          </div>
          <div className="text-xs font-semibold text-white mt-0.5 tabular-nums">
            On Route: {activeRoute.hazardExposure.criticalSectionCount + activeRoute.hazardExposure.highSectionCount} Crit/High
          </div>
          <div className="text-[10px] font-mono text-amber-300 tabular-nums">
            Region: {highOrCriticalCount} Crit/High · {missionState.hazardRisk.avoidedHazardZonesCount} avoided
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate?.('survival-calculator')}
          className="flex-1 min-w-[180px] text-left p-3 rounded bg-[#0D1016] hover:border-[#E85D2A]/60 border border-white/10 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <Zap className="w-3 h-3 text-emerald-400" />
            Survival &amp; Readiness
          </div>
          <div className="text-xs font-semibold text-white mt-0.5 tabular-nums">
            {missionState.oxygen.totalRequiredKg.toFixed(2)} kg O2 ·{' '}
            {missionState.water.totalRequiredL.toFixed(1)} L
          </div>
          <div
            className={`text-[10px] font-mono font-semibold ${
              missionReadiness.hasInsufficientResource
                ? 'text-red-400'
                : missionReadiness.overallResourceStatus === 'LIMITED'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            }`}
          >
            {missionReadiness.overallResourceStatus} ·{' '}
            {missionState.energy.totalRequiredKwh.toFixed(1)} kWh · {missionReadiness.score}/100
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate?.('science-explorer')}
          className="flex-1 min-w-[180px] text-left p-3 rounded bg-[#0D1016] hover:border-[#E85D2A]/60 border border-white/10 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <FlaskConical className="w-3 h-3 text-cyan-300" />
            Science Discovery
          </div>
          <div className="text-xs font-semibold text-white mt-0.5 tabular-nums">
            {nearbyScience.length} Sector Target(s)
          </div>
          <div className="text-[10px] font-mono text-slate-400 truncate">
            {nearbyScience[0]?.title || 'No local catalog site'}
          </div>
        </button>
      </div>

      {/* Insufficient Resource Warning Callout */}
      {missionReadiness.hasInsufficientResource && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/40 text-xs text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-mono font-semibold text-red-300">
              {missionReadiness.classification} (Score {missionReadiness.score}/100)
            </div>
            <div className="text-[11px] font-mono">
              {missionReadiness.warnings[0] ||
                `Insufficient loaded supplies for: ${missionReadiness.insufficientResources.join(', ')}.`}
            </div>
          </div>
        </div>
      )}

      {/* Quick Mission Actions + Risk Analysis + What-If Toggle */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#E85D2A]" />
            Quick Mission Actions (Cross-Module Advisor)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showSwitchToSafest && (
              <button
                type="button"
                onClick={() => onSelectRouteId(safestRoute.id)}
                className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 transition-colors"
              >
                Apply Safer Route ({safestRoute.safetyScore}/100 Safety)
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowWhatIfPanel((v) => !v)}
              className={`px-2.5 py-1 rounded border text-[11px] font-mono flex items-center gap-1 transition-colors ${
                showWhatIfPanel || whatIfOutcome.isModified
                  ? 'bg-[#E85D2A]/15 border-[#E85D2A]/50 text-[#E85D2A]'
                  : 'bg-[#07090E] hover:bg-white/10 border-white/15 text-amber-300'
              }`}
            >
              <Sliders className="w-3 h-3" />
              {showWhatIfPanel ? 'Hide What-If Simulator' : 'What-If Simulator'}
              {whatIfOutcome.isModified && ' (Modified)'}
            </button>
            <button
              type="button"
              onClick={() => setShowSummaryDrawer((v) => !v)}
              className="px-2.5 py-1 rounded bg-[#07090E] hover:bg-white/10 border border-white/15 text-[11px] font-mono text-cyan-300 flex items-center gap-1"
            >
              <FileText className="w-3 h-3" />
              {showSummaryDrawer ? 'Hide Summary Dossier' : 'Mission Summary Dossier'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleQuickAction('risk-analysis')}
            className="px-3 py-2 rounded bg-amber-500/12 hover:bg-amber-500/22 border border-amber-500/45 text-xs font-semibold text-amber-200 flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Mission Risk Analysis</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleQuickAction('route')}
            className="px-3 py-2 rounded bg-[#080A0F] hover:border-[#E85D2A] border border-white/10 text-xs font-medium text-white flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Route className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">Analyse Current Route</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleQuickAction('resources')}
            className="px-3 py-2 rounded bg-[#080A0F] hover:border-[#E85D2A] border border-white/10 text-xs font-medium text-white flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Check Mission Resources</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleQuickAction('hazards')}
            className="px-3 py-2 rounded bg-[#080A0F] hover:border-[#E85D2A] border border-white/10 text-xs font-medium text-white flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Mountain className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Identify Nearby Hazards</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleQuickAction('science')}
            className="px-3 py-2 rounded bg-[#080A0F] hover:border-[#E85D2A] border border-white/10 text-xs font-medium text-white flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <FlaskConical className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span className="truncate">Scientific Opportunities</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleQuickAction('summary')}
            className="px-3 py-2 rounded bg-[#E85D2A]/15 hover:bg-[#E85D2A]/25 border border-[#E85D2A]/60 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-[#E85D2A] shrink-0" />
            <span className="truncate">Generate Summary</span>
          </button>
        </div>
      </div>

      {/* Phase 4: Interactive What-If Mission Simulator */}
      {showWhatIfPanel && (
        <div
          ref={whatIfSectionRef}
          className="bg-[#0D1016] border border-[#E85D2A]/45 rounded p-5 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-display font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-[#E85D2A]" />
                  What-If Mission Simulator
                </h2>
                <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/45 text-[10px] font-mono font-bold uppercase text-amber-300">
                  SIMULATED SCENARIO
                </span>
                {whatIfOutcome.isModified && (
                  <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-[10px] font-mono text-cyan-300">
                    Unsaved Hypothetical Changes
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Test parameter changes using the live A* route engine and survival calculator without altering your active mission unless you click Confirm &amp; Apply.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setWhatIfInput(createInitialWhatIfInput(missionState));
                  setWhatIfAppliedBanner(null);
                }}
                className="px-2.5 py-1.5 rounded bg-[#080A0F] hover:bg-white/10 border border-white/15 text-[11px] font-mono text-slate-300 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to Active
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  void sendQuestion(
                    whatIfOutcome.isModified
                      ? `Evaluate this SIMULATED SCENARIO vs our Original Active Mission in a Markdown table (Route, Duration, O2, Energy, Water, Readiness, and New Warnings): Crew=${whatIfOutcome.inputs.astronautCount}, Route=${whatIfOutcome.inputs.routePreference}, Speed=${whatIfOutcome.inputs.walkingSpeedKmh.toFixed(1)} km/h, Duration=${whatIfOutcome.simulatedSurvival.effectiveMissionDurationHr.toFixed(2)} hr, Available O2=${whatIfOutcome.inputs.availableOxygenSupplyKg} kg, Energy=${whatIfOutcome.inputs.availableEnergySupplyKwh} kWh, Water=${whatIfOutcome.inputs.availableWaterSupplyL} L.`
                      : `Simulate what happens to our active mission (${missionState.crewSize} crew, ${timing.totalMissionDurationHr.toFixed(2)} hr, ${activeRoute.label}) if duration increases by +2 hours or crew increases, and recommend whether we need reserve adjustments.`,
                    'what-if',
                  )
                }
                className="px-3 py-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/45 text-[11px] font-mono font-semibold text-cyan-200 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                Ask Gemini About Scenario
              </button>
              {onApplyWhatIfScenario && (
                <button
                  type="button"
                  disabled={!whatIfOutcome.isModified}
                  onClick={handleApplyWhatIfToMission}
                  className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] disabled:opacity-40 text-[11px] font-mono font-semibold text-white"
                >
                  Confirm &amp; Apply to Active Mission
                </button>
              )}
            </div>
          </div>

          {whatIfAppliedBanner && (
            <div className="px-3 py-2 rounded bg-emerald-500/12 border border-emerald-500/40 text-xs font-mono text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{whatIfAppliedBanner}</span>
            </div>
          )}

          {/* Controls Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Crew Size (Astronauts)
              </span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={whatIfInput.astronautCount}
                onChange={(e) =>
                  setWhatIfInput((prev) => ({
                    ...prev,
                    astronautCount: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              />
            </label>

            <label className="block p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Walking Speed (km/h)
              </span>
              <input
                type="number"
                min={0.8}
                max={6.0}
                step={0.2}
                value={whatIfInput.walkingSpeedKmh}
                onChange={(e) =>
                  setWhatIfInput((prev) => ({
                    ...prev,
                    walkingSpeedKmh: Math.max(0.8, Math.min(6.0, Number(e.target.value) || 3.2)),
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              />
            </label>

            <label className="block p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Route Preference
              </span>
              <select
                value={whatIfInput.routePreference}
                onChange={(e) =>
                  setWhatIfInput((prev) => ({
                    ...prev,
                    routePreference: e.target.value as RoutePreference,
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              >
                <option value="safest">Safest (Lowest Hazard)</option>
                <option value="balanced">Balanced (Safety + Distance)</option>
                <option value="shortest">Shortest (Minimum Distance)</option>
              </select>
            </label>

            <div className="p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase text-slate-400">
                  Mission Duration (hr)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setWhatIfInput((prev) => ({
                      ...prev,
                      durationOverrideHr: null,
                    }))
                  }
                  className={`text-[10px] font-mono underline ${
                    whatIfInput.durationOverrideHr === null ? 'text-cyan-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {whatIfInput.durationOverrideHr === null ? 'Engine-Derived' : 'Auto'}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0.5}
                  max={72}
                  step={0.5}
                  value={Number(effectiveWhatIfDurationDisplay.toFixed(2))}
                  onChange={(e) =>
                    setWhatIfInput((prev) => ({
                      ...prev,
                      durationOverrideHr: Math.max(0.5, Number(e.target.value) || 0.5),
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
                />
                <button
                  type="button"
                  onClick={() =>
                    setWhatIfInput((prev) => ({
                      ...prev,
                      durationOverrideHr: Number(
                        (
                          (prev.durationOverrideHr ??
                            whatIfOutcome.simulatedSurvival.effectiveMissionDurationHr) + 2
                        ).toFixed(2),
                      ),
                    }))
                  }
                  className="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-white shrink-0"
                  title="Add +2 hours"
                >
                  +2h
                </button>
              </div>
            </div>

            <label className="block p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Available O2 Supply (kg)
              </span>
              <input
                type="number"
                min={0}
                max={500}
                step={0.5}
                value={whatIfInput.availableOxygenSupplyKg}
                onChange={(e) =>
                  setWhatIfInput((prev) => ({
                    ...prev,
                    availableOxygenSupplyKg: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              />
            </label>

            <label className="block p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Available Energy (kWh)
              </span>
              <input
                type="number"
                min={0}
                max={500}
                step={1}
                value={whatIfInput.availableEnergySupplyKwh}
                onChange={(e) =>
                  setWhatIfInput((prev) => ({
                    ...prev,
                    availableEnergySupplyKwh: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              />
            </label>

            <label className="block p-3 rounded bg-[#080A0F] border border-white/10 space-y-1.5 sm:col-span-2">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Available Water Supply (L)
              </span>
              <input
                type="number"
                min={0}
                max={500}
                step={1}
                value={whatIfInput.availableWaterSupplyL}
                onChange={(e) =>
                  setWhatIfInput((prev) => ({
                    ...prev,
                    availableWaterSupplyL: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              />
            </label>
          </div>

          {/* Original vs Modified Comparison Table */}
          <div className="overflow-x-auto rounded border border-white/10">
            <table className="w-full text-left text-[11px] font-mono border-collapse">
              <thead className="bg-[#080A0F] text-slate-400 border-b border-white/10">
                <tr>
                  <th className="px-3 py-2">Metric</th>
                  <th className="px-3 py-2">Original Active Mission</th>
                  <th className="px-3 py-2 text-amber-300">Modified (SIMULATED SCENARIO)</th>
                  <th className="px-3 py-2">Difference (Δ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-slate-200 tabular-nums">
                <tr>
                  <td className="px-3 py-2 text-slate-400">Route / Distance / Safety</td>
                  <td className="px-3 py-2">
                    {activeRoute.profile.toUpperCase()} · {missionState.distanceKm.toFixed(2)} km ·{' '}
                    {missionState.safetyScore}/100
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">
                    {whatIfOutcome.simulatedRoute.profile.toUpperCase()} ·{' '}
                    {whatIfOutcome.simulatedRoute.distanceKm.toFixed(2)} km ·{' '}
                    {whatIfOutcome.simulatedRoute.safetyScore}/100
                  </td>
                  <td className="px-3 py-2">
                    {formatSigned(whatIfOutcome.deltas.distanceKm, 'km')} ·{' '}
                    {formatSigned(whatIfOutcome.deltas.safetyScore, 'pts', 0)}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-400">Effective Mission Duration</td>
                  <td className="px-3 py-2">
                    {timing.totalMissionDurationHr.toFixed(2)} hr (
                    {timing.totalMissionDurationSols.toFixed(2)} sols)
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">
                    {whatIfOutcome.simulatedSurvival.effectiveMissionDurationHr.toFixed(2)} hr (
                    {whatIfOutcome.simulatedSurvival.effectiveMissionDurationSols.toFixed(2)} sols)
                  </td>
                  <td className="px-3 py-2">{formatSigned(whatIfOutcome.deltas.durationHr, 'hr')}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-400">Oxygen Required &amp; Margin</td>
                  <td className="px-3 py-2">
                    {missionState.oxygen.totalRequiredKg.toFixed(2)} kg (Margin{' '}
                    {missionState.oxygen.marginKg.toFixed(2)} kg · {missionState.oxygen.status})
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">
                    {whatIfOutcome.simulatedSurvival.totalOxygenRequiredKg.toFixed(2)} kg (Margin{' '}
                    {whatIfOutcome.simulatedSurvival.remainingOxygenReserveKg.toFixed(2)} kg ·{' '}
                    {whatIfOutcome.simulatedSurvival.oxygenStatus})
                  </td>
                  <td
                    className={`px-3 py-2 ${
                      whatIfOutcome.deltas.oxygenMarginKg < 0 ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatSigned(whatIfOutcome.deltas.oxygenRequiredKg, 'kg req')} (
                    {formatSigned(whatIfOutcome.deltas.oxygenMarginKg, 'kg margin')})
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-400">Energy Required &amp; Margin</td>
                  <td className="px-3 py-2">
                    {missionState.energy.totalRequiredKwh.toFixed(2)} kWh (Margin{' '}
                    {missionState.energy.marginKwh.toFixed(2)} kWh · {missionState.energy.status})
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">
                    {whatIfOutcome.simulatedSurvival.totalEnergyRequiredKwh.toFixed(2)} kWh (Margin{' '}
                    {whatIfOutcome.simulatedSurvival.remainingEnergyReserveKwh.toFixed(2)} kWh ·{' '}
                    {whatIfOutcome.simulatedSurvival.energyStatus})
                  </td>
                  <td
                    className={`px-3 py-2 ${
                      whatIfOutcome.deltas.energyMarginKwh < 0 ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatSigned(whatIfOutcome.deltas.energyRequiredKwh, 'kWh req')} (
                    {formatSigned(whatIfOutcome.deltas.energyMarginKwh, 'kWh margin')})
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-400">Water Required &amp; Margin</td>
                  <td className="px-3 py-2">
                    {missionState.water.totalRequiredL.toFixed(2)} L (Margin{' '}
                    {missionState.water.marginL.toFixed(2)} L · {missionState.water.status})
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">
                    {whatIfOutcome.simulatedSurvival.totalWaterRequiredL.toFixed(2)} L (Margin{' '}
                    {whatIfOutcome.simulatedSurvival.remainingWaterReserveL.toFixed(2)} L ·{' '}
                    {whatIfOutcome.simulatedSurvival.waterStatus})
                  </td>
                  <td
                    className={`px-3 py-2 ${
                      whatIfOutcome.deltas.waterMarginL < 0 ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatSigned(whatIfOutcome.deltas.waterRequiredL, 'L req')} (
                    {formatSigned(whatIfOutcome.deltas.waterMarginL, 'L margin')})
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-400">Readiness Status</td>
                  <td className="px-3 py-2">
                    {missionReadiness.score}/100 ({missionReadiness.classification})
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">
                    {whatIfOutcome.simulatedSurvival.missionReadinessScore}/100 (
                    {whatIfOutcome.simulatedSurvival.readinessClassification})
                  </td>
                  <td
                    className={`px-3 py-2 ${
                      whatIfOutcome.deltas.readinessScore < 0 ? 'text-red-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatSigned(whatIfOutcome.deltas.readinessScore, 'pts', 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {(whatIfOutcome.newWarnings.length > 0 || whatIfOutcome.resolvedWarnings.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {whatIfOutcome.newWarnings.length > 0 && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/40 text-xs space-y-1">
                  <div className="font-mono font-semibold text-red-300 uppercase text-[10px]">
                    New Warnings in SIMULATED SCENARIO
                  </div>
                  <ul className="list-disc pl-4 text-[11px] text-red-200 space-y-0.5">
                    {whatIfOutcome.newWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {whatIfOutcome.resolvedWarnings.length > 0 && (
                <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/35 text-xs space-y-1">
                  <div className="font-mono font-semibold text-emerald-300 uppercase text-[10px]">
                    Resolved Warnings in SIMULATED SCENARIO
                  </div>
                  <ul className="list-disc pl-4 text-[11px] text-emerald-200 space-y-0.5">
                    {whatIfOutcome.resolvedWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Phase 5: Evidence-Based Smart Recommendations */}
      {smartRecommendations.length > 0 && (
        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-[#E85D2A]" />
              Evidence-Based Smart Recommendations ({smartRecommendations.length})
            </h2>
            <span className="text-[10px] font-mono text-slate-400">
              Generated strictly from verified route, terrain, survival &amp; science engine metrics
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {smartRecommendations.map((rec) => {
              const badgeCls =
                rec.severity === 'CRITICAL'
                  ? 'bg-red-500/15 border-red-500/45 text-red-300'
                  : rec.severity === 'WARNING'
                    ? 'bg-amber-500/15 border-amber-500/45 text-amber-300'
                    : rec.severity === 'OPPORTUNITY'
                      ? 'bg-cyan-500/15 border-cyan-500/45 text-cyan-300'
                      : 'bg-white/10 border-white/20 text-slate-300';
              return (
                <div
                  key={rec.id}
                  className="p-3.5 rounded bg-[#080A0F] border border-white/10 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${badgeCls}`}
                      >
                        {rec.severity}
                      </span>
                      <ProvenanceTag type={rec.provenance} />
                    </div>
                    <div className="text-xs font-semibold text-white">{rec.title}</div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{rec.reason}</p>
                    <div className="p-2 rounded bg-[#0D1016] border border-white/[0.06] text-[10px] font-mono text-slate-400 leading-relaxed">
                      {rec.supportingData}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.06]">
                    {rec.actionLabel && (
                      <button
                        type="button"
                        onClick={() => handleRecommendationAction(rec)}
                        className="px-2.5 py-1 rounded bg-[#E85D2A]/15 hover:bg-[#E85D2A]/25 border border-[#E85D2A]/50 text-[10px] font-mono font-semibold text-white transition-colors"
                      >
                        {rec.actionLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void sendQuestion(rec.promptHint, 'chat')}
                      className="px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[10px] font-mono text-cyan-300 disabled:opacity-50 transition-colors"
                    >
                      Ask Advisor
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expandable Structured Mission Summary Generator & PDF Export */}
      {showSummaryDrawer && (
        <div className="bg-[#0D1016] border border-cyan-500/35 rounded p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div>
              <h2 className="text-sm font-display font-semibold text-white">
                Structured Mission Summary Generator
              </h2>
              <p className="text-xs text-slate-400">
                Compiled live from Central Mission State (Route Planner, Terrain &amp; Hazard Engines, Survival Calculator, and Science Discovery Explorer).
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportPdf}
              className="px-3.5 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-mono font-semibold text-white flex items-center gap-1.5"
            >
              <FileDown className="w-3.5 h-3.5" />
              Export Synchronized PDF Report
            </button>
          </div>
          <div className="p-4 rounded bg-[#080A0F] border border-white/[0.08] max-h-[340px] overflow-y-auto text-xs text-slate-200 leading-relaxed">
            <MarkdownRenderer content={localSummaryMarkdown} />
          </div>
        </div>
      )}

      {/* Main Split: Chat Workspace + Suggested Questions & Safety Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Chat Interface */}
        <div className="lg:col-span-8 bg-[#0D1016] border border-white/10 rounded flex flex-col h-[580px]">
          <div className="px-4 py-2.5 border-b border-white/10 bg-[#080A0F] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-300 truncate">
              <Bot className="w-4 h-4 text-[#E85D2A] shrink-0" />
              <span className="truncate">
                Mission Advisory Channel · {selectedLocation.name} · {activeRoute.label}
              </span>
              {whatIfOutcome.isModified && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-[10px] text-amber-300 shrink-0">
                  SIMULATED SCENARIO attached
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleClearConversation}
              disabled={loading}
              className="px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[11px] font-mono text-slate-300 flex items-center gap-1 disabled:opacity-50 shrink-0"
            >
              <Trash2 className="w-3 h-3" />
              Clear Chat
            </button>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3.5 w-full">
            {messages.map((m) => {
              const renderedText = m.id === 'welcome' ? liveWelcomeText : m.text;
              return (
                <div
                  key={m.id}
                  className={`w-full rounded p-3.5 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#E85D2A]/15 border border-[#E85D2A]/45 text-white'
                      : m.role === 'error'
                        ? 'bg-red-500/10 border border-red-500/40 text-red-200'
                        : 'bg-[#080A0F] border border-white/10 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2 pb-1 border-b border-white/[0.06]">
                    <span>
                      {m.role === 'user'
                        ? 'Flight Crew'
                        : m.role === 'error'
                          ? 'API / System Error'
                          : `MARSWALK AI Advisor (${m.model || 'gemini-4-hydrogen'})`}{' '}
                      · {m.timestamp}
                    </span>
                    {m.role === 'assistant' && (
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(m.id, renderedText)}
                        className="text-slate-400 hover:text-white inline-flex items-center gap-1 normal-case"
                      >
                        {copiedId === m.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedId === m.id ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>

                  {m.role === 'user' || m.role === 'error' ? (
                    <div className="whitespace-pre-wrap">{renderedText}</div>
                  ) : (
                    <MarkdownRenderer content={renderedText} />
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="w-full rounded p-3.5 bg-[#080A0F] border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                Querying Gemini with live route, terrain, hazard, survival, and NASA science context...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendQuestion(input, 'chat');
            }}
            className="p-3 border-t border-white/10 bg-[#080A0F] flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about route risks, dangerous segments, O2/energy/water, +2h extension, or NASA provenance..."
              aria-label="Ask Mission Assistant"
              className="flex-1 px-3 py-2 rounded bg-[#0D1016] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#E85D2A]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 rounded bg-[#E85D2A] hover:bg-[#d14e1e] disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </div>

        {/* Right Sidebar: Suggested Questions + Scientific Rules */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-2.5">
            <h2 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Suggested Mission Questions
            </h2>
            <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={loading}
                  onClick={() => void sendQuestion(q, 'chat')}
                  className="w-full text-left px-3 py-2 rounded bg-[#080A0F] hover:border-[#E85D2A]/60 border border-white/[0.08] text-xs text-slate-200 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#0D1016] border border-amber-500/30 rounded p-4 space-y-2">
            <div className="text-xs font-mono uppercase text-amber-300 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Scientific &amp; EVA Safety Rules
            </div>
            <ul className="text-[11px] text-slate-300 space-y-1.5 leading-relaxed list-disc pl-4">
              <li>
                Strictly distinguishes <strong>ACTUAL NASA OBSERVATION</strong>,{' '}
                <strong>PUBLISHED SCIENTIFIC DATASET</strong>,{' '}
                <strong>DERIVED CALCULATION</strong>,{' '}
                <strong>SIMULATED DEMONSTRATION</strong>, and{' '}
                <strong>SIMULATED SCENARIO</strong>.
              </li>
              <li>
                Explicitly states when live rover weather, raw MOLA elevation profiles, or 0.25 m/px HiRISE DTMs are unavailable rather than inventing telemetry.
              </li>
              <li>
                Does <span className="text-white font-semibold">not</span> certify any route or consumable plan as flight-ready for real astronauts.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-sm font-display font-bold text-white mt-3 mb-1.5 border-b border-white/10 pb-1">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xs font-display font-bold text-[#E85D2A] uppercase tracking-wider mt-3 mb-1">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-xs font-display font-semibold text-cyan-300 mt-2.5 mb-1">
            {children}
          </h3>
        ),
        p: ({ children }) => <p className="text-xs text-slate-200 mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="list-disc pl-4 space-y-1 mb-2 text-xs text-slate-200">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-4 space-y-1 mb-2 text-xs text-slate-200">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[#E85D2A] hover:underline"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded bg-white/10 text-cyan-300 font-mono text-[11px]">
            {children}
          </code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 p-2.5 rounded bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2.5 overflow-x-auto rounded border border-white/10">
            <table className="w-full text-left text-[11px] font-mono border-collapse">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-[#0D1016] text-slate-300 border-b border-white/10">{children}</thead>
        ),
        th: ({ children }) => <th className="px-2.5 py-1.5 font-semibold">{children}</th>,
        td: ({ children }) => (
          <td className="px-2.5 py-1.5 border-t border-white/[0.06] text-slate-200 tabular-nums">
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
