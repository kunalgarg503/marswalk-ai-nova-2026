import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Presentation,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { CentralMissionState, NavSection } from '../types/mars';

interface PresentationStep {
  number: number;
  title: string;
  section: NavSection;
  sectionLabel: string;
  objective: string;
  keyPoints: string[];
  liveHighlight: (m: CentralMissionState) => string;
  limitationNote: string;
}

const PRESENTATION_STEPS: PresentationStep[] = [
  {
    number: 1,
    title: 'Mars Exploration Problem',
    section: 'mission-control',
    sectionLabel: 'Mission Control',
    objective:
      'Human EVA traverses on Mars face high spatial uncertainty across crater rims, steep regolith slopes, dust-obscured low-TIU fines, and tight suit consumables.',
    keyPoints: [
      'A shortest Euclidean path often cuts across severe slopes or crater walls that spike suit oxygen and metabolic energy loads.',
      'Disconnected terrain, hazard, science, and life-support calculators create dangerous planning mismatches between distance, duration, and reserves.',
      'Mission planners need clear separation between verified NASA science records and synthetic planning grids.',
    ],
    liveHighlight: (m) =>
      `Active Scenario: ${m.region.name} (${m.region.lat.toFixed(2)}°, ${m.region.lon.toFixed(2)}°) · ${m.hazardRisk.flaggedRegionalZonesCount} mapped hazard zones`,
    limitationNote:
      'MARSWALK AI is a planning and engineering demonstration prototype—not flight-certified navigation software.',
  },
  {
    number: 2,
    title: 'MARSWALK AI Solution',
    section: 'mission-control',
    sectionLabel: 'Mission Control',
    objective:
      'Unify A* hazard-aware pathfinding, deterministic EVA consumables math, regional science site targeting, NASA provenance tracking, and Gemini AI briefing on one CentralMissionState.',
    keyPoints: [
      'Changing region, route preference, science stops, or crew size immediately updates every module and report from one snapshot.',
      'Explicit 5-category data provenance distinguishes retrieved NASA data, archival maps, derived metrics, simulated grids, and unavailable feeds.',
      'Built for rapid hackathon evaluation as an integrated end-to-end surface EVA planning bench.',
    ],
    liveHighlight: (m) =>
      `Unified State: ${m.missionName} · Readiness ${m.missionReadiness.score}/100 (${m.missionReadiness.classification})`,
    limitationNote:
      'Surface DEM cells use a 500 m procedural terrain model anchored to MOLA/literature baselines rather than sub-meter HiRISE DTM tiles.',
  },
  {
    number: 3,
    title: 'Mission Control',
    section: 'mission-control',
    sectionLabel: 'Mission Control',
    objective:
      'Give commanders an executive single-glance view of active traverse geometry, hazard posture, life-support margins, top local science target, and synchronized report export.',
    keyPoints: [
      'Top KPI strip aggregates active corridor distance, safety score, resource margin status, and readiness score.',
      'Readiness explicitly caps at <= 48/100 whenever any consumable (O2, energy, or water) is INSUFFICIENT.',
      'Direct one-click navigation jumps into the underlying route, hazard, survival, or AI advisor views.',
    ],
    liveHighlight: (m) =>
      `${m.startingLocation.name} → ${m.destination.name} · ${m.distanceKm.toFixed(2)} km · ${m.timing.totalMissionDurationHr.toFixed(1)} hr`,
    limitationNote:
      'Readiness indices represent internal model weighting across route safety, slope difficulty, and consumable sufficiency.',
  },
  {
    number: 4,
    title: 'NASA Data Integration',
    section: 'nasa-data-centre',
    sectionLabel: 'NASA Data Centre',
    objective:
      'Probe official NASA, JPL, USGS, and PDS endpoints via server-side proxy routes and classify every dataset strictly by whether structured data was actually retrieved.',
    keyPoints: [
      'Strict 5-category taxonomy: NASA data successfully retrieved, NASA archival reference, Derived analysis, Simulated demonstration data, and Unavailable or failed retrieval.',
      'WMTS/WMS orbital tile endpoints (MOLA, Viking, THEMIS) report as Archival Reference unless numeric science arrays are retrieved.',
      'Structured JSON feeds (Mars 2020/MSL rover imagery, MEDA/REMS weather, NASA Images, PDS ODE) require parsed record counts > 0 to mark VERIFIED.',
    ],
    liveHighlight: (m) =>
      `${m.datasets.length} cataloged sources tracked · Live probe status verified via /api/nasa/status`,
    limitationNote:
      'Upstream NASA/PDS endpoints may intermittently rate-limit or time out depending on network connectivity; failed probes remain marked UNAVAILABLE.',
  },
  {
    number: 5,
    title: 'Terrain & Hazard Intelligence',
    section: 'terrain-intelligence',
    sectionLabel: 'Terrain Intelligence',
    objective:
      'Analyze local elevation profiles, slope gradients, regolith roughness, crater proximity, and thermal inertia across the regional 500 m traverse grid.',
    keyPoints: [
      'Inspect slope distributions, mean/max grade degrees, and high-hazard corridor intersections along the active route.',
      'Shared deterministic formula computes Safety = clamp(5..99, 100 - 2.1·Crit% - 1.25·High% - 0.32·Mod% - min(35, 1.05·MaxSlope°) - 0.26·MeanDiff) with Risk = 100 - Safety.',
      'Hazard Detection and Terrain Intelligence read directly from the active routePlan.',
    ],
    liveHighlight: (m) =>
      `Mean Slope ${m.terrainDifficulty.meanSlopeDeg.toFixed(1)}° · Max ${m.terrainDifficulty.maxSlopeDeg.toFixed(1)}° · Risk ${m.hazardRisk.overallRiskScore}/100 (${m.hazardRisk.overallRiskLevel})`,
    limitationNote:
      '500 m synthetic cells cannot resolve meter-scale boulders, sharp trench edges, or local dust traps required for real EVA certification.',
  },
  {
    number: 6,
    title: 'Smart Route Planning',
    section: 'route-planner',
    sectionLabel: 'Smart Route Planner',
    objective:
      'Compute Shortest, Balanced, and Safest multi-leg A* paths between origin, optional intermediate Science Stops, and destination on the interactive Mars map.',
    keyPoints: [
      'Each route profile applies distinct distance, slope, difficulty, and hazard cost weights—and explains clearly if topography forces profiles onto the same corridor.',
      'Interactive map tooltips expose local terrain difficulty and hazard exposure along route segments.',
      'Optional intermediate Science Waypoints automatically recalculate multi-leg distance, elevation gain, duration, and consumable requirements.',
    ],
    liveHighlight: (m) =>
      `${m.activeRouteLabel}: ${m.distanceKm.toFixed(2)} km · Safety ${m.safetyScore}/100 · +${m.elevationGainM} m / -${m.elevationLossM} m · ${m.scienceWaypoints.length} via-stops`,
    limitationNote:
      'Pathfinding optimizes over the regional demonstration grid and does not ingest live rover hazard-camera stereo meshes.',
  },
  {
    number: 7,
    title: 'Astronaut Survival Calculator',
    section: 'survival-calculator',
    sectionLabel: 'Survival Calculator',
    objective:
      'Model crew oxygen, electrical energy, and potable water requirements with slope-adjusted walking duration, safety reserve % applied exactly once, and sufficiency checks.',
    keyPoints: [
      'O2 scales linearly with crew size, oxygen rate, and terrain-adjusted EVA duration; Suit power scales with crew while shared equipment stays fixed.',
      'Any consumable falling below required total triggers an explicit INSUFFICIENT warning and caps overall mission readiness.',
      'Supports direct route synchronization or manual distance/difficulty overrides for trade-off studies.',
    ],
    liveHighlight: (m) =>
      `Crew ${m.crewSize} · O2 ${m.oxygen.totalRequiredKg.toFixed(2)}/${m.oxygen.loadedSupplyKg.toFixed(2)} kg · Energy ${m.energy.totalRequiredKwh.toFixed(1)}/${m.energy.loadedSupplyKwh.toFixed(1)} kWh · Water ${m.water.totalRequiredL.toFixed(1)}/${m.water.loadedSupplyL.toFixed(1)} L`,
    limitationNote:
      'Consumable constants are parametric engineering planning estimates, not qualified against a specific NASA EMU/xEMU flight suit spec.',
  },
  {
    number: 8,
    title: 'Science Discovery Explorer',
    section: 'science-explorer',
    sectionLabel: 'Science Explorer',
    objective:
      'Prioritize scientifically valuable targets around Jezero Crater and partner regions, linking each site to NASA instruments, confidence levels, and route waypoints.',
    keyPoints: [
      'Targets such as Three Forks Delta, Bright Angel, Belva Crater, South Séítah, Butler Landing, and Neretva Vallis include orbital/rover instrument context.',
      'One-click "Add Science Stop" injects a target directly into the A* Smart Route Planner as an intermediate via-waypoint.',
      'Live NASA Images/Mars2020/PDS probes inspect real external availability without fabricating unconfirmed observations.',
    ],
    liveHighlight: (m) =>
      `${m.nearbyScience.length} regional targets · ${m.scienceWaypoints.length} active route stop(s) queued`,
    limitationNote:
      'Science priority scores combine proximity to the active route and cataloged target value as a planning heuristic.',
  },
  {
    number: 9,
    title: 'AI Mission Assistant',
    section: 'mission-assistant',
    sectionLabel: 'AI Mission Assistant',
    objective:
      'Provide context-aware surface EVA recommendations grounded in the live CentralMissionState and verified NASA probe state via Gemini API.',
    keyPoints: [
      'Every prompt attaches full active mission context: sector, route geometry, slopes, hazards, crew, consumables, science stops, and probe status.',
      'Interactive What-If scenario simulation tests safer routes or adjusted crew/reserve settings before committing changes.',
      'If Gemini API is unavailable or unconfigured, the UI surfaces the real error and marks local rule-based guidance explicitly as LOCAL DETERMINISTIC FALLBACK (NOT FROM GEMINI AI).',
    ],
    liveHighlight: (m) =>
      `Context Bound: ${m.region.name} · ${m.activeRouteProfile.toUpperCase()} (${m.safetyScore}/100) · ${m.missionReadiness.classification}`,
    limitationNote:
      'Live AI responses require a valid server-side GEMINI_API_KEY; fallback output never calls itself Gemini.',
  },
  {
    number: 10,
    title: 'Mission Reports & Limitations',
    section: 'mission-control',
    sectionLabel: 'Reports & Export',
    objective:
      'Export synchronized Summary (Markdown/PDF) and Resource Planning (TXT/PDF) mission briefs built from a single immutable MissionSnapshot.',
    keyPoints: [
      'Both reports pull distance, duration, science waypoints, O2/energy/water totals, readiness score, and 5-category provenance from one validated snapshot.',
      'Every exported document embeds explicit prototype disclaimers so stakeholders never mistake simulated grids for flight telemetry.',
      'Ready for hackathon judges to inspect live state changes, exports, and honest scientific provenance end to end.',
    ],
    liveHighlight: (m) =>
      `Snapshot Ready · ${m.distanceKm.toFixed(2)} km · ${m.timing.totalMissionDurationHr.toFixed(2)} hr · Readiness ${m.missionReadiness.score}/100`,
    limitationNote:
      'Research & planning prototype only — not certified for operational spacecraft or astronaut EVA execution.',
  },
];

