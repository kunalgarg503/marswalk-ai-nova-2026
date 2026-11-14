import type {
  LandingZoneCandidate,
  MarsLocation,
  RiskLevel,
  TerrainAnalysisResult,
  TerrainGridCell,
} from '../types/mars';

function hash2D(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * smoothNoise(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return value / norm;
}

function stringSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 100000);
}

interface SyntheticCrater {
  cx: number;
  cy: number;
  radiusKm: number;
  depthM: number;
  rimHeightM: number;
}

function getRegionCraters(location: MarsLocation, spanKm: number, seed: number): SyntheticCrater[] {
  const count = location.type === 'Volcanic Plains' ? 4 : location.type === 'Crater Basin' ? 7 : 6;
  const craters: SyntheticCrater[] = [];
  for (let i = 0; i < count; i++) {
    const rx = hash2D(i, 11, seed);
    const ry = hash2D(i, 29, seed);
    const rr = hash2D(i, 47, seed);
    const radiusKm = 0.9 + rr * 2.3;
    const cx = spanKm * (0.15 + rx * 0.7);
    const cy = spanKm * (0.15 + ry * 0.7);
    const depthM = 45 + rr * 145;
    craters.push({
      cx,
      cy,
      radiusKm,
      depthM,
      rimHeightM: depthM * 0.28,
    });
  }
  return craters;
}

/**
 * Transparent 4-Level Risk Classification Rules:
 * - CRITICAL: Slope >= 23 deg OR Difficulty >= 74 OR (Crater edge < 0.35 km and Slope >= 17 deg)
 * - HIGH: Slope >= 16 deg OR Difficulty >= 54 OR Crater edge < 0.45 km
 * - MODERATE: Slope >= 10 deg OR Difficulty >= 34 OR Rock cover >= 25% OR TIU < 160 (dust/uncertain regolith)
 * - LOW: All other cells (relatively safe terrain)
 */
export function classifyTerrainRisk(params: {
  slopeDeg: number;
  difficultyScore: number;
  craterProximityKm: number;
  rockAbundancePct: number;
  thermalInertia: number;
}): RiskLevel {
  const { slopeDeg, difficultyScore, craterProximityKm, rockAbundancePct, thermalInertia } = params;
  if (slopeDeg >= 23 || difficultyScore >= 74 || (craterProximityKm < 0.35 && slopeDeg >= 17)) {
    return 'CRITICAL';
  }
  if (slopeDeg >= 16 || difficultyScore >= 54 || (craterProximityKm < 0.45 && slopeDeg >= 12)) {
    return 'HIGH';
  }
  if (slopeDeg >= 10 || difficultyScore >= 34 || rockAbundancePct >= 25 || thermalInertia < 160) {
    return 'MODERATE';
  }
  return 'LOW';
}

export function getTerrainSectorCenter(location: MarsLocation): { lat: number; lon: number } {
  if (!location.localWaypoints || location.localWaypoints.length === 0) {
    return { lat: location.lat, lon: location.lon };
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const wp of location.localWaypoints) {
    if (wp.lat < minLat) minLat = wp.lat;
    if (wp.lat > maxLat) maxLat = wp.lat;
    if (wp.lon < minLon) minLon = wp.lon;
    if (wp.lon > maxLon) maxLon = wp.lon;
  }
  return {
    lat: (minLat + maxLat) / 2,
    lon: (minLon + maxLon) / 2,
  };
}

export function latLonToLocalKm(
  lat: number,
  lon: number,
  location: MarsLocation,
  spanKm = 25,
): { xKm: number; yKm: number } {
  const center = getTerrainSectorCenter(location);
  const kmPerDegLat = 59.29;
  const kmPerDegLon = Math.max(15, 59.29 * Math.cos((center.lat * Math.PI) / 180));
  const xKm = spanKm / 2 + (lon - center.lon) * kmPerDegLon;
  const yKm = spanKm / 2 + (lat - center.lat) * kmPerDegLat;
  return {
    xKm: Number(Math.max(0.5, Math.min(spanKm - 0.5, xKm)).toFixed(2)),
    yKm: Number(Math.max(0.5, Math.min(spanKm - 0.5, yKm)).toFixed(2)),
  };
}

