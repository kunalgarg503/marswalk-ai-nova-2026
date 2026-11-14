import type {
  AStarCostDiagnostics,
  AStarStepCostNode,
  LocalWaypoint,
  MarsLocation,
  MissionObjective,
  RiskLevel,
  RouteOption,
  RoutePlanSummary,
  RoutePreference,
  RouteWaypointNode,
  TerrainAnalysisResult,
  TerrainGridCell,
} from '../types/mars';
import { buildTerrainGrid, latLonToLocalKm } from './terrainEngine';
import { detectHazards } from './hazardEngine';
import { computeWalkingDurationDetails } from './survivalCalculator';

interface AStarNode {
  gx: number;
  gy: number;
  g: number;
  f: number;
}

class MinHeap {
  private data: AStarNode[] = [];

  get size(): number {
    return this.data.length;
  }

  push(node: AStarNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): AStarNode | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.data[parent].f <= this.data[idx].f) break;
      [this.data[parent], this.data[idx]] = [this.data[idx], this.data[parent]];
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest === idx) break;
      [this.data[idx], this.data[smallest]] = [this.data[smallest], this.data[idx]];
      idx = smallest;
    }
  }
}

interface WeightProfile {
  profile: RouteOption['profile'];
  label: string;
  slopeWeight: number;
  roughnessWeight: number;
  criticalHazardPenalty: number;
  highHazardPenalty: number;
  modHazardPenalty: number;
  climbWeight: number;
  toleranceMultiplier: number;
  scienceBonus: number;
}

export const WEIGHT_PROFILES: WeightProfile[] = [
  {
    profile: 'shortest',
    label: 'Direct Geodesic Path',
    slopeWeight: 0.01,
    roughnessWeight: 0.005,
    criticalHazardPenalty: 0.04,
    highHazardPenalty: 0.02,
    modHazardPenalty: 0.005,
    climbWeight: 0.0005,
    toleranceMultiplier: 0,
    scienceBonus: 0,
  },
  {
    profile: 'balanced',
    label: 'Balanced Traverse',
    slopeWeight: 1.4,
    roughnessWeight: 0.55,
    criticalHazardPenalty: 12.0,
    highHazardPenalty: 5.5,
    modHazardPenalty: 1.2,
    climbWeight: 0.012,
    toleranceMultiplier: 3.2,
    scienceBonus: 0.08,
  },
  {
    profile: 'safest',
    label: 'Max-Safety & Science Corridor',
    slopeWeight: 3.2,
    roughnessWeight: 1.25,
    criticalHazardPenalty: 35.0,
    highHazardPenalty: 16.0,
    modHazardPenalty: 3.0,
    climbWeight: 0.02,
    toleranceMultiplier: 6.5,
    scienceBonus: 0.22,
  },
];

interface StepCostDecomposition {
  baseDistanceCost: number;
  slopePenaltyCost: number;
  roughnessPenaltyCost: number;
  climbPenaltyCost: number;
  toleranceOverflowCost: number;
  terrainDifficultyCost: number;
  hazardAvoidanceCost: number;
  objectiveDiscountApplied: number;
  netStepCost: number;
}

