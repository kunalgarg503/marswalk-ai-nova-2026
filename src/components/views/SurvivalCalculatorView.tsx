import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Download,
  Droplets,
  FileText,
  Gauge,
  RefreshCw,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import type {
  CentralMissionState,
  ResourceStatusLevel,
  SurvivalInputs,
} from '../../types/mars';
import { createMissionSnapshot } from '../../engine/missionState';
import {
  buildResourcePlanningReportText,
  downloadResourcePlanningPdf,
} from '../../utils/missionSummaryPdf';
import { ProvenanceTag } from '../ProvenanceTag';

interface SurvivalCalculatorViewProps {
  missionState: CentralMissionState;
  inputs: SurvivalInputs;
  onChangeInputs: (next: SurvivalInputs) => void;
}

function statusBadgeStyle(status: ResourceStatusLevel): string {
  if (status === 'INSUFFICIENT') return 'border-red-500/40 bg-red-500/15 text-red-300';
  if (status === 'LIMITED') return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
}

function statusBarColor(status: ResourceStatusLevel): string {
  if (status === 'INSUFFICIENT') return 'bg-red-500';
  if (status === 'LIMITED') return 'bg-amber-400';
  return 'bg-emerald-500';
}

export function SurvivalCalculatorView({
  missionState,
  inputs,
  onChangeInputs,
}: SurvivalCalculatorViewProps) {
  const {
    survivalResults: results,
    activeRoute,
    routePlan,
    region,
    missionReadiness,
    timing,
  } = missionState;
  const locationName = region.name;

  const [copiedReport, setCopiedReport] = useState(false);
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [showEmergencyOverlay, setShowEmergencyOverlay] = useState(false);
  const [lastExportMeta, setLastExportMeta] = useState<{
    snapshotId: string;
    generatedAtIso: string;
    kind: 'TXT' | 'PDF';
  } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const update = <K extends keyof SurvivalInputs>(key: K, value: SurvivalInputs[K]) => {
    onChangeInputs({ ...inputs, [key]: value });
  };

  const toggleEmergencyScenario = (pct: 10 | 20 | 30) => {
    update('emergencyExtensionPct', inputs.emergencyExtensionPct === pct ? 0 : pct);
  };

  const oxygenDelta = Number((results.totalOxygenRequiredKg - results.nominalOxygenRequiredKg).toFixed(2));
  const energyDelta = Number((results.totalEnergyRequiredKwh - results.nominalEnergyRequiredKwh).toFixed(2));
  const waterDelta = Number((results.totalWaterRequiredL - results.nominalWaterRequiredL).toFixed(2));
  const durationDelta = Number((results.effectiveMissionDurationHr - results.nominalDurationHr).toFixed(2));

  const handleToggleRouteSync = (sync: boolean) => {
    if (sync) {
      onChangeInputs({ ...inputs, useRouteSync: true });
    } else {
      onChangeInputs({
        ...inputs,
        useRouteSync: false,
        manualDistanceKm: activeRoute.distanceKm,
        manualTerrainDifficulty: Math.round(activeRoute.meanDifficulty),
      });
    }
  };

  // Depletion curve points over effective mission duration
  const steps = 10;
  const svgW = 540;
  const svgH = 175;
  const padX = 44;
  const padY = 18;
  const plotW = svgW - padX * 2;
  const plotH = svgH - padY * 2;

  const makeDepletionPoints = (available: number, required: number) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const frac = i / steps;
      const rem = Math.max(0, available - required * frac);
      const maxCap = Math.max(available, required, 1);
      const x = padX + frac * plotW;
      const y = padY + (1 - rem / maxCap) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  const o2Line = makeDepletionPoints(inputs.availableOxygenSupplyKg, results.totalOxygenRequiredKg);
  const energyLine = makeDepletionPoints(inputs.availableEnergySupplyKwh, results.totalEnergyRequiredKwh);
  const waterLine = makeDepletionPoints(inputs.availableWaterSupplyL, results.totalWaterRequiredL);

  const previewBundle = buildResourcePlanningReportText(missionState);
  const reportText = previewBundle.text;

  const handleDownloadTxtReport = () => {
    const snapshot = createMissionSnapshot(missionState);
    const { text, validation } = buildResourcePlanningReportText(snapshot);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }
    setValidationErrors([]);
    setLastExportMeta({
      snapshotId: snapshot.snapshotId,
      generatedAtIso: snapshot.generatedAtIso,
      kind: 'TXT',
    });

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (inputs.missionName || 'marswalk-mission')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    a.download = `${slug || 'marswalk'}-resource-report-${snapshot.snapshotId.slice(-9)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdfReport = () => {
    const snapshot = createMissionSnapshot(missionState);
    const res = downloadResourcePlanningPdf(snapshot);
    if (!res.ok) {
      setValidationErrors(res.errors);
      return;
    }
    setValidationErrors([]);
    setLastExportMeta({
      snapshotId: res.snapshotId,
      generatedAtIso: res.generatedAtIso,
      kind: 'PDF',
    });
  };

  const handleCopyReport = () => {
    const snapshot = createMissionSnapshot(missionState);
    const { text, validation } = buildResourcePlanningReportText(snapshot);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }
    setValidationErrors([]);
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2000);
      })
      .catch(() => {
        setShowReportPreview(true);
      });
  };

  const coveragePct = (available: number, required: number) =>
    Math.min(100, Math.round((available / Math.max(0.01, required)) * 100));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          <h1 className="text-2xl font-display font-bold text-white">
            Astronaut Survival &amp; Resource Calculator
          </h1>
          <p className="text-xs text-slate-400 max-w-4xl">
            Parametric oxygen, energy, water, duration, emergency reserve, and readiness planning estimator integrated with{' '}
            <span className="text-slate-200">{activeRoute.label}</span> ({routePlan.originName} → {routePlan.destinationName}) in{' '}
            <span className="text-slate-200">{locationName}</span>.
          </p>
          <div className="pt-0.5">
            <ProvenanceTag type="DERIVED CALCULATION" detail="Planning Estimate Only" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowEmergencyOverlay((v) => !v)}
            className={`px-3.5 py-2 rounded border text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              showEmergencyOverlay || inputs.emergencyExtensionPct > 0
                ? 'bg-amber-500/20 border-amber-400 text-amber-200 hover:bg-amber-500/30'
                : 'bg-[#0D1016] border-white/15 text-slate-200 hover:border-[#E85D2A]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-[#E85D2A]" />
            Emergency Impact
            {inputs.emergencyExtensionPct > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-[#E85D2A] text-white text-[10px]">
                +{inputs.emergencyExtensionPct}%
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadTxtReport}
            className="px-3 py-2 rounded bg-[#0D1016] hover:border-[#E85D2A] border border-white/15 text-xs font-mono font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Export .TXT
          </button>
          <button
            type="button"
            onClick={handleDownloadPdfReport}
            className="px-3.5 py-2 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-xs font-mono font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export Resource PDF
          </button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="p-3.5 rounded bg-red-500/12 border border-red-500/50 text-xs text-red-200 space-y-1">
          <div className="font-mono font-bold text-red-300 uppercase flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            Pre-Export Validation Blocked Report Generation
          </div>
          <ul className="list-disc pl-5 space-y-0.5 font-mono text-[11px]">
            {validationErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {lastExportMeta && (
        <div className="px-3.5 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono text-emerald-200 flex flex-wrap items-center justify-between gap-2">
          <span>
            Exported synchronized {lastExportMeta.kind} report · Snapshot ID:{' '}
            <strong className="text-white">{lastExportMeta.snapshotId}</strong>
          </span>
          <span className="text-slate-300">UTC: {lastExportMeta.generatedAtIso}</span>
        </div>
      )}

      {/* Mandatory Scientific Transparency Banner */}
      <div className="p-3.5 rounded bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Planning Estimate Disclaimer:</span> All oxygen, energy, water, and readiness metrics are illustrative planning estimates built from transparent configurable equations. They are{' '}
          <span className="underline">not</span> actual NASA spacesuit (xEMU/PLSS) specifications, official mission requirements, or astronaut safety certifications.
        </div>
      </div>

      {/* Top Resource Category Dashboard Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3.5">
        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1">
          <div className="text-[10px] font-mono uppercase text-slate-400">Oxygen Demand</div>
          <div className="text-xl font-mono font-bold text-white tabular-nums">
            {results.totalOxygenRequiredKg.toFixed(2)} <span className="text-xs text-slate-400">kg</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {results.totalOxygenPerAstronautKg.toFixed(2)} kg / crew
            {oxygenDelta > 0 && (
              <span className="text-amber-300 ml-1">(+{oxygenDelta.toFixed(2)} kg)</span>
            )}
          </div>
          <div className={`text-[10px] font-mono font-semibold ${results.oxygenStatus === 'SUFFICIENT' ? 'text-emerald-400' : results.oxygenStatus === 'LIMITED' ? 'text-amber-400' : 'text-red-400'}`}>
            {results.oxygenStatus} (Est.)
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1">
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400" />
            Energy Demand
          </div>
          <div className="text-xl font-mono font-bold text-white tabular-nums">
            {results.totalEnergyRequiredKwh.toFixed(2)} <span className="text-xs text-slate-400">kWh</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {results.totalEnergyPerAstronautKwh.toFixed(2)} kWh / crew
            {energyDelta > 0 && (
              <span className="text-amber-300 ml-1">(+{energyDelta.toFixed(1)})</span>
            )}
          </div>
          <div className={`text-[10px] font-mono font-semibold ${results.energyStatus === 'SUFFICIENT' ? 'text-emerald-400' : results.energyStatus === 'LIMITED' ? 'text-amber-400' : 'text-red-400'}`}>
            {results.energyStatus} (Est.)
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1">
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <Droplets className="w-3 h-3 text-sky-400" />
            Water Demand
          </div>
          <div className="text-xl font-mono font-bold text-white tabular-nums">
            {results.totalWaterRequiredL.toFixed(2)} <span className="text-xs text-slate-400">L</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {results.totalWaterPerAstronautL.toFixed(2)} L / crew
            {waterDelta > 0 && (
              <span className="text-amber-300 ml-1">(+{waterDelta.toFixed(2)} L)</span>
            )}
          </div>
          <div className={`text-[10px] font-mono font-semibold ${results.waterStatus === 'SUFFICIENT' ? 'text-emerald-400' : results.waterStatus === 'LIMITED' ? 'text-amber-400' : 'text-red-400'}`}>
            {results.waterStatus} (Est.)
          </div>
        </div>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1">
          <div className="text-[10px] font-mono uppercase text-slate-400">Mission Duration</div>
          <div className="text-xl font-mono font-bold text-white tabular-nums">
            {results.effectiveMissionDurationHr.toFixed(1)} <span className="text-xs text-slate-400">hr</span>
          </div>
          <div className="text-[11px] font-mono text-cyan-300 tabular-nums">
            {results.effectiveMissionDurationSols.toFixed(2)} Martian sols
            {durationDelta > 0 && (
              <span className="text-amber-300 ml-1">(+{durationDelta.toFixed(1)}h)</span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-400 tabular-nums">
            Walk {results.walkingDurationHr.toFixed(1)}h + Rest {results.restDurationHr.toFixed(1)}h
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowEmergencyOverlay(true)}
          className="text-left bg-[#0D1016] hover:border-[#E85D2A]/60 border border-white/10 rounded p-4 space-y-1 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
            <span>Emergency Reserve</span>
            <span className="text-[#E85D2A]">Overlay →</span>
          </div>
          <div className="text-xl font-mono font-bold text-white tabular-nums">
            +{inputs.safetyReservePct}%
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {results.reserveOxygenKg.toFixed(2)} kg · {results.reserveEnergyKwh.toFixed(1)} kWh
          </div>
          <div className="text-[10px] font-mono text-amber-300 tabular-nums">
            Sim Shift: {inputs.emergencyExtensionPct === 0 ? 'Nominal (0%)' : `+${inputs.emergencyExtensionPct}% dur`}
          </div>
        </button>

        <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-1">
          <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
            <Gauge className="w-3 h-3 text-[#E85D2A]" />
            Resource &amp; Readiness
          </div>
          <div className="text-xl font-mono font-bold text-white tabular-nums">
            {results.missionReadinessScore} <span className="text-xs text-slate-400">/ 100</span>
          </div>
          <div className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${statusBadgeStyle(results.overallResourceStatus)}`}>
            {results.overallResourceStatus}
          </div>
        </div>
      </div>

      {/* Main Split: Left Inputs | Right Calculators, Status, Scenarios, Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Mission & Configurable Engineering Inputs */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-display font-semibold text-white">
                Mission &amp; Crew Inputs
              </h2>
              <button
                type="button"
                onClick={() => handleToggleRouteSync(!inputs.useRouteSync)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono border flex items-center gap-1.5 transition-colors ${
                  inputs.useRouteSync
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#07090E] border-white/15 text-slate-300'
                }`}
              >
                <RefreshCw className="w-3 h-3" />
                {inputs.useRouteSync ? 'Route Synced' : 'Manual Override'}
              </button>
            </div>

            <div>
              <label className="block font-mono text-[11px] text-slate-400 mb-1">
                Mission Name (for Report)
              </label>
              <input
                type="text"
                value={inputs.missionName}
                onChange={(e) => update('missionName', e.target.value)}
                className="w-full px-3 py-1.5 rounded bg-[#07090E] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-[#E85D2A]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-mono text-[11px] text-slate-400 mb-1">
                  Walking Distance (km)
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={100}
                  step={0.5}
                  disabled={inputs.useRouteSync}
                  value={inputs.useRouteSync ? activeRoute.distanceKm : inputs.manualDistanceKm}
                  onChange={(e) => update('manualDistanceKm', Math.max(0.5, Number(e.target.value) || 0.5))}
                  className="w-full px-2.5 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] text-slate-400 mb-1">
                  Terrain Difficulty (0–100)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  disabled={inputs.useRouteSync}
                  value={inputs.useRouteSync ? Math.round(activeRoute.meanDifficulty) : inputs.manualTerrainDifficulty}
                  onChange={(e) =>
                    update('manualTerrainDifficulty', Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                  }
                  className="w-full px-2.5 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white disabled:opacity-60"
                />
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between font-mono text-slate-300 mb-1">
                  <span>Number of Astronauts</span>
                  <span className="text-white font-semibold tabular-nums">{inputs.astronautCount} crew</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={6}
                  step={1}
                  value={inputs.astronautCount}
                  onChange={(e) => update('astronautCount', Number(e.target.value))}
                  className="w-full accent-[#E85D2A]"
                />
              </div>

              <div>
                <div className="flex justify-between font-mono text-slate-300 mb-1">
                  <span>Estimated Walking Speed</span>
                  <span className="text-white font-semibold tabular-nums">{inputs.walkingSpeedKmh.toFixed(1)} km/h</span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={8.0}
                  step={0.2}
                  value={inputs.walkingSpeedKmh}
                  onChange={(e) => update('walkingSpeedKmh', Number(e.target.value))}
                  className="w-full accent-[#E85D2A]"
                />
              </div>

              {/* Duration Controls: Activity-Derived vs Manual Override */}
              <div className="pt-2 border-t border-white/10 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] uppercase text-slate-400">
                    Mission Duration Control
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => update('durationMode', 'activity-derived')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        inputs.durationMode === 'activity-derived'
                          ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                          : 'bg-[#07090E] border-white/15 text-slate-400 hover:text-white'
                      }`}
                    >
                      Auto-Calculated
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeInputs({
                          ...inputs,
                          durationMode: 'manual',
                          missionDurationHr: results.nominalDurationHr,
                        })
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        inputs.durationMode === 'manual'
                          ? 'bg-[#E85D2A]/20 border-[#E85D2A] text-amber-200'
                          : 'bg-[#07090E] border-white/15 text-slate-400 hover:text-white'
                      }`}
                    >
                      Manual Duration
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block font-mono text-[10px] text-slate-400 mb-1">
                      Rest (hr)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={48}
                      step={0.5}
                      value={inputs.restDurationHr}
                      onChange={(e) => update('restDurationHr', Math.max(0, Number(e.target.value) || 0))}
                      className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-slate-400 mb-1">
                      Science (hr)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={48}
                      step={0.5}
                      value={inputs.additionalActivityHr}
                      onChange={(e) => update('additionalActivityHr', Math.max(0, Number(e.target.value) || 0))}
                      className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-slate-400 mb-1">
                      Buffer (hr)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      disabled={inputs.durationMode === 'manual'}
                      value={inputs.scheduleBufferHr}
                      onChange={(e) => update('scheduleBufferHr', Math.max(0, Number(e.target.value) || 0))}
                      className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-slate-400 mb-1">
                      Mission Dur (hr)
                    </label>
                    <input
                      type="number"
                      min={0.5}
                      max={168}
                      step={0.5}
                      value={
                        inputs.durationMode === 'manual'
                          ? inputs.missionDurationHr
                          : results.nominalDurationHr
                      }
                      onChange={(e) =>
                        onChangeInputs({
                          ...inputs,
                          durationMode: 'manual',
                          missionDurationHr: Math.max(0.5, Number(e.target.value) || 0.5),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between font-mono text-slate-300 mb-1">
                  <span>Emergency Reserve Percentage</span>
                  <span className="text-white font-semibold tabular-nums">{inputs.safetyReservePct}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={5}
                  value={inputs.safetyReservePct}
                  onChange={(e) => update('safetyReservePct', Number(e.target.value))}
                  className="w-full accent-[#E85D2A]"
                />
              </div>
            </div>

            {/* Configurable Assumptions */}
            <div className="pt-3 border-t border-white/10 space-y-3 text-xs">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Configurable Planning Assumptions
              </div>

              <div>
                <div className="flex justify-between font-mono text-slate-300 mb-1">
                  <span>O2 Consumption Rate (per Astronaut)</span>
                  <span className="text-white tabular-nums">{inputs.oxygenRateKgPerPersonHr.toFixed(3)} kg/hr</span>
                </div>
                <input
                  type="range"
                  min={0.02}
                  max={0.08}
                  step={0.005}
                  value={inputs.oxygenRateKgPerPersonHr}
                  onChange={(e) => update('oxygenRateKgPerPersonHr', Number(e.target.value))}
                  className="w-full accent-[#E85D2A]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 mb-1">
                    Suit kW / Crew
                  </label>
                  <input
                    type="number"
                    min={0.2}
                    max={3.0}
                    step={0.05}
                    value={inputs.suitPowerKwPerAstronaut}
                    onChange={(e) => update('suitPowerKwPerAstronaut', Math.max(0.1, Number(e.target.value) || 0.1))}
                    className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 mb-1">
                    Shared Gear (kW)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={6.0}
                    step={0.1}
                    value={inputs.equipmentPowerKw}
                    onChange={(e) => update('equipmentPowerKw', Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 mb-1">
                    Water L / Sol
                  </label>
                  <input
                    type="number"
                    min={1.0}
                    max={8.0}
                    step={0.2}
                    value={inputs.dailyWaterLitersPerPerson}
                    onChange={(e) => update('dailyWaterLitersPerPerson', Math.max(0.5, Number(e.target.value) || 0.5))}
                    className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                  />
                </div>
              </div>
            </div>

            {/* Available Capacities */}
            <div className="pt-3 border-t border-white/10 space-y-2 text-xs">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Available Resource Capacity
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 mb-1">
                    Available O2 (kg)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={0.25}
                    value={inputs.availableOxygenSupplyKg}
                    onChange={(e) => update('availableOxygenSupplyKg', Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 mb-1">
                    Battery (kWh)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={inputs.availableEnergySupplyKwh}
                    onChange={(e) => update('availableEnergySupplyKwh', Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-slate-400 mb-1">
                    Water (L)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={0.5}
                    value={inputs.availableWaterSupplyL}
                    onChange={(e) => update('availableWaterSupplyL', Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2 py-1.5 rounded bg-[#07090E] border border-white/15 font-mono text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Detailed Estimators, Resource Status, Emergency Simulation, Readiness, Formulas */}
        <div className="lg:col-span-7 space-y-5">
          {/* Resource Status Comparison Panel */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-display font-semibold text-white">
                Resource Capacity vs. Estimated Demand
              </h2>
              <span className={`px-2 py-0.5 rounded border text-[11px] font-mono font-semibold ${statusBadgeStyle(results.overallResourceStatus)}`}>
                OVERALL: {results.overallResourceStatus} RESOURCES
              </span>
            </div>

            {results.overallResourceStatus !== 'SUFFICIENT' && (
              <div
                className={`p-3 rounded border text-xs flex items-start gap-2 ${
                  results.overallResourceStatus === 'INSUFFICIENT'
                    ? 'bg-red-500/12 border-red-500/45 text-red-200'
                    : 'bg-amber-500/10 border-amber-500/35 text-amber-200'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold">
                    {results.overallResourceStatus === 'INSUFFICIENT'
                      ? `INSUFFICIENT RESOURCE WARNING: ${results.insufficientResources.join(' · ')}`
                      : `LIMITED BUFFER WARNING: ${results.limitedResources.join(' · ')}`}
                  </div>
                  <div className="text-[11px] opacity-90">
                    {results.overallResourceStatus === 'INSUFFICIENT'
                      ? 'Available capacity cannot cover required mission demand + emergency reserve. Mission cannot be marked ready — increase loaded supplies, shorten route, or reduce duration.'
                      : 'Available supplies cover demand + reserve, but remaining spare margin is below 15%.'}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3 text-xs font-mono">
              {[
                {
                  label: 'Oxygen (O2)',
                  unit: 'kg',
                  avail: inputs.availableOxygenSupplyKg,
                  req: results.totalOxygenRequiredKg,
                  base: results.baseOxygenKg,
                  res: results.reserveOxygenKg,
                  perCrew: results.oxygenPerAstronautKg,
                  margin: results.remainingOxygenReserveKg,
                  status: results.oxygenStatus,
                  proof: `${inputs.astronautCount} crew × ${results.effectiveMissionDurationHr.toFixed(2)} hr × ${inputs.oxygenRateKgPerPersonHr.toFixed(3)} kg/p/hr = ${results.baseOxygenKg.toFixed(2)} kg + ${inputs.safetyReservePct}% (${results.reserveOxygenKg.toFixed(2)} kg) = ${results.totalOxygenRequiredKg.toFixed(2)} kg`,
                },
                {
                  label: 'Energy (Electrical + Gear)',
                  unit: 'kWh',
                  avail: inputs.availableEnergySupplyKwh,
                  req: results.totalEnergyRequiredKwh,
                  base: results.baseEnergyKwh,
                  res: results.reserveEnergyKwh,
                  perCrew: results.energyPerAstronautKwh,
                  margin: results.remainingEnergyReserveKwh,
                  status: results.energyStatus,
                  proof: `(${inputs.astronautCount} × ${inputs.suitPowerKwPerAstronaut.toFixed(2)} kW + ${inputs.equipmentPowerKw.toFixed(2)} kW = ${results.totalPowerLoadKw.toFixed(2)} kW) × ${results.effectiveMissionDurationHr.toFixed(2)} hr = ${results.baseEnergyKwh.toFixed(2)} kWh + ${inputs.safetyReservePct}% (${results.reserveEnergyKwh.toFixed(2)} kWh) = ${results.totalEnergyRequiredKwh.toFixed(2)} kWh`,
                },
                {
                  label: 'Potable & Cooling Water',
                  unit: 'L',
                  avail: inputs.availableWaterSupplyL,
                  req: results.totalWaterRequiredL,
                  base: results.baseWaterL,
                  res: results.reserveWaterL,
                  perCrew: results.waterPerAstronautL,
                  margin: results.remainingWaterReserveL,
                  status: results.waterStatus,
                  proof: `${inputs.astronautCount} crew × (${results.effectiveMissionDurationHr.toFixed(2)} / 24.623 sol hr) × ${inputs.dailyWaterLitersPerPerson.toFixed(1)} L/sol = ${results.baseWaterL.toFixed(2)} L + ${inputs.safetyReservePct}% (${results.reserveWaterL.toFixed(2)} L) = ${results.totalWaterRequiredL.toFixed(2)} L`,
                },
              ].map((row) => {
                const pct = coveragePct(row.avail, row.req);
                return (
                  <div key={row.label} className="p-3 rounded bg-[#07090E] border border-white/[0.06] space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-100 font-semibold">{row.label}</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${statusBadgeStyle(row.status)}`}>
                        {row.status} · {row.margin >= 0 ? '+' : ''}
                        {row.margin.toFixed(2)} {row.unit}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded bg-white/10 overflow-hidden">
                      <div className={`h-full ${statusBarColor(row.status)}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex flex-wrap justify-between text-[11px] text-slate-400 tabular-nums">
                      <span>
                        Base {row.base.toFixed(2)} ({row.perCrew.toFixed(2)}/crew) + Reserve {row.res.toFixed(2)} ={' '}
                        <span className="text-white">{row.req.toFixed(2)} {row.unit}</span>
                      </span>
                      <span>
                        Loaded: {row.avail.toFixed(2)} {row.unit} ({pct}% coverage)
                      </span>
                    </div>
                    <div className="text-[10px] text-cyan-300/80 tabular-nums">{row.proof}</div>
                  </div>
                );
              })}
            </div>

            {/* Transparent Duration Breakdown */}
            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-display font-semibold text-white">
                  Mission Duration Component Breakdown
                </span>
                <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
                  Total: {timing.totalMissionDurationHr.toFixed(2)} hr ({timing.totalMissionDurationSols.toFixed(2)} sols)
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px] font-mono tabular-nums">
                <div className="p-2 rounded bg-[#07090E] border border-white/[0.06]">
                  <div className="text-[10px] text-slate-500">Base Walk</div>
                  <div className="text-white font-semibold">{timing.baseWalkingTimeHr.toFixed(2)}h</div>
                </div>
                <div className="p-2 rounded bg-[#07090E] border border-white/[0.06]">
                  <div className="text-[10px] text-slate-500">Terrain Delay</div>
                  <div className="text-amber-300 font-semibold">+{timing.terrainDelayHr.toFixed(2)}h</div>
                </div>
                <div className="p-2 rounded bg-[#07090E] border border-white/[0.06]">
                  <div className="text-[10px] text-slate-500">Rest Time</div>
                  <div className="text-white font-semibold">{timing.restTimeHr.toFixed(2)}h</div>
                </div>
                <div className="p-2 rounded bg-[#07090E] border border-white/[0.06]">
                  <div className="text-[10px] text-slate-500">Science Activity</div>
                  <div className="text-white font-semibold">{timing.scientificActivityTimeHr.toFixed(2)}h</div>
                </div>
                <div className="p-2 rounded bg-[#07090E] border border-white/[0.06]">
                  <div className="text-[10px] text-slate-500">Schedule Buffer</div>
                  <div className="text-cyan-300 font-semibold">+{timing.scheduleBufferHr.toFixed(2)}h</div>
                </div>
                <div className="p-2 rounded bg-[#07090E] border border-white/[0.06]">
                  <div className="text-[10px] text-slate-500">Emergency (+{timing.emergencyContingencyPct}%)</div>
                  <div className="text-[#E85D2A] font-semibold">+{timing.emergencyContingencyTimeHr.toFixed(2)}h</div>
                </div>
              </div>
              <p className="text-[11px] font-mono text-slate-400 leading-relaxed">{timing.explanation}</p>
            </div>
          </div>

          {/* Emergency Duration Simulator (+10%, +20%, +30%) */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-display font-semibold text-white">
                  Emergency Duration Contingency Simulator
                </h2>
                <p className="text-xs text-slate-400">
                  Simulate +10%, +20%, or +30% additional mission duration to inspect consumable growth.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowEmergencyOverlay(true)}
                  className="px-2.5 py-1 rounded text-[11px] font-mono border border-[#E85D2A]/60 bg-[#E85D2A]/15 text-amber-200 hover:bg-[#E85D2A]/25 mr-1"
                >
                  Open Overlay
                </button>
                {([0, 10, 20, 30] as const).map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() =>
                      pct === 0 ? update('emergencyExtensionPct', 0) : toggleEmergencyScenario(pct)
                    }
                    className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors ${
                      inputs.emergencyExtensionPct === pct
                        ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                        : 'bg-[#07090E] border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    {pct === 0 ? 'Nominal' : `+${pct}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090B10] text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2">Scenario</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">O2 Total (Δ)</th>
                    <th className="px-3 py-2">Energy Total (Δ)</th>
                    <th className="px-3 py-2">Water Total (Δ)</th>
                    <th className="px-3 py-2">Covered?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {results.emergencyScenarios.map((sc) => (
                    <tr
                      key={sc.extraPct}
                      onClick={() => toggleEmergencyScenario(sc.extraPct as 10 | 20 | 30)}
                      className={`cursor-pointer transition-colors ${
                        inputs.emergencyExtensionPct === sc.extraPct ? 'bg-[#E85D2A]/12 text-white' : 'text-slate-300 hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className="px-3 py-2 font-semibold">+{sc.extraPct}% Duration</td>
                      <td className="px-3 py-2 tabular-nums">
                        {sc.durationHr.toFixed(1)} hr ({sc.durationSols.toFixed(2)} sol)
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {sc.totalOxygenKg.toFixed(2)} kg (+{sc.oxygenDeltaKg.toFixed(2)})
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {sc.totalEnergyKwh.toFixed(1)} kWh (+{sc.energyDeltaKwh.toFixed(1)})
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {sc.totalWaterL.toFixed(2)} L (+{sc.waterDeltaL.toFixed(2)})
                      </td>
                      <td className={`px-3 py-2 font-semibold ${sc.allSufficient ? 'text-emerald-400' : 'text-red-400'}`}>
                        {sc.allSufficient ? 'YES' : 'SHORTFALL'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Resource Depletion Curve */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-display font-semibold text-white">Projected Supply Depletion Curve</span>
              <span className="font-mono text-[11px] text-slate-400">
                Orange: O2 · Cyan: Energy · Sky: Water
              </span>
            </div>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto bg-[#07090E] rounded border border-white/[0.06]">
              <line x1={padX} y1={padY} x2={padX} y2={padY + plotH} stroke="rgba(255,255,255,0.15)" />
              <line x1={padX} y1={padY + plotH} x2={padX + plotW} y2={padY + plotH} stroke="rgba(255,255,255,0.15)" />
              <polyline points={o2Line} fill="none" stroke="#E85D2A" strokeWidth="2.5" />
              <polyline points={energyLine} fill="none" stroke="#06b6d4" strokeWidth="2.2" strokeDasharray="5 3" />
              <polyline points={waterLine} fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="2 3" />
              <text x={padX} y={svgH - 4} fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono">
                T+0.0 hr
              </text>
              <text x={padX + plotW - 96} y={svgH - 4} fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono">
                T+{results.effectiveMissionDurationHr.toFixed(1)} hr ({results.effectiveMissionDurationSols.toFixed(2)} sol)
              </text>
            </svg>
          </div>

          {/* Mission Readiness Score & Formulas */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-display font-semibold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#E85D2A]" />
                Mission Readiness Score (Planning Indicator Only)
              </h3>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                    missionReadiness.hasInsufficientResource
                      ? 'border-red-500/45 bg-red-500/15 text-red-300'
                      : missionReadiness.classification.startsWith('NOMINAL')
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {missionReadiness.classification}
                </span>
                <span className="text-base font-mono font-bold text-white tabular-nums">
                  {missionReadiness.score} / 100
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
              <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.06]">
                <div className="text-slate-500 text-[10px]">Resource Sufficiency</div>
                <div className="text-white font-semibold tabular-nums">
                  {missionReadiness.breakdown.resourceSufficiencyScore} / 40
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.06]">
                <div className="text-slate-500 text-[10px]">Route Safety</div>
                <div className="text-white font-semibold tabular-nums">
                  {missionReadiness.breakdown.routeSafetyScore} / 20
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.06]">
                <div className="text-slate-500 text-[10px]">Terrain Difficulty</div>
                <div className="text-white font-semibold tabular-nums">
                  {missionReadiness.breakdown.terrainDifficultyScore} / 15
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.06]">
                <div className="text-slate-500 text-[10px]">Emergency Reserves</div>
                <div className="text-white font-semibold tabular-nums">
                  {missionReadiness.breakdown.emergencyReserveScore} / 15
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#07090E] border border-white/[0.06]">
                <div className="text-slate-500 text-[10px]">Mission Duration</div>
                <div className="text-white font-semibold tabular-nums">
                  {missionReadiness.breakdown.missionDurationScore} / 10
                </div>
              </div>
            </div>

            {missionReadiness.breakdown.capAppliedReason && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/35 text-[11px] font-mono text-red-200">
                {missionReadiness.breakdown.capAppliedReason}
              </div>
            )}

            <div className="text-[11px] font-mono text-slate-300 bg-[#07090E] p-3 rounded border border-white/[0.06] space-y-1">
              <div>{missionReadiness.breakdown.formulaSummary}</div>
              <div>
                1. Duration T_total = Walk({results.walkingDurationHr.toFixed(2)}h = {results.baseWalkingDurationHr.toFixed(2)}h × {results.combinedTerrainTimeFactor.toFixed(3)}) + Rest({results.restDurationHr.toFixed(2)}h) + Sci({results.additionalActivityHr.toFixed(2)}h) + Buffer({results.scheduleBufferHr.toFixed(2)}h) + Contingency(+{inputs.emergencyExtensionPct}% = {results.emergencyContingencyHr.toFixed(2)}h) = {results.effectiveMissionDurationHr.toFixed(2)} hr ({results.effectiveMissionDurationSols.toFixed(2)} sols)
              </div>
              <div>
                2. O2 (kg) = Crew({inputs.astronautCount}) × T_total({results.effectiveMissionDurationHr.toFixed(2)}h) × Rate({inputs.oxygenRateKgPerPersonHr.toFixed(3)}) × (1 + {inputs.safetyReservePct}%) = {results.baseOxygenKg.toFixed(2)} + {results.reserveOxygenKg.toFixed(2)} = {results.totalOxygenRequiredKg.toFixed(2)} kg
              </div>
              <div>
                3. Energy (kWh) = [Crew({inputs.astronautCount}) × Suit({inputs.suitPowerKwPerAstronaut.toFixed(2)} kW) + Shared({inputs.equipmentPowerKw.toFixed(2)} kW)] × T_total({results.effectiveMissionDurationHr.toFixed(2)}h) × (1 + {inputs.safetyReservePct}%) = {results.baseEnergyKwh.toFixed(2)} + {results.reserveEnergyKwh.toFixed(2)} = {results.totalEnergyRequiredKwh.toFixed(2)} kWh
              </div>
              <div>
                4. Water (L) = Crew({inputs.astronautCount}) × (T_total({results.effectiveMissionDurationHr.toFixed(2)}h) / 24.623 sol_hr) × Rate({inputs.dailyWaterLitersPerPerson.toFixed(1)} L/sol) × (1 + {inputs.safetyReservePct}%) = {results.baseWaterL.toFixed(2)} + {results.reserveWaterL.toFixed(2)} = {results.totalWaterRequiredL.toFixed(2)} L
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              {missionReadiness.disclaimer}
            </p>
          </div>

          {/* Synchronized Report Export & Preview */}
          <div className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyan-400" />
                Synchronized Mission Resource &amp; Survival Report (.TXT / .PDF)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowReportPreview((v) => !v)}
                  className="px-2.5 py-1 rounded bg-[#07090E] hover:bg-white/10 border border-white/15 text-[11px] font-mono text-slate-200"
                >
                  {showReportPreview ? 'Hide Preview' : 'Preview Report'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="px-2.5 py-1 rounded bg-[#07090E] hover:bg-white/10 border border-white/15 text-[11px] font-mono text-slate-200 flex items-center gap-1"
                >
                  {copiedReport ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedReport ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadTxtReport}
                  className="px-2.5 py-1 rounded bg-[#07090E] hover:border-[#E85D2A] border border-white/15 text-[11px] font-mono text-white flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-cyan-400" />
                  Download .TXT
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdfReport}
                  className="px-3 py-1 rounded bg-[#E85D2A] hover:bg-[#d14e1e] text-[11px] font-mono font-semibold text-white flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Download .PDF
                </button>
              </div>
            </div>

            {showReportPreview && (
              <pre className="text-[11px] font-mono text-slate-300 bg-[#07090E] border border-white/[0.06] rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                {reportText}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Impact Floating Overlay HUD */}
      {showEmergencyOverlay && (
        <div
          role="dialog"
          aria-label="Emergency Impact Overlay"
          className="fixed bottom-4 right-4 z-40 w-[min(94vw,470px)] bg-[#090C12]/96 backdrop-blur-md border border-[#E85D2A]/75 rounded shadow-2xl p-4 space-y-3.5"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-2.5">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#E85D2A]" />
                <h3 className="text-sm font-display font-bold text-white uppercase tracking-wide">
                  Emergency Impact Overlay
                </h3>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                    inputs.emergencyExtensionPct > 0
                      ? 'bg-[#E85D2A]/20 border-[#E85D2A] text-amber-200'
                      : 'bg-white/5 border-white/15 text-slate-300'
                  }`}
                >
                  {inputs.emergencyExtensionPct === 0
                    ? 'NOMINAL'
                    : `+${inputs.emergencyExtensionPct}% DURATION`}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Toggle 10%, 20%, or 30% emergency duration extensions to inspect live oxygen, water, and energy impact.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowEmergencyOverlay(false)}
              aria-label="Close Emergency Impact overlay"
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scenario Toggle Buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => update('emergencyExtensionPct', 0)}
              className={`px-2 py-2 rounded text-xs font-mono border transition-colors ${
                inputs.emergencyExtensionPct === 0
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                  : 'bg-[#06070A] border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              Nominal
              <div className="text-[9px] text-slate-400">0%</div>
            </button>
            {([10, 20, 30] as const).map((pct) => {
              const active = inputs.emergencyExtensionPct === pct;
              const scenario = results.emergencyScenarios.find((s) => s.extraPct === pct);
              return (
                <button
                  key={pct}
                  type="button"
                  onClick={() => toggleEmergencyScenario(pct)}
                  className={`px-2 py-2 rounded text-xs font-mono border transition-colors ${
                    active
                      ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                      : 'bg-[#06070A] border-white/10 text-slate-200 hover:border-[#E85D2A]/60'
                  }`}
                >
                  +{pct}%
                  <div
                    className={`text-[9px] ${
                      active
                        ? 'text-white/90'
                        : scenario?.allSufficient
                          ? 'text-emerald-400'
                          : 'text-red-400'
                    }`}
                  >
                    {scenario?.allSufficient ? 'Covered' : 'Shortfall'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Live Dynamic Oxygen, Water, Energy & Duration Impact Rows */}
          <div className="space-y-2 text-xs font-mono">
            {[
              {
                label: 'Oxygen Required',
                unit: 'kg',
                nominal: results.nominalOxygenRequiredKg,
                active: results.totalOxygenRequiredKg,
                delta: oxygenDelta,
                avail: inputs.availableOxygenSupplyKg,
                status: results.oxygenStatus,
                accentClass: 'text-[#E85D2A]',
              },
              {
                label: 'Water Required',
                unit: 'L',
                nominal: results.nominalWaterRequiredL,
                active: results.totalWaterRequiredL,
                delta: waterDelta,
                avail: inputs.availableWaterSupplyL,
                status: results.waterStatus,
                accentClass: 'text-sky-400',
              },
              {
                label: 'Energy Required',
                unit: 'kWh',
                nominal: results.nominalEnergyRequiredKwh,
                active: results.totalEnergyRequiredKwh,
                delta: energyDelta,
                avail: inputs.availableEnergySupplyKwh,
                status: results.energyStatus,
                accentClass: 'text-cyan-400',
              },
            ].map((item) => {
              const loadPct = Math.min(125, Math.round((item.active / Math.max(0.01, item.avail)) * 100));
              const nominalPct = Math.min(100, Math.round((item.nominal / Math.max(0.01, item.avail)) * 100));
              return (
                <div
                  key={item.label}
                  className="p-2.5 rounded bg-[#06070A] border border-white/[0.08] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-semibold ${item.accentClass}`}>{item.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[10px] ${statusBadgeStyle(
                        item.status,
                      )}`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 tabular-nums">
                    <div>
                      <span className="text-sm font-bold text-white">
                        {item.active.toFixed(2)} {item.unit}
                      </span>
                      {item.delta > 0 && (
                        <span className="text-[11px] text-amber-300 ml-1.5">
                          (+{item.delta.toFixed(2)} {item.unit})
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Base {item.nominal.toFixed(2)} · Cap {item.avail.toFixed(2)} {item.unit}
                    </div>
                  </div>
                  <div className="relative h-2 w-full rounded bg-white/10 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-slate-500/60"
                      style={{ width: `${nominalPct}%` }}
                    />
                    <div
                      className={`h-full transition-all ${statusBarColor(item.status)}`}
                      style={{ width: `${Math.min(100, loadPct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Duration & Contingency Summary Footer */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 text-[11px] font-mono">
            <div className="text-slate-300 tabular-nums">
              Duration:{' '}
              <span className="text-white font-semibold">
                {results.effectiveMissionDurationHr.toFixed(1)} hr
              </span>{' '}
              ({results.effectiveMissionDurationSols.toFixed(2)} sol)
              {durationDelta > 0 && (
                <span className="text-amber-300 ml-1">+{durationDelta.toFixed(1)}h</span>
              )}
            </div>
            {inputs.emergencyExtensionPct > 0 && (
              <button
                type="button"
                onClick={() => update('emergencyExtensionPct', 0)}
                className="text-cyan-400 hover:underline whitespace-nowrap"
              >
                Reset to Nominal
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
