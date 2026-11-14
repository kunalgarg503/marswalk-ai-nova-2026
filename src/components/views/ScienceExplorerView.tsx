import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Bot,
  Check,
  Compass,
  Copy,
  Database,
  Download,
  Droplets,
  ExternalLink,
  FileText,
  FlaskConical,
  Map as MapIcon,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { MARTIAN_CRATERS, ROVER_EXPLORATION_SITES } from '../../data/marsFeatures';
import { planMartianRoute } from '../../engine/routePlanner';
import {
  compareDirectVsScienceRoute,
  computeRouteToSiteProximity,
  computeSciencePriority,
  findNearbyOpportunities,
  GEOLOGICAL_CATEGORIES,
  GEOLOGICAL_CATEGORY_META,
  recommendScienceRoutes,
  resolveSiteWaypoint,
  SCIENCE_OBJECTIVES,
} from '../../engine/scienceEngine';
import type {
  CentralMissionState,
  GeologicalFeatureCategory,
  LocalWaypoint,
  MarsLocation,
  NasaEndpointProbe,
  NasaEnvironmentResponse,
  NasaImageryItem,
  NavSection,
  PdsOrbitalProduct,
  RetrievalBadgeStatus,
  ScienceExplorationObjective,
  ScienceProvenanceClass,
  ScienceSite,
} from '../../types/mars';
import { ProvenanceTag } from '../ProvenanceTag';
import { TerrainMapCanvas } from '../TerrainMapCanvas';

interface ScienceExplorerViewProps {
  sites: ScienceSite[];
  locations: MarsLocation[];
  missionState: CentralMissionState;
  scienceStops: LocalWaypoint[];
  onSelectLocation: (loc: MarsLocation) => void;
  onAddScienceStop: (site: ScienceSite) => void;
  onRemoveScienceStop: (waypointId: string) => void;
  onClearScienceStops: () => void;
  onPlanScienceTarget: (locationId: string, waypointId?: string) => void;
  onNavigate: (section: NavSection) => void;
}

type ObservationAvailability = 'LIVE VERIFIED' | 'ARCHIVAL REFERENCE' | 'UNAVAILABLE';

const MISSION_INSTRUMENT_FILTERS = [
  'ALL',
  'Perseverance',
  'MRO',
  'HiRISE',
  'CTX',
  'CRISM',
  'THEMIS',
  'MOLA',
  'Mastcam-Z',
  'SuperCam',
  'PIXL',
  'SHERLOC',
] as const;

type MissionInstrumentFilter = (typeof MISSION_INSTRUMENT_FILTERS)[number];

interface ScienceChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  timestamp: string;
  model?: string;
}

function getProvenanceBadgeStyle(provenance: ScienceProvenanceClass): string {
  switch (provenance) {
    case 'NASA observation retrieved':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/45';
    case 'NASA archival reference':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-400/45';
    case 'Derived analysis':
      return 'bg-amber-500/15 text-amber-300 border-amber-400/45';
    case 'Simulated demonstration data':
      return 'bg-orange-500/15 text-orange-300 border-orange-400/45';
    case 'Unverified information':
      return 'bg-red-500/15 text-red-300 border-red-400/45';
  }
}

function ProvenanceClassBadge({
  provenance,
  sourceName,
  instrument,
  retrievalStatus,
  date,
}: {
  provenance: ScienceProvenanceClass;
  sourceName?: string;
  instrument?: string;
  retrievalStatus?: string;
  date?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
      <span
        className={`px-2 py-0.5 rounded border font-semibold ${getProvenanceBadgeStyle(provenance)}`}
      >
        {provenance}
      </span>
      {sourceName && (
        <span className="px-1.5 py-0.5 rounded bg-[#07090E] border border-white/10 text-slate-300">
          {sourceName}
        </span>
      )}
      {instrument && (
        <span className="px-1.5 py-0.5 rounded bg-[#07090E] border border-white/10 text-cyan-300">
          {instrument}
        </span>
      )}
      {retrievalStatus && (
        <span className="px-1.5 py-0.5 rounded bg-[#07090E] border border-white/10 text-slate-300">
          {retrievalStatus}
        </span>
      )}
      {date && (
        <span className="px-1.5 py-0.5 rounded bg-[#07090E] border border-white/10 text-slate-400">
          {date}
        </span>
      )}
    </div>
  );
}

function siteMatchesInstrumentFilter(site: ScienceSite, filter: MissionInstrumentFilter): boolean {
  if (filter === 'ALL') return true;
  const f = filter.toLowerCase();
  if (site.nasaMission.toLowerCase().includes(f)) return true;
  if (site.instrument.toLowerCase().includes(f)) return true;
  if (site.supportingDataset.toLowerCase().includes(f)) return true;
  if (site.missionConnections) {
    return site.missionConnections.some(
      (c) =>
        c.mission.toLowerCase().includes(f) ||
        c.instruments.some((inst) => inst.toLowerCase().includes(f)),
    );
  }
  return false;
}