function computeStepCostComponents(
  cCell: TerrainGridCell,
  nCell: TerrainGridCell,
  stepDistKm: number,
  weights: WeightProfile,
  objective: MissionObjective,
  maxAcceptableDifficulty: number,
): StepCostDecomposition {
  const slopeNorm = Math.pow(nCell.slopeDeg / 10, 1.7);
  const roughNorm = nCell.roughnessIdx / 50;
  const hazardPen =
    nCell.hazardLevel === 'CRITICAL'
      ? weights.criticalHazardPenalty
      : nCell.hazardLevel === 'HIGH'
        ? weights.highHazardPenalty
        : nCell.hazardLevel === 'MODERATE'
          ? weights.modHazardPenalty
          : 0;

  const elevDelta = Math.max(0, nCell.elevationM - cCell.elevationM);
  const climbPenaltyCost = elevDelta * weights.climbWeight;

  let objectiveDiscount = 0;
  if (
    (objective === 'geological-sampling' || objective === 'isru-survey') &&
    nCell.slopeDeg < 12 &&
    nCell.thermalInertia > 280
  ) {
    objectiveDiscount = Math.min(0.25, weights.scienceBonus * stepDistKm);
  }

  const toleranceOverflow =
    weights.toleranceMultiplier > 0 && nCell.difficultyScore > maxAcceptableDifficulty
      ? ((nCell.difficultyScore - maxAcceptableDifficulty) / 15) * weights.toleranceMultiplier
      : 0;

  const slopePenaltyCost = stepDistKm * (weights.slopeWeight * slopeNorm);
  const roughnessPenaltyCost = stepDistKm * (weights.roughnessWeight * roughNorm);
  const hazardAvoidanceCost = stepDistKm * hazardPen;
  const toleranceOverflowCost = stepDistKm * toleranceOverflow;
  const terrainDifficultyCost =
    slopePenaltyCost + roughnessPenaltyCost + climbPenaltyCost + toleranceOverflowCost;

  const rawPenaltyCost = terrainDifficultyCost + hazardAvoidanceCost;
  const objectiveDiscountApplied = Math.min(rawPenaltyCost, objectiveDiscount);
  const netStepCost = stepDistKm + (rawPenaltyCost - objectiveDiscountApplied);

  return {
    baseDistanceCost: stepDistKm,
    slopePenaltyCost,
    roughnessPenaltyCost,
    climbPenaltyCost,
    toleranceOverflowCost,
    terrainDifficultyCost,
    hazardAvoidanceCost,
    objectiveDiscountApplied,
    netStepCost,
  };
}

function coordToGrid(xKm: number, yKm: number, terrain: TerrainAnalysisResult): { gx: number; gy: number } {
  const gx = Math.max(0, Math.min(terrain.gridSize - 1, Math.round(xKm / terrain.cellSizeKm)));
  const gy = Math.max(0, Math.min(terrain.gridSize - 1, Math.round(yKm / terrain.cellSizeKm)));
  return { gx, gy };
}

interface AStarSearchResult {
  cells: TerrainGridCell[];
  nodesExpanded: number;
  totalGridNodes: number;
  initialHeuristicKm: number;
  totalGCost: number;
}

function runAStar(
  terrain: TerrainAnalysisResult,
  start: { gx: number; gy: number },
  goal: { gx: number; gy: number },
  weights: WeightProfile,
  objective: MissionObjective,
  maxAcceptableDifficulty: number,
): AStarSearchResult {
  const N = terrain.gridSize;
  const total = N * N;
  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const idx = (gx: number, gy: number) => gy * N + gx;
  const startIdx = idx(start.gx, start.gy);
  const goalIdx = idx(goal.gx, goal.gy);

  const heuristic = (gx: number, gy: number) =>
    Math.hypot(goal.gx - gx, goal.gy - gy) * terrain.cellSizeKm;

  const initialHeuristicKm = heuristic(start.gx, start.gy);
  gScore[startIdx] = 0;
  const open = new MinHeap();
  open.push({ gx: start.gx, gy: start.gy, g: 0, f: initialHeuristicKm });

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  let nodesExpanded = 0;

  while (open.size > 0) {
    const curr = open.pop()!;
    const cIdx = idx(curr.gx, curr.gy);
    if (closed[cIdx]) continue;
    closed[cIdx] = 1;
    nodesExpanded++;

    if (cIdx === goalIdx) break;

    const cCell = terrain.cells[curr.gy][curr.gx];

    for (const [ox, oy] of neighbors) {
      const nx = curr.gx + ox;
      const ny = curr.gy + oy;
      if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
      const nIdx = idx(nx, ny);
      if (closed[nIdx]) continue;

      const nCell = terrain.cells[ny][nx];
      const stepDistKm = Math.hypot(ox, oy) * terrain.cellSizeKm;
      const { netStepCost } = computeStepCostComponents(
        cCell,
        nCell,
        stepDistKm,
        weights,
        objective,
        maxAcceptableDifficulty,
      );

      const tentativeG = gScore[cIdx] + netStepCost;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = cIdx;
        gScore[nIdx] = tentativeG;
        open.push({
          gx: nx,
          gy: ny,
          g: tentativeG,
          f: tentativeG + heuristic(nx, ny),
        });
      }
    }
  }

  const path: TerrainGridCell[] = [];
  let trace = goalIdx;
  if (cameFrom[trace] === -1 && trace !== startIdx) {
    const fallbackCells = [terrain.cells[start.gy][start.gx], terrain.cells[goal.gy][goal.gx]];
    return {
      cells: fallbackCells,
      nodesExpanded,
      totalGridNodes: total,
      initialHeuristicKm,
      totalGCost: initialHeuristicKm,
    };
  }
  while (trace !== -1) {
    const gx = trace % N;
    const gy = Math.floor(trace / N);
    path.push(terrain.cells[gy][gx]);
    if (trace === startIdx) break;
    trace = cameFrom[trace];
  }
  path.reverse();
  return {
    cells: path,
    nodesExpanded,
    totalGridNodes: total,
    initialHeuristicKm,
    totalGCost: Number.isFinite(gScore[goalIdx]) ? gScore[goalIdx] : initialHeuristicKm,
  };
}

