import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  ImageOff,
  RefreshCw,
  Thermometer,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  MarsLocation,
  NasaDatasetRecord,
  NasaEndpointKey,
  NasaEndpointProbe,
  NasaEnvironmentResponse,
  NasaImageryItem,
  PdsOrbitalProduct,
  RetrievalBadgeStatus,
} from '../../types/mars';
import { ProvenanceTag } from '../ProvenanceTag';

interface NasaDataCentreViewProps {
  datasets: NasaDatasetRecord[];
  selectedLocation: MarsLocation;
}

interface ImageryResponse {
  site: string;
  apiSource: string;
  fallbackMode: boolean;
  fallbackReason?: string;
  cached?: boolean;
  retrievedAt: string;
  items: NasaImageryItem[];
}

interface PdsProductsResponse {
  site: string;
  lat: number;
  lon: number;
  retrievedAt: string;
  cached: boolean;
  status: RetrievalBadgeStatus;
  apiSource: string;
  error?: string;
  products: PdsOrbitalProduct[];
}

type FiveCategoryIntegrityLabel =
  | 'NASA data successfully retrieved'
  | 'NASA archival reference'
  | 'Derived analysis'
  | 'Simulated demonstration data'
  | 'Unavailable or failed retrieval';

function getFiveCategoryIntegrity(
  ds: NasaDatasetRecord,
  status: RetrievalBadgeStatus,
): {
  category: FiveCategoryIntegrityLabel;
  badgeCls: string;
  actuallyRetrievedText: string;
} {
  if (ds.credibilityClass === 'SIMULATED DEMONSTRATION' || status === 'SIMULATED') {
    return {
      category: 'Simulated demonstration data',
      badgeCls: 'border-orange-500/45 bg-orange-500/15 text-orange-300',
      actuallyRetrievedText: 'No — Local deterministic synthetic model',
    };
  }
  if (status === 'VERIFIED') {
    return {
      category: 'NASA data successfully retrieved',
      badgeCls: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300',
      actuallyRetrievedText: 'Yes — Structured NASA/JPL/PDS records validated',
    };
  }
  if (status === 'CONNECTED') {
    return {
      category: 'NASA archival reference',
      badgeCls: 'border-cyan-500/45 bg-cyan-500/15 text-cyan-300',
      actuallyRetrievedText: 'Archival layer reachable only (no raw telemetry/DEM array retrieved)',
    };
  }
  return {
    category: 'Unavailable or failed retrieval',
    badgeCls: 'border-red-500/45 bg-red-500/15 text-red-300',
    actuallyRetrievedText: 'No — Endpoint failed or returned no validated payload',
  };
}

function statusBadgeMeta(status: RetrievalBadgeStatus) {
  switch (status) {
    case 'VERIFIED':
      return {
        label: 'VERIFIED (DATA RETRIEVED)',
        cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
        Icon: CheckCircle2,
      };
    case 'CONNECTED':
      return {
        label: 'ARCHIVAL REF (REACHABLE)',
        cls: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
        Icon: Wifi,
      };
    case 'SIMULATED':
      return {
        label: 'SIMULATED',
        cls: 'border-orange-500/45 bg-orange-500/15 text-orange-300',
        Icon: Database,
      };
    default:
      return {
        label: 'UNAVAILABLE',
        cls: 'border-red-500/40 bg-red-500/15 text-red-300',
        Icon: WifiOff,
      };
  }
}

