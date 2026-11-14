import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, FlaskConical, Globe2, Layers, Map as MapIcon, MapPin, Mountain, RefreshCw, Route, Search } from 'lucide-react';
import { MARTIAN_CRATERS, ROVER_EXPLORATION_SITES } from '../../data/marsFeatures';
import { SCIENCE_SITES } from '../../data/scienceSites';
import {
  computeSciencePriority,
  findNearbyOpportunities,
  GEOLOGICAL_CATEGORY_META,
} from '../../engine/scienceEngine';
import type {
  DataProvenance,
  GlobeLayerId,
  HazardZone,
  LocalWaypoint,
  MarsLocation,
  MarsMapLayerId,
  NasaImageryItem,
  NavSection,
  RouteOption,
  ScienceSite,
  TerrainAnalysisResult,
} from '../../types/mars';
import { MarsGlobe3D } from '../MarsGlobe3D';
import { MarsInteractiveMap, type SelectedMapFeature } from '../MarsInteractiveMap';
import { ProvenanceTag } from '../ProvenanceTag';

interface MarsExplorerViewProps {
  locations: MarsLocation[];
  selectedLocation: MarsLocation;
  onSelectLocation: (loc: MarsLocation) => void;
  terrain: TerrainAnalysisResult;
  hazards: HazardZone[];
  routes: RouteOption[];
  activeRoute: RouteOption;
  onSelectRouteId: (id: string) => void;
  onNavigate: (section: NavSection) => void;
  onPlanScienceTarget?: (locationId: string, waypointId?: string) => void;
  scienceStops?: LocalWaypoint[];
  onAddScienceStop?: (site: ScienceSite) => void;
  onRemoveScienceStop?: (waypointId: string) => void;
}

const PROVENANCE_GLYPH_META: Record<
  DataProvenance,
  { glyph: string; textClass: string; shortLabel: string }
> = {
  'ACTUAL NASA OBSERVATION': {
    glyph: '●',
    textClass: 'text-emerald-400',
    shortLabel: 'Actual NASA Obs.',
  },
  'PUBLISHED SCIENTIFIC DATASET': {
    glyph: '◆',
    textClass: 'text-cyan-400',
    shortLabel: 'Published Dataset',
  },
  'DERIVED CALCULATION': {
    glyph: '▲',
    textClass: 'text-amber-400',
    shortLabel: 'Derived Calc.',
  },
  'SIMULATED DEMONSTRATION': {
    glyph: '◇',
    textClass: 'text-orange-400',
    shortLabel: 'Simulated Demo',
  },
};

const MAP_LAYERS: Array<{
  id: MarsMapLayerId;
  label: string;
  source: string;
  provenance: DataProvenance;
}> = [
  {
    id: 'surface',
    label: 'Surface Imagery',
    source: 'NASA Trek Viking MDIM21 (232 m/px)',
    provenance: 'PUBLISHED SCIENTIFIC DATASET',
  },
  {
    id: 'elevation',
    label: 'Elevation (MOLA)',
    source: 'NASA Trek MGS MOLA Shade (463 m/px)',
    provenance: 'PUBLISHED SCIENTIFIC DATASET',
  },
  {
    id: 'terrain',
    label: 'Terrain Relief',
    source: 'USGS/NASA HRSC + MOLA Hillshade',
    provenance: 'PUBLISHED SCIENTIFIC DATASET',
  },
  {
    id: 'themis-night',
    label: 'THEMIS Thermal IR',
    source: 'Mars Odyssey THEMIS Nighttime IR',
    provenance: 'PUBLISHED SCIENTIFIC DATASET',
  },
  {
    id: 'roughness',
    label: 'Terrain Roughness',
    source: 'Simulated 25×25 km TRI Roughness Grid (0–100)',
    provenance: 'SIMULATED DEMONSTRATION',
  },
  {
    id: 'route',
    label: 'Planned Route',
    source: 'Derived A* Traverse Corridor & Alternatives',
    provenance: 'DERIVED CALCULATION',
  },
  {
    id: 'craters',
    label: 'Craters',
    source: 'IAU / MOLA Crater Catalog',
    provenance: 'PUBLISHED SCIENTIFIC DATASET',
  },
  {
    id: 'rovers',
    label: 'Rover Locations',
    source: 'Perseverance, Curiosity, InSight, MER',
    provenance: 'ACTUAL NASA OBSERVATION',
  },
  {
    id: 'science',
    label: 'Science Locations',
    source: 'CRISM / OMEGA / Rover Targets',
    provenance: 'ACTUAL NASA OBSERVATION',
  },
  {
    id: 'hazards',
    label: 'Hazard Zones',
    source: 'Simulated 25×25 km Slope & Roughness Hazard Sectors',
    provenance: 'SIMULATED DEMONSTRATION',
  },
];