function evaluateRoute(
  searchResult: AStarSearchResult,
  weights: WeightProfile,
  objective: MissionObjective,
  maxAcceptableDifficulty: number,
  terrain: TerrainAnalysisResult,
  walkingSpeedKmh = 3.2,
): RouteOption {
  const { cells, nodesExpanded, totalGridNodes, initialHeuristicKm } = searchResult;
  const cellSizeKm = terrain.cellSizeKm;
  const waypoints: RouteWaypointNode[] = [];
  const stepBreakdown: AStarStepCostNode[] = [];
  let distanceKm = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  let maxSlopeDeg = 0;
  let slopeSum = 0;
  let diffSum = 0;
  let lowCount = 0;
  let modCount = 0;
  let highCount = 0;
  let criticalCount = 0;
  let estimatedDurationHr = 0;

  let baseDistanceCostSum = 0;
  let slopePenaltyCostSum = 0;
  let roughnessPenaltyCostSum = 0;
  let climbPenaltyCostSum = 0;
  let toleranceOverflowCostSum = 0;
  let terrainDifficultyCostSum = 0;
  let hazardAvoidanceCostSum = 0;
  let objectiveDiscountAppliedSum = 0;
  let cumulativeGCost = 0;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (i > 0) {
      const prev = cells[i - 1];
      const segKm = Math.hypot(c.xKm - prev.xKm, c.yKm - prev.yKm);
      const gridStepDistKm = Math.hypot(c.gx - prev.gx, c.gy - prev.gy) * cellSizeKm;
      distanceKm += segKm;
      const dElev = c.elevationM - prev.elevationM;
      if (dElev > 0) elevationGainM += dElev;
      else elevationLossM += Math.abs(dElev);

      const step = computeStepCostComponents(
        prev,
        c,
        gridStepDistKm,
        weights,
        objective,
        maxAcceptableDifficulty,
      );
      baseDistanceCostSum += step.baseDistanceCost;
      slopePenaltyCostSum += step.slopePenaltyCost;
      roughnessPenaltyCostSum += step.roughnessPenaltyCost;
      climbPenaltyCostSum += step.climbPenaltyCost;
      toleranceOverflowCostSum += step.toleranceOverflowCost;
      terrainDifficultyCostSum += step.terrainDifficultyCost;
      hazardAvoidanceCostSum += step.hazardAvoidanceCost;
      objectiveDiscountAppliedSum += step.objectiveDiscountApplied;
      cumulativeGCost += step.netStepCost;

      stepBreakdown.push({
        stepIndex: i,
        cumulativeDistKm: Number(distanceKm.toFixed(2)),
        cumulativeGCost,
        baseDistanceCost: step.baseDistanceCost,
        slopePenaltyCost: step.slopePenaltyCost,
        roughnessPenaltyCost: step.roughnessPenaltyCost,
        climbPenaltyCost: step.climbPenaltyCost,
        toleranceOverflowCost: step.toleranceOverflowCost,
        terrainDifficultyCost: step.terrainDifficultyCost,
        hazardAvoidanceCost: step.hazardAvoidanceCost,
        objectiveDiscountApplied: step.objectiveDiscountApplied,
        netStepCost: step.netStepCost,
        hazardLevel: c.hazardLevel,
        slopeDeg: c.slopeDeg,
        roughnessIdx: c.roughnessIdx,
        difficultyScore: c.difficultyScore,
      });
    }

    if (c.slopeDeg > maxSlopeDeg) maxSlopeDeg = c.slopeDeg;
    slopeSum += c.slopeDeg;
    diffSum += c.difficultyScore;
    if (c.hazardLevel === 'CRITICAL') criticalCount++;
    else if (c.hazardLevel === 'HIGH') highCount++;
    else if (c.hazardLevel === 'MODERATE') modCount++;
    else lowCount++;

    waypoints.push({
      gx: c.gx,
      gy: c.gy,
      xKm: c.xKm,
      yKm: c.yKm,
      lat: c.lat,
      lon: c.lon,
      elevationM: c.elevationM,
      slopeDeg: c.slopeDeg,
      roughnessIdx: c.roughnessIdx,
      craterProximityKm: c.craterProximityKm,
      difficultyScore: c.difficultyScore,
      hazardLevel: c.hazardLevel,
      cumulativeDistKm: Number(distanceKm.toFixed(2)),
    });
  }

  const n = Math.max(1, cells.length);
  const lowPct = Number(((lowCount / n) * 100).toFixed(1));
  const moderatePct = Number(((modCount / n) * 100).toFixed(1));
  const highPct = Number(((highCount / n) * 100).toFixed(1));
  const criticalPct = Number(((criticalCount / n) * 100).toFixed(1));
  const meanDifficulty = Number((diffSum / n).toFixed(1));
  const meanSlopeDeg = Number((slopeSum / n).toFixed(1));

  // Deterministic Safety & Risk Scores (0–100)
  const rawSafety =
    100 -
    criticalPct * 2.1 -
    highPct * 1.25 -
    moderatePct * 0.32 -
    Math.min(35, maxSlopeDeg * 1.05) -
    meanDifficulty * 0.26;
  const safetyScore = Math.max(5, Math.min(99, Math.round(rawSafety)));
  const overallRiskScore = 100 - safetyScore;

  let overallRiskLevel: RiskLevel = 'LOW';
  if (criticalCount > 0 || overallRiskScore >= 65) overallRiskLevel = 'CRITICAL';
  else if (highPct >= 15 || overallRiskScore >= 42) overallRiskLevel = 'HIGH';
  else if (moderatePct >= 25 || overallRiskScore >= 22) overallRiskLevel = 'MODERATE';

  const passesMaxDifficulty =
    criticalCount === 0 &&
    meanDifficulty <= maxAcceptableDifficulty &&
    maxSlopeDeg <= maxAcceptableDifficulty * 0.45 + 8;

  const reasoning =
    weights.profile === 'shortest'
      ? `Minimizes Euclidean path length (${distanceKm.toFixed(2)} km), crossing ${criticalCount} critical and ${highCount} high-risk sections (peak slope ${maxSlopeDeg.toFixed(1)}°).`
      : weights.profile === 'balanced'
        ? `Balances travel distance (${distanceKm.toFixed(2)} km) against slope avoidance (${criticalCount} critical, ${highCount} high-risk sections).`
        : `Detours around steep scarps and crater edges to achieve a ${safetyScore}/100 safety score (${criticalCount} critical, ${highCount} high-risk sections).`;

  const costDiagnostics: AStarCostDiagnostics = {
    profile: weights.profile,
    profileLabel: weights.label,
    heuristicFormula: 'h(n) = √((goal_x − n_x)² + (goal_y − n_y)²) · Δx',
    heuristicWeight: 1.0,
    initialHeuristicKm,
    gridSize: terrain.gridSize,
    totalGridNodes,
    gridResolutionM: Math.round(cellSizeKm * 1000),
    nodesExpanded,
    nodesExpandedPct: Number(((nodesExpanded / Math.max(1, totalGridNodes)) * 100).toFixed(1)),
    totalGCost: cumulativeGCost,
    baseDistanceCost: baseDistanceCostSum,
    slopePenaltyCost: slopePenaltyCostSum,
    roughnessPenaltyCost: roughnessPenaltyCostSum,
    climbPenaltyCost: climbPenaltyCostSum,
    toleranceOverflowCost: toleranceOverflowCostSum,
    terrainDifficultyCost: terrainDifficultyCostSum,
    hazardAvoidanceCost: hazardAvoidanceCostSum,
    objectiveDiscountApplied: objectiveDiscountAppliedSum,
    weights: {
      slopeWeight: weights.slopeWeight,
      roughnessWeight: weights.roughnessWeight,
      climbWeight: weights.climbWeight,
      toleranceMultiplier: weights.toleranceMultiplier,
      criticalHazardPenalty: weights.criticalHazardPenalty,
      highHazardPenalty: weights.highHazardPenalty,
      modHazardPenalty: weights.modHazardPenalty,
      scienceBonus: weights.scienceBonus,
    },
    stepBreakdown,
  };

  const walkingTiming = computeWalkingDurationDetails({
    distanceKm: Number(distanceKm.toFixed(2)),
    walkingSpeedKmh,
    elevationGainM: Math.round(elevationGainM),
    terrainDifficulty: meanDifficulty,
  });
  estimatedDurationHr = walkingTiming.terrainAdjustedWalkingHr;

  return {
    id: `route-${weights.profile}`,
    profile: weights.profile,
    label: weights.label,
    waypoints,
    distanceKm: Number(distanceKm.toFixed(2)),
    elevationGainM: Math.round(elevationGainM),
    elevationLossM: Math.round(elevationLossM),
    maxSlopeDeg: Number(maxSlopeDeg.toFixed(1)),
    meanSlopeDeg,
    meanDifficulty,
    estimatedDurationHr,
    hazardExposure: {
      lowPct,
      moderatePct,
      highPct,
      criticalPct,
      moderateSectionCount: modCount,
      highSectionCount: highCount,
      criticalSectionCount: criticalCount,
      flaggedHazardCount: criticalCount + highCount + Math.ceil(modCount / 3),
    },
    overallRiskScore,
    overallRiskLevel,
    safetyScore,
    coverageNote: `Evaluated across all ${cells.length} grid steps (~${Math.round(cellSizeKm * 1000)} m/step).`,
    passesMaxDifficulty,
    recommended: false,
    reasoning,
    costDiagnostics,
  };
}