export function ScienceExplorerView({
  sites,
  locations,
  missionState,
  scienceStops,
  onSelectLocation,
  onAddScienceStop,
  onRemoveScienceStop,
  onClearScienceStops,
  onPlanScienceTarget,
  onNavigate,
}: ScienceExplorerViewProps) {
  const selectedLocation = missionState.selectedLocation;
  const activeRoute = missionState.activeRoute;
  const routePlan = missionState.routePlan;
  const maxDifficulty = missionState.terrainDifficulty.maxAcceptableDifficulty;
  const walkingSpeedKmh = missionState.walkingSpeedKmh;

  const originWaypoint: LocalWaypoint = useMemo(() => {
    const matched = selectedLocation.localWaypoints.find(
      (w) =>
        w.id === missionState.startingLocation.id ||
        w.name === missionState.startingLocation.name ||
        w.name === routePlan.originName,
    );
    if (matched) return matched;
    return {
      id: missionState.startingLocation.id || 'active-origin',
      name: missionState.startingLocation.name || routePlan.originName,
      lat: routePlan.originLat,
      lon: routePlan.originLon,
      elevationM: selectedLocation.elevationM,
      localXKm: activeRoute.waypoints[0]?.xKm ?? selectedLocation.localWaypoints[0]?.localXKm ?? 12.5,
      localYKm: activeRoute.waypoints[0]?.yKm ?? selectedLocation.localWaypoints[0]?.localYKm ?? 12.5,
      featureType: 'Mission Origin',
      scienceValue: 'Route starting coordinate',
      missionSource: selectedLocation.name,
    };
  }, [selectedLocation, missionState.startingLocation, routePlan, activeRoute.waypoints]);

  const destWaypoint: LocalWaypoint = useMemo(() => {
    const matched = selectedLocation.localWaypoints.find(
      (w) =>
        w.id === missionState.destination.id ||
        w.name === missionState.destination.name ||
        w.name === routePlan.destinationName,
    );
    if (matched) return matched;
    const lastWp = activeRoute.waypoints[activeRoute.waypoints.length - 1];
    return {
      id: missionState.destination.id || 'active-dest',
      name: missionState.destination.name || routePlan.destinationName,
      lat: routePlan.destLat,
      lon: routePlan.destLon,
      elevationM: selectedLocation.elevationM,
      localXKm: lastWp?.xKm ?? selectedLocation.localWaypoints[1]?.localXKm ?? 12.5,
      localYKm: lastWp?.yKm ?? selectedLocation.localWaypoints[1]?.localYKm ?? 12.5,
      featureType: 'Mission Destination',
      scienceValue: 'Route destination coordinate',
      missionSource: selectedLocation.name,
    };
  }, [selectedLocation, missionState.destination, routePlan, activeRoute.waypoints]);

  // Filters — default Jezero Crater demonstration scope
  const [regionScope, setRegionScope] = useState<string>('jezero-crater');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | GeologicalFeatureCategory>('ALL');
  const [instrumentFilter, setInstrumentFilter] = useState<MissionInstrumentFilter>('ALL');
  const [waterOnly, setWaterOnly] = useState(false);
  const [roverOnly, setRoverOnly] = useState(false);
  const [scienceObjective, setScienceObjective] =
    useState<ScienceExplorationObjective>('explore-ancient-deltas');

  // Active target for Location Detail Panel
  const [selectedSiteId, setSelectedSiteId] = useState<string>('sci-jezero-delta');

  // Live NASA Science Data Feed state
  const [instrumentMode, setInstrumentMode] = useState<
    'auto' | 'perseverance' | 'curiosity' | 'hirise' | 'ctx' | 'crism'
  >('auto');
  const [obsItems, setObsItems] = useState<NasaImageryItem[]>([]);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsAvailability, setObsAvailability] = useState<ObservationAvailability>('LIVE VERIFIED');
  const [obsSourceLabel, setObsSourceLabel] = useState<string>('NASA Image & JPL Feeds');
  const [obsNote, setObsNote] = useState<string>('');
  const [obsRetrievedAt, setObsRetrievedAt] = useState<string>('');
  const [obsCached, setObsCached] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [endpointProbes, setEndpointProbes] = useState<Record<string, NasaEndpointProbe> | null>(
    null,
  );
  const [probesLoading, setProbesLoading] = useState(false);

  // Target-specific PDS ODE georeferenced HiRISE / CTX footprints
  const [pdsProducts, setPdsProducts] = useState<PdsOrbitalProduct[]>([]);
  const [pdsStatus, setPdsStatus] = useState<RetrievalBadgeStatus>('CONNECTED');
  const [pdsLoading, setPdsLoading] = useState(false);
  const [pdsError, setPdsError] = useState<string | null>(null);
  const [pdsRetrievedAt, setPdsRetrievedAt] = useState<string>('');

  // Environmental archive context (MEDA Jezero / REMS Gale)
  const [envData, setEnvData] = useState<NasaEnvironmentResponse | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);

  // Retry nonces
  const [retryNonce, setRetryNonce] = useState(0);
  const [pdsRetryNonce, setPdsRetryNonce] = useState(0);

  // Report controls
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);

  // Embedded AI Science Assistant state
  const [sciMessages, setSciMessages] = useState<ScienceChatMessage[]>([]);
  const [sciQuestion, setSciQuestion] = useState('');
  const [sciAsking, setSciAsking] = useState(false);

  // Filtered sites with 5-factor live route-aware scoring
  const filteredSites = useMemo(() => {
    return sites
      .filter((s) => (regionScope === 'ALL' ? true : s.locationId === regionScope))
      .filter((s) => (selectedCategory === 'ALL' ? true : s.geologicalCategory === selectedCategory))
      .filter((s) => siteMatchesInstrumentFilter(s, instrumentFilter))
      .filter((s) => (waterOnly ? s.waterEnvironmentEvidence === 'STRONG' : true))
      .filter((s) => (roverOnly ? s.roverSupport : true))
      .map((site) => ({
        site,
        priority: computeSciencePriority(site, scienceObjective, {
          route: activeRoute,
          location: selectedLocation,
        }),
      }))
      .sort((a, b) => b.priority.totalScore - a.priority.totalScore);
  }, [
    sites,
    regionScope,
    selectedCategory,
    instrumentFilter,
    waterOnly,
    roverOnly,
    scienceObjective,
    activeRoute,
    selectedLocation,
  ]);

  const activeSiteEntry = useMemo(() => {
    return (
      filteredSites.find((entry) => entry.site.id === selectedSiteId) ||
      filteredSites[0] || {
        site: sites[0],
        priority: computeSciencePriority(sites[0], scienceObjective, {
          route: activeRoute,
          location: selectedLocation,
        }),
      }
    );
  }, [filteredSites, selectedSiteId, sites, scienceObjective, activeRoute, selectedLocation]);

  const activeSite = activeSiteEntry.site;
  const activePriority = activeSiteEntry.priority;

  // Smart Route Planner integration: evaluate region for Science Explorer map & route recommendations
  const routeRegion = useMemo(() => {
    if (regionScope !== 'ALL') {
      return locations.find((l) => l.id === regionScope) || selectedLocation;
    }
    return locations.find((l) => l.id === activeSite.locationId) || selectedLocation;
  }, [regionScope, locations, selectedLocation, activeSite.locationId]);

  const routeOrigin = useMemo(() => {
    if (routeRegion.id === selectedLocation.id) return originWaypoint;
    return routeRegion.localWaypoints[0];
  }, [routeRegion, selectedLocation.id, originWaypoint]);

  const sectorRoutePlan = useMemo(() => {
    if (routeRegion.id === selectedLocation.id) {
      return routePlan;
    }
    const regionDest = routeRegion.localWaypoints[1] || routeRegion.localWaypoints[0];
    return planMartianRoute({
      location: routeRegion,
      originWaypoint: routeRegion.localWaypoints[0],
      destWaypoint: regionDest,
      viaWaypoints: [],
      objective: missionState.routePlan.objective,
      routePreference: missionState.routePreference,
      maxAcceptableDifficulty: maxDifficulty,
      walkingSpeedKmh,
    });
  }, [
    routeRegion,
    selectedLocation.id,
    routePlan,
    missionState.routePlan.objective,
    missionState.routePreference,
    maxDifficulty,
    walkingSpeedKmh,
  ]);

  const sectorActiveRoute = useMemo(() => {
    if (routeRegion.id === selectedLocation.id) return activeRoute;
    return (
      sectorRoutePlan.routes.find((r) => r.id === sectorRoutePlan.recommendedRouteId) ||
      sectorRoutePlan.routes[0]
    );
  }, [routeRegion.id, selectedLocation.id, activeRoute, sectorRoutePlan]);

  const sectorScienceSites = useMemo(
    () => sites.filter((s) => s.locationId === routeRegion.id),
    [sites, routeRegion.id],
  );

  // Regional targets sorted by corridor proximity to the active route
  const targetsByRouteProximity = useMemo(() => {
    return sites
      .filter((s) => s.locationId === selectedLocation.id)
      .map((site) => {
        const prox = computeRouteToSiteProximity(site, activeRoute);
        const pri = computeSciencePriority(site, scienceObjective, {
          route: activeRoute,
          location: selectedLocation,
        });
        const wp = resolveSiteWaypoint(site, selectedLocation);
        const isWaypoint = scienceStops.some((st) => st.id === wp.id);
        return {
          site,
          proximity: prox,
          priority: pri,
          waypoint: wp,
          isWaypoint,
        };
      })
      .sort((a, b) => a.proximity.minDistanceKm - b.proximity.minDistanceKm);
  }, [sites, selectedLocation, activeRoute, scienceObjective, scienceStops]);

  // Direct vs Science-Focused Route comparison for the currently inspected target (if in active region)
  const directVsScience = useMemo(() => {
    if (activeSite.locationId !== selectedLocation.id) return null;
    return compareDirectVsScienceRoute({
      location: selectedLocation,
      originWaypoint,
      destWaypoint,
      currentScienceStops: scienceStops,
      targetSite: activeSite,
      missionObjective: missionState.routePlan.objective,
      routePreference: missionState.routePreference,
      maxAcceptableDifficulty: maxDifficulty,
      survivalInputs: missionState.survivalInputs,
    });
  }, [
    activeSite,
    selectedLocation,
    originWaypoint,
    destWaypoint,
    scienceStops,
    missionState.routePlan.objective,
    missionState.routePreference,
    maxDifficulty,
    missionState.survivalInputs,
  ]);

  const routeRecommendationResult = useMemo(() => {
    return recommendScienceRoutes({
      location: routeRegion,
      originWaypoint: routeOrigin,
      sites,
      objective: scienceObjective,
      maxAcceptableDifficulty: maxDifficulty,
      walkingSpeedKmh,
      activeRoute: sectorActiveRoute,
    });
  }, [
    routeRegion,
    routeOrigin,
    sites,
    scienceObjective,
    maxDifficulty,
    walkingSpeedKmh,
    sectorActiveRoute,
  ]);

  const nearbyOpportunities = useMemo(() => {
    return findNearbyOpportunities(
      activeSite,
      locations,
      sites,
      ROVER_EXPLORATION_SITES,
      MARTIAN_CRATERS,
    );
  }, [activeSite, locations, sites]);

  const fetchProbes = useCallback(async (forceRefresh = false) => {
    setProbesLoading(true);
    try {
      const r = await fetch(`/api/nasa/status${forceRefresh ? '?refresh=1' : ''}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { probes?: Record<string, NasaEndpointProbe> } | null;
      if (data?.probes) {
        setEndpointProbes(data.probes);
      }
    } catch (err) {
      console.warn('Failed to fetch NASA endpoint status:', err);
    } finally {
      setProbesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProbes(false);
  }, [fetchProbes]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/nasa/environment')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NasaEnvironmentResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setEnvData(data);
          setEnvError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEnvError(err instanceof Error ? err.message : 'Weather archive unreachable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPdsLoading(true);
    setPdsError(null);
    const qs = new URLSearchParams({
      lat: activeSite.lat.toFixed(4),
      lon: activeSite.lon.toFixed(4),
      site: activeSite.title,
    });
    if (pdsRetryNonce > 0) qs.set('refresh', '1');

    fetch(`/api/nasa/pds-products?${qs.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`PDS ODE proxy HTTP ${res.status}`);
        return (await res.json()) as {
          status: RetrievalBadgeStatus;
          retrievedAt: string;
          error?: string;
          products: PdsOrbitalProduct[];
        };
      })
      .then((data) => {
        if (cancelled) return;
        setPdsProducts(data.products || []);
        setPdsStatus(data.status || 'CONNECTED');
        setPdsRetrievedAt(data.retrievedAt || new Date().toISOString());
        setPdsError(data.error || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPdsProducts([]);
        setPdsStatus('UNAVAILABLE');
        setPdsError(err instanceof Error ? err.message : 'Failed to query PDS ODE');
      })
      .finally(() => {
        if (!cancelled) setPdsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSite.id, activeSite.lat, activeSite.lon, activeSite.title, pdsRetryNonce]);

  useEffect(() => {
    let cancelled = false;
    setObsLoading(true);
    setObsNote('');
    setBrokenImages({});

    let queryParams = '';
    if (instrumentMode === 'perseverance') {
      queryParams = '&rover=perseverance';
    } else if (instrumentMode === 'curiosity') {
      queryParams = '&rover=curiosity';
    } else if (instrumentMode === 'hirise' || instrumentMode === 'ctx' || instrumentMode === 'crism') {
      queryParams = `&instrument=${instrumentMode}`;
    } else {
      if (activeSite.locationId === 'jezero-crater') {
        queryParams = '&rover=perseverance';
      } else if (activeSite.locationId === 'gale-crater') {
        queryParams = '&rover=curiosity';
      } else if (activeSite.instrument.toUpperCase().includes('CRISM')) {
        queryParams = '&instrument=crism';
      } else {
        queryParams = '&instrument=hirise';
      }
    }

    const refreshParam = retryNonce > 0 ? '&refresh=1' : '';

    fetch(`/api/nasa/imagery?site=${encodeURIComponent(activeSite.locationName)}${queryParams}${refreshParam}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          apiSource?: string;
          fallbackMode?: boolean;
          fallbackReason?: string;
          cached?: boolean;
          retrievedAt?: string;
          items?: NasaImageryItem[];
        };
      })
      .then((data) => {
        if (cancelled) return;
        const items = data.items || [];
        setObsItems(items);
        setObsSourceLabel(data.apiSource || 'NASA Science Archive');
        setObsRetrievedAt(data.retrievedAt || new Date().toISOString());
        setObsCached(Boolean(data.cached));
        if (items.length === 0) {
          setObsAvailability('UNAVAILABLE');
          setObsNote(data.fallbackReason || 'No matching observations returned by upstream endpoint.');
        } else if (data.fallbackMode || items.every((i) => i.isFallback)) {
          setObsAvailability('ARCHIVAL REFERENCE');
          setObsNote(
            data.fallbackReason ||
              'Live NASA image endpoint unavailable or returned empty; showing curated PDS archival reference.',
          );
        } else {
          setObsAvailability('LIVE VERIFIED');
          setObsNote('');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setObsItems([]);
        setObsAvailability('UNAVAILABLE');
        setObsSourceLabel('NASA Public Science API');
        setObsNote(
          err instanceof Error
            ? `Observation feed inaccessible (${err.message}).`
            : 'Observation feed currently unavailable.',
        );
      })
      .finally(() => {
        if (!cancelled) setObsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSite.id, activeSite.locationId, activeSite.locationName, activeSite.instrument, instrumentMode, retryNonce]);

  const activeSiteWaypoint = useMemo(() => {
    const loc = locations.find((l) => l.id === activeSite.locationId);
    return loc ? resolveSiteWaypoint(activeSite, loc) : null;
  }, [activeSite, locations]);

  const activeSiteIsWaypoint = Boolean(
    activeSiteWaypoint && scienceStops.some((st) => st.id === activeSiteWaypoint.id),
  );

  // Dashboard summary metrics for current region scope
  const scopeSites = useMemo(
    () => (regionScope === 'ALL' ? sites : sites.filter((s) => s.locationId === regionScope)),
    [sites, regionScope],
  );
  const ancientWaterCount = useMemo(
    () => scopeSites.filter((s) => s.waterEnvironmentEvidence === 'STRONG').length,
    [scopeSites],
  );
  const roverVerifiedCount = useMemo(
    () => scopeSites.filter((s) => s.roverSupport).length,
    [scopeSites],
  );

  // Live provenance class for the observation feed
  const liveFeedProvenance: ScienceProvenanceClass =
    obsAvailability === 'LIVE VERIFIED'
      ? 'NASA observation retrieved'
      : obsAvailability === 'ARCHIVAL REFERENCE'
        ? 'NASA archival reference'
        : 'Unverified information';

  // Embedded AI Science Assistant request handler (grounded in real /api/assistant)
  const askScienceAssistant = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || sciAsking) return;

    const userMsg: ScienceChatMessage = {
      id: `sci-u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString(),
    };
    const nextMsgs = [...sciMessages, userMsg];
    setSciMessages(nextMsgs);
    setSciQuestion('');
    setSciAsking(true);

    const missionContext = {
      module: 'Science Discovery Explorer',
      activeMission: {
        missionName: missionState.missionName,
        regionName: selectedLocation.name,
        startingLocation: missionState.startingLocation.name,
        destination: missionState.destination.name,
        routePreference: missionState.routePreference,
        selectedRouteLabel: activeRoute.label,
        routeDistanceKm: activeRoute.distanceKm,
        estimatedDurationHr: missionState.timing.totalMissionDurationHr,
        safetyScore: activeRoute.safetyScore,
        riskLevel: activeRoute.overallRiskLevel,
        meanTerrainDifficulty: activeRoute.meanDifficulty,
        intermediateScienceWaypoints: missionState.scienceWaypoints,
        resourcesRequired: {
          oxygenKg: missionState.oxygen.totalRequiredKg,
          energyKwh: missionState.energy.totalRequiredKwh,
          waterL: missionState.water.totalRequiredL,
        },
        readinessScore: missionState.missionReadiness.score,
        readinessClassification: missionState.missionReadiness.classification,
      },
      currentlyInspectedScienceTarget: {
        id: activeSite.id,
        title: activeSite.title,
        locationName: activeSite.locationName,
        lat: activeSite.lat,
        lon: activeSite.lon,
        elevationM: activeSite.elevationM,
        geologicalCategory: activeSite.geologicalCategory,
        provenanceClass: activeSite.provenanceClass || 'NASA archival reference',
        confidenceLevel: activeSite.confidenceLevel,
        geologicalContext: activeSite.geologicalContext || 'Data not available',
        geologicalFeatures: activeSite.geologicalFeatures?.length
          ? activeSite.geologicalFeatures
          : 'Data not available',
        investigatorRationale: activeSite.investigatorRationale || 'Data not available',
        suggestedActivities: activeSite.suggestedActivities?.length
          ? activeSite.suggestedActivities
          : 'Data not available',
        limitations: activeSite.limitations || 'Data not available',
        supportingDataset: activeSite.supportingDataset,
        nasaMission: activeSite.nasaMission,
        instrument: activeSite.instrument,
        sourceDate: activeSite.sourceDate || 'Data not available',
        sourceUrl: activeSite.sourceUrl,
        missionConnections: activeSite.missionConnections || 'Data not available',
        sciencePriorityScore5Factor: activePriority,
        directVsScienceRouteImpact: directVsScience
          ? {
              deltaDistanceKm: directVsScience.deltaDistanceKm,
              deltaDurationHr: directVsScience.deltaDurationHr,
              deltaSafetyScore: directVsScience.deltaSafetyScore,
              deltaOxygenKg: directVsScience.deltaOxygenKg,
              deltaEnergyKwh: directVsScience.deltaEnergyKwh,
              deltaWaterL: directVsScience.deltaWaterL,
              deltaReadinessScore: directVsScience.deltaReadinessScore,
            }
          : 'Not on active route region grid',
      },
      allRegionalScienceTargetsWithRouteProximity: targetsByRouteProximity.map((t) => ({
        id: t.site.id,
        title: t.site.title,
        category: t.site.geologicalCategory,
        lat: t.site.lat,
        lon: t.site.lon,
        corridorDistanceKm: t.proximity.minDistanceKm,
        corridorStatus: t.priority.accessibilityStatus,
        priorityScore: t.priority.totalScore,
        isAddedAsWaypoint: t.isWaypoint,
        nasaMission: t.site.nasaMission,
        instrument: t.site.instrument,
        evidenceSummary: t.site.evidenceSummary,
        scientificSignificance: t.site.scientificSignificance,
        supportingDataset: t.site.supportingDataset,
        provenanceClass: t.site.provenanceClass || 'NASA archival reference',
      })),
      allCatalogedJezeroTargets: sites
        .filter((s) => s.locationId === 'jezero-crater')
        .map((s) => ({
          id: s.id,
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          geologicalCategory: s.geologicalCategory,
          provenanceClass: s.provenanceClass || 'NASA archival reference',
          nasaMission: s.nasaMission,
          instrument: s.instrument,
          supportingDataset: s.supportingDataset,
          evidenceSummary: s.evidenceSummary,
          scientificSignificance: s.scientificSignificance,
          sourceUrl: s.sourceUrl,
        })),
      retrievedNasaObservationsAndFeeds: {
        imageryStatus: obsAvailability,
        imagerySource: obsSourceLabel,
        imageryCount: obsItems.length,
        imageryTitles: obsItems.slice(0, 4).map((i) => `${i.title} (${i.mission} · ${i.instrument}, ${i.observationDate})`),
        pdsOdeStatus: pdsStatus,
        pdsFootprintsCount: pdsProducts.length,
        pdsProducts: pdsProducts.slice(0, 4).map((p) => `${p.productId} (${p.instrument}, ${p.observationDate})`),
        weatherArchiveMedaLatest: envData?.meda?.records?.[0] || null,
        weatherArchiveRemsLatest: envData?.rems?.records?.[0] || null,
      },
    };

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          mode: 'chat',
          missionContext,
          history: sciMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const payload = (await res.json()) as { answer?: string; error?: string; model?: string };
      if (!res.ok) {
        throw new Error(payload.error || `Assistant HTTP ${res.status}`);
      }
      setSciMessages([
        ...nextMsgs,
        {
          id: `sci-a-${Date.now()}`,
          role: 'assistant',
          text: payload.answer || 'No response returned.',
          timestamp: new Date().toLocaleTimeString(),
          model: payload.model,
        },
      ]);
    } catch (err) {
      const errorDetail =
        err instanceof Error ? err.message : 'Failed to reach /api/assistant.';
      const fallbackAnswer = [
        `> **LOCAL DETERMINISTIC FALLBACK (NOT FROM GEMINI AI)** — ${errorDetail}`,
        '',
        `**Active Science Target:** ${activeSite.title} (${activeSite.geologicalCategory}, ${activeSite.lat.toFixed(4)}°, ${activeSite.lon.toFixed(4)}°, ${activeSite.elevationM} m MOLA)`,
        `- **NASA Evidence & Dataset:** ${activeSite.nasaMission} · ${activeSite.instrument} · ${activeSite.supportingDataset} (${activeSite.confidenceLevel} confidence)`,
        `- **Prototype 5-Factor Priority:** ${activePriority.totalScore}/100 (${activePriority.tier}, ${activePriority.accessibilityStatus}) — planning estimate only.`,
        directVsScience
          ? `- **Route Impact vs Direct:** ${directVsScience.deltaDistanceKm >= 0 ? '+' : ''}${directVsScience.deltaDistanceKm.toFixed(2)} km, ${directVsScience.deltaDurationHr >= 0 ? '+' : ''}${directVsScience.deltaDurationHr.toFixed(2)} hr, Safety ${directVsScience.deltaSafetyScore >= 0 ? '+' : ''}${directVsScience.deltaSafetyScore} pts.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      setSciMessages([
        ...nextMsgs,
        {
          id: `sci-e-${Date.now()}`,
          role: 'error',
          text: `AI Science Assistant Error: ${errorDetail} (Showing local deterministic target summary below — not generated by Gemini.)`,
          timestamp: new Date().toLocaleTimeString(),
        },
        {
          id: `sci-fb-${Date.now() + 1}`,
          role: 'assistant',
          text: fallbackAnswer,
          timestamp: new Date().toLocaleTimeString(),
          model: 'LOCAL FALLBACK (NO GEMINI)',
        },
      ]);
    } finally {
      setSciAsking(false);
    }
  };

  // Build plain-text downloadable Science Discovery Report using upgraded 5-factor breakdown & provenance
  const scienceReportText = useMemo(() => {
    const scopeTitle =
      regionScope === 'ALL'
        ? 'All Cataloged Martian Regions'
        : locations.find((l) => l.id === regionScope)?.name || regionScope;
    const objectiveMeta =
      SCIENCE_OBJECTIVES.find((o) => o.id === scienceObjective) || SCIENCE_OBJECTIVES[0];
    const generatedAt = new Date().toISOString();

    const targetLines = filteredSites.map(({ site, priority }, idx) => {
      return [
        `${idx + 1}. ${site.title}`,
        `   Region: ${site.locationName} (${site.lat.toFixed(4)}° lat, ${site.lon.toFixed(4)}° lon, ${site.elevationM} m MOLA)`,
        `   Geological Category: ${site.geologicalCategory}`,
        `   Provenance Tier: ${site.provenanceClass || 'NASA archival reference'}`,
        `   Ancient Water Evidence: ${site.waterEnvironmentEvidence} | Rover Support: ${site.roverSupport ? 'Yes' : 'Orbital Only'} | Confidence: ${site.confidenceLevel}`,
        `   Prototype 5-Factor Science Priority Score: ${priority.totalScore}/100 (${priority.tier})`,
        `     - Scientific Relevance:       ${priority.breakdown.scientificRelevance}/25`,
        `     - Geological Diversity:       ${priority.breakdown.geologicalDiversity}/20`,
        `     - Supporting Evidence:        ${priority.breakdown.supportingEvidence}/20`,
        `     - Objective Relevance:        ${priority.breakdown.objectiveRelevance}/20`,
        `     - Route Accessibility:        ${priority.breakdown.routeAccessibility}/15 (${priority.accessibilityStatus}${priority.routeDistanceKm !== null ? `, ${priority.routeDistanceKm} km` : ''})`,
        `   Supporting Dataset: ${site.supportingDataset} (${site.nasaMission} · ${site.instrument})`,
        `   Geological Context: ${site.geologicalContext || 'Data not available'}`,
        `   Observation Summary: ${site.evidenceSummary}`,
        `   Scientific Significance: ${site.scientificSignificance}`,
        `   Limitations: ${site.limitations || 'Data not available'}`,
        `   Source URL: ${site.sourceUrl}`,
      ].join('\n');
    });

    const routeLines = routeRecommendationResult.recommendations.map((rec, idx) => {
      return `${idx + 1}. ${rec.site.title} -> Distance ${rec.safestRoute.distanceKm.toFixed(2)} km | Est. Time ${rec.safestRoute.estimatedDurationHr.toFixed(1)} hr | Risk ${rec.safestRoute.overallRiskLevel} (Safety ${rec.safestRoute.safetyScore}/100) | Priority ${rec.priority.totalScore}/100\n   Rationale: ${rec.reason}`;
    });

    const impassableLines =
      routeRecommendationResult.impassableTargets.length > 0
        ? routeRecommendationResult.impassableTargets
            .map((t) => `- EXCLUDED: ${t.site.title} (${t.impassableReason})`)
            .join('\n')
        : 'None — all evaluated targets in the current sector meet traversability thresholds.';

    const obsSummaryLines =
      obsItems.length > 0
        ? obsItems
            .slice(0, 4)
            .map(
              (o) =>
                `- [${obsAvailability}] ${o.mission} / ${o.instrument} (${o.observationDate}): ${o.title} -> ${o.sourceUrl}`,
            )
            .join('\n')
        : `- [${obsAvailability}] ${obsNote || 'No live frames returned for current query.'}`;

    const pdsSummaryLines =
      pdsProducts.length > 0
        ? pdsProducts
            .slice(0, 4)
            .map(
              (p) =>
                `- [NASA observation retrieved / PDS ODE] ${p.productId} (${p.mission} ${p.instrument}, ${p.observationDate}) at ${p.centerLat.toFixed(3)}°, ${p.centerLon.toFixed(3)}° -> ${p.sourceUrl}`,
            )
            .join('\n')
        : `- [PDS ODE ${pdsStatus}] ${pdsError || 'No overlapping MRO HiRISE/CTX PDS footprints returned.'}`;

    return [
      '========================================================================',
      'MARSWALK AI — MARS SCIENCE DISCOVERY REPORT',
      'NASA Space Apps Challenge 2026 | Interplanetary Survival Guide',
      '========================================================================',
      `Generated (UTC):        ${generatedAt}`,
      `Exploration Scope:      ${scopeTitle}`,
      `Active Route Sector:    ${routeRegion.name} (${missionState.startingLocation.name} -> ${missionState.destination.name})`,
      `Active Science Stops:   ${scienceStops.length > 0 ? scienceStops.map((s) => s.name).join(' -> ') : 'None (Direct Route)'}`,
      `Selected Objective:     ${objectiveMeta.label}`,
      `Max Terrain Tolerance:  ${maxDifficulty}/100`,
      '',
      'PLANNING ESTIMATE DISCLAIMER:',
      'The Science Priority Score (0-100) is a planning estimate only — NOT an',
      'official NASA scientific assessment or ranking, and no claim of',
      'extraterrestrial life discovery is made.',
      '',
      '------------------------------------------------------------------------',
      `1. PRIORITIZED GEOLOGICAL TARGETS (${filteredSites.length})`,
      '------------------------------------------------------------------------',
      targetLines.join('\n\n') || 'No targets match active filters.',
      '',
      '------------------------------------------------------------------------',
      `2. SCIENCE-BASED SAFE ROUTE RECOMMENDATIONS (${routeRegion.name})`,
      '------------------------------------------------------------------------',
      routeLines.join('\n\n') || 'No passable targets found under current terrain tolerance.',
      '',
      'Excluded / Impassable Targets:',
      impassableLines,
      '',
      '------------------------------------------------------------------------',
      `3. ACTIVE TARGET OBSERVATIONS (${activeSite.title})`,
      '------------------------------------------------------------------------',
      `Availability Status: ${obsAvailability} (${obsSourceLabel})`,
      obsSummaryLines,
      '',
      `Georeferenced PDS ODE Orbital Footprints (${pdsProducts.length}):`,
      pdsSummaryLines,
      '',
      '------------------------------------------------------------------------',
      '4. PROVENANCE SEPARATION, SOURCES & LIMITATIONS',
      '------------------------------------------------------------------------',
      '- NASA observation retrieved: Live PDS ODE georeferenced HiRISE RDRV11 & CTX EDR footprints,',
      '  JPL Mars 2020 & MSL raw/weather JSON archives, NASA Image Library.',
      '- NASA archival reference: Curated published PDS/MRO/Perseverance coordinates & literature summaries.',
      '- Derived analysis: 5-Factor Science Priority Score (0-100) & A* route evaluations.',
      '- Simulated demonstration data: 25x25 km synthetic terrain grid (500 m cells) for slope/hazard screening.',
      '========================================================================',
    ].join('\n');
  }, [
    regionScope,
    locations,
    scienceObjective,
    filteredSites,
    routeRecommendationResult,
    routeRegion.name,
    missionState.startingLocation,
    missionState.destination,
    scienceStops,
    maxDifficulty,
    activeSite.title,
    obsItems,
    obsAvailability,
    obsSourceLabel,
    obsNote,
    pdsProducts,
    pdsStatus,
    pdsError,
  ]);

  const handleDownloadReport = () => {
    const blob = new Blob([scienceReportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marswalk-science-discovery-${regionScope.toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(scienceReportText);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      setShowReportPreview(true);
    }
  };

  const handleOpenInMap = (locationId: string) => {
    const loc = locations.find((l) => l.id === locationId);
    if (loc) onSelectLocation(loc);
    onNavigate('mars-explorer');
  };

  const confidenceBadgeStyle = (level: ScienceSite['confidenceLevel']) => {
    if (level === 'HIGH') return 'text-emerald-300 bg-emerald-500/15 border-emerald-400/40';
    if (level === 'MODERATE') return 'text-amber-300 bg-amber-500/15 border-amber-400/40';
    return 'text-slate-300 bg-white/10 border-white/20';
  };

  const availabilityBadgeStyle = (status: ObservationAvailability) => {
    if (status === 'LIVE VERIFIED') return 'text-emerald-300 bg-emerald-500/15 border-emerald-400/40';
    if (status === 'ARCHIVAL REFERENCE') return 'text-amber-300 bg-amber-500/15 border-amber-400/40';
    return 'text-red-300 bg-red-500/15 border-red-400/40';
  };

  const accessibilityBadgeStyle = (
    status: ReturnType<typeof computeSciencePriority>['accessibilityStatus'],
  ) => {
    if (status === 'ON ROUTE') return 'text-emerald-300 bg-emerald-500/15 border-emerald-400/45';
    if (status === 'NEAR CORRIDOR') return 'text-cyan-300 bg-cyan-500/15 border-cyan-400/45';
    if (status === 'DETOUR REQUIRED') return 'text-amber-300 bg-amber-500/15 border-amber-400/45';
    return 'text-slate-400 bg-white/[0.06] border-white/15';
  };

  const selectedMapOriginWp = sectorRoutePlan.terrain.cells.length > 0 ? routeOrigin : undefined;
  const selectedMapDestWp =
    routeRegion.id === selectedLocation.id
      ? destWaypoint
      : routeRegion.localWaypoints[1] || routeRegion.localWaypoints[0];

  const renderShapeGlyph = (shape: string, color: string) => {
    if (shape === 'diamond') {
      return <span className="inline-block w-2.5 h-2.5 rotate-45 shrink-0" style={{ backgroundColor: color }} />;
    }
    if (shape === 'square') {
      return <span className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ backgroundColor: color }} />;
    }
    if (shape === 'ring') {
      return (
        <span
          className="inline-block w-2.5 h-2.5 rounded-full border-2 shrink-0"
          style={{ borderColor: color }}
        />
      );
    }
    if (shape === 'triangle') {
      return (
        <span
          className="inline-block w-0 h-0 shrink-0"
          style={{
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderBottom: `9px solid ${color}`,
          }}
        />
      );
    }
    return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          <h1 className="text-2xl font-display font-bold text-white">
            Mars Science Discovery Explorer
          </h1>
          <p className="text-xs text-slate-400 max-w-4xl">
            Scientifically transparent EVA target research, MRO/Perseverance instrument provenance, A* science corridor integration, and AI geology advisory centered on Jezero Crater.
          </p>
          <div className="pt-0.5">
            <ProvenanceTag
              type="ACTUAL NASA OBSERVATION"
              detail="Perseverance · Curiosity · HiRISE · CTX · CRISM · THEMIS · MOLA"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleOpenInMap(activeSite.locationId)}
            className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/15 text-xs font-mono text-cyan-300 flex items-center gap-1.5 whitespace-nowrap"
          >
            <MapIcon className="w-3.5 h-3.5" />
            Science Map Layer
          </button>
        </div>
      </div>

      {/* Dashboard KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono uppercase text-slate-400">Active Focus Scope</div>
          <div className="text-base font-display font-bold text-white mt-1 truncate">
            {regionScope === 'ALL'
              ? 'All Mars Regions'
              : locations.find((l) => l.id === regionScope)?.name || 'Jezero Crater'}
          </div>
          <div className="text-[11px] font-mono text-cyan-400 mt-0.5 tabular-nums">
            {scopeSites.length} cataloged targets
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono uppercase text-slate-400">Ancient Water Sites</div>
          <div className="text-xl font-mono font-bold text-cyan-300 mt-1 tabular-nums">
            {ancientWaterCount}/{scopeSites.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Strong aqueous evidence</div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono uppercase text-slate-400">Rover-Verified Targets</div>
          <div className="text-xl font-mono font-bold text-emerald-400 mt-1 tabular-nums">
            {roverVerifiedCount}/{scopeSites.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Perseverance / Curiosity</div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5">
          <div className="text-[11px] font-mono uppercase text-slate-400">Active Route Waypoints</div>
          <div className="text-xl font-mono font-bold text-[#E85D2A] mt-1 tabular-nums">
            {scienceStops.length}
            <span className="text-xs text-slate-400 font-normal"> stops</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {activeRoute.distanceKm.toFixed(1)} km · {missionState.routePreference.toUpperCase()}
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-3.5 col-span-2 lg:col-span-1">
          <div className="text-[11px] font-mono uppercase text-slate-400">NASA Science Feed</div>
          <div className="mt-1.5">
            <span
              className={`inline-block px-2 py-0.5 rounded border text-[11px] font-mono font-semibold ${availabilityBadgeStyle(
                obsAvailability,
              )}`}
            >
              {obsAvailability}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">{obsSourceLabel}</div>
        </div>
      </div>

      {/* Filters: Region + Geological Categories + NASA Missions/Instruments */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 mr-1">Region Focus:</span>
            <button
              type="button"
              onClick={() => {
                setRegionScope('jezero-crater');
                const jezero = locations.find((l) => l.id === 'jezero-crater');
                if (jezero) onSelectLocation(jezero);
              }}
              className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors whitespace-nowrap ${
                regionScope === 'jezero-crater'
                  ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                  : 'bg-[#07090E] border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              Jezero Crater (6 Targets)
            </button>
            <button
              type="button"
              onClick={() => setRegionScope('ALL')}
              className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors whitespace-nowrap ${
                regionScope === 'ALL'
                  ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                  : 'bg-[#07090E] border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              All Mars Regions ({sites.length})
            </button>
            {locations
              .filter((l) => l.id !== 'jezero-crater' && sites.some((s) => s.locationId === l.id))
              .map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    setRegionScope(loc.id);
                    onSelectLocation(loc);
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors whitespace-nowrap ${
                    regionScope === loc.id
                      ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                      : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {loc.name}
                </button>
              ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setWaterOnly((v) => !v)}
              className={`px-2.5 py-1 rounded text-xs font-mono border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                waterOnly
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              <Droplets className="w-3.5 h-3.5" />
              Ancient Water Evidence
            </button>
            <button
              type="button"
              onClick={() => setRoverOnly((v) => !v)}
              className={`px-2.5 py-1 rounded text-xs font-mono border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                roverOnly
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              Rover Observations Only
            </button>
          </div>
        </div>

        {/* 7 Geological Feature Categories */}
        <div className="pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-mono uppercase text-slate-400 mr-1">
            Geological Category:
          </span>
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
              selectedCategory === 'ALL'
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            All Categories
          </button>
          {GEOLOGICAL_CATEGORIES.map((cat) => {
            const meta = GEOLOGICAL_CATEGORY_META[cat];
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  active
                    ? `${meta.bgClass} ${meta.borderClass} ${meta.textClass}`
                    : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {renderShapeGlyph(meta.shape, meta.colorHex)}
                {cat}
              </button>
            );
          })}
        </div>

        {/* Mission & Instrument Filter */}
        <div className="pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-mono uppercase text-slate-400 mr-1">
            Mission / Instrument:
          </span>
          {MISSION_INSTRUMENT_FILTERS.map((inst) => (
            <button
              key={inst}
              type="button"
              onClick={() => setInstrumentFilter(inst)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors whitespace-nowrap ${
                instrumentFilter === inst
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                  : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              {inst}
            </button>
          ))}
        </div>
      </div>

      {/* Main Master-Detail Split: Prioritized Targets List + Comprehensive Target Details Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Column: Prioritized Science Targets */}
        <div className="xl:col-span-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-display font-semibold text-white uppercase tracking-wider">
              Science Target Explorer ({filteredSites.length})
            </h2>
            <span className="text-[10px] font-mono text-slate-400">
              Ranked for {SCIENCE_OBJECTIVES.find((o) => o.id === scienceObjective)?.shortLabel}
            </span>
          </div>

          {filteredSites.length === 0 ? (
            <div className="bg-[#0D1016] border border-white/10 rounded p-6 text-center space-y-2">
              <div className="text-sm font-medium text-white">No targets match active filters</div>
              <p className="text-xs text-slate-400">
                Try resetting Mission/Instrument, Geological Category, Water, or Rover filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setRegionScope('ALL');
                  setSelectedCategory('ALL');
                  setInstrumentFilter('ALL');
                  setWaterOnly(false);
                  setRoverOnly(false);
                }}
                className="px-3 py-1.5 rounded bg-[#E85D2A] text-xs font-semibold text-white"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[820px] overflow-y-auto pr-1">
              {filteredSites.map(({ site, priority }) => {
                const isSelected = site.id === activeSite.id;
                const catMeta = GEOLOGICAL_CATEGORY_META[site.geologicalCategory];
                const loc = locations.find((l) => l.id === site.locationId);
                const wpId = loc ? resolveSiteWaypoint(site, loc).id : `sci-wp-${site.id}`;
                const isInRoute = scienceStops.some((st) => st.id === wpId);
                const provenance: ScienceProvenanceClass =
                  site.provenanceClass || 'NASA archival reference';
                return (
                  <button
                    key={site.id}
                    type="button"
                    onClick={() => setSelectedSiteId(site.id)}
                    className={`w-full text-left p-4 rounded border transition-colors space-y-2 ${
                      isSelected
                        ? 'bg-[#121722] border-[#E85D2A]'
                        : 'bg-[#0D1016] border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                          <span
                            className={`px-1.5 py-0.5 rounded border ${catMeta.bgClass} ${catMeta.borderClass} ${catMeta.textClass}`}
                          >
                            {site.geologicalCategory}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border ${getProvenanceBadgeStyle(
                              provenance,
                            )}`}
                          >
                            {provenance}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border ${confidenceBadgeStyle(
                              site.confidenceLevel,
                            )}`}
                          >
                            {site.confidenceLevel}
                          </span>
                          {isInRoute && (
                            <span className="px-1.5 py-0.5 rounded border border-emerald-400/50 bg-emerald-500/20 text-emerald-200 font-semibold">
                              IN ROUTE
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-display font-semibold text-white">
                          {site.title}
                        </h3>
                      </div>

                      <div className="shrink-0 text-right font-mono bg-[#07090E] border border-white/10 rounded px-2.5 py-1">
                        <div className="text-[9px] text-slate-400 uppercase">Priority*</div>
                        <div className="text-base font-bold text-cyan-300 tabular-nums">
                          {priority.totalScore}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
                      <span>
                        {site.locationName} · {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}° ·{' '}
                        {site.elevationM} m MOLA
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded border text-[9px] ${accessibilityBadgeStyle(
                          priority.accessibilityStatus,
                        )}`}
                      >
                        {priority.accessibilityStatus}
                        {priority.routeDistanceKm !== null ? ` (${priority.routeDistanceKm} km)` : ''}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {site.geologicalContext || site.evidenceSummary}
                    </p>

                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400 pt-1 border-t border-white/[0.06]">
                      <span className="truncate">
                        {site.nasaMission} · {site.instrument}
                      </span>
                      <span className="text-[#E85D2A] shrink-0">
                        {isSelected ? 'Inspecting →' : 'Inspect Dossier'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Comprehensive 6-Section Science Target Details Panel */}
        <div className="xl:col-span-7 bg-[#0D1016] border border-white/10 rounded p-5 space-y-5">
          {/* Dossier Header */}
          <div className="space-y-2.5 border-b border-white/10 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <span
                  className={`px-2 py-0.5 rounded border ${
                    GEOLOGICAL_CATEGORY_META[activeSite.geologicalCategory].bgClass
                  } ${GEOLOGICAL_CATEGORY_META[activeSite.geologicalCategory].borderClass} ${
                    GEOLOGICAL_CATEGORY_META[activeSite.geologicalCategory].textClass
                  }`}
                >
                  {activeSite.geologicalCategory}
                </span>
                <span
                  className={`px-2 py-0.5 rounded border ${confidenceBadgeStyle(
                    activeSite.confidenceLevel,
                  )}`}
                >
                  {activeSite.confidenceLevel} CONFIDENCE
                </span>
                <span
                  className={`px-2 py-0.5 rounded border font-semibold ${getProvenanceBadgeStyle(
                    activeSite.provenanceClass || 'NASA archival reference',
                  )}`}
                >
                  {activeSite.provenanceClass || 'NASA archival reference'}
                </span>
              </div>

              <a
                href={activeSite.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-[#E85D2A] hover:underline inline-flex items-center gap-1"
              >
                Official NASA Archive <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-display font-bold text-white">{activeSite.title}</h2>
                <div className="text-xs font-mono text-cyan-300 tabular-nums mt-0.5">
                  {activeSite.locationName} · Lat {activeSite.lat.toFixed(4)}° · Lon{' '}
                  {activeSite.lon.toFixed(4)}° · Elevation {activeSite.elevationM} m MOLA
                </div>
              </div>

              {/* Waypoint Toggle right in header */}
              <div className="flex items-center gap-2">
                {activeSiteIsWaypoint && activeSiteWaypoint ? (
                  <button
                    type="button"
                    onClick={() => onRemoveScienceStop(activeSiteWaypoint.id)}
                    className="px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-xs font-mono font-semibold text-emerald-200 inline-flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Added to Route (Remove)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAddScienceStop(activeSite)}
                    className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Waypoint to Route
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 6-Part Structured Target Details Panel */}
          <div className="space-y-3">
            {/* 1. Scientific Overview & Geological Context + 3. Why Investigate */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 rounded bg-[#080A0F] border border-white/[0.08] space-y-1.5">
                <div className="text-[11px] font-mono uppercase text-cyan-300 font-semibold">
                  1. Scientific Overview &amp; Geological Context
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {activeSite.geologicalContext || 'Data not available'}
                </p>
                <div className="text-[11px] text-slate-400 pt-1 border-t border-white/[0.05]">
                  {activeSite.evidenceSummary || 'Data not available'}
                </div>
              </div>

              <div className="p-3.5 rounded bg-[#080A0F] border border-white/[0.08] space-y-1.5">
                <div className="text-[11px] font-mono uppercase text-[#E85D2A] font-semibold">
                  2. Why Astronauts &amp; Researchers Investigate It
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {activeSite.investigatorRationale || 'Data not available'}
                </p>
                <div className="text-[11px] text-slate-400 pt-1 border-t border-white/[0.05]">
                  {activeSite.scientificSignificance || 'Data not available'}
                </div>
              </div>
            </div>

            {/* 2. Geological Features of Interest + 6. Suggested Scientific Activities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 rounded bg-[#080A0F] border border-white/[0.08] space-y-2">
                <div className="text-[11px] font-mono uppercase text-slate-300 font-semibold">
                  3. Geological Features of Interest
                </div>
                {activeSite.geologicalFeatures && activeSite.geologicalFeatures.length > 0 ? (
                  <ul className="space-y-1 text-xs text-slate-200">
                    {activeSite.geologicalFeatures.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <span className="text-cyan-400 mt-0.5">•</span>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs font-mono text-amber-300/90">Data not available</div>
                )}
              </div>

              <div className="p-3.5 rounded bg-[#080A0F] border border-white/[0.08] space-y-2">
                <div className="text-[11px] font-mono uppercase text-slate-300 font-semibold">
                  4. Suggested Scientific Activities (EVA)
                </div>
                {activeSite.suggestedActivities && activeSite.suggestedActivities.length > 0 ? (
                  <ul className="space-y-1 text-xs text-slate-200">
                    {activeSite.suggestedActivities.map((act) => (
                      <li key={act} className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">▸</span>
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs font-mono text-amber-300/90">Data not available</div>
                )}
              </div>
            </div>

            {/* 5. Supporting NASA Datasets & Mission / Instrument Connections */}
            <div className="p-3.5 rounded bg-[#080A0F] border border-white/[0.08] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-mono uppercase text-slate-200 font-semibold">
                  5. Supporting Datasets &amp; NASA Mission / Instrument Connections
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  MRO (HiRISE · CTX · CRISM) · Odyssey THEMIS · MGS MOLA · Perseverance (Mastcam-Z · SuperCam · PIXL · SHERLOC)
                </span>
              </div>

              {activeSite.missionConnections && activeSite.missionConnections.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {activeSite.missionConnections.map((conn, idx) => (
                    <div
                      key={`${conn.mission}-${idx}`}
                      className="p-2.5 rounded bg-[#0D1016] border border-white/[0.07] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">{conn.mission}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${getProvenanceBadgeStyle(
                            conn.provenanceClass,
                          )}`}
                        >
                          {conn.provenanceClass}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {conn.instruments.map((inst) => (
                          <span
                            key={inst}
                            className="px-1.5 py-0.2 rounded bg-cyan-500/10 border border-cyan-400/30 text-[10px] font-mono text-cyan-200"
                          >
                            {inst}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-300 leading-snug">{conn.role}</p>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-400 pt-1 border-t border-white/[0.05]">
                        <span className="truncate">{conn.sourceName}</span>
                        <span>{conn.date || 'Date unavailable'}</span>
                      </div>
                      {conn.sourceUrl && (
                        <a
                          href={conn.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] font-mono text-[#E85D2A] hover:underline inline-flex items-center gap-1"
                        >
                          Verify Mission Source <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs font-mono text-amber-300/90">
                  Structured instrument breakdown: Data not available (Primary citation:{' '}
                  {activeSite.supportingDataset} · {activeSite.nasaMission} · {activeSite.instrument}).
                </div>
              )}
            </div>

            {/* 6. Data Provenance & Scientific Limitations */}
            <div className="p-3.5 rounded bg-[#080A0F] border border-white/[0.08] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-mono uppercase text-slate-200 font-semibold">
                  6. Data Provenance &amp; Limitations
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  Observation Period: {activeSite.observationPeriod || 'Data not available'}
                </span>
              </div>

              <ProvenanceClassBadge
                provenance={activeSite.provenanceClass || 'NASA archival reference'}
                sourceName={activeSite.supportingDataset}
                instrument={activeSite.instrument}
                retrievalStatus={`Confidence: ${activeSite.confidenceLevel}`}
                date={activeSite.sourceDate || 'Data not available'}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
                <div className="p-2.5 rounded bg-[#0D1016] border border-emerald-500/25 space-y-1">
                  <span className="inline-block px-1.5 py-0.5 rounded border text-[9px] font-mono bg-emerald-500/15 text-emerald-300 border-emerald-400/40">
                    NASA observation retrieved
                  </span>
                  <div className="text-slate-300 leading-relaxed">
                    Live PDS ODE orbital footprints ({pdsProducts.length} found) &amp; NASA Image/JPL feeds ({obsAvailability}) below when upstream responds.
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#0D1016] border border-amber-500/25 space-y-1">
                  <span className="inline-block px-1.5 py-0.5 rounded border text-[9px] font-mono bg-amber-500/15 text-amber-300 border-amber-400/40">
                    Derived analysis
                  </span>
                  <div className="text-slate-300 leading-relaxed">
                    5-Factor Science Priority Score ({activePriority.totalScore}/100) and route corridor distance calculations.
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#0D1016] border border-orange-500/25 space-y-1">
                  <span className="inline-block px-1.5 py-0.5 rounded border text-[9px] font-mono bg-orange-500/15 text-orange-300 border-orange-400/40">
                    Simulated demonstration data
                  </span>
                  <div className="text-slate-300 leading-relaxed">
                    25×25 km synthetic terrain grid (500 m cells) used for A* traversability; not a 0.25 m/px HiRISE stereo DTM.
                  </div>
                </div>
              </div>

              <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded p-2.5">
                <span className="font-mono text-[10px] uppercase text-amber-300 block mb-0.5">
                  Known Scientific &amp; Measurement Limitations
                </span>
                {activeSite.limitations || 'Data not available'}
              </div>
            </div>
          </div>

          {/* Transparent 5-Factor Science Priority Score Breakdown */}
          <div className="p-4 rounded bg-[#080A0F] border border-cyan-500/25 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                  <FlaskConical className="w-4 h-4 text-cyan-400" />
                  5-Factor Science Priority Score Breakdown
                  <span className="ml-1 px-1.5 py-0.5 rounded border text-[9px] font-mono bg-amber-500/15 text-amber-300 border-amber-400/40">
                    Derived analysis
                  </span>
                </div>
                <div className="text-[11px] text-amber-300 mt-0.5 font-semibold">
                  * {activePriority.disclaimer}
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="text-2xl font-bold text-cyan-300 tabular-nums">
                  {activePriority.totalScore}
                </span>
                <span className="text-xs text-slate-400"> / 100</span>
                <div className="text-[10px] text-cyan-400">{activePriority.tier}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-[11px] font-mono">
              {[
                {
                  label: 'Scientific Relevance',
                  val: activePriority.breakdown.scientificRelevance,
                  max: 25,
                },
                {
                  label: 'Geo Diversity',
                  val: activePriority.breakdown.geologicalDiversity,
                  max: 20,
                },
                {
                  label: 'Supporting Evidence',
                  val: activePriority.breakdown.supportingEvidence,
                  max: 20,
                },
                {
                  label: 'Objective Fit',
                  val: activePriority.breakdown.objectiveRelevance,
                  max: 20,
                },
                {
                  label: 'Route Accessibility',
                  val: activePriority.breakdown.routeAccessibility,
                  max: 15,
                },
              ].map((factor) => {
                const pct = Math.round((factor.val / factor.max) * 100);
                return (
                  <div
                    key={factor.label}
                    className="p-2 rounded bg-[#0D1016] border border-white/[0.06] space-y-1"
                  >
                    <div className="text-slate-400 truncate" title={factor.label}>
                      {factor.label}
                    </div>
                    <div className="text-white font-bold tabular-nums">
                      {factor.val}/{factor.max}
                    </div>
                    <div className="h-1.5 rounded-sm bg-white/10 overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400 pt-1 border-t border-white/[0.06]">
              <span>Formula: {activePriority.formulaSummary}</span>
              <span className="text-cyan-300">
                Route Status: {activePriority.accessibilityStatus}
                {activePriority.routeDistanceKm !== null ? ` (${activePriority.routeDistanceKm} km from corridor)` : ''}
              </span>
            </div>
          </div>

          {/* Direct Route vs Science-Focused Route Comparison (for Active Region) */}
          <div className="p-4 rounded bg-[#080A0F] border border-[#E85D2A]/35 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                  <Route className="w-4 h-4 text-[#E85D2A]" />
                  Direct Route vs. Science-Focused Route Impact — {activeSite.title}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Evaluates Central Mission State impact ({missionState.startingLocation.name} →{' '}
                  {missionState.destination.name}, {missionState.routePreference.toUpperCase()}) if{' '}
                  <span className="text-slate-200">{activeSite.title}</span> is included as an intermediate science waypoint.
                </p>
              </div>
              {directVsScience && (
                <span
                  className={`px-2 py-0.5 rounded border text-[10px] font-mono ${
                    directVsScience.alreadyIncludedInRoute
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                      : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200'
                  }`}
                >
                  {directVsScience.alreadyIncludedInRoute
                    ? 'CURRENTLY INCLUDED IN ACTIVE ROUTE'
                    : 'DETOUR PREVIEW (DERIVED ANALYSIS)'}
                </span>
              )}
            </div>

            {!directVsScience ? (
              <div className="text-xs text-slate-300 bg-[#0D1016] border border-white/[0.06] rounded p-3 flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong className="text-white">{activeSite.title}</strong> is in{' '}
                  <strong className="text-cyan-300">{activeSite.locationName}</strong>, while your active mission route is currently planned in{' '}
                  <strong className="text-[#E85D2A]">{selectedLocation.name}</strong>.
                </span>
                <button
                  type="button"
                  onClick={() => onPlanScienceTarget(activeSite.locationId, activeSite.linkedWaypointId)}
                  className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white"
                >
                  Switch Active Mission to {activeSite.locationName}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-white/10 text-left">
                        <th className="py-1.5 pr-3">Metric</th>
                        <th className="py-1.5 px-2">Direct Route</th>
                        <th className="py-1.5 px-2">Science-Focused Route</th>
                        <th className="py-1.5 pl-2 text-right">Impact Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] tabular-nums">
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Traverse Distance</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directRoute.distanceKm.toFixed(2)} km
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceRoute.distanceKm.toFixed(2)} km
                        </td>
                        <td className="py-1.5 pl-2 text-right text-cyan-300">
                          {directVsScience.deltaDistanceKm >= 0 ? '+' : ''}
                          {directVsScience.deltaDistanceKm.toFixed(2)} km
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Mission Duration</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directSurvival.effectiveMissionDurationHr.toFixed(2)} hr
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceSurvival.effectiveMissionDurationHr.toFixed(2)} hr
                        </td>
                        <td className="py-1.5 pl-2 text-right text-cyan-300">
                          {directVsScience.deltaDurationHr >= 0 ? '+' : ''}
                          {directVsScience.deltaDurationHr.toFixed(2)} hr
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Route Safety Score</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directRoute.safetyScore}/100 ({directVsScience.directRoute.overallRiskLevel})
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceRoute.safetyScore}/100 ({directVsScience.scienceRoute.overallRiskLevel})
                        </td>
                        <td
                          className={`py-1.5 pl-2 text-right ${
                            directVsScience.deltaSafetyScore >= 0 ? 'text-emerald-300' : 'text-amber-300'
                          }`}
                        >
                          {directVsScience.deltaSafetyScore >= 0 ? '+' : ''}
                          {directVsScience.deltaSafetyScore} pts
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Oxygen Required</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directSurvival.totalOxygenRequiredKg.toFixed(2)} kg
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceSurvival.totalOxygenRequiredKg.toFixed(2)} kg
                        </td>
                        <td className="py-1.5 pl-2 text-right text-amber-300">
                          {directVsScience.deltaOxygenKg >= 0 ? '+' : ''}
                          {directVsScience.deltaOxygenKg.toFixed(2)} kg
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Energy Required</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directSurvival.totalEnergyRequiredKwh.toFixed(2)} kWh
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceSurvival.totalEnergyRequiredKwh.toFixed(2)} kWh
                        </td>
                        <td className="py-1.5 pl-2 text-right text-amber-300">
                          {directVsScience.deltaEnergyKwh >= 0 ? '+' : ''}
                          {directVsScience.deltaEnergyKwh.toFixed(2)} kWh
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Water Required</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directSurvival.totalWaterRequiredL.toFixed(2)} L
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceSurvival.totalWaterRequiredL.toFixed(2)} L
                        </td>
                        <td className="py-1.5 pl-2 text-right text-amber-300">
                          {directVsScience.deltaWaterL >= 0 ? '+' : ''}
                          {directVsScience.deltaWaterL.toFixed(2)} L
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-slate-300">Mission Readiness</td>
                        <td className="py-1.5 px-2 text-slate-200">
                          {directVsScience.directSurvival.missionReadinessScore}/100 (
                          {directVsScience.directSurvival.readinessClassification})
                        </td>
                        <td className="py-1.5 px-2 text-white font-semibold">
                          {directVsScience.scienceSurvival.missionReadinessScore}/100 (
                          {directVsScience.scienceSurvival.readinessClassification})
                        </td>
                        <td
                          className={`py-1.5 pl-2 text-right ${
                            directVsScience.deltaReadinessScore >= 0
                              ? 'text-emerald-300'
                              : 'text-orange-300'
                          }`}
                        >
                          {directVsScience.deltaReadinessScore >= 0 ? '+' : ''}
                          {directVsScience.deltaReadinessScore} pts
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {activeSiteIsWaypoint && activeSiteWaypoint ? (
                    <button
                      type="button"
                      onClick={() => onRemoveScienceStop(activeSiteWaypoint.id)}
                      className="px-3 py-1.5 rounded bg-red-500/15 hover:bg-red-500/25 border border-red-400/40 text-xs font-mono text-red-200 inline-flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove "{activeSite.title}" Waypoint
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddScienceStop(activeSite)}
                      className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add "{activeSite.title}" as Route Waypoint
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigate('route-planner')}
                    className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/15 text-xs font-mono text-cyan-300 inline-flex items-center gap-1.5"
                  >
                    <Route className="w-3.5 h-3.5" />
                    Inspect in Smart Route Planner
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Live NASA Science Data Integration (Perseverance / HiRISE / CTX / CRISM + PDS ODE + MEDA/REMS) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-display font-semibold text-white">
                    NASA Science Observations — {activeSite.locationName}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded border text-[10px] font-mono ${getProvenanceBadgeStyle(
                      liveFeedProvenance,
                    )}`}
                  >
                    {liveFeedProvenance}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Live queries to NASA Image &amp; Video Library and JPL Mars Rover archives.
                  {obsRetrievedAt
                    ? ` Retrieved ${new Date(obsRetrievedAt).toLocaleTimeString()}${obsCached ? ' (cached)' : ''}.`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'auto', label: 'Auto' },
                    { id: 'perseverance', label: 'Perseverance' },
                    { id: 'curiosity', label: 'Curiosity' },
                    { id: 'hirise', label: 'HiRISE' },
                    { id: 'ctx', label: 'CTX' },
                    { id: 'crism', label: 'CRISM' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setInstrumentMode(tab.id)}
                    className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                      instrumentMode === tab.id
                        ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                        : 'bg-[#080A0F] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setRetryNonce((n) => n + 1);
                    void fetchProbes(true);
                  }}
                  disabled={obsLoading || probesLoading}
                  title="Force fresh NASA/JPL query (bypass cache)"
                  className="ml-1 px-2 py-1 rounded text-[11px] font-mono border border-white/15 bg-[#07090E] text-slate-200 hover:bg-white/10 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${obsLoading ? 'animate-spin' : ''}`} />
                  Retry
                </button>
              </div>
            </div>

            {endpointProbes && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-slate-400">
                <span>Endpoint Probes:</span>
                {(
                  [
                    'pds-ode',
                    'jpl-mars2020',
                    'jpl-msl',
                    'nasa-images',
                    'meda-weather',
                    'rems-weather',
                    'trek-mola',
                  ] as const
                ).map((k) => {
                  const st = endpointProbes[k]?.status || 'UNAVAILABLE';
                  const cls =
                    st === 'VERIFIED'
                      ? 'border-emerald-500/35 text-emerald-300 bg-emerald-500/10'
                      : st === 'CONNECTED'
                        ? 'border-cyan-500/35 text-cyan-300 bg-cyan-500/10'
                        : 'border-red-500/35 text-red-300 bg-red-500/10';
                  return (
                    <span
                      key={k}
                      title={endpointProbes[k]?.detail}
                      className={`px-1.5 py-0.5 rounded border ${cls}`}
                    >
                      {k}: {st}
                    </span>
                  );
                })}
              </div>
            )}

            {obsNote && (
              <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{obsNote}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="px-2 py-0.5 rounded border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-mono text-amber-100 shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {obsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded bg-[#080A0F] border border-white/[0.06] animate-pulse"
                  />
                ))}
              </div>
            ) : obsItems.length === 0 ? (
              <div className="p-4 rounded bg-[#080A0F] border border-red-500/30 text-xs text-red-200 flex items-center justify-between gap-3">
                <span>
                  Status: UNAVAILABLE — No verified observations returned from NASA public endpoints for this query.
                </span>
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="px-2.5 py-1 rounded border border-red-400/40 bg-red-500/15 hover:bg-red-500/25 font-mono text-red-100 shrink-0"
                >
                  Retry Query
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {obsItems.slice(0, 4).map((item) => (
                  <a
                    key={item.id}
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex gap-3 p-2.5 rounded bg-[#080A0F] border border-white/[0.08] hover:border-[#E85D2A]/60 transition-colors"
                  >
                    {item.imageUrl && !brokenImages[item.id] ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        onError={() => setBrokenImages((prev) => ({ ...prev, [item.id]: true }))}
                        className="w-20 h-20 rounded object-cover shrink-0 bg-black"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded bg-[#121620] shrink-0 flex items-center justify-center text-[10px] font-mono text-slate-500 text-center px-1">
                        PDS REF
                      </div>
                    )}
                    <div className="min-w-0 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                          <span className="text-emerald-400 truncate">
                            {item.mission} · {item.instrument}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {item.locationMatch && (
                              <span
                                className={`px-1 py-0.2 rounded border text-[9px] ${
                                  item.locationMatch === 'REGIONAL_MATCH'
                                    ? 'border-emerald-400/40 text-emerald-300'
                                    : 'border-amber-400/40 text-amber-200'
                                }`}
                              >
                                {item.locationMatch === 'REGIONAL_MATCH'
                                  ? 'SITE'
                                  : item.locationMatch === 'CROSS_SITE_REFERENCE'
                                    ? 'CROSS-SITE'
                                    : 'ARCHIVAL'}
                              </span>
                            )}
                            <span
                              className={`px-1 py-0.2 rounded border ${
                                item.isFallback
                                  ? 'border-cyan-400/40 text-cyan-300'
                                  : 'border-emerald-400/40 text-emerald-300'
                              }`}
                            >
                              {item.isFallback ? 'NASA archival' : 'Retrieved'}
                            </span>
                          </div>
                        </div>
                        <div className="text-xs font-semibold text-white mt-0.5 line-clamp-1">
                          {item.title}
                        </div>
                        {item.locationNote && (
                          <div className="text-[10px] font-mono text-amber-300/90 mt-0.5 line-clamp-1">
                            {item.locationNote}
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {activeSite.locationName} · {item.observationDate}
                          {typeof item.sol === 'number' ? ` · Sol ${item.sol}` : ''}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-[#E85D2A] inline-flex items-center gap-1 mt-1">
                        Open NASA Record <ExternalLink className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )}

            {/* Georeferenced PDS Geosciences ODE Orbital Products matching exact Target Coordinates */}
            <div className="p-3.5 rounded bg-[#080A0F] border border-cyan-500/20 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                    PDS ODE Georeferenced Orbital Footprints (±0.35° around {activeSite.lat.toFixed(2)}°,{' '}
                    {activeSite.lon.toFixed(2)}°)
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    Live Washington Univ. PDS Geosciences ODE metadata query for MRO HiRISE (RDRV11) &amp; CTX (EDR).
                    {pdsRetrievedAt ? ` Checked ${new Date(pdsRetrievedAt).toLocaleTimeString()}.` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${
                      pdsProducts.length > 0
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : pdsStatus === 'CONNECTED'
                          ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                          : 'border-red-500/40 bg-red-500/15 text-red-300'
                    }`}
                  >
                    {pdsProducts.length > 0 ? 'NASA observation retrieved' : pdsStatus}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPdsRetryNonce((n) => n + 1)}
                    disabled={pdsLoading}
                    className="px-2 py-0.5 rounded border border-white/15 bg-[#0D1016] hover:bg-white/10 text-[10px] font-mono text-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${pdsLoading ? 'animate-spin' : ''}`} />
                    Retry PDS
                  </button>
                </div>
              </div>

              {pdsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-14 rounded bg-[#0D1016] border border-white/[0.06] animate-pulse"
                    />
                  ))}
                </div>
              ) : pdsError ? (
                <div className="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/25 rounded px-2.5 py-2">
                  PDS ODE Error: {pdsError}
                </div>
              ) : pdsProducts.length === 0 ? (
                <div className="text-[11px] text-slate-400">
                  PDS ODE connected (HTTP 200) — zero HiRISE RDRV11 / CTX EDR footprints indexed inside this ±0.35° bounding box.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pdsProducts.slice(0, 4).map((prod) => (
                    <a
                      key={prod.productId}
                      href={prod.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2.5 rounded bg-[#0D1016] border border-white/[0.07] hover:border-cyan-400/50 transition-colors space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                        <span className="text-cyan-300 font-semibold truncate">{prod.productId}</span>
                        {prod.geographicMatch ? (
                          <span
                            className={`px-1.5 py-0.2 rounded border text-[9px] shrink-0 ${
                              prod.geographicMatch === 'IN_SECTOR'
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                : prod.geographicMatch === 'ADJACENT_REGION'
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                                  : 'border-slate-500/40 bg-white/5 text-slate-300'
                            }`}
                          >
                            {prod.geographicMatch === 'IN_SECTOR'
                              ? `IN SECTOR · ${prod.distanceKm?.toFixed(1)} km`
                              : prod.geographicMatch === 'ADJACENT_REGION'
                                ? `ADJACENT · ${prod.distanceKm?.toFixed(1)} km`
                                : `OUT · ${prod.distanceKm?.toFixed(1)} km`}
                          </span>
                        ) : (
                          <span className="text-emerald-400 shrink-0">{prod.instrument}</span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                        {prod.instrument} · {prod.observationDate} · {prod.centerLat.toFixed(2)}°,{' '}
                        {prod.centerLon.toFixed(2)}°
                      </div>
                      <span className="text-[10px] font-mono text-[#E85D2A] inline-flex items-center gap-1">
                        View PDS Product <ExternalLink className="w-2.5 h-2.5" />
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Rover Environmental Measurement Context (MEDA / REMS Historical Archive or Published Baseline) */}
            {(() => {
              const targetLoc = locations.find((l) => l.id === activeSite.locationId);
              const isJezero = activeSite.locationId === 'jezero-crater';
              const isGale = activeSite.locationId === 'gale-crater';
              const roverWeather = isJezero ? envData?.meda : isGale ? envData?.rems : null;
              const latestSol = roverWeather?.records?.[0];

              if (roverWeather && latestSol) {
                return (
                  <div className="p-3 rounded bg-[#080A0F] border border-emerald-500/20 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-emerald-400" />
                        Retrieved Environmental Archive — {latestSol.mission} ({latestSol.instrument})
                      </span>
                      <span className="px-2 py-0.5 rounded border text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border-emerald-400/40">
                        NASA observation retrieved · Sol {latestSol.sol} ({latestSol.terrestrialDate})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono pt-1">
                      <div className="p-2 rounded bg-[#0D1016] border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500 uppercase">Min / Max Temp</div>
                        <div className="text-white tabular-nums">
                          {latestSol.minTempC}°C / {latestSol.maxTempC}°C
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#0D1016] border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500 uppercase">Pressure</div>
                        <div className="text-white tabular-nums">
                          {latestSol.pressurePa} Pa ({latestSol.pressureMbar} mbar)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#0D1016] border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500 uppercase">Solar Longitude</div>
                        <div className="text-white tabular-nums">
                          {latestSol.season} (Ls {latestSol.ls}°)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#0D1016] border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500 uppercase">Atmosphere / UV</div>
                        <div className="text-white truncate">
                          {latestSol.opacity || 'Clear'}{' '}
                          {latestSol.uvIndex ? `· UV ${latestSol.uvIndex}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-amber-300/90">{roverWeather.note}</div>
                  </div>
                );
              }

              if (targetLoc) {
                return (
                  <div className="p-3 rounded bg-[#080A0F] border border-white/[0.07] space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
                        Regional Environmental Reference — {targetLoc.name}
                      </span>
                      <span className="px-2 py-0.5 rounded border text-[10px] font-mono bg-cyan-500/15 text-cyan-300 border-cyan-400/40">
                        NASA archival reference · {targetLoc.environmentalBaseline.sourceLabel}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-300">
                      Temp {targetLoc.environmentalBaseline.tempRangeC} · Pressure{' '}
                      {targetLoc.environmentalBaseline.pressureMbar} · Dust τ{' '}
                      {targetLoc.environmentalBaseline.dustOpacityTau} · {targetLoc.thermalInertiaTIU} TIU
                      {envError ? ` · (Weather endpoint unavailable: ${envError})` : ''}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Nearby Exploration Opportunities */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-display font-semibold text-white flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-[#E85D2A]" />
              Nearby Exploration Opportunities &amp; Points of Interest
            </h3>
            {nearbyOpportunities.length === 0 ? (
              <div className="text-xs text-slate-400 p-3 rounded bg-[#080A0F] border border-white/[0.06]">
                No other cataloged POIs within 150 km of this location.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {nearbyOpportunities.map((opp) => (
                  <div
                    key={opp.id}
                    className="p-2.5 rounded bg-[#080A0F] border border-white/[0.08] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-cyan-400 uppercase">{opp.kind}</div>
                      <div className="text-xs font-medium text-white truncate">{opp.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{opp.subtitle}</div>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="text-xs font-bold text-white tabular-nums">
                        {opp.distanceKm} km
                      </div>
                      <div className="text-[10px] text-slate-500">great-circle</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Direct Map & Route Actions */}
          <div className="pt-2 border-t border-white/10 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleOpenInMap(activeSite.locationId)}
              className="flex-1 min-w-[180px] px-4 py-2.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/15 text-xs font-semibold text-white flex items-center justify-center gap-2"
            >
              <MapIcon className="w-4 h-4 text-cyan-400" />
              Inspect on Global Mars Explorer
            </button>
            <button
              type="button"
              onClick={() => onPlanScienceTarget(activeSite.locationId, activeSite.linkedWaypointId)}
              className="flex-1 min-w-[200px] px-4 py-2.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white flex items-center justify-center gap-2"
            >
              <Route className="w-4 h-4" />
              Plan Safe A* Route to Target
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Sector Science & Route Map + Corridor Proximity Queue */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Sector Interactive Science Map with Distinct Category Shapes & Clickable Info */}
        <div className="xl:col-span-7 bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-1.5">
                <MapIcon className="w-4 h-4 text-cyan-400" />
                Sector Science &amp; Route Map — {routeRegion.name}
              </h2>
              <p className="text-[11px] text-slate-400">
                Click any geological marker to inspect its dossier or add/remove it as a mission route waypoint.
              </p>
            </div>
            <span className="px-2 py-0.5 rounded border text-[10px] font-mono bg-orange-500/15 text-orange-300 border-orange-400/40">
              Simulated demonstration data (Terrain Grid)
            </span>
          </div>

          <TerrainMapCanvas
            terrain={sectorRoutePlan.terrain}
            colorMode="elevation"
            routes={sectorRoutePlan.routes}
            selectedRouteId={sectorActiveRoute.id}
            waypoints={routeRegion.localWaypoints}
            hazards={sectorRoutePlan.hazards}
            originWaypointId={selectedMapOriginWp?.id}
            destWaypointId={selectedMapDestWp?.id}
            scienceSites={sectorScienceSites}
            selectedScienceSiteId={activeSite.id}
            scienceStopIds={scienceStops.map((s) => s.id)}
            showScienceMarkers={true}
            onSelectScienceSite={(site) => setSelectedSiteId(site.id)}
            showHazards={true}
            showSegmentLabels={false}
            height={330}
          />

          {/* Compact Science Marker Legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-mono text-slate-300 pt-1">
            <span className="text-slate-400 uppercase">Marker Legend:</span>
            {GEOLOGICAL_CATEGORIES.map((cat) => {
              const meta = GEOLOGICAL_CATEGORY_META[cat];
              return (
                <span key={cat} className="inline-flex items-center gap-1.5">
                  {renderShapeGlyph(meta.shape, meta.colorHex)}
                  <span>{cat}</span>
                </span>
              );
            })}
          </div>

          {/* Active Map Marker Info Bar */}
          <div className="p-3 rounded bg-[#080A0F] border border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-display font-semibold text-white">{activeSite.title}</span>
                <span className="text-[10px] font-mono text-cyan-300">
                  {activeSite.geologicalCategory}
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded border text-[9px] font-mono ${getProvenanceBadgeStyle(
                    activeSite.provenanceClass || 'NASA archival reference',
                  )}`}
                >
                  {activeSite.provenanceClass || 'NASA archival reference'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {activeSite.lat.toFixed(4)}°, {activeSite.lon.toFixed(4)}° ·{' '}
                {activeSite.supportingDataset} ({activeSite.instrument})
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeSiteIsWaypoint && activeSiteWaypoint ? (
                <button
                  type="button"
                  onClick={() => onRemoveScienceStop(activeSiteWaypoint.id)}
                  className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-[11px] font-mono text-emerald-200 hover:bg-emerald-500/30"
                >
                  ✓ Waypoint Active (Remove)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAddScienceStop(activeSite)}
                  className="px-2.5 py-1 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-[11px] font-mono font-semibold text-white"
                >
                  + Add Waypoint
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Route & Science Integration Queue: Targets Near Active Route + Active Waypoints */}
        <div className="xl:col-span-5 bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
            <div>
              <h2 className="text-sm font-display font-semibold text-white flex items-center gap-1.5">
                <Route className="w-4 h-4 text-[#E85D2A]" />
                Targets Near Active Route ({selectedLocation.name})
              </h2>
              <p className="text-[11px] text-slate-400">
                Active corridor: {missionState.startingLocation.name} → {missionState.destination.name} (
                {activeRoute.distanceKm.toFixed(2)} km)
              </p>
            </div>
            {scienceStops.length > 0 && (
              <button
                type="button"
                onClick={onClearScienceStops}
                className="text-[10px] font-mono text-red-300 hover:underline shrink-0"
              >
                Clear Stops ({scienceStops.length})
              </button>
            )}
          </div>

          {scienceStops.length > 0 && (
            <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-400/30 space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-emerald-300 font-semibold">
                Active Intermediate Science Waypoints ({scienceStops.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scienceStops.map((stop, idx) => (
                  <span
                    key={stop.id}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#07090E] border border-emerald-400/40 text-[11px] font-mono text-white"
                  >
                    <span>
                      {idx + 1}. {stop.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveScienceStop(stop.id)}
                      className="text-slate-400 hover:text-red-300"
                      title="Remove waypoint"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {targetsByRouteProximity.map(({ site, proximity, priority, waypoint, isWaypoint }) => (
              <div
                key={site.id}
                className={`p-3 rounded border flex items-center justify-between gap-2.5 ${
                  site.id === activeSite.id
                    ? 'bg-[#121722] border-[#E85D2A]/70'
                    : 'bg-[#080A0F] border-white/[0.08]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedSiteId(site.id)}
                  className="text-left min-w-0 flex-1 space-y-0.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-white truncate">{site.title}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded border text-[9px] font-mono ${accessibilityBadgeStyle(
                        priority.accessibilityStatus,
                      )}`}
                    >
                      {priority.accessibilityStatus}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                    {proximity.minDistanceKm.toFixed(2)} km from route (km {proximity.corridorKmMark.toFixed(1)} mark) · Score* {priority.totalScore}/100
                  </div>
                </button>

                {isWaypoint ? (
                  <button
                    type="button"
                    onClick={() => onRemoveScienceStop(waypoint.id)}
                    className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/45 text-[10px] font-mono text-emerald-200 hover:bg-emerald-500/30 shrink-0"
                  >
                    ✓ In Route
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAddScienceStop(site)}
                    className="px-2 py-1 rounded bg-white/[0.06] hover:bg-[#E85D2A] border border-white/15 hover:border-[#E85D2A] text-[10px] font-mono text-white shrink-0 transition-colors"
                  >
                    + Add Stop
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Embedded AI Science Assistant (Real /api/assistant Integration) */}
      <div className="bg-[#0D1016] border border-cyan-500/25 rounded p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h2 className="text-base font-display font-semibold text-white flex items-center gap-2">
              <Bot className="w-4 h-4 text-cyan-400" />
              AI Science Advisor — Geological &amp; Route Intelligence
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Grounded strictly in Central Mission State, the inspected science dossier ({activeSite.title}), PDS ODE footprints, and NASA dataset provenance rules.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sciMessages.length > 0 && (
              <button
                type="button"
                onClick={() => setSciMessages([])}
                className="px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[11px] font-mono text-slate-300"
              >
                Clear Q&amp;A
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('mission-assistant')}
              className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/15 text-xs font-mono text-cyan-300 inline-flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open Full Mission Assistant
            </button>
          </div>
        </div>

        {/* Quick Science Questions */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase text-slate-400 mr-1">
            Ask Science Advisor:
          </span>
          {[
            'Why is Three Forks scientifically important?',
            'Which science target is closest to my current route?',
            'What scientific value would I gain by visiting Bright Angel?',
            'Which available datasets support this geological interpretation?',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={sciAsking}
              onClick={() => void askScienceAssistant(prompt)}
              className="px-2.5 py-1 rounded bg-[#080A0F] hover:bg-cyan-500/15 border border-white/15 hover:border-cyan-400/50 text-xs text-slate-200 transition-colors disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Custom Question Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askScienceAssistant(sciQuestion);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={sciQuestion}
            onChange={(e) => setSciQuestion(e.target.value)}
            placeholder={`Ask about ${activeSite.title}, instrument provenance, corridor detours, or Jezero stratigraphy...`}
            className="flex-1 px-3 py-2 rounded bg-[#080A0F] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={sciAsking || !sciQuestion.trim()}
            className="px-4 py-2 rounded bg-[#E85D2A] hover:bg-[#d14e1e] disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {sciAsking ? 'Analyzing...' : 'Ask Advisor'}
          </button>
        </form>

        {/* Q&A Transcript */}
        {sciMessages.length > 0 && (
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 pt-1">
            {sciMessages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3.5 rounded border text-xs ${
                  msg.role === 'user'
                    ? 'bg-[#121722] border-cyan-500/35 text-white'
                    : msg.role === 'error'
                      ? 'bg-red-500/10 border-red-500/35 text-red-200'
                      : 'bg-[#080A0F] border-white/10 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400 mb-1.5">
                  <span className="uppercase font-semibold text-cyan-300">
                    {msg.role === 'user'
                      ? 'Astronaut / Researcher Query'
                      : msg.role === 'error'
                        ? 'Assistant Error'
                        : `MARSWALK Science Advisor (${msg.model || 'Gemini'})`}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-invert prose-xs max-w-none leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Science-Based Route Recommendations (Smart Route Planner Integration) */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h2 className="text-base font-display font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Science-Based Safe Route Recommendations — {routeRegion.name}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Computes safest A* corridors from <span className="text-slate-200">{routeOrigin.name}</span> under terrain tolerance ≤ {maxDifficulty}/100. Impassable routes are strictly excluded.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SCIENCE_OBJECTIVES.map((obj) => (
              <button
                key={obj.id}
                type="button"
                title={obj.description}
                onClick={() => setScienceObjective(obj.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
                  scienceObjective === obj.id
                    ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                    : 'bg-[#07090E] border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                {obj.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-cyan-300 font-mono">
          Active Objective: {routeRecommendationResult.objective.label} —{' '}
          <span className="text-slate-300 font-sans">
            {routeRecommendationResult.objective.description}
          </span>
        </div>

        {routeRecommendationResult.recommendations.length === 0 ? (
          <div className="p-4 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-200">
            No science targets in {routeRegion.name} currently satisfy safe EVA traversability thresholds under terrain tolerance {maxDifficulty}/100.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {routeRecommendationResult.recommendations.map((rec, idx) => (
              <div
                key={rec.site.id}
                className={`p-4 rounded border flex flex-col justify-between space-y-3 ${
                  idx === 0
                    ? 'bg-[#101620] border-emerald-500/40'
                    : 'bg-[#080A0F] border-white/10'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="text-emerald-400 font-semibold uppercase">
                      {idx === 0 ? '★ Top Recommended Science Traverse' : `Option #${idx + 1}`}
                    </span>
                    <span className="text-slate-400">
                      Risk: <strong className="text-white">{rec.safestRoute.overallRiskLevel}</strong>
                    </span>
                  </div>

                  <h3 className="text-sm font-display font-semibold text-white">
                    {rec.site.title}
                  </h3>

                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono bg-[#0D1016] border border-white/[0.06] rounded p-2">
                    <div>
                      <div className="text-slate-500 text-[9px] uppercase">Distance</div>
                      <div className="text-white font-bold tabular-nums">
                        {rec.safestRoute.distanceKm.toFixed(2)} km
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[9px] uppercase">Safety</div>
                      <div className="text-emerald-400 font-bold tabular-nums">
                        {rec.safestRoute.safetyScore}/100
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[9px] uppercase">Sci Score*</div>
                      <div className="text-cyan-300 font-bold tabular-nums">
                        {rec.priority.totalScore}/100
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{rec.reason}</p>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setSelectedSiteId(rec.site.id)}
                    className="px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/10 text-[11px] font-mono text-slate-200 whitespace-nowrap"
                  >
                    Inspect Details
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onPlanScienceTarget(rec.site.locationId, rec.site.linkedWaypointId)
                    }
                    className="flex-1 px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-[11px] font-semibold text-white flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Route className="w-3.5 h-3.5" />
                    Open in Route Planner
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {routeRecommendationResult.impassableTargets.length > 0 && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/30 space-y-1.5">
            <div className="text-xs font-mono uppercase text-red-300 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Impassable Targets Excluded from Route Recommendations (
              {routeRecommendationResult.impassableTargets.length})
            </div>
            {routeRecommendationResult.impassableTargets.map((t) => (
              <div key={t.site.id} className="text-xs text-red-200">
                <span className="font-semibold">{t.site.title}:</span> {t.impassableReason}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Science Discovery Report Export */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#E85D2A]" />
              Science Discovery Report Export
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Generates a formatted mission dossier with geological context, 5-factor scores, active waypoints, NASA provenance tiers, and dataset limitations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReportPreview((v) => !v)}
              className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-mono text-slate-200"
            >
              {showReportPreview ? 'Hide Preview' : 'Preview Report'}
            </button>
            <button
              type="button"
              onClick={handleCopyReport}
              className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-mono text-slate-200 flex items-center gap-1.5"
            >
              {copiedReport ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedReport ? 'Copied' : 'Copy Text'}
            </button>
            <button
              type="button"
              onClick={handleDownloadReport}
              className="px-3.5 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download .TXT Report
            </button>
          </div>
        </div>

        {showReportPreview && (
          <pre className="p-4 rounded bg-[#05070B] border border-white/10 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-[340px] leading-relaxed whitespace-pre-wrap">
            {scienceReportText}
          </pre>
        )}
      </div>
    </div>
  );
}