export function buildTerrainGrid(location: MarsLocation, gridSize = 44, spanKm = 25): TerrainAnalysisResult {
  const seed = stringSeed(location.id);
  const cellSizeKm = spanKm / (gridSize - 1);
  const cellSizeM = cellSizeKm * 1000;
  const craters = getRegionCraters(location, spanKm, seed);
  const sectorCenter = getTerrainSectorCenter(location);

  const reliefScale =
    location.type === 'Canyon System'
      ? 680
      : location.type === 'Shield Volcano'
        ? 540
        : location.type === 'Crater Basin'
          ? 240
          : location.type === 'Outflow Channel'
            ? 290
            : location.type === 'Polar / Ice Plain'
              ? 85
              : 68;

  const rawElev: number[][] = Array.from({ length: gridSize }, () => new Array(gridSize).fill(0));
  const craterDistGrid: number[][] = Array.from({ length: gridSize }, () => new Array(gridSize).fill(99));

  const kmPerDegLat = 59.29;
  const kmPerDegLon = Math.max(15, 59.29 * Math.cos((sectorCenter.lat * Math.PI) / 180));

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const xKm = gx * cellSizeKm;
      const yKm = gy * cellSizeKm;

      const n1 = fbm(xKm * 0.14, yKm * 0.14, seed, 4) - 0.5;
      const ridgeNoise = Math.abs(fbm(xKm * 0.28, yKm * 0.28, seed + 17, 3) - 0.5) * 2;

      let elev = location.elevationM + n1 * reliefScale;

      if (location.type === 'Canyon System') {
        const scarpLine = 0.55 * xKm + 6.5 - yKm;
        elev += Math.tanh(scarpLine * 0.45) * 390;
      } else if (location.type === 'Shield Volcano') {
        elev += (xKm / spanKm) * 420 + (yKm / spanKm) * 260;
        elev += (1 - ridgeNoise) * 140;
      } else if (location.type === 'Crater Basin') {
        elev += Math.sin(xKm * 0.35 + yKm * 0.15) * 42 + (1 - ridgeNoise) * 65;
      } else if (location.type === 'Outflow Channel') {
        const channelCenter = 12.5 + Math.sin(xKm * 0.25) * 3.2;
        const distChannel = Math.abs(yKm - channelCenter);
        elev -= Math.exp(-(distChannel * distChannel) / 14) * 165;
      }

      let minCraterEdgeDist = 99;
      for (const c of craters) {
        const dx = xKm - c.cx;
        const dy = yKm - c.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const edgeDist = Math.abs(dist - c.radiusKm);
        if (edgeDist < minCraterEdgeDist) minCraterEdgeDist = edgeDist;

        const rNorm = dist / c.radiusKm;
        if (rNorm < 1.0) {
          elev -= c.depthM * (1 - rNorm * rNorm);
        }
        const rimFactor = Math.exp(-Math.pow((rNorm - 1.02) / 0.2, 2));
        elev += c.rimHeightM * rimFactor;
      }

      rawElev[gy][gx] = elev;
      craterDistGrid[gy][gx] = minCraterEdgeDist;
    }
  }

  const cells: TerrainGridCell[][] = [];
  let minElev = Infinity;
  let maxElev = -Infinity;
  let elevSum = 0;
  let slopeSum = 0;
  let maxSlope = 0;
  let roughnessSum = 0;
  let maxRoughness = 0;
  let minCraterProx = Infinity;
  let craterProxSum = 0;
  let criticalCount = 0;
  let highCount = 0;
  let modCount = 0;
  let lowCount = 0;
  let landingZoneCount = 0;

  const landingCandidatesRaw: Array<{ score: number; candidate: LandingZoneCandidate }> = [];

  for (let gy = 0; gy < gridSize; gy++) {
    const row: TerrainGridCell[] = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const xKm = gx * cellSizeKm;
      const yKm = gy * cellSizeKm;
      const elev = rawElev[gy][gx];
      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;
      elevSum += elev;

      const left = rawElev[gy][Math.max(0, gx - 1)];
      const right = rawElev[gy][Math.min(gridSize - 1, gx + 1)];
      const down = rawElev[Math.max(0, gy - 1)][gx];
      const up = rawElev[Math.min(gridSize - 1, gy + 1)][gx];

      const dxSpan = (gx === 0 || gx === gridSize - 1 ? 1 : 2) * cellSizeM;
      const dySpan = (gy === 0 || gy === gridSize - 1 ? 1 : 2) * cellSizeM;
      const dzdx = (right - left) / dxSpan;
      const dzdy = (up - down) / dySpan;
      const slopeDeg = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;

      let sqDiffSum = 0;
      let nCount = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const ny = gy + oy;
          const nx = gx + ox;
          if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
            const diff = rawElev[ny][nx] - elev;
            sqDiffSum += diff * diff;
            nCount++;
          }
        }
      }
      const triMeters = Math.sqrt(sqDiffSum / Math.max(1, nCount));
      const roughnessIdx = Math.min(100, (triMeters / 45) * 100);

      const tiNoise = (fbm(xKm * 0.45, yKm * 0.45, seed + 99, 3) - 0.5) * 130;
      const thermalInertia = Math.max(70, Math.min(650, location.thermalInertiaTIU + tiNoise + slopeDeg * 3.5));
      const rockAbundancePct = Math.max(
        2,
        Math.min(48, ((thermalInertia - 100) / 480) * 32 + roughnessIdx * 0.16),
      );
      const craterProximityKm = craterDistGrid[gy][gx];

      const slopeTerm = Math.min(52, (slopeDeg / 28) * 52);
      const roughTerm = Math.min(25, roughnessIdx * 0.25);
      const rockTerm = Math.min(15, (rockAbundancePct / 45) * 15);
      const craterRimTerm = craterProximityKm < 0.7 ? 10 * (1 - craterProximityKm / 0.7) : 0;
      const dustSinkageTerm = thermalInertia < 160 ? 9 : 0;

      const difficultyScore = Math.min(
        100,
        Math.round(slopeTerm + roughTerm + rockTerm + craterRimTerm + dustSinkageTerm),
      );

      const hazardReasons: string[] = [];
      if (slopeDeg >= 23) {
        hazardReasons.push(`Critical slope (${slopeDeg.toFixed(1)}° ≥ 23°) poses severe slip and rollover failure risk`);
      } else if (slopeDeg >= 16) {
        hazardReasons.push(`Steep gradient (${slopeDeg.toFixed(1)}° ≥ 16°) exceeds nominal EVA stability comfort`);
      } else if (slopeDeg >= 10) {
        hazardReasons.push(`Moderate incline (${slopeDeg.toFixed(1)}°) increases metabolic & traction demand`);
      }
      if (craterProximityKm < 0.55) {
        hazardReasons.push(`Crater edge/depression proximity (${(craterProximityKm * 1000).toFixed(0)} m) with rim instability`);
      }
      if (rockAbundancePct >= 25) {
        hazardReasons.push(`Rocky/boulder terrain (~${rockAbundancePct.toFixed(0)}% cover inferred from THEMIS TIU)`);
      }
      if (roughnessIdx >= 55) {
        hazardReasons.push(`High surface roughness index (${roughnessIdx.toFixed(0)}/100)`);
      }
      if (thermalInertia < 160) {
        hazardReasons.push(`Uncertain low-TIU regolith (${thermalInertia.toFixed(0)} TIU) indicates fine dust / sinkage uncertainty`);
      }

      const hazardLevel = classifyTerrainRisk({
        slopeDeg,
        difficultyScore,
        craterProximityKm,
        rockAbundancePct,
        thermalInertia,
      });

      if (hazardLevel === 'CRITICAL') criticalCount++;
      else if (hazardLevel === 'HIGH') highCount++;
      else if (hazardLevel === 'MODERATE') modCount++;
      else lowCount++;

      // Potential Landing & Walking Area identification
      let landingSuitability: TerrainGridCell['landingSuitability'] = 'UNSUITABLE';
      if (
        hazardLevel === 'LOW' &&
        slopeDeg <= 5.5 &&
        roughnessIdx <= 22 &&
        craterProximityKm >= 1.1 &&
        thermalInertia >= 180
      ) {
        landingSuitability = 'SUITABLE';
        landingZoneCount++;
        const suitabilityScore = 100 - slopeDeg * 6 - roughnessIdx - (thermalInertia < 200 ? 10 : 0);
        landingCandidatesRaw.push({
          score: suitabilityScore,
          candidate: {
            id: `land-${gx}-${gy}`,
            label: `Flat Sector (${xKm.toFixed(1)}, ${yKm.toFixed(1)} km)`,
            suitability: slopeDeg <= 3.5 && roughnessIdx <= 14 ? 'Landing & EVA Corridor' : 'EVA Walking Corridor',
            lat: Number((sectorCenter.lat + (yKm - spanKm / 2) / kmPerDegLat).toFixed(4)),
            lon: Number((sectorCenter.lon + (xKm - spanKm / 2) / kmPerDegLon).toFixed(4)),
            xKm: Number(xKm.toFixed(2)),
            yKm: Number(yKm.toFixed(2)),
            elevationM: Math.round(elev),
            slopeDeg: Number(slopeDeg.toFixed(1)),
            roughnessIdx: Number(roughnessIdx.toFixed(1)),
            craterStandoffKm: Number(craterProximityKm.toFixed(2)),
            thermalInertia: Math.round(thermalInertia),
            reason: `Low slope (${slopeDeg.toFixed(1)}°), minimal roughness (${roughnessIdx.toFixed(0)}/100), ${craterProximityKm.toFixed(2)} km crater standoff, firm ${Math.round(thermalInertia)} TIU regolith.`,
          },
        });
      } else if (hazardLevel === 'LOW' && slopeDeg <= 9.5) {
        landingSuitability = 'MARGINAL';
      }

      const lat = sectorCenter.lat + (yKm - spanKm / 2) / kmPerDegLat;
      const lon = sectorCenter.lon + (xKm - spanKm / 2) / kmPerDegLon;

      slopeSum += slopeDeg;
      if (slopeDeg > maxSlope) maxSlope = slopeDeg;
      roughnessSum += roughnessIdx;
      if (roughnessIdx > maxRoughness) maxRoughness = roughnessIdx;
      if (craterProximityKm < minCraterProx) minCraterProx = craterProximityKm;
      craterProxSum += craterProximityKm;

      row.push({
        gx,
        gy,
        xKm,
        yKm,
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
        elevationM: Math.round(elev),
        slopeDeg: Number(slopeDeg.toFixed(2)),
        roughnessIdx: Number(roughnessIdx.toFixed(1)),
        thermalInertia: Math.round(thermalInertia),
        craterProximityKm: Number(craterProximityKm.toFixed(2)),
        rockAbundancePct: Number(rockAbundancePct.toFixed(1)),
        difficultyScore,
        hazardLevel,
        hazardReasons,
        landingSuitability,
      });
    }
    cells.push(row);
  }

  // De-cluster landing candidates (>= 3 km apart)
  landingCandidatesRaw.sort((a, b) => b.score - a.score);
  const landingCandidates: LandingZoneCandidate[] = [];
  for (const item of landingCandidatesRaw) {
    if (landingCandidates.length >= 6) break;
    const tooClose = landingCandidates.some(
      (c) => Math.hypot(c.xKm - item.candidate.xKm, c.yKm - item.candidate.yKm) < 3.0,
    );
    if (!tooClose) landingCandidates.push(item.candidate);
  }

  const totalCells = gridSize * gridSize;

  return {
    regionId: location.id,
    regionName: location.name,
    gridSize,
    spanKm,
    cellSizeKm,
    cells,
    minElevationM: Math.round(minElev),
    maxElevationM: Math.round(maxElev),
    meanElevationM: Math.round(elevSum / totalCells),
    meanSlopeDeg: Number((slopeSum / totalCells).toFixed(2)),
    maxSlopeDeg: Number(maxSlope.toFixed(2)),
    meanRoughness: Number((roughnessSum / totalCells).toFixed(1)),
    maxRoughness: Number(maxRoughness.toFixed(1)),
    minCraterProximityKm: Number(minCraterProx.toFixed(2)),
    meanCraterProximityKm: Number((craterProxSum / totalCells).toFixed(2)),
    criticalRiskCellPct: Number(((criticalCount / totalCells) * 100).toFixed(1)),
    highRiskCellPct: Number(((highCount / totalCells) * 100).toFixed(1)),
    moderateRiskCellPct: Number(((modCount / totalCells) * 100).toFixed(1)),
    lowRiskCellPct: Number(((lowCount / totalCells) * 100).toFixed(1)),
    landingZoneCount,
    landingCandidates,
  };
}
