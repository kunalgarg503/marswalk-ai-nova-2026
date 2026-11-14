import { useMemo, useState } from 'react';
import { Menu, Presentation, X } from 'lucide-react';
import { MARS_LOCATIONS } from './data/marsLocations';
import { NASA_DATASET_CATALOG } from './data/nasaCatalog';
import { SCIENCE_SITES } from './data/scienceSites';
import { planMartianRoute } from './engine/routePlanner';
import { resolveSiteWaypoint } from './engine/scienceEngine';
import { calculateSurvivalEstimate } from './engine/survivalCalculator';
import { buildCentralMissionState } from './engine/missionState';
import type {
  LocalWaypoint,
  MarsLocation,
  MissionObjective,
  NavSection,
  RoutePreference,
  ScienceSite,
  SurvivalInputs,
} from './types/mars';
import { Sidebar } from './components/Sidebar';
import { MissionControlView } from './components/views/MissionControlView';
import { MarsExplorerView } from './components/views/MarsExplorerView';
import { TerrainIntelligenceView } from './components/views/TerrainIntelligenceView';
import { HazardDetectionView } from './components/views/HazardDetectionView';
import { RoutePlannerView } from './components/views/RoutePlannerView';
import { ScienceExplorerView } from './components/views/ScienceExplorerView';
import { SurvivalCalculatorView } from './components/views/SurvivalCalculatorView';
import { NasaDataCentreView } from './components/views/NasaDataCentreView';
import { MissionAssistantView } from './components/views/MissionAssistantView';
import { PresentationModeOverlay } from './components/PresentationModeOverlay';

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('mission-control');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);

  // Unified Mission State
  const [selectedLocation, setSelectedLocation] = useState<MarsLocation>(MARS_LOCATIONS[0]);
  const [originWaypointId, setOriginWaypointId] = useState<string>(
    MARS_LOCATIONS[0].localWaypoints[0].id,
  );
  const [destWaypointId, setDestWaypointId] = useState<string>(
    MARS_LOCATIONS[0].localWaypoints[MARS_LOCATIONS[0].localWaypoints.length - 1].id,
  );
  const [scienceStops, setScienceStops] = useState<LocalWaypoint[]>([]);
  const [objective, setObjective] = useState<MissionObjective>('geological-sampling');
  const [routePreference, setRoutePreference] = useState<RoutePreference>('balanced');
  const [maxDifficulty, setMaxDifficulty] = useState<number>(55);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('route-balanced');
  const [customOrigin, setCustomOrigin] = useState<LocalWaypoint | null>(null);
  const [customDest, setCustomDest] = useState<LocalWaypoint | null>(null);

  const [survivalInputs, setSurvivalInputs] = useState<SurvivalInputs>({
    missionName: 'Jezero EVA Traverse Planning',
    astronautCount: 2,
    useRouteSync: true,
    durationMode: 'activity-derived',
    manualDistanceKm: 12,
    manualTerrainDifficulty: 40,
    missionDurationHr: 8,
    restDurationHr: 1.5,
    additionalActivityHr: 2.0,
    scheduleBufferHr: 0.5,
    walkingSpeedKmh: 3.2,
    oxygenRateKgPerPersonHr: 0.035,
    suitPowerKwPerAstronaut: 0.75,
    equipmentPowerKw: 0.8,
    dailyWaterLitersPerPerson: 3.2,
    safetyReservePct: 30,
    emergencyExtensionPct: 0,
    availableOxygenSupplyKg: 2.5,
    availableEnergySupplyKwh: 45,
    availableWaterSupplyL: 12,
  });

  const handleSelectLocation = (loc: MarsLocation) => {
    setSelectedLocation(loc);
    setCustomOrigin(null);
    setCustomDest(null);
    setScienceStops([]);
    const firstWp = loc.localWaypoints[0];
    const lastWp = loc.localWaypoints[loc.localWaypoints.length - 1];
    if (firstWp) setOriginWaypointId(firstWp.id);
    if (lastWp) setDestWaypointId(lastWp.id);
  };

  const handleChangeOriginWaypoint = (id: string) => {
    setCustomOrigin(null);
    setOriginWaypointId(id);
    setScienceStops((prev) => prev.filter((s) => s.id !== id));
  };

  const handleChangeDestWaypoint = (id: string) => {
    setCustomDest(null);
    setDestWaypointId(id);
    setScienceStops((prev) => prev.filter((s) => s.id !== id));
  };

  const handleChangeRoutePreference = (pref: RoutePreference) => {
    setRoutePreference(pref);
    setSelectedRouteId(`route-${pref}`);
  };

  const handleSelectRouteId = (routeId: string) => {
    setSelectedRouteId(routeId);
    if (routeId === 'route-shortest') setRoutePreference('shortest');
    else if (routeId === 'route-balanced') setRoutePreference('balanced');
    else if (routeId === 'route-safest') setRoutePreference('safest');
  };

  const originWaypoint = useMemo(() => {
    if (customOrigin && originWaypointId === customOrigin.id) return customOrigin;
    return (
      selectedLocation.localWaypoints.find((w) => w.id === originWaypointId) ||
      selectedLocation.localWaypoints[0]
    );
  }, [selectedLocation, originWaypointId, customOrigin]);

  const destWaypoint = useMemo(() => {
    if (customDest && destWaypointId === customDest.id) return customDest;
    return (
      selectedLocation.localWaypoints.find((w) => w.id === destWaypointId) ||
      selectedLocation.localWaypoints[selectedLocation.localWaypoints.length - 1]
    );
  }, [selectedLocation, destWaypointId, customDest]);

  const handleAddScienceStop = (site: ScienceSite) => {
    const loc = MARS_LOCATIONS.find((l) => l.id === site.locationId) || selectedLocation;
    const wp = resolveSiteWaypoint(site, loc);

    if (loc.id !== selectedLocation.id) {
      // Switch region cleanly and route from basecamp to the science target
      setSelectedLocation(loc);
      setCustomOrigin(null);
      setCustomDest(null);
      const firstWp = loc.localWaypoints[0];
      const fallbackSecond = loc.localWaypoints[1] || firstWp;
      const startWp = firstWp && firstWp.id !== wp.id ? firstWp : fallbackSecond;
      if (startWp) setOriginWaypointId(startWp.id);
      setDestWaypointId(wp.id);
      setScienceStops([]);
      setObjective('geological-sampling');
      return;
    }

    if (wp.id === originWaypoint.id || wp.id === destWaypoint.id) return;
    setScienceStops((prev) => (prev.some((s) => s.id === wp.id) ? prev : [...prev, wp]));
    setObjective('geological-sampling');
  };

  const handleRemoveScienceStop = (waypointId: string) => {
    setScienceStops((prev) => prev.filter((s) => s.id !== waypointId));
  };

  const handleClearScienceStops = () => {
    setScienceStops([]);
  };

  // Deterministic A* Pathfinding & Terrain/Hazard Analysis (including multi-leg Science Stops)
  const routePlan = useMemo(() => {
    return planMartianRoute({
      location: selectedLocation,
      originWaypoint,
      destWaypoint,
      viaWaypoints: scienceStops,
      objective,
      routePreference,
      maxAcceptableDifficulty: maxDifficulty,
      walkingSpeedKmh: survivalInputs.walkingSpeedKmh,
    });
  }, [
    selectedLocation,
    originWaypoint,
    destWaypoint,
    scienceStops,
    objective,
    routePreference,
    maxDifficulty,
    survivalInputs.walkingSpeedKmh,
  ]);

  const activeRoute = useMemo(() => {
    return (
      routePlan.routes.find((r) => r.id === selectedRouteId) ||
      routePlan.routes.find((r) => r.id === routePlan.recommendedRouteId) ||
      routePlan.routes[0]
    );
  }, [routePlan, selectedRouteId]);

  const survivalResults = useMemo(() => {
    return calculateSurvivalEstimate(
      survivalInputs,
      activeRoute.distanceKm,
      activeRoute.elevationGainM,
      activeRoute.meanDifficulty,
      activeRoute.overallRiskScore,
      maxDifficulty,
    );
  }, [
    survivalInputs,
    activeRoute.distanceKm,
    activeRoute.elevationGainM,
    activeRoute.meanDifficulty,
    activeRoute.overallRiskScore,
    maxDifficulty,
  ]);

  const nearbyScience = useMemo(() => {
    return SCIENCE_SITES.filter((s) => s.locationId === selectedLocation.id);
  }, [selectedLocation.id]);

  // Single Central Source of Truth consumed by all modules & reports
  const missionState = useMemo(() => {
    return buildCentralMissionState({
      selectedLocation,
      originWaypoint,
      destWaypoint,
      routePlan,
      activeRoute,
      survivalInputs,
      survivalResults,
      nearbyScience,
      datasets: NASA_DATASET_CATALOG,
    });
  }, [
    selectedLocation,
    originWaypoint,
    destWaypoint,
    routePlan,
    activeRoute,
    survivalInputs,
    survivalResults,
    nearbyScience,
  ]);

  const highHazardCount = useMemo(() => {
    return routePlan.hazards.filter((h) => h.riskLevel === 'HIGH' || h.riskLevel === 'CRITICAL').length;
  }, [routePlan.hazards]);

  const onRouteHighCritCount =
    activeRoute.hazardExposure.criticalSectionCount + activeRoute.hazardExposure.highSectionCount;

  const handlePlanScienceTarget = (locationId: string, waypointId?: string) => {
    const loc = MARS_LOCATIONS.find((l) => l.id === locationId) || selectedLocation;
    const firstWp = loc.localWaypoints[0];
    const targetWp =
      (waypointId && loc.localWaypoints.find((w) => w.id === waypointId)) ||
      loc.localWaypoints[loc.localWaypoints.length - 1];

    setSelectedLocation(loc);
    setCustomOrigin(null);
    setCustomDest(null);
    setScienceStops([]);

    if (firstWp && targetWp && firstWp.id === targetWp.id && loc.localWaypoints.length > 1) {
      setOriginWaypointId(loc.localWaypoints[1].id);
    } else if (firstWp) {
      setOriginWaypointId(firstWp.id);
    }
    if (targetWp) {
      setDestWaypointId(targetWp.id);
    }
    setObjective('geological-sampling');
    setRoutePreference('safest');
    setSelectedRouteId('route-safest');
    setActiveSection('route-planner');
  };

  const handleNavigate = (section: NavSection) => {
    setActiveSection(section);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#06070A] text-[#EEF1F6] flex flex-col md:flex-row">
      {/* Mobile Header Bar */}
      <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-white/10 bg-[#0A0C11] sticky top-0 z-30">
        <span className="font-display font-bold text-sm tracking-wider text-white">
          MARSWALK AI
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPresentationOpen((v) => !v)}
            className="px-2.5 py-1.5 rounded bg-[#0D1016] border border-[#E85D2A]/40 hover:border-[#E85D2A] text-[11px] font-mono text-[#E85D2A] flex items-center gap-1"
          >
            <Presentation className="w-3.5 h-3.5" /> Demo
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="p-2 rounded hover:bg-white/5 text-slate-300"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 top-14 z-20 bg-black/80 flex">
          <Sidebar
            activeSection={activeSection}
            onSelectSection={handleNavigate}
            collapsed={false}
            onToggleCollapse={() => setMobileMenuOpen(false)}
            activeLocationName={selectedLocation.name}
            activeRouteSafety={activeRoute.safetyScore}
            highHazardCount={highHazardCount}
            onRouteHighCritCount={onRouteHighCritCount}
          />
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:flex sticky top-0 h-screen">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={handleNavigate}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          activeLocationName={selectedLocation.name}
          activeRouteSafety={activeRoute.safetyScore}
          highHazardCount={highHazardCount}
          onRouteHighCritCount={onRouteHighCritCount}
        />
      </div>

      {/* Main Content Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Sector Bar */}
        <header className="hidden md:flex items-center justify-between gap-8 h-14 px-6 border-b border-white/10 bg-[#080A0F]">
          <div className="text-xs font-mono text-slate-400 truncate">
            Active Sector: <span className="text-white font-medium">{selectedLocation.name}</span> ·{' '}
            {selectedLocation.lat.toFixed(2)}°, {selectedLocation.lon.toFixed(2)}° ·{' '}
            {selectedLocation.elevationM} m MOLA
            {scienceStops.length > 0 && (
              <span className="ml-2 text-cyan-300">
                · +{scienceStops.length} Science Stop{scienceStops.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden xl:flex items-center gap-3 text-[11px] font-mono text-slate-400 border-r border-white/10 pr-3 tabular-nums">
              <span>
                Route:{' '}
                <strong className="text-cyan-300">
                  {missionState.distanceKm.toFixed(1)} km ({missionState.safetyScore}/100)
                </strong>
              </span>
              <span>
                Resources:{' '}
                <strong
                  className={
                    missionState.missionReadiness.overallResourceStatus === 'SUFFICIENT'
                      ? 'text-emerald-400'
                      : missionState.missionReadiness.overallResourceStatus === 'LIMITED'
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }
                >
                  {missionState.missionReadiness.overallResourceStatus}
                </strong>
              </span>
              <span>
                Readiness:{' '}
                <strong
                  className={
                    missionState.missionReadiness.hasInsufficientResource
                      ? 'text-red-400'
                      : missionState.missionReadiness.score >= 75
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                  }
                >
                  {missionState.missionReadiness.score}/100
                </strong>
              </span>
            </div>

            <button
              type="button"
              onClick={() => setPresentationOpen((v) => !v)}
              className={`px-2.5 py-1.5 rounded border text-xs font-mono flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                presentationOpen
                  ? 'bg-[#E85D2A] border-[#E85D2A] text-white'
                  : 'bg-[#0D1016] border-[#E85D2A]/40 hover:border-[#E85D2A] text-[#E85D2A]'
              }`}
            >
              <Presentation className="w-3.5 h-3.5" />
              Guided Demo
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('mission-assistant')}
              className="px-2.5 py-1.5 rounded bg-[#0D1016] hover:border-[#E85D2A] border border-white/15 text-xs font-mono text-cyan-300 transition-colors whitespace-nowrap"
            >
              AI Advisor
            </button>

            <select
              aria-label="Quick select Martian region"
              value={selectedLocation.id}
              onChange={(e) => {
                const loc = MARS_LOCATIONS.find((l) => l.id === e.target.value);
                if (loc) handleSelectLocation(loc);
              }}
              className="px-3 py-1.5 rounded bg-[#0D1016] border border-white/15 text-xs font-mono text-slate-200 focus:outline-none focus:border-[#E85D2A]"
            >
              {MARS_LOCATIONS.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 max-w-[1680px] w-full mx-auto flex flex-col">
          {activeSection === 'mission-control' && (
            <MissionControlView
              missionState={missionState}
              onNavigate={handleNavigate}
            />
          )}

          {activeSection === 'mars-explorer' && (
            <MarsExplorerView
              locations={MARS_LOCATIONS}
              selectedLocation={selectedLocation}
              onSelectLocation={handleSelectLocation}
              terrain={routePlan.terrain}
              hazards={routePlan.hazards}
              routes={routePlan.routes}
              activeRoute={activeRoute}
              onSelectRouteId={handleSelectRouteId}
              onNavigate={handleNavigate}
              onPlanScienceTarget={handlePlanScienceTarget}
              scienceStops={scienceStops}
              onAddScienceStop={handleAddScienceStop}
              onRemoveScienceStop={handleRemoveScienceStop}
            />
          )}

          {activeSection === 'terrain-intelligence' && (
            <TerrainIntelligenceView
              location={selectedLocation}
              terrain={routePlan.terrain}
              activeRoute={activeRoute}
              hazards={routePlan.hazards}
            />
          )}

          {activeSection === 'hazard-detection' && (
            <HazardDetectionView
              missionState={missionState}
            />
          )}

          {activeSection === 'route-planner' && (
            <RoutePlannerView
              locations={MARS_LOCATIONS}
              selectedLocation={selectedLocation}
              onSelectLocation={handleSelectLocation}
              originWaypointId={originWaypoint.id}
              onChangeOriginWaypoint={handleChangeOriginWaypoint}
              destWaypointId={destWaypoint.id}
              onChangeDestWaypoint={handleChangeDestWaypoint}
              scienceStops={scienceStops}
              onAddScienceStop={handleAddScienceStop}
              onRemoveScienceStop={handleRemoveScienceStop}
              onClearScienceStops={handleClearScienceStops}
              customOrigin={customOrigin}
              customDest={customDest}
              onSetCustomOrigin={(wp) => {
                setCustomOrigin(wp);
                setOriginWaypointId(wp.id);
              }}
              onSetCustomDest={(wp) => {
                setCustomDest(wp);
                setDestWaypointId(wp.id);
              }}
              objective={objective}
              onChangeObjective={setObjective}
              routePreference={routePreference}
              onChangeRoutePreference={handleChangeRoutePreference}
              maxDifficulty={maxDifficulty}
              onChangeMaxDifficulty={setMaxDifficulty}
              routePlan={routePlan}
              selectedRouteId={activeRoute.id}
              onSelectRouteId={handleSelectRouteId}
              missionState={missionState}
              onNavigate={handleNavigate}
            />
          )}

          {activeSection === 'science-explorer' && (
            <ScienceExplorerView
              sites={SCIENCE_SITES}
              locations={MARS_LOCATIONS}
              missionState={missionState}
              scienceStops={scienceStops}
              onSelectLocation={handleSelectLocation}
              onAddScienceStop={handleAddScienceStop}
              onRemoveScienceStop={handleRemoveScienceStop}
              onClearScienceStops={handleClearScienceStops}
              onPlanScienceTarget={handlePlanScienceTarget}
              onNavigate={handleNavigate}
            />
          )}

          {activeSection === 'survival-calculator' && (
            <SurvivalCalculatorView
              missionState={missionState}
              inputs={survivalInputs}
              onChangeInputs={setSurvivalInputs}
            />
          )}

          {activeSection === 'nasa-data-centre' && (
            <NasaDataCentreView
              datasets={NASA_DATASET_CATALOG}
              selectedLocation={selectedLocation}
            />
          )}

          {activeSection === 'mission-assistant' && (
            <MissionAssistantView
              missionState={missionState}
              onNavigate={handleNavigate}
              onSelectRouteId={handleSelectRouteId}
              onApplyWhatIfScenario={({ survivalInputs: nextInputs, routePreference: nextPref }) => {
                setSurvivalInputs(nextInputs);
                handleChangeRoutePreference(nextPref);
              }}
            />
          )}
        </main>
      </div>

      <PresentationModeOverlay
        open={presentationOpen}
        onClose={() => setPresentationOpen(false)}
        missionState={missionState}
        activeSection={activeSection}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