interface PresentationModeOverlayProps {
  open: boolean;
  onClose: () => void;
  missionState: CentralMissionState;
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
}

export const PresentationModeOverlay: React.FC<PresentationModeOverlayProps> = ({
  open,
  onClose,
  missionState,
  activeSection,
  onNavigate,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [autoSyncView, setAutoSyncView] = useState(true);

  const step = PRESENTATION_STEPS[stepIdx];

  useEffect(() => {
    if (!open) return;
    if (autoSyncView && activeSection !== step.section) {
      onNavigate(step.section);
    }
  }, [open, autoSyncView, step.section, activeSection, onNavigate]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        setStepIdx((prev) => Math.min(PRESENTATION_STEPS.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setStepIdx((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="MARSWALK AI Project Presentation Mode"
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4 pointer-events-none flex justify-center"
    >
      <div className="pointer-events-auto w-full max-w-5xl rounded-lg border border-[#E85D2A]/50 bg-[#0A0D13]/95 backdrop-blur-md shadow-2xl overflow-hidden">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10 bg-[#0D1016]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Presentation className="w-4 h-4 text-[#E85D2A] shrink-0" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#E85D2A] font-semibold">
              Guided Demo · Step {String(step.number).padStart(2, '0')} / {PRESENTATION_STEPS.length}
            </span>
            <span className="hidden sm:inline text-xs font-mono text-slate-500">·</span>
            <h2 className="font-display font-bold text-sm sm:text-base text-white truncate">
              {step.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 cursor-pointer select-none px-2 py-1 rounded border border-white/10 bg-black/30">
              <input
                type="checkbox"
                checked={autoSyncView}
                onChange={(e) => setAutoSyncView(e.target.checked)}
                className="accent-[#E85D2A]"
              />
              Auto-open module
            </label>

            <button
              type="button"
              onClick={() => onNavigate(step.section)}
              className="px-2.5 py-1 rounded border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-mono text-cyan-300 flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              {step.sectionLabel}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Presentation Mode"
              className="p-1.5 rounded border border-white/10 hover:border-white/25 text-slate-300 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-8 space-y-2.5">
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">{step.objective}</p>
              <ul className="space-y-1.5">
                {step.keyPoints.map((pt, i) => (
                  <li key={i} className="text-xs text-slate-300 flex items-start gap-2 leading-relaxed">
                    <span className="font-mono text-[#E85D2A] font-bold shrink-0">0{i + 1}</span>
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-4 space-y-2">
              <div className="p-3 rounded border border-cyan-500/25 bg-cyan-500/[0.05] space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-300">
                  <Compass className="w-3.5 h-3.5" /> Live Mission State
                </div>
                <p className="text-[11px] font-mono text-slate-200 leading-relaxed">
                  {step.liveHighlight(missionState)}
                </p>
              </div>

              <div className="p-3 rounded border border-amber-500/25 bg-amber-500/[0.05] space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-300">
                  <ShieldAlert className="w-3.5 h-3.5" /> Scope & Limitation
                </div>
                <p className="text-[11px] text-amber-100/90 leading-relaxed">
                  {step.limitationNote}
                </p>
              </div>
            </div>
          </div>

          {/* Step Strip & Controls */}
          <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {PRESENTATION_STEPS.map((s, i) => {
                const active = i === stepIdx;
                return (
                  <button
                    key={s.number}
                    type="button"
                    onClick={() => setStepIdx(i)}
                    title={`${s.number}. ${s.title}`}
                    className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                      active
                        ? 'bg-[#E85D2A] border-[#E85D2A] text-white font-semibold'
                        : 'bg-[#0D1016] border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                    }`}
                  >
                    {String(s.number).padStart(2, '0')}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] font-mono text-slate-500">
                Keys: ← / → / Esc
              </span>
              <button
                type="button"
                disabled={stepIdx === 0}
                onClick={() => setStepIdx((p) => Math.max(0, p - 1))}
                className="px-3 py-1.5 rounded border border-white/15 bg-[#0D1016] hover:border-white/30 disabled:opacity-40 text-xs font-mono text-slate-200 flex items-center gap-1 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              {stepIdx < PRESENTATION_STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setStepIdx((p) => Math.min(PRESENTATION_STEPS.length - 1, p + 1))
                  }
                  className="px-3 py-1.5 rounded bg-[#E85D2A] hover:bg-[#d45020] text-xs font-mono font-semibold text-white flex items-center gap-1 transition-colors"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-mono font-semibold text-white transition-colors"
                >
                  Finish Demo
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