export function MarsExplorerView({
  locations,
  selectedLocation,
  onSelectLocation,
  terrain,
  hazards,
  routes,
  activeRoute,
  onSelectRouteId,
  onNavigate,
  onPlanScienceTarget,
  scienceStops = [],
  onAddScienceStop,
  onRemoveScienceStop: _onRemoveScienceStop,
}: MarsExplorerViewProps) {
  const [viewMode, setViewMode] = useState<'2d-map' | '3d-globe'>('2d-map');
  const [searchQuery, setSearchQuery] = useState('');

  // 2D Map Viewport centered initially on Jezero Crater (18.38°N, 77.58°E)
  const [mapCenter, setMapCenter] = useState({
    lat: selectedLocation.lat,
    lon: selectedLocation.lon,
    zoom: 5,
  });

  // Independently toggleable 2D scientific map layers
  const [mapLayers, setMapLayers] = useState<Record<MarsMapLayerId, boolean>>({
    surface: true,
    elevation: false,
    terrain: false,
    'themis-night': false,
    roughness: false,
    route: true,
    craters: true,
    rovers: true,
    science: true,
    hazards: true,
  });

  // 3D Globe layers
  const [globeLayers, setGlobeLayers] = useState<Record<GlobeLayerId, boolean>>({
    albedo: true,
    'mola-elevation': false,
    'themis-thermal': false,
    'terrain-roughness': false,
    graticule: true,
    hazards: true,
    route: true,
  });

  const [selectedFeature, setSelectedFeature] = useState<SelectedMapFeature>({
    kind: 'location',
    data: selectedLocation,
  });

  // Real NASA MRO HiRISE / CTX / Rover observation strip for selected site
  const [siteObs, setSiteObs] = useState<NasaImageryItem[]>([]);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsError, setObsError] = useState<string | null>(null);
  const [obsFallbackReason, setObsFallbackReason] = useState<string | null>(null);
  const [obsSource, setObsSource] = useState<string | null>(null);
  const [obsRetrievedAt, setObsRetrievedAt] = useState<string | null>(null);
  const [obsCached, setObsCached] = useState(false);
  const [obsRefreshNonce, setObsRefreshNonce] = useState(0);
  const [brokenObs, setBrokenObs] = useState<Record<string, boolean>>({});
  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedFeature]);

  // Sync map viewport when global selectedLocation changes from header/elsewhere
  useEffect(() => {
    setMapCenter((prev) => ({
      lat: selectedLocation.lat,
      lon: selectedLocation.lon,
      zoom: Math.max(prev.zoom, 4),
    }));
    setSelectedFeature({ kind: 'location', data: selectedLocation });
  }, [selectedLocation]);

  useEffect(() => {
    let cancelled = false;
    const querySite =
      selectedFeature.kind === 'location'
        ? selectedFeature.data.name
        : selectedFeature.kind === 'rover'
          ? selectedFeature.data.locationName
          : selectedFeature.kind === 'crater'
            ? selectedFeature.data.name
            : selectedFeature.kind === 'science'
              ? selectedFeature.data.locationName
              : selectedLocation.name;

    const roverParam =
      querySite.includes('Jezero') ||
      (selectedFeature.kind === 'rover' && selectedFeature.data.id === 'rover-perseverance')
        ? '&rover=perseverance'
        : querySite.includes('Gale') ||
            (selectedFeature.kind === 'rover' && selectedFeature.data.id === 'rover-curiosity')
          ? '&rover=curiosity'
          : selectedFeature.kind === 'science' &&
              selectedFeature.data.instrument.toUpperCase().includes('CRISM')
            ? '&instrument=crism'
            : '&instrument=hirise';

    const refreshParam = obsRefreshNonce > 0 ? '&refresh=1' : '';

    setObsLoading(true);
    setObsError(null);
    setObsFallbackReason(null);
    setObsSource(null);
    setBrokenObs({});
    fetch(`/api/nasa/imagery?site=${encodeURIComponent(querySite)}${roverParam}${refreshParam}`)
      .then(async (r) => {
        if (!r.ok) {
          let errMsg = `HTTP ${r.status}`;
          try {
            const errJson = (await r.json()) as { error?: string };
            if (errJson?.error) errMsg = errJson.error;
          } catch {
            // keep HTTP status message
          }
          throw new Error(errMsg);
        }
        return (await r.json()) as {
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
        setSiteObs((data.items || []).slice(0, 3));
        setObsSource(data.apiSource || null);
        setObsRetrievedAt(data.retrievedAt || new Date().toISOString());
        setObsCached(Boolean(data.cached));
        setObsFallbackReason(data.fallbackMode ? data.fallbackReason || 'Using archival PDS reference.' : null);
      })
      .catch((err) => {
        console.warn('NASA imagery observation fetch failed:', err);
        if (!cancelled) {
          setSiteObs([]);
          setObsError(
            err instanceof Error
              ? `NASA imagery feed request failed: ${err.message}`
              : 'NASA imagery feed request failed.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setObsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFeature, selectedLocation.name, obsRefreshNonce]);

  const toggleMapLayer = (id: MarsMapLayerId) => {
    const nextVal = !mapLayers[id];
    setMapLayers((prev) => ({ ...prev, [id]: nextVal }));
    if ((id === 'roughness' || id === 'route') && nextVal && mapCenter.zoom < 7) {
      setMapCenter({
        lat: activeRoute.waypoints[0]?.lat ?? selectedLocation.lat,
        lon: activeRoute.waypoints[0]?.lon ?? selectedLocation.lon,
        zoom: 8,
      });
    }
  };

  const handleToggleGlobeLayer = (layer: GlobeLayerId) => {
    setGlobeLayers((prev) => {
      if (layer === 'albedo' || layer === 'mola-elevation' || layer === 'themis-thermal') {
        return {
          ...prev,
          albedo: layer === 'albedo',
          'mola-elevation': layer === 'mola-elevation',
          'themis-thermal': layer === 'themis-thermal',
        };
      }
      return { ...prev, [layer]: !prev[layer] };
    });
  };

  // Unified searchable catalog (Regions + Rovers + Craters)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const regionItems = locations.map((l) => ({
      id: l.id,
      title: l.name,
      subtitle: `${l.lat.toFixed(2)}°, ${l.lon.toFixed(2)}° · ${l.type}`,
      badge: `${l.elevationM} m`,
      onPick: () => {
        onSelectLocation(l);
        setMapCenter({ lat: l.lat, lon: l.lon, zoom: 5 });
        setSelectedFeature({ kind: 'location', data: l });
      },
    }));

    const roverItems = ROVER_EXPLORATION_SITES.map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: `${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}° · ${r.mission}`,
      badge: 'Rover',
      onPick: () => {
        if (r.linkedLocationId) {
          const linked = locations.find((l) => l.id === r.linkedLocationId);
          if (linked) onSelectLocation(linked);
        }
        setMapCenter({ lat: r.lat, lon: r.lon, zoom: 7 });
        setSelectedFeature({ kind: 'rover', data: r });
      },
    }));

    const scienceItems = SCIENCE_SITES.map((s) => ({
      id: s.id,
      title: s.title,
      subtitle: `${s.geologicalCategory} · ${s.locationName} (${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°)`,
      badge: `Sci ${computeSciencePriority(s, 'explore-ancient-deltas', { route: activeRoute, location: selectedLocation }).totalScore}`,
      onPick: () => {
        const linked = locations.find((l) => l.id === s.locationId);
        if (linked) onSelectLocation(linked);
        setMapCenter({ lat: s.lat, lon: s.lon, zoom: 7 });
        setSelectedFeature({ kind: 'science', data: s });
      },
    }));

    const combined = [...regionItems, ...roverItems, ...scienceItems];
    if (!q) return combined;
    return combined.filter(
      (item) =>
        item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
    );
  }, [locations, searchQuery, onSelectLocation]);

  const handleFeatureSelect = (feature: SelectedMapFeature) => {
    setSelectedFeature(feature);
    if (feature.kind === 'location') {
      onSelectLocation(feature.data);
      setMapCenter({ lat: feature.data.lat, lon: feature.data.lon, zoom: Math.max(mapCenter.zoom, 5) });
    } else if (feature.kind === 'rover') {
      if (feature.data.linkedLocationId) {
        const linked = locations.find((l) => l.id === feature.data.linkedLocationId);
        if (linked) onSelectLocation(linked);
      }
      setMapCenter({ lat: feature.data.lat, lon: feature.data.lon, zoom: Math.max(mapCenter.zoom, 7) });
    } else if (feature.kind === 'crater') {
      setMapCenter({ lat: feature.data.lat, lon: feature.data.lon, zoom: Math.max(mapCenter.zoom, 5) });
    } else if (feature.kind === 'science') {
      const linked = locations.find((l) => l.id === feature.data.locationId);
      if (linked) onSelectLocation(linked);
      setMapCenter({ lat: feature.data.lat, lon: feature.data.lon, zoom: Math.max(mapCenter.zoom, 7) });
    } else if (feature.kind === 'hazard') {
      setMapCenter({ lat: feature.data.lat, lon: feature.data.lon, zoom: Math.max(mapCenter.zoom, 7) });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-display font-bold text-white">
            Interactive Martian Scientific Map Explorer
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-4xl">
            NASA Mars Trek WMTS (Viking MDIM21, MGS MOLA) &amp; USGS Astrogeology WMS (THEMIS IR, HRSC-MOLA Terrain) paired with an interactive 3D Mars globe.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#0D1016] p-1 rounded border border-white/15 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('2d-map')}
            className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              viewMode === '2d-map' ? 'bg-[#E85D2A] text-white font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            2D NASA Tile Map
          </button>
          <button
            type="button"
            onClick={() => setViewMode('3d-globe')}
            className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              viewMode === '3d-globe' ? 'bg-[#E85D2A] text-white font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Globe2 className="w-3.5 h-3.5" />
            3D Mars Globe
          </button>
        </div>
      </div>

      {/* Quick Focus Targets + Independent Map Layers Bar */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase text-slate-400 mr-1">Focus Site:</span>
            {[
              { label: 'Jezero Crater', id: 'jezero-crater', zoom: 5 },
              { label: 'Perseverance Area', roverId: 'rover-perseverance', zoom: 6 },
              { label: 'Gale Crater', id: 'gale-crater', zoom: 5 },
              { label: 'Curiosity Area', roverId: 'rover-curiosity', zoom: 6 },
              { label: 'Elysium Planitia', id: 'elysium-planitia', zoom: 5 },
            ].map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  if (q.id) {
                    const loc = locations.find((l) => l.id === q.id);
                    if (loc) {
                      onSelectLocation(loc);
                      setMapCenter({ lat: loc.lat, lon: loc.lon, zoom: q.zoom });
                      setSelectedFeature({ kind: 'location', data: loc });
                    }
                  } else if (q.roverId) {
                    const rv = ROVER_EXPLORATION_SITES.find((r) => r.id === q.roverId);
                    if (rv) handleFeatureSelect({ kind: 'rover', data: rv });
                  }
                }}
                className="px-2.5 py-1 rounded bg-[#07090E] hover:bg-white/10 border border-white/10 text-[11px] font-mono text-slate-200 transition-colors whitespace-nowrap"
              >
                {q.label}
              </button>
            ))}
          </div>
          <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" detail="NASA Trek & USGS Astrogeology" />
        </div>

        {viewMode === '2d-map' && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-mono uppercase text-slate-400 flex items-center gap-1 mr-1">
                <Layers className="w-3.5 h-3.5 text-[#E85D2A]" />
                Map Layers:
              </span>
              {MAP_LAYERS.map((layer) => {
                const active = mapLayers[layer.id];
                const pMeta = PROVENANCE_GLYPH_META[layer.provenance];
                return (
                  <button
                    key={layer.id}
                    type="button"
                    title={`${layer.source} · Classification: ${layer.provenance}`}
                    onClick={() => toggleMapLayer(layer.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                      active
                        ? 'bg-[#E85D2A]/20 border-[#E85D2A] text-white'
                        : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className={pMeta.textClass} aria-hidden="true">
                      {pMeta.glyph}
                    </span>
                    <span>
                      {active ? '✓ ' : ''}
                      {layer.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-400">
              <span className="uppercase text-slate-500">Layer Provenance Key:</span>
              {(['ACTUAL NASA OBSERVATION', 'PUBLISHED SCIENTIFIC DATASET', 'DERIVED CALCULATION', 'SIMULATED DEMONSTRATION'] as DataProvenance[]).map((prov) => (
                <span key={prov} className="inline-flex items-center gap-1">
                  <span className={PROVENANCE_GLYPH_META[prov].textClass}>{PROVENANCE_GLYPH_META[prov].glyph}</span>
                  <span>{prov}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {viewMode === '3d-globe' && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-mono uppercase text-slate-400 flex items-center gap-1 mr-1">
                <Layers className="w-3.5 h-3.5 text-[#E85D2A]" />
                3D Globe Layers:
              </span>
              {(
                [
                  { id: 'albedo', label: 'Surface Albedo', source: 'NASA Viking MDIM21 Procedural Sphere', provenance: 'PUBLISHED SCIENTIFIC DATASET' },
                  { id: 'mola-elevation', label: 'MOLA Elevation', source: 'MGS MOLA Hypsometric Texture', provenance: 'PUBLISHED SCIENTIFIC DATASET' },
                  { id: 'themis-thermal', label: 'THEMIS Thermal', source: 'Odyssey THEMIS Thermal Inertia', provenance: 'PUBLISHED SCIENTIFIC DATASET' },
                  {
                    id: 'terrain-roughness',
                    label: 'Terrain Roughness',
                    source: 'Simulated 25×25 km TRI Roughness Heatmap from routePlan.terrain',
                    provenance: 'SIMULATED DEMONSTRATION',
                  },
                  { id: 'graticule', label: 'Lat/Lon Grid', source: 'Planetocentric Graticule', provenance: 'PUBLISHED SCIENTIFIC DATASET' },
                  { id: 'hazards', label: 'Hazards', source: 'Simulated 4-Level Hazard Risk Markers', provenance: 'SIMULATED DEMONSTRATION' },
                  { id: 'route', label: 'Active Route', source: 'Derived A* Traverse Path Arc', provenance: 'DERIVED CALCULATION' },
                ] as Array<{ id: GlobeLayerId; label: string; source: string; provenance: DataProvenance }>
              ).map((layer) => {
                const active = globeLayers[layer.id];
                const pMeta = PROVENANCE_GLYPH_META[layer.provenance];
                return (
                  <button
                    key={layer.id}
                    type="button"
                    title={`${layer.source} · Classification: ${layer.provenance}`}
                    onClick={() => handleToggleGlobeLayer(layer.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                      active
                        ? 'bg-[#E85D2A]/20 border-[#E85D2A] text-white'
                        : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className={pMeta.textClass} aria-hidden="true">
                      {pMeta.glyph}
                    </span>
                    <span>
                      {active ? '✓ ' : ''}
                      {layer.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-400">
              <span className="uppercase text-slate-500">3D Layer Provenance Key:</span>
              {(['PUBLISHED SCIENTIFIC DATASET', 'DERIVED CALCULATION', 'SIMULATED DEMONSTRATION'] as DataProvenance[]).map((prov) => (
                <span key={prov} className="inline-flex items-center gap-1">
                  <span className={PROVENANCE_GLYPH_META[prov].textClass}>{PROVENANCE_GLYPH_META[prov].glyph}</span>
                  <span>{prov}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {viewMode === '2d-map' && mapLayers.route && (
          <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400 uppercase mr-1">Route Corridor:</span>
              {routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRouteId(r.id)}
                  className={`px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                    r.id === activeRoute.id
                      ? 'bg-amber-400/20 border-amber-400 text-amber-200 font-semibold'
                      : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {r.profile.toUpperCase()} · {r.distanceKm.toFixed(1)} km · Safety {r.safetyScore}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setMapCenter({
                  lat: activeRoute.waypoints[Math.floor(activeRoute.waypoints.length / 2)]?.lat ?? selectedLocation.lat,
                  lon: activeRoute.waypoints[Math.floor(activeRoute.waypoints.length / 2)]?.lon ?? selectedLocation.lon,
                  zoom: 8,
                })
              }
              className="text-cyan-400 hover:underline whitespace-nowrap"
            >
              Zoom to Route Sector (z8)
            </button>
          </div>
        )}
      </div>

      {/* Main Split Map + Location Search & Scientific Dossier */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-8">
          {viewMode === '2d-map' ? (
            <MarsInteractiveMap
              centerLat={mapCenter.lat}
              centerLon={mapCenter.lon}
              zoom={mapCenter.zoom}
              onViewportChange={(lat, lon, zoom) => setMapCenter({ lat, lon, zoom })}
              layers={mapLayers}
              locations={locations}
              selectedLocation={selectedLocation}
              craters={MARTIAN_CRATERS}
              rovers={ROVER_EXPLORATION_SITES}
              scienceSites={SCIENCE_SITES}
              scienceStopIds={scienceStops.map((s) => s.id)}
              terrain={terrain}
              hazards={hazards}
              routes={routes}
              activeRoute={activeRoute}
              selectedFeature={selectedFeature}
              onSelectFeature={handleFeatureSelect}
              onSelectRouteId={onSelectRouteId}
              onAddScienceWaypoint={onAddScienceStop}
              onOpenScienceExplorer={() => onNavigate('science-explorer')}
              heightClass="h-[560px]"
            />
          ) : (
            <MarsGlobe3D
              locations={locations}
              selectedLocation={selectedLocation}
              onSelectLocation={onSelectLocation}
              activeLayers={globeLayers}
              onToggleLayer={handleToggleGlobeLayer}
              terrain={terrain}
              hazards={hazards}
              activeRoute={activeRoute}
              heightClass="h-[560px]"
            />
          )}
        </div>

        {/* Right Panel: Search + Selected Feature Scientific Dossier */}
        <div className="lg:col-span-4 flex flex-col gap-3 bg-[#0D1016] border border-white/10 rounded p-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search craters, rovers, plains..."
              aria-label="Search Martian locations"
              className="w-full pl-9 pr-3 py-2 rounded bg-[#07090E] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#E85D2A]"
            />
          </div>

          <div className="space-y-1.5 max-h-[185px] overflow-y-auto pr-1">
            {searchResults.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onPick}
                className="w-full text-left px-3 py-2 rounded border bg-[#090B10] border-white/[0.06] text-slate-300 hover:border-[#E85D2A]/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-white">
                  <span className="truncate flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#E85D2A] shrink-0" />
                    {item.title}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                    {item.badge}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">{item.subtitle}</div>
              </button>
            ))}
          </div>

          {/* Selected Marker Scientific Details */}
          <div ref={detailScrollRef} className="flex-1 border-t border-white/10 pt-3 space-y-2.5 overflow-y-auto">
            {selectedFeature.kind !== 'location' && (
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                <span className="text-cyan-300 uppercase tracking-wider">
                  Selected {selectedFeature.kind} Marker
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFeature({ kind: 'location', data: selectedLocation })}
                  className="text-slate-400 hover:text-white underline"
                >
                  Back to {selectedLocation.name}
                </button>
              </div>
            )}
            {selectedFeature.kind === 'location' && (
              <>
                <ProvenanceTag
                  type="PUBLISHED SCIENTIFIC DATASET"
                  detail={selectedFeature.data.observationPeriod}
                />
                <div className="text-[11px] font-mono text-[#E85D2A]">{selectedFeature.data.region}</div>
                <h2 className="text-base font-display font-bold text-white">{selectedFeature.data.name}</h2>
                <div className="text-[11px] font-mono text-slate-400">
                  {selectedFeature.data.lat.toFixed(2)}°, {selectedFeature.data.lon.toFixed(2)}° ·{' '}
                  {selectedFeature.data.elevationM} m MOLA · {selectedFeature.data.thermalInertiaTIU} TIU
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedFeature.data.summary}</p>
                <div className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-200 font-medium">Geology: </span>
                  {selectedFeature.data.geologyNotes}
                </div>
              </>
            )}

            {selectedFeature.kind === 'rover' && (
              <>
                <ProvenanceTag type="ACTUAL NASA OBSERVATION" detail={selectedFeature.data.status} />
                <h2 className="text-base font-display font-bold text-white">{selectedFeature.data.name}</h2>
                <div className="text-[11px] font-mono text-slate-400">
                  {selectedFeature.data.lat.toFixed(4)}°, {selectedFeature.data.lon.toFixed(4)}° ·{' '}
                  {selectedFeature.data.elevationM} m MOLA
                </div>
                <div className="text-[11px] font-mono text-cyan-400">
                  {selectedFeature.data.mission} · {selectedFeature.data.operationalPeriod}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedFeature.data.summary}</p>
                <div className="text-[11px] font-mono text-slate-400">
                  Instruments: {selectedFeature.data.instruments}
                </div>
                <a
                  href={selectedFeature.data.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-[#E85D2A] hover:underline"
                >
                  Official NASA Mission Page <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}

            {selectedFeature.kind === 'crater' && (
              <>
                <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" detail={selectedFeature.data.quadrangle} />
                <h2 className="text-base font-display font-bold text-white">{selectedFeature.data.name}</h2>
                <div className="text-[11px] font-mono text-slate-400">
                  {selectedFeature.data.lat.toFixed(2)}°, {selectedFeature.data.lon.toFixed(2)}° · Ø{' '}
                  {selectedFeature.data.diameterKm} km · {selectedFeature.data.elevationM} m MOLA
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedFeature.data.summary}</p>
                <div className="text-[11px] font-mono text-slate-400">
                  Source: {selectedFeature.data.sourceDataset}
                </div>
              </>
            )}

            {selectedFeature.kind === 'science' && (() => {
              const s = selectedFeature.data;
              const priority = computeSciencePriority(s, 'explore-ancient-deltas', {
                route: activeRoute,
                location: selectedLocation,
              });
              const catMeta = GEOLOGICAL_CATEGORY_META[s.geologicalCategory];
              const nearbyOpps = findNearbyOpportunities(
                s,
                locations,
                SCIENCE_SITES,
                ROVER_EXPLORATION_SITES,
                MARTIAN_CRATERS,
              ).slice(0, 3);
              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ProvenanceTag
                      type="ACTUAL NASA OBSERVATION"
                      detail={`${s.confidenceLevel} CONFIDENCE`}
                    />
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${catMeta.bgClass} ${catMeta.borderClass} ${catMeta.textClass}`}
                    >
                      {s.geologicalCategory}
                    </span>
                  </div>
                  <h2 className="text-base font-display font-bold text-white">{s.title}</h2>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {s.locationName} · {s.lat.toFixed(4)}°, {s.lon.toFixed(4)}° · {s.elevationM} m
                  </div>
                  <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.08] flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Prototype Science Priority Score
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Not an official NASA assessment · Water: {s.waterEnvironmentEvidence}
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-lg font-bold text-cyan-300 tabular-nums">
                        {priority.totalScore}
                      </span>
                      <span className="text-[10px] text-slate-400">/100</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{s.evidenceSummary}</p>
                  <div className="text-[11px] font-mono text-slate-400">
                    Dataset: {s.supportingDataset} ({s.instrument})
                  </div>
                  {nearbyOpps.length > 0 && (
                    <div className="text-[11px] text-slate-400 bg-[#07090E] border border-white/[0.06] rounded p-2 space-y-1">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Nearby Exploration Opportunities
                      </div>
                      {nearbyOpps.map((o) => (
                        <div key={o.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate text-slate-300">{o.name}</span>
                          <span className="font-mono text-cyan-400 shrink-0 tabular-nums">
                            {o.distanceKm} km
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-mono text-[#E85D2A] hover:underline"
                    >
                      NASA Source <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => onNavigate('science-explorer')}
                      className="inline-flex items-center gap-1 text-xs font-mono text-cyan-400 hover:underline"
                    >
                      <FlaskConical className="w-3 h-3" />
                      Open Science Explorer
                    </button>
                  </div>
                </>
              );
            })()}

            {selectedFeature.kind === 'hazard' && (
              <>
                <div className="flex flex-col gap-1">
                  <ProvenanceTag
                    type="SIMULATED DEMONSTRATION"
                    detail={`${selectedFeature.data.riskLevel} RISK · ${selectedFeature.data.dataOrigin}`}
                  />
                  <ProvenanceTag
                    type="DERIVED CALCULATION"
                    detail="Deterministic Threshold Classification"
                  />
                </div>
                <h2 className="text-base font-display font-bold text-white">
                  {selectedFeature.data.category}
                </h2>
                <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {selectedFeature.data.lat.toFixed(3)}°, {selectedFeature.data.lon.toFixed(3)}° · Slope{' '}
                  {selectedFeature.data.slopeDeg.toFixed(1)}° · Roughness{' '}
                  {selectedFeature.data.roughnessIdx.toFixed(0)}/100
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedFeature.data.reason}</p>
                <div className="text-[11px] font-mono text-amber-300 bg-[#07090E] border border-white/[0.06] rounded p-2">
                  {selectedFeature.data.classificationRule}
                </div>
                <p className="text-xs text-cyan-300 leading-relaxed">
                  <span className="font-semibold">Mitigation: </span>
                  {selectedFeature.data.mitigation}
                </p>
                <div className="text-[10px] font-mono text-slate-500">
                  {selectedFeature.data.sourceNote}
                </div>
              </>
            )}

            <div className="pt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('terrain-intelligence')}
                className="flex-1 px-3 py-2 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-medium text-white flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Mountain className="w-3.5 h-3.5 text-cyan-400" />
                Terrain Analysis
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedFeature.kind === 'science' && onPlanScienceTarget) {
                    onPlanScienceTarget(
                      selectedFeature.data.locationId,
                      selectedFeature.data.linkedWaypointId,
                    );
                  } else {
                    onNavigate('route-planner');
                  }
                }}
                className="flex-1 px-3 py-2 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-semibold text-white flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Route className="w-3.5 h-3.5" />
                {selectedFeature.kind === 'science' ? 'Plan Safe Route' : 'Plan A* Route'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Archival NASA HiRISE / CTX / Rover Observations Strip for Active Region */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-display font-semibold text-white">
              NASA Orbital &amp; Rover Observations — {selectedLocation.name}
            </h2>
            <p className="text-xs text-slate-400">
              Historical HiRISE / CTX / Rover archival frames verified from NASA Image Library &amp; JPL feeds.
              {obsRetrievedAt ? ` Retrieved ${new Date(obsRetrievedAt).toLocaleTimeString()}${obsCached ? ' (cached)' : ''}.` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceTag
              type={obsFallbackReason ? 'PUBLISHED SCIENTIFIC DATASET' : 'ACTUAL NASA OBSERVATION'}
              detail={obsFallbackReason ? 'Archival Reference' : 'Verified NASA Feed'}
            />
            <button
              type="button"
              onClick={() => setObsRefreshNonce((n) => n + 1)}
              disabled={obsLoading}
              className="px-2.5 py-1 rounded bg-[#07090E] hover:bg-white/10 border border-white/15 text-[11px] font-mono text-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${obsLoading ? 'animate-spin' : ''}`} />
              Retry Feed
            </button>
          </div>
        </div>

        {obsFallbackReason && !obsError && (
          <div className="rounded bg-amber-500/10 border border-amber-400/30 px-3 py-2 text-[11px] font-mono text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span>
              {obsSource ? `${obsSource}: ` : ''}
              {obsFallbackReason}
            </span>
          </div>
        )}

        {obsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded bg-[#080A0F] border border-white/[0.06] animate-pulse" />
            ))}
          </div>
        ) : obsError ? (
          <div className="rounded bg-red-500/10 border border-red-400/30 px-3 py-3 text-xs font-mono text-red-300 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{obsError}</span>
            </div>
            <button
              type="button"
              onClick={() => setObsRefreshNonce((n) => n + 1)}
              className="px-2.5 py-1 rounded border border-red-400/40 bg-red-500/15 hover:bg-red-500/25 text-red-200 shrink-0"
            >
              Retry
            </button>
          </div>
        ) : siteObs.length === 0 ? (
          <div className="rounded bg-[#080A0F] border border-white/[0.08] px-3 py-3 text-xs font-mono text-slate-400">
            No live archival frames returned for {selectedLocation.name} from the current NASA feed query.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {siteObs.map((item) => (
              <a
                key={item.id}
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex gap-3 p-2.5 rounded bg-[#080A0F] border border-white/[0.08] hover:border-[#E85D2A]/50 transition-colors"
              >
                {item.imageUrl && !brokenObs[item.id] ? (
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    onError={() => setBrokenObs((prev) => ({ ...prev, [item.id]: true }))}
                    className="w-24 h-24 rounded object-cover shrink-0 bg-black"
                  />
                ) : (
                  <div className="w-24 h-24 rounded bg-[#121620] shrink-0 flex items-center justify-center text-[10px] font-mono text-slate-500">
                    NASA PDS
                  </div>
                )}
                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono">
                      <span className="text-emerald-400 truncate">
                        {item.instrument} · {item.observationDate}
                        {typeof item.sol === 'number' ? ` · Sol ${item.sol}` : ''}
                      </span>
                      {item.locationMatch && (
                        <span
                          className={`px-1 py-0.2 rounded border text-[9px] shrink-0 ${
                            item.locationMatch === 'REGIONAL_MATCH'
                              ? 'border-emerald-500/35 text-emerald-300'
                              : 'border-amber-500/35 text-amber-200'
                          }`}
                        >
                          {item.locationMatch === 'REGIONAL_MATCH'
                            ? 'SITE MATCH'
                            : item.locationMatch === 'CROSS_SITE_REFERENCE'
                              ? 'CROSS-SITE'
                              : 'ARCHIVAL'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-white mt-0.5 line-clamp-2">{item.title}</div>
                    {item.locationNote && (
                      <div className="text-[10px] font-mono text-amber-300/90 mt-0.5 line-clamp-1">
                        {item.locationNote}
                      </div>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{item.description}</p>
                  </div>
                  <span className="text-[10px] font-mono text-[#E85D2A] inline-flex items-center gap-1">
                    NASA Archive <ExternalLink className="w-2.5 h-2.5" />
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