export function NasaDataCentreView({ datasets, selectedLocation }: NasaDataCentreViewProps) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, NasaEndpointProbe>>({});
  const [checkedAt, setCheckedAt] = useState<string>('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusCached, setStatusCached] = useState(false);

  const [envData, setEnvData] = useState<NasaEnvironmentResponse | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  const [pdsData, setPdsData] = useState<PdsProductsResponse | null>(null);
  const [pdsLoading, setPdsLoading] = useState(false);
  const [pdsError, setPdsError] = useState<string | null>(null);

  const [imagery, setImagery] = useState<ImageryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedMode, setFeedMode] = useState<
    'site' | 'hirise' | 'ctx' | 'crism' | 'themis' | 'perseverance' | 'curiosity'
  >('site');
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const checkEndpoints = useCallback(async (forceRefresh = false, singleKey?: NasaEndpointKey) => {
    if (singleKey) {
      setRetryingKey(singleKey);
    } else {
      setStatusLoading(true);
    }
    setStatusError(null);
    try {
      const qs = new URLSearchParams();
      if (forceRefresh) qs.set('refresh', '1');
      if (singleKey) qs.set('endpoint', singleKey);
      const res = await fetch(`/api/nasa/status${qs.toString() ? `?${qs.toString()}` : ''}`);
      if (!res.ok) throw new Error(`Status probe returned HTTP ${res.status}`);
      const data = (await res.json()) as {
        checkedAt?: string;
        cached?: boolean;
        probes?: Record<string, NasaEndpointProbe>;
      };
      setProbes((prev) => ({ ...prev, ...(data.probes || {}) }));
      setCheckedAt(data.checkedAt || new Date().toISOString());
      setStatusCached(Boolean(data.cached));
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : 'Unable to probe NASA/USGS endpoints.',
      );
      setCheckedAt(new Date().toISOString());
    } finally {
      setStatusLoading(false);
      setRetryingKey(null);
    }
  }, []);

  const loadEnvironment = useCallback(async (forceRefresh = false) => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const res = await fetch(`/api/nasa/environment${forceRefresh ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NasaEnvironmentResponse;
      setEnvData(data);
    } catch (err) {
      setEnvError(
        err instanceof Error ? err.message : 'Failed to retrieve MEDA / REMS archives.',
      );
    } finally {
      setEnvLoading(false);
    }
  }, []);

  const loadPdsProducts = useCallback(
    async (forceRefresh = false) => {
      setPdsLoading(true);
      setPdsError(null);
      try {
        const qs = new URLSearchParams({
          lat: String(selectedLocation.lat),
          lon: String(selectedLocation.lon),
          site: selectedLocation.name,
        });
        if (forceRefresh) qs.set('refresh', '1');
        const res = await fetch(`/api/nasa/pds-products?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PdsProductsResponse;
        setPdsData(data);
      } catch (err) {
        setPdsError(
          err instanceof Error ? err.message : 'Unable to query PDS Geosciences ODE.',
        );
      } finally {
        setPdsLoading(false);
      }
    },
    [selectedLocation.lat, selectedLocation.lon, selectedLocation.name],
  );

  const loadImagery = useCallback(
    async (mode: typeof feedMode, forceRefresh = false) => {
      setLoading(true);
      setErrorMsg(null);
      setBrokenImages({});
      try {
        const params = new URLSearchParams();
        if (mode === 'perseverance') {
          params.set('site', 'Jezero Crater');
          params.set('rover', 'perseverance');
        } else if (mode === 'curiosity') {
          params.set('site', 'Gale Crater');
          params.set('rover', 'curiosity');
        } else {
          params.set('site', selectedLocation.name);
          if (mode === 'hirise' || mode === 'ctx' || mode === 'crism' || mode === 'themis') {
            params.set('instrument', mode);
          }
        }
        if (forceRefresh) params.set('refresh', '1');
        const res = await fetch(`/api/nasa/imagery?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ImageryResponse;
        setImagery(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to retrieve NASA archival feed.');
      } finally {
        setLoading(false);
      }
    },
    [selectedLocation.name],
  );

  useEffect(() => {
    void checkEndpoints(false);
    void loadEnvironment(false);
  }, [checkEndpoints, loadEnvironment]);

  useEffect(() => {
    void loadImagery(feedMode, false);
  }, [loadImagery, feedMode]);

  useEffect(() => {
    void loadPdsProducts(false);
  }, [loadPdsProducts]);

  const getDatasetStatus = (ds: NasaDatasetRecord): RetrievalBadgeStatus => {
    if (ds.credibilityClass === 'SIMULATED DEMONSTRATION' || !ds.endpointKey) {
      return 'SIMULATED';
    }
    const p = probes[ds.endpointKey];
    if (!p) return 'UNAVAILABLE';
    return p.status;
  };

  const counts = datasets.reduce(
    (acc, ds) => {
      const s = getDatasetStatus(ds);
      acc[s] += 1;
      return acc;
    },
    { VERIFIED: 0, CONNECTED: 0, UNAVAILABLE: 0, SIMULATED: 0 } as Record<RetrievalBadgeStatus, number>,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2.5 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-white">NASA Data Centre</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-4xl">
            Audited NASA/JPL/USGS/PDS data provenance registry. Distinguishes verified retrieved data, endpoint connectivity, unavailable services, and simulated demonstration models—never misrepresenting archival or simulated data as live telemetry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ProvenanceTag type="ACTUAL NASA OBSERVATION" detail="MRO PDS · Perseverance · Curiosity · MEDA · REMS" />
          <ProvenanceTag type="PUBLISHED SCIENTIFIC DATASET" detail="MOLA · Viking · THEMIS Baselines" />
          <ProvenanceTag type="SIMULATED DEMONSTRATION" detail="25×25 km Local Grid Separated" />
        </div>
      </div>

      {/* Live Endpoint Verification & Status Legend Bar */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-display font-semibold text-white">
              Live NASA, USGS &amp; PDS Retrieval Verification
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {statusLoading
                ? 'Retrieving sample payloads from NASA Mars Trek, USGS WMS, PDS ODE, NASA Image Library, MEDA & REMS...'
                : `Last probe: ${checkedAt ? new Date(checkedAt).toLocaleString() : '—'}${statusCached ? ' (cached)' : ' (fresh)'} · Checks actual payload bytes & JSON records, not just website ping.`}
            </div>
          </div>

          <button
            type="button"
            disabled={statusLoading || loading || envLoading || pdsLoading}
            onClick={() => {
              void checkEndpoints(true);
              void loadImagery(feedMode, true);
              void loadEnvironment(true);
              void loadPdsProducts(true);
            }}
            className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d14e1e] disabled:opacity-50 text-xs font-mono font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                statusLoading || loading || envLoading || pdsLoading ? 'animate-spin' : ''
              }`}
            />
            Retry &amp; Refresh All NASA Sources
          </button>
        </div>

        {/* 5-Category Provenance & Retrieval Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2 border-t border-white/[0.08] text-xs font-mono">
          <div className="p-2.5 rounded bg-[#090B10] border border-emerald-500/25 flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] text-emerald-300 font-semibold">NASA data successfully retrieved</div>
              <div className="text-[10px] text-slate-400">Validated JSON/PDS records</div>
            </div>
            <span className="text-lg font-bold text-emerald-400 tabular-nums shrink-0">
              {statusLoading ? '…' : counts.VERIFIED}
            </span>
          </div>
          <div className="p-2.5 rounded bg-[#090B10] border border-cyan-500/25 flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] text-cyan-300 font-semibold">NASA archival reference</div>
              <div className="text-[10px] text-slate-400">WMTS/WMS &amp; baseline refs</div>
            </div>
            <span className="text-lg font-bold text-cyan-400 tabular-nums shrink-0">
              {statusLoading ? '…' : counts.CONNECTED}
            </span>
          </div>
          <div className="p-2.5 rounded bg-[#090B10] border border-amber-500/25 flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] text-amber-300 font-semibold">Derived analysis</div>
              <div className="text-[10px] text-slate-400">A*, slope, priority &amp; life-support</div>
            </div>
            <span className="text-lg font-bold text-amber-400 tabular-nums shrink-0">4</span>
          </div>
          <div className="p-2.5 rounded bg-[#090B10] border border-orange-500/25 flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] text-orange-300 font-semibold">Simulated demonstration data</div>
              <div className="text-[10px] text-slate-400">25×25 km local grid</div>
            </div>
            <span className="text-lg font-bold text-orange-400 tabular-nums shrink-0">{counts.SIMULATED}</span>
          </div>
          <div className="p-2.5 rounded bg-[#090B10] border border-red-500/25 flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] text-red-300 font-semibold">Unavailable or failed retrieval</div>
              <div className="text-[10px] text-slate-400">Timeout / HTTP error</div>
            </div>
            <span className="text-lg font-bold text-red-400 tabular-nums shrink-0">
              {statusLoading ? '…' : counts.UNAVAILABLE}
            </span>
          </div>
        </div>

        {statusError && (
          <div className="p-2.5 rounded bg-red-500/10 border border-red-500/35 text-xs text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>Status probe failed: {statusError}</span>
          </div>
        )}
      </div>

      {/* Dataset Catalog Table */}
      <div className="bg-[#0D1016] border border-white/10 rounded overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-display font-semibold text-white">
            Audited Planetary Dataset &amp; Model Registry ({datasets.length})
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            Every source shows real retrieval outcome, observation date &amp; technical limits
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#090B10] font-mono text-[11px] text-slate-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-2.5">Dataset, Provenance &amp; Limitations</th>
                <th className="px-4 py-2.5">Mission &amp; Instrument</th>
                <th className="px-4 py-2.5">Official Source &amp; Coverage</th>
                <th className="px-4 py-2.5">Retrieval Status &amp; Timing</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {datasets.map((ds) => {
                const isSimulated = ds.credibilityClass === 'SIMULATED DEMONSTRATION' || !ds.endpointKey;
                const probe = ds.endpointKey ? probes[ds.endpointKey] : undefined;
                const status: RetrievalBadgeStatus = isSimulated
                  ? 'SIMULATED'
                  : probe?.status || 'UNAVAILABLE';
                const badge = statusBadgeMeta(status);
                const BadgeIcon = badge.Icon;
                const isRetryingThis = ds.endpointKey && retryingKey === ds.endpointKey;

                return (
                  <tr key={ds.id} className="hover:bg-white/[0.02] align-top">
                    <td className="px-4 py-3 max-w-md">
                      <div className="font-semibold text-white">{ds.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <ProvenanceTag type={ds.credibilityClass} />
                        <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-[#07090E] border border-white/10">
                          {ds.dataNature}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                        {ds.description}
                      </p>
                      <div className="text-[10px] font-mono text-cyan-300/90 mt-1">
                        Integration: {ds.integrationMethod}
                      </div>
                      <div className="text-[10px] text-amber-300/90 mt-0.5">
                        Note: {ds.limitations}
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-[11px] text-slate-300 min-w-[180px]">
                      <div className="text-white font-semibold">{ds.mission}</div>
                      <div className="text-slate-400 mt-0.5">{ds.instrument}</div>
                      <div className="text-slate-500 mt-1">{ds.spatialResolution}</div>
                    </td>

                    <td className="px-4 py-3 text-[11px] text-slate-300 min-w-[200px]">
                      <div className="font-mono text-white">{ds.officialSourceLabel}</div>
                      <div className="text-slate-400 mt-0.5">{ds.dataType}</div>
                      <div className="font-mono text-slate-400 mt-1">
                        Coverage: {ds.geographicCoverage}
                      </div>
                      <div className="font-mono text-slate-500 mt-0.5">
                        Window: {ds.coveragePeriod}
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-[11px] min-w-[240px]">
                      {statusLoading && !isSimulated && !probe ? (
                        <span className="text-slate-400">CHECKING...</span>
                      ) : (() => {
                        const integrity = getFiveCategoryIntegrity(ds, status);
                        return (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${badge.cls}`}
                              >
                                <BadgeIcon className="w-3 h-3" />
                                {badge.label}
                              </span>
                            </div>
                            <div
                              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold ${integrity.badgeCls}`}
                            >
                              {integrity.category}
                            </div>
                            <div className="text-[10px] text-slate-300">
                              <span className="text-slate-500">Data Retrieved: </span>
                              {integrity.actuallyRetrievedText}
                            </div>
                            {!isSimulated && probe && (
                              <>
                                <div className="text-slate-300 text-[10px] leading-snug">
                                  {probe.detail}
                                </div>
                                {probe.observationDate && (
                                  <div className="text-cyan-300 text-[10px]">
                                    Obs Date: {probe.observationDate}
                                  </div>
                                )}
                                <div className="text-slate-500 text-[10px]">
                                  Checked:{' '}
                                  {probe.retrievedAt
                                    ? new Date(probe.retrievedAt).toLocaleString()
                                    : 'Pending'}
                                  {typeof probe.latencyMs === 'number' ? ` · ${probe.latencyMs} ms` : ''}
                                </div>
                                {probe.error && (
                                  <div className="text-red-300 text-[10px]">
                                    Error: {probe.error}
                                  </div>
                                )}
                              </>
                            )}
                            {isSimulated && (
                              <div className="text-orange-300/90 text-[10px]">
                                Local deterministic synthetic model (no external spacecraft retrieval).
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    <td className="px-4 py-3 min-w-[140px]">
                      <div className="flex flex-col gap-1.5">
                        <a
                          href={ds.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-[#07090E] hover:border-[#E85D2A] border border-white/15 font-mono text-[11px] text-[#E85D2A] whitespace-nowrap"
                        >
                          Open Source <ExternalLink className="w-3 h-3" />
                        </a>
                        {ds.endpointKey && !isSimulated && (
                          <button
                            type="button"
                            disabled={Boolean(isRetryingThis) || statusLoading}
                            onClick={() => void checkEndpoints(true, ds.endpointKey)}
                            className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/10 border border-white/10 font-mono text-[11px] text-slate-200 disabled:opacity-50 whitespace-nowrap"
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${isRetryingThis ? 'animate-spin' : ''}`}
                            />
                            Retry Retrieval
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real Rover Environmental Archives (MEDA & REMS) */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-[#E85D2A]" />
              Retrieved Rover Environmental Measurements (MEDA &amp; REMS Archives)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Actual archived meteorological measurements from Mars 2020 MEDA (Jezero Crater) and MSL REMS (Gale Crater). Displayed as historical mission observations, never fabricated current telemetry.
            </p>
          </div>
          <button
            type="button"
            disabled={envLoading}
            onClick={() => void loadEnvironment(true)}
            className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-mono text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${envLoading ? 'animate-spin' : ''}`} />
            Retry Environmental Feeds
          </button>
        </div>

        {envError && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/35 text-xs text-red-200">
            Environmental feed error: {envError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[
            {
              title: 'Mars 2020 Perseverance · MEDA (Jezero Crater)',
              feed: envData?.meda,
              isLocalMatch: selectedLocation.id === 'jezero-crater',
            },
            {
              title: 'MSL Curiosity · REMS (Gale Crater)',
              feed: envData?.rems,
              isLocalMatch: selectedLocation.id === 'gale-crater',
            },
          ].map(({ title, feed, isLocalMatch }) => {
            const st: RetrievalBadgeStatus = feed?.status || (envLoading ? 'CONNECTED' : 'UNAVAILABLE');
            const b = statusBadgeMeta(st);
            return (
              <div
                key={title}
                className="bg-[#090B10] border border-white/[0.08] rounded p-3.5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white">{title}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[9px] font-mono font-semibold ${
                        isLocalMatch
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                      }`}
                    >
                      {isLocalMatch
                        ? `ACTIVE SITE MATCH (${selectedLocation.name})`
                        : `CROSS-SITE REF (Active: ${selectedLocation.name})`}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${b.cls}`}
                    >
                      {envLoading ? 'LOADING' : b.label}
                    </span>
                    {feed?.sourceUrl && (
                      <a
                        href={feed.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono text-[#E85D2A] hover:underline inline-flex items-center gap-1"
                      >
                        Source <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>

                {feed?.note && <p className="text-[11px] text-slate-400">{feed.note}</p>}
                {feed?.error && (
                  <p className="text-[11px] font-mono text-red-300">Error: {feed.error}</p>
                )}

                {envLoading ? (
                  <div className="h-28 rounded bg-[#05070B] animate-pulse" />
                ) : feed && feed.records.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-mono">
                      <thead className="text-slate-400 border-b border-white/10">
                        <tr>
                          <th className="py-1.5 pr-2">Sol</th>
                          <th className="py-1.5 pr-2">Earth Date</th>
                          <th className="py-1.5 pr-2">Temp (°C)</th>
                          <th className="py-1.5 pr-2">Pressure</th>
                          <th className="py-1.5">Season / Ls</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05] text-slate-200">
                        {feed.records.slice(0, 5).map((r) => (
                          <tr key={`${r.instrument}-${r.sol}`}>
                            <td className="py-1.5 pr-2 font-semibold text-cyan-300">Sol {r.sol}</td>
                            <td className="py-1.5 pr-2 tabular-nums">{r.terrestrialDate}</td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              {r.minTempC}..{r.maxTempC}°C
                            </td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              {r.pressureMbar} mbar ({r.pressurePa} Pa)
                            </td>
                            <td className="py-1.5 text-slate-400 truncate max-w-[140px]">
                              {r.season} · Ls {r.ls}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs font-mono text-slate-400 py-4 text-center">
                    No environmental sol records returned.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Georeferenced PDS ODE Products for Selected Location */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-display font-semibold text-white">
              PDS Geosciences Orbital Data Explorer (ODE) — {selectedLocation.name} ({selectedLocation.lat.toFixed(2)}°, {selectedLocation.lon.toFixed(2)}°)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Georeferenced MRO HiRISE (RDRV11) and CTX (EDR) PDS products overlapping the active coordinate window (±0.35°).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pdsData && (
              <span
                className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                  statusBadgeMeta(pdsData.status).cls
                }`}
              >
                {pdsData.status}
              </span>
            )}
            <button
              type="button"
              disabled={pdsLoading}
              onClick={() => void loadPdsProducts(true)}
              className="px-2.5 py-1 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] font-mono text-white flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${pdsLoading ? 'animate-spin' : ''}`} />
              Retry PDS Query
            </button>
          </div>
        </div>

        {(pdsError || pdsData?.error) && (
          <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/35 text-xs text-amber-200">
            PDS ODE Notice: {pdsError || pdsData?.error}
          </div>
        )}

        {pdsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-24 rounded bg-[#090B10] animate-pulse" />
            ))}
          </div>
        ) : pdsData && pdsData.products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {pdsData.products.map((p) => (
              <div
                key={`${p.productId}-${p.observationDate}`}
                className="p-3 rounded bg-[#090B10] border border-white/[0.08] space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                  <span className="text-emerald-400 font-semibold truncate">{p.instrument}</span>
                  {p.geographicMatch && (
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[9px] shrink-0 ${
                        p.geographicMatch === 'IN_SECTOR'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : p.geographicMatch === 'ADJACENT_REGION'
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                            : 'border-slate-500/40 bg-white/5 text-slate-300'
                      }`}
                    >
                      {p.geographicMatch === 'IN_SECTOR'
                        ? `IN SECTOR · ${p.distanceKm?.toFixed(1)} km`
                        : p.geographicMatch === 'ADJACENT_REGION'
                          ? `ADJACENT SWATH · ${p.distanceKm?.toFixed(1)} km`
                          : `OUT OF SECTOR · ${p.distanceKm?.toFixed(1)} km`}
                    </span>
                  )}
                </div>
                <div className="text-xs font-mono font-semibold text-white truncate">
                  {p.productId}
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2">{p.description}</p>
                <div className="flex items-center justify-between text-[10px] font-mono pt-1">
                  <span className="text-slate-500 tabular-nums">
                    {p.observationDate} · {p.centerLat.toFixed(2)}°, {p.centerLon.toFixed(2)}°
                  </span>
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#E85D2A] hover:underline inline-flex items-center gap-1 shrink-0"
                  >
                    Open PDS Product <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs font-mono text-slate-400 py-3">
            No georeferenced HiRISE/CTX PDS products matched within ±0.35° of {selectedLocation.name}.
          </div>
        )}
      </div>

      {/* Archival Imagery Browser */}
      <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-display font-semibold text-white">
              NASA / JPL Archival Imagery &amp; Instrument Query
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Source: {imagery?.apiSource || 'Querying NASA archive...'}
              {imagery?.retrievedAt
                ? ` · Retrieved ${new Date(imagery.retrievedAt).toLocaleTimeString()}${imagery.cached ? ' (cached)' : ''}`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 bg-[#07090E] p-1 rounded border border-white/10">
              {[
                { id: 'site', label: `${selectedLocation.name}` },
                { id: 'hirise', label: 'MRO HiRISE' },
                { id: 'ctx', label: 'MRO CTX' },
                { id: 'crism', label: 'MRO CRISM' },
                { id: 'themis', label: 'Odyssey THEMIS' },
                { id: 'perseverance', label: 'Perseverance' },
                { id: 'curiosity', label: 'Curiosity' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFeedMode(tab.id as typeof feedMode)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors whitespace-nowrap ${
                    feedMode === tab.id ? 'bg-[#E85D2A] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadImagery(feedMode, true)}
              className="px-2.5 py-1.5 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] font-mono text-white flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Retry Feed
            </button>
          </div>
        </div>

        {imagery?.fallbackMode && (
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            <span className="font-semibold">Graceful Fallback (No Fabricated Data):</span> Live NASA external endpoint returned unavailable or empty ({imagery.fallbackReason}). Showing verified historical PDS/JPL reference metadata only.
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            Unable to query NASA proxy: {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-56 rounded bg-[#090B10] border border-white/[0.06] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(imagery?.items || []).map((item) => {
              const showFallbackVisual = !item.imageUrl || brokenImages[item.id];
              return (
                <div
                  key={item.id}
                  className="bg-[#090B10] border border-white/[0.08] rounded overflow-hidden flex flex-col"
                >
                  <div className="h-40 bg-[#05070B] relative flex items-center justify-center overflow-hidden">
                    {!showFallbackVisual ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        onError={() => setBrokenImages((prev) => ({ ...prev, [item.id]: true }))}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-[#141821] to-[#080A0F]">
                        <ImageOff className="w-5 h-5 text-slate-500 mb-1.5" />
                        <div className="text-[11px] font-mono text-slate-400">
                          {item.mission} · {item.id}
                        </div>
                      </div>
                    )}
                    <span
                      className={`absolute top-2 right-2 px-1.5 py-0.5 rounded border text-[9px] font-mono font-semibold ${
                        item.isFallback
                          ? 'bg-amber-950/90 border-amber-400/50 text-amber-200'
                          : 'bg-emerald-950/90 border-emerald-400/50 text-emerald-200'
                      }`}
                    >
                      {item.isFallback ? 'PUBLISHED REF' : 'VERIFIED'}
                    </span>
                  </div>
                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
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
                      <h3 className="text-xs font-semibold text-white mt-1 line-clamp-2">{item.title}</h3>
                      {item.locationNote && (
                        <div className="text-[10px] font-mono text-amber-300/90 mt-0.5 line-clamp-1">
                          {item.locationNote}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-3">{item.description}</p>
                    </div>
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-mono text-[#E85D2A] hover:underline inline-flex items-center gap-1 pt-1"
                    >
                      Open Official Record <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