export function planMartianRoute(params: {
  location: MarsLocation;
  originWaypoint: LocalWaypoint;
  destWaypoint: LocalWaypoint;
  viaWaypoints?: LocalWaypoint[];
  objective: MissionObjective;
  routePreference?: RoutePreference;
  maxAcceptableDifficulty: number;
  walkingSpeedKmh?: number;
}): RoutePlanSummary {
  const {
    location,
    originWaypoint,
    destWaypoint,
    viaWaypoints = [],
    objective,
    routePreference = 'balanced',
    maxAcceptableDifficulty,
    walkingSpeedKmh = 3.2,
  } = params;
  const terrain = buildTerrainGrid(location, 44, 25);

  const originLocal = latLonToLocalKm(originWaypoint.lat, originWaypoint.lon, location, 25);
  const destLocal = latLonToLocalKm(destWaypoint.lat, destWaypoint.lon, location, 25);
  const start = coordToGrid(originLocal.xKm, originLocal.yKm, terrain);
  let goal = coordToGrid(destLocal.xKm, destLocal.yKm, terrain);

  // Deduplicate intermediate science waypoints against origin/destination and each other
  const activeVias: LocalWaypoint[] = [];
  const seenViaIds = new Set<string>([originWaypoint.id, destWaypoint.id]);
  for (const v of viaWaypoints) {
    if (!v || seenViaIds.has(v.id)) continue;
    seenViaIds.add(v.id);
    activeVias.push(v);
  }

  if (activeVias.length === 0 && start.gx === goal.gx && start.gy === goal.gy) {
    goal = {
      gx: Math.min(terrain.gridSize - 1, start.gx + 8),
      gy: Math.min(terrain.gridSize - 1, start.gy + 8),
    };
  }

  const legNodes: Array<{ gx: number; gy: number }> = [
    start,
    ...activeVias.map((v) => {
      const local = latLonToLocalKm(v.lat, v.lon, location, 25);
      return coordToGrid(local.xKm, local.yKm, terrain);
    }),
    goal,
  ];

  const routes = WEIGHT_PROFILES.map((wp) => {
    if (legNodes.length <= 2) {
      const searchResult = runAStar(terrain, start, goal, wp, objective, maxAcceptableDifficulty);
      return evaluateRoute(searchResult, wp, objective, maxAcceptableDifficulty, terrain, walkingSpeedKmh);
    }

    const stitchedCells: TerrainGridCell[] = [];
    let totalNodesExpanded = 0;
    let totalInitialHeuristicKm = 0;
    let totalGCost = 0;
    let totalGridNodes = terrain.gridSize * terrain.gridSize;

    for (let i = 0; i < legNodes.length - 1; i++) {
      const legStart = legNodes[i];
      const legGoal = legNodes[i + 1];
      if (legStart.gx === legGoal.gx && legStart.gy === legGoal.gy) {
        if (stitchedCells.length === 0) {
          stitchedCells.push(terrain.cells[legStart.gy][legStart.gx]);
        }
        continue;
      }
      const legRes = runAStar(terrain, legStart, legGoal, wp, objective, maxAcceptableDifficulty);
      totalNodesExpanded += legRes.nodesExpanded;
      totalInitialHeuristicKm += legRes.initialHeuristicKm;
      totalGCost += legRes.totalGCost;
      totalGridNodes = legRes.totalGridNodes;

      const sliceFrom = stitchedCells.length > 0 ? 1 : 0;
      for (let cIdx = sliceFrom; cIdx < legRes.cells.length; cIdx++) {
        stitchedCells.push(legRes.cells[cIdx]);
      }
    }

    if (stitchedCells.length < 2) {
      stitchedCells.push(terrain.cells[goal.gy][goal.gx]);
    }

    const combinedSearch: AStarSearchResult = {
      cells: stitchedCells,
      nodesExpanded: totalNodesExpanded,
      totalGridNodes,
      initialHeuristicKm: totalInitialHeuristicKm,
      totalGCost,
    };

    return evaluateRoute(combinedSearch, wp, objective, maxAcceptableDifficulty, terrain, walkingSpeedKmh);
  });

  const preferredRoute = routes.find((r) => r.profile === routePreference) || routes[1];
  const shortest = routes.find((r) => r.profile === 'shortest')!;
  const safest = routes.find((r) => r.profile === 'safest')!;

  const bestId = preferredRoute.id;
  for (const r of routes) {
    r.recommended = r.id === bestId;
  }

  const best = routes.find((r) => r.id === bestId)!;
  const hazards = detectHazards(terrain, best.waypoints);

  const distDelta = (best.distanceKm - shortest.distanceKm).toFixed(2);
  const safetyGain = best.safetyScore - shortest.safetyScore;
  const toleranceNote = best.passesMaxDifficulty
    ? `within your terrain tolerance (≤ ${maxAcceptableDifficulty}/100)`
    : `exceeding your terrain tolerance (≤ ${maxAcceptableDifficulty}/100) — consider switching to ${safest.label} (${safest.safetyScore}/100 safety)`;
  const viaNote =
    activeVias.length > 0
      ? ` via ${activeVias.length} science stop(s) (${activeVias.map((v) => v.name).join(', ')})`
      : '';

  const isSameCorridorAsShortest =
    best.profile !== 'shortest' &&
    Math.abs(best.distanceKm - shortest.distanceKm) < 0.01 &&
    best.safetyScore === shortest.safetyScore &&
    best.waypoints.length === shortest.waypoints.length;

  const selectionExplanation =
    best.profile === 'shortest'
      ? `${best.label}${viaNote} selected per Shortest preference (${best.distanceKm.toFixed(2)} km, max slope ${best.maxSlopeDeg}°), ${toleranceNote}.`
      : isSameCorridorAsShortest
        ? `${best.label}${viaNote} converged on the same optimal corridor as Shortest (${best.distanceKm.toFixed(2)} km, ${best.safetyScore}/100 safety) because the direct cells between waypoints already avoid higher-penalty hazard detours, ${toleranceNote}.`
        : `${best.label}${viaNote} selected per ${routePreference.toUpperCase()} preference: +${distDelta} km over the shortest multi-leg path yields ${safetyGain >= 0 ? `+${safetyGain}` : safetyGain} safety points (${best.safetyScore}/100), ${toleranceNote}.`;

  return {
    mode: 'local-eva',
    originName: originWaypoint.name,
    destinationName: destWaypoint.name,
    originLat: originWaypoint.lat,
    originLon: originWaypoint.lon,
    destLat: destWaypoint.lat,
    destLon: destWaypoint.lon,
    viaWaypoints: activeVias.map((v) => ({
      id: v.id,
      name: v.name,
      lat: v.lat,
      lon: v.lon,
      elevationM: v.elevationM,
      localXKm: v.localXKm,
      localYKm: v.localYKm,
    })),
    objective,
    routePreference,
    maxAcceptableDifficulty,
    terrain,
    hazards,
    routes,
    recommendedRouteId: bestId,
    selectionExplanation,
  };
}
