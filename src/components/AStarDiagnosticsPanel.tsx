import { useState } from 'react';
import { Activity, Compass, Layers, ShieldAlert } from 'lucide-react';
import type {
  AStarCostDiagnostics,
  AStarStepCostNode,
  MissionObjective,
  RouteOption,
} from '../types/mars';

interface AStarDiagnosticsPanelProps {
  routes: RouteOption[];
  activeRoute: RouteOption;
  objective: MissionObjective;
  maxAcceptableDifficulty: number;
  onSelectRouteId: (id: string) => void;
}

type StepChartMode = 'marginal' | 'cumulative';

export function AStarDiagnosticsPanel({
  routes,
  activeRoute,
  objective,
  maxAcceptableDifficulty,
  onSelectRouteId,
}: AStarDiagnosticsPanelProps) {
  const [chartMode, setChartMode] = useState<StepChartMode>('marginal');
  const [hoveredStepIdx, setHoveredStepIdx] = useState<number | null>(null);

  const diag: AStarCostDiagnostics = activeRoute.costDiagnostics;
  const steps: AStarStepCostNode[] = diag.stepBreakdown;
  const grossCost = Math.max(
    0.0001,
    diag.baseDistanceCost + diag.terrainDifficultyCost + diag.hazardAvoidanceCost,
  );
  const netCost = Math.max(0.0001, diag.totalGCost);
  const penaltyOverhead = Math.max(0, diag.totalGCost - diag.baseDistanceCost);
  const effectiveMultiplier = diag.baseDistanceCost > 0 ? diag.totalGCost / diag.baseDistanceCost : 1;

  const scienceObjectiveActive =
    objective === 'geological-sampling' || objective === 'isru-survey';

  const decompositionRows = [
    {
      id: 'base-dist',
      label: 'Geodesic Step Distance (d)',
      formula: 'Δd = √(Δx² + Δy²) · Δcell',
      value: diag.baseDistanceCost,
      pct: (diag.baseDistanceCost / grossCost) * 100,
      barColor: '#06B6D4',
      textColor: 'text-cyan-400',
    },
    {
      id: 'slope-pen',
      label: 'Slope Penalty',
      formula: 'Δd · w_slope · (slope° / 10)^1.7',
      value: diag.slopePenaltyCost,
      pct: (diag.slopePenaltyCost / grossCost) * 100,
      barColor: '#E85D2A',
      textColor: 'text-[#E85D2A]',
    },
    {
      id: 'rough-pen',
      label: 'Surface Roughness (TRI)',
      formula: 'Δd · w_rough · (TRI / 50)',
      value: diag.roughnessPenaltyCost,
      pct: (diag.roughnessPenaltyCost / grossCost) * 100,
      barColor: '#F59E0B',
      textColor: 'text-amber-400',
    },
    {
      id: 'climb-pen',
      label: 'Uphill Climb Effort',
      formula: 'max(0, Δelev_m) · w_climb',
      value: diag.climbPenaltyCost,
      pct: (diag.climbPenaltyCost / grossCost) * 100,
      barColor: '#FB923C',
      textColor: 'text-orange-300',
    },
    {
      id: 'tol-pen',
      label: `Tolerance Overflow (>${maxAcceptableDifficulty})`,
      formula: 'Δd · ((diff − maxDiff) / 15) · k_tol',
      value: diag.toleranceOverflowCost,
      pct: (diag.toleranceOverflowCost / grossCost) * 100,
      barColor: '#A855F7',
      textColor: 'text-purple-400',
    },
    {
      id: 'hazard-pen',
      label: 'Hazard Zone Avoidance',
      formula: 'Δd · w_hazard(LOW | MOD | HIGH | CRIT)',
      value: diag.hazardAvoidanceCost,
      pct: (diag.hazardAvoidanceCost / grossCost) * 100,
      barColor: '#EF4444',
      textColor: 'text-red-400',
    },
  ];

  // SVG chart dimensions
  const svgW = 640;
  const svgH = 168;
  const padL = 44;
  const padR = 14;
  const padT = 16;
  const padB = 24;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const maxMarginalStepCost = Math.max(
    0.5,
    ...steps.map((s) => s.baseDistanceCost + s.terrainDifficultyCost + s.hazardAvoidanceCost),
  );
  const maxCumulativeVal = Math.max(0.5, diag.totalGCost, diag.baseDistanceCost);
  const totalDist = Math.max(0.1, activeRoute.distanceKm);

  const inspectedStep =
    hoveredStepIdx !== null && steps[hoveredStepIdx]
      ? steps[hoveredStepIdx]
      : steps.length > 0
        ? steps.reduce((worst, cur) => (cur.netStepCost > worst.netStepCost ? cur : worst), steps[0])
        : null;
  const isShowingPeakDefault = hoveredStepIdx === null && inspectedStep !== null;

  return (
    <section
      aria-label="A* Cost Function Diagnostic Panel"
      className="bg-[#0D1016] border border-white/10 rounded p-4 space-y-4"
    >
      {/* Panel Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            A* Cost Function &amp; Heuristic Diagnostics — {diag.profileLabel}
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            f(n) = g(n) + {diag.heuristicWeight.toFixed(1)}·h(n) · {diag.heuristicFormula} · Admissible Lower Bound Preserved (stepCost ≥ Δd)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {routes.map((r) => {
            const active = r.id === activeRoute.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRouteId(r.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors ${
                  active
                    ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200 font-semibold'
                    : 'bg-[#07090E] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {r.profile.toUpperCase()} · g={r.costDiagnostics.totalGCost.toFixed(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Top Precision KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#07090E] border border-white/[0.08] rounded p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Total Path Cost g(goal)
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-mono font-bold text-white tabular-nums">
              {diag.totalGCost.toFixed(2)}
            </span>
            <span className="text-[11px] font-mono text-slate-400">cost units</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-cyan-400 tabular-nums">
            Effective factor: {effectiveMultiplier.toFixed(2)}× geodesic · h(start)={diag.initialHeuristicKm.toFixed(2)} km
          </div>
        </div>

        <div className="bg-[#07090E] border border-white/[0.08] rounded p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Terrain Difficulty Penalty
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-mono font-bold text-[#E85D2A] tabular-nums">
              +{diag.terrainDifficultyCost.toFixed(2)}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              ({((diag.terrainDifficultyCost / netCost) * 100).toFixed(1)}%)
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400 tabular-nums">
            Slope {diag.slopePenaltyCost.toFixed(2)} · TRI {diag.roughnessPenaltyCost.toFixed(2)} · Climb {diag.climbPenaltyCost.toFixed(2)}
          </div>
        </div>

        <div className="bg-[#07090E] border border-white/[0.08] rounded p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Hazard Avoidance Penalty
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-mono font-bold text-red-400 tabular-nums">
              +{diag.hazardAvoidanceCost.toFixed(2)}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              ({((diag.hazardAvoidanceCost / netCost) * 100).toFixed(1)}%)
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400 tabular-nums">
            Crit {activeRoute.hazardExposure.criticalSectionCount} · High {activeRoute.hazardExposure.highSectionCount} · Net overhead +{penaltyOverhead.toFixed(2)}
          </div>
        </div>

        <div className="bg-[#07090E] border border-white/[0.08] rounded p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            A* Graph Search Coverage
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-mono font-bold text-white tabular-nums">
              {diag.nodesExpanded}
            </span>
            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
              / {diag.totalGridNodes} cells ({diag.nodesExpandedPct}%)
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-400 tabular-nums">
            {steps.length} traverse steps · {diag.gridResolutionM} m/cell · w_h={diag.heuristicWeight.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Main Two-Column Mathematical Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: Cost Function Decomposition */}
        <div className="xl:col-span-6 bg-[#07090E] border border-white/[0.08] rounded p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Exact Cost Term Decomposition (g(goal))
            </h3>
            <span className="text-[10px] font-mono text-slate-400 tabular-nums">
              stepCost = Δd + max(0, P_terrain + P_hazard − D_science)
            </span>
          </div>

          {/* Stacked Proportion Bar */}
          <div className="space-y-1.5">
            <div className="h-3 w-full rounded overflow-hidden bg-slate-900 border border-white/10 flex">
              {decompositionRows.map((row) =>
                row.pct > 0.2 ? (
                  <div
                    key={row.id}
                    style={{ width: `${row.pct}%`, backgroundColor: row.barColor }}
                    title={`${row.label}: ${row.value.toFixed(3)} (${row.pct.toFixed(1)}%)`}
                    className="h-full transition-all duration-300"
                  />
                ) : null,
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400 tabular-nums">
              <span>Gross Cost: {grossCost.toFixed(3)}</span>
              <span className={scienceObjectiveActive ? 'text-emerald-400' : 'text-slate-500'}>
                Science/ISRU Corridor Discount: −{diag.objectiveDiscountApplied.toFixed(3)}
              </span>
              <span className="text-white font-semibold">Net g(goal): {diag.totalGCost.toFixed(3)}</span>
            </div>
          </div>

          {/* Term Breakdown Table */}
          <div className="divide-y divide-white/[0.06] border-t border-white/[0.08]">
            {decompositionRows.map((row) => (
              <div
                key={row.id}
                className="py-2 flex items-center justify-between gap-3 text-[11px] font-mono"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-xs shrink-0"
                      style={{ backgroundColor: row.barColor }}
                    />
                    <span className="text-slate-200 truncate">{row.label}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 pl-4 truncate">{row.formula}</div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className={`font-semibold ${row.textColor}`}>{row.value.toFixed(3)}</div>
                  <div className="text-[10px] text-slate-500">{row.pct.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Heuristic & Penalty Weight Matrix Across Profiles */}
        <div className="xl:col-span-6 bg-[#07090E] border border-white/[0.08] rounded p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-[#E85D2A]" />
              Heuristic &amp; Penalty Weight Matrix (All 3 Profiles)
            </h3>
            <span className="text-[10px] font-mono text-slate-400">
              Click any profile column to inspect its A* path
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] font-mono">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="py-1.5 pr-2 font-normal">Cost / Heuristic Parameter</th>
                  {routes.map((r) => {
                    const selected = r.id === activeRoute.id;
                    return (
                      <th key={r.id} className="py-1.5 px-2 text-right font-normal">
                        <button
                          type="button"
                          onClick={() => onSelectRouteId(r.id)}
                          className={`px-1.5 py-0.5 rounded uppercase transition-colors ${
                            selected
                              ? 'bg-[#E85D2A]/20 text-white font-semibold border border-[#E85D2A]/60'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {r.profile}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] tabular-nums">
                <tr>
                  <td className="py-1.5 pr-2 text-cyan-300">Heuristic Weight w_h (Euclidean)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.heuristicWeight.toFixed(2)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-slate-300">Terrain Slope Weight (w_slope)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-[#E85D2A] font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.slopeWeight.toFixed(2)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-slate-300">Terrain Roughness Weight (w_rough)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-amber-300 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.roughnessWeight.toFixed(2)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-slate-300">Uphill Climb Weight (w_climb / m)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.climbWeight.toFixed(3)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-slate-300">Tolerance Overflow Multiplier</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-purple-300 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.toleranceMultiplier.toFixed(1)}×
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-red-300">Critical Hazard Penalty (per km)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-red-400 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.criticalHazardPenalty.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-orange-300">High Hazard Penalty (per km)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-orange-300 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.highHazardPenalty.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-amber-300">Moderate Hazard Penalty (per km)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-amber-300 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.weights.modHazardPenalty.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 text-emerald-300">Science Corridor Bonus (slope &lt;12°, TI &gt;280)</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-emerald-400 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {scienceObjectiveActive
                        ? r.costDiagnostics.weights.scienceBonus.toFixed(2)
                        : '0.00 (off)'}
                    </td>
                  ))}
                </tr>
                <tr className="bg-white/[0.02]">
                  <td className="py-1.5 pr-2 text-slate-200 font-semibold">Resulting A* Search Nodes</td>
                  {routes.map((r) => (
                    <td
                      key={r.id}
                      className={`py-1.5 px-2 text-right ${
                        r.id === activeRoute.id ? 'text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {r.costDiagnostics.nodesExpanded}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Interactive Step-by-Step Cost Trajectory SVG */}
      <div className="bg-[#07090E] border border-white/[0.08] rounded p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-display font-semibold text-white flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              Step-by-Step A* Cost Profile Along Traverse ({steps.length} Grid Transitions)
            </h3>
            <div className="text-[10px] font-mono text-slate-400">
              Hover any step bar or point to inspect local slope, roughness, hazard penalty, and cumulative g(n)
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setChartMode('marginal')}
              className={`px-2.5 py-1 rounded text-[10px] font-mono border transition-colors ${
                chartMode === 'marginal'
                  ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200'
                  : 'bg-[#0D1016] border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              Per-Step Cost Spikes
            </button>
            <button
              type="button"
              onClick={() => setChartMode('cumulative')}
              className={`px-2.5 py-1 rounded text-[10px] font-mono border transition-colors ${
                chartMode === 'cumulative'
                  ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200'
                  : 'bg-[#0D1016] border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              Cumulative g(n) vs Geodesic
            </button>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-44 bg-[#05070B] border border-white/[0.06] rounded"
          onMouseLeave={() => setHoveredStepIdx(null)}
        >
          {/* Horizontal gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = padT + (1 - frac) * plotH;
            const yVal =
              chartMode === 'marginal'
                ? (frac * maxMarginalStepCost).toFixed(1)
                : (frac * maxCumulativeVal).toFixed(1);
            return (
              <g key={frac}>
                <line
                  x1={padL}
                  y1={y}
                  x2={padL + plotW}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {yVal}
                </text>
              </g>
            );
          })}

          {/* X-axis distance markers */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const x = padL + frac * plotW;
            const distLabel = (frac * totalDist).toFixed(1);
            return (
              <text
                key={frac}
                x={x}
                y={svgH - 7}
                textAnchor={frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}
                fill="#64748B"
                fontSize="9"
                fontFamily="monospace"
              >
                {distLabel} km
              </text>
            );
          })}

          {chartMode === 'marginal' && steps.length > 0 && (() => {
            const barSlotW = plotW / steps.length;
            const barW = Math.max(2, Math.min(18, barSlotW * 0.78));
            return steps.map((s, idx) => {
              const xCenter = padL + (idx + 0.5) * barSlotW;
              const x = xCenter - barW / 2;
              const baseH = (s.baseDistanceCost / maxMarginalStepCost) * plotH;
              const terrH = (s.terrainDifficultyCost / maxMarginalStepCost) * plotH;
              const hazH = (s.hazardAvoidanceCost / maxMarginalStepCost) * plotH;
              const yBase = padT + plotH - baseH;
              const yTerr = yBase - terrH;
              const yHaz = yTerr - hazH;
              const isHovered = hoveredStepIdx === idx;

              return (
                <g
                  key={s.stepIndex}
                  onMouseEnter={() => setHoveredStepIdx(idx)}
                  className="cursor-crosshair"
                >
                  <rect
                    x={padL + idx * barSlotW}
                    y={padT}
                    width={barSlotW}
                    height={plotH}
                    fill={isHovered ? 'rgba(255,255,255,0.05)' : 'transparent'}
                  />
                  <rect x={x} y={yBase} width={barW} height={baseH} fill="#06B6D4" opacity={0.85} />
                  {terrH > 0.3 && (
                    <rect x={x} y={yTerr} width={barW} height={terrH} fill="#E85D2A" opacity={0.9} />
                  )}
                  {hazH > 0.3 && (
                    <rect x={x} y={yHaz} width={barW} height={hazH} fill="#EF4444" opacity={0.95} />
                  )}
                </g>
              );
            });
          })()}

          {chartMode === 'cumulative' && steps.length > 0 && (() => {
            const pts = steps.map((s, idx) => {
              const x = padL + ((idx + 1) / steps.length) * plotW;
              const yG = padT + (1 - s.cumulativeGCost / maxCumulativeVal) * plotH;
              const yDist = padT + (1 - s.cumulativeDistKm / maxCumulativeVal) * plotH;
              return { x, yG, yDist, idx };
            });
            const startX = padL;
            const startY = padT + plotH;
            const gPath = `M${startX},${startY} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.yG.toFixed(1)}`).join(' ');
            const distPath = `M${startX},${startY} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.yDist.toFixed(1)}`).join(' ');
            const penaltyBand =
              `M${startX},${startY} ` +
              pts.map((p) => `L${p.x.toFixed(1)},${p.yG.toFixed(1)}`).join(' ') +
              ' ' +
              [...pts].reverse().map((p) => `L${p.x.toFixed(1)},${p.yDist.toFixed(1)}`).join(' ') +
              ' Z';

            const sliceW = plotW / steps.length;
            return (
              <g>
                <path d={penaltyBand} fill="rgba(232, 93, 42, 0.16)" />
                <path
                  d={distPath}
                  fill="none"
                  stroke="#06B6D4"
                  strokeWidth="1.75"
                  strokeDasharray="4 3"
                />
                <path d={gPath} fill="none" stroke="#E85D2A" strokeWidth="2.2" />
                {pts.map((p) => {
                  const isHovered = hoveredStepIdx === p.idx;
                  return (
                    <g
                      key={p.idx}
                      onMouseEnter={() => setHoveredStepIdx(p.idx)}
                      className="cursor-crosshair"
                    >
                      <rect
                        x={padL + p.idx * sliceW}
                        y={padT}
                        width={sliceW}
                        height={plotH}
                        fill="transparent"
                      />
                      {isHovered && (
                        <line
                          x1={p.x}
                          y1={padT}
                          x2={p.x}
                          y2={padT + plotH}
                          stroke="rgba(255,255,255,0.35)"
                          strokeDasharray="2 2"
                        />
                      )}
                      <circle
                        cx={p.x}
                        cy={p.yG}
                        r={isHovered ? 3.5 : 1.8}
                        fill={isHovered ? '#FFFFFF' : '#E85D2A'}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })()}
        </svg>

        {/* Legend + Active Step Readout */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 text-[10px] font-mono">
          <div className="flex flex-wrap items-center gap-3 text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-cyan-500 inline-block" />
              Geodesic Base (Δd)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#E85D2A] inline-block" />
              Terrain Penalty (Slope + TRI + Climb + Tolerance)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-red-500 inline-block" />
              Hazard Penalty
            </span>
          </div>

          {inspectedStep && (
            <div className="text-slate-200 tabular-nums bg-[#0D1016] border border-white/10 rounded px-2.5 py-1">
              {isShowingPeakDefault ? 'Peak-Cost Step' : 'Inspected Step'} #{inspectedStep.stepIndex} @{' '}
              {inspectedStep.cumulativeDistKm.toFixed(2)} km · Slope {inspectedStep.slopeDeg.toFixed(1)}° · TRI{' '}
              {inspectedStep.roughnessIdx.toFixed(0)} · {inspectedStep.hazardLevel} · Step g=
              {inspectedStep.netStepCost.toFixed(3)} (Terrain +{inspectedStep.terrainDifficultyCost.toFixed(3)}, Hazard +
              {inspectedStep.hazardAvoidanceCost.toFixed(3)})
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
