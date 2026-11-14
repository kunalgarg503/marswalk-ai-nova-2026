import * as THREE from 'three';

function hash(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm3D(x: number, y: number, z: number, octaves = 5): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1.8;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    // Project 3D sphere coords into seamless multi-plane 2D hashes (zero seam at ±180°)
    const n1 = noise2D(x * freq + z * 0.7 * freq, y * freq - z * 0.5 * freq, 101 + i * 37);
    const n2 = noise2D(z * freq - x * 0.6 * freq, y * freq + x * 0.4 * freq, 313 + i * 53);
    val += amp * ((n1 + n2) * 0.5);
    norm += amp;
    amp *= 0.5;
    freq *= 2.08;
  }
  return val / norm;
}

/**
 * Computes approximate realistic Martian elevation (normalized -1 to +1)
 * and albedo character at geographic (latDeg, lonDeg) using real major features:
 * - Southern Highlands vs Northern Lowlands dichotomy
 * - Tharsis Rise & Olympus Mons
 * - Valles Marineris rift canyon
 * - Hellas & Argyre impact basins
 * - Syrtis Major dark basaltic shield
 */
function sampleMarsField(latDeg: number, lonDeg: number): {
  elevNorm: number;
  darkBasalt: number;
  iceCap: number;
} {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;
  const sx = Math.cos(latRad) * Math.cos(lonRad);
  const sy = Math.sin(latRad);
  const sz = Math.cos(latRad) * Math.sin(lonRad);

  const macro = fbm3D(sx, sy, sz, 5);
  const fine = fbm3D(sx * 3.1 + 1.4, sy * 3.1 - 0.8, sz * 3.1, 4);

  // Hemispheric dichotomy: northern lowlands lower than southern cratered highlands
  let elev = -Math.tanh((latDeg - 8) / 28) * 0.32 + (macro - 0.5) * 0.55 + (fine - 0.5) * 0.22;

  // Tharsis Bulge (+lat ~ 0..20, lon ~ -110)
  const dTharsis = Math.hypot((latDeg - 4) * 0.8, lonDeg + 108);
  elev += Math.exp(-(dTharsis * dTharsis) / 1450) * 0.48;

  // Olympus Mons (18.65°N, -133.8°E)
  const dOly = Math.hypot(latDeg - 18.65, lonDeg + 133.8);
  elev += Math.exp(-(dOly * dOly) / 48) * 0.75;

  // Valles Marineris (-13.9°S, -59.2°E elongated east-west rift)
  const dVmLat = (latDeg + 12.5) / 4.2;
  const dVmLon = (lonDeg + 65) / 22;
  const vmDistSq = dVmLat * dVmLat + dVmLon * dVmLon;
  elev -= Math.exp(-vmDistSq) * 0.62;

  // Hellas Planitia (-42.4°S, +70.5°E deep circular basin)
  const dHellas = Math.hypot((latDeg + 42.4) * 1.15, lonDeg - 70.5);
  elev -= Math.exp(-(dHellas * dHellas) / 310) * 0.72;

  // Argyre Planitia (-49.7°S, -43.9°E)
  const dArgyre = Math.hypot((latDeg + 49.7) * 1.15, lonDeg + 43.9);
  elev -= Math.exp(-(dArgyre * dArgyre) / 130) * 0.48;

  // Isidis Basin (+12.9°N, +87°E — Jezero sits on western rim!)
  const dIsidis = Math.hypot(latDeg - 12.9, lonDeg - 87.0);
  elev -= Math.exp(-(dIsidis * dIsidis) / 110) * 0.34;

  // Syrtis Major Planum dark volcanic albedo shield (~8.4°N, 69.5°E)
  const dSyrtis = Math.hypot((latDeg - 8.4) * 0.9, (lonDeg - 69.5) * 1.1);
  const syrtisDark = Math.exp(-(dSyrtis * dSyrtis) / 170);

  // Acidalia Planitia dark northern plain (~48°N, -22°E)
  const dAcidalia = Math.hypot((latDeg - 48) * 1.1, lonDeg + 22);
  const acidaliaDark = Math.exp(-(dAcidalia * dAcidalia) / 420) * 0.7;

  // Sabaea / Meridiani dark equatorial band
  const dMeridiani = Math.hypot((latDeg + 12) * 1.8, (lonDeg - 15) * 0.45);
  const meridianiDark = Math.exp(-(dMeridiani * dMeridiani) / 380) * 0.55;

  const darkBasalt = Math.min(1, syrtisDark * 0.9 + acidaliaDark + meridianiDark + Math.max(0, 0.45 - macro) * 0.35);

  // Polar CO2/H2O ice caps
  const absLat = Math.abs(latDeg) + (fine - 0.5) * 5.5;
  const iceCap = absLat > 79 ? Math.min(1, (absLat - 79) / 6) : 0;

  return {
    elevNorm: Math.max(-1, Math.min(1, elev)),
    darkBasalt,
    iceCap,
  };
}

function molaPalette(t: number): [number, number, number] {
  // MOLA hypsometric color scale: deep violet/blue (-8km) -> cyan -> green -> yellow -> orange -> red -> white (+21km)
  const x = Math.max(0, Math.min(1, (t + 1) * 0.5));
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [34, 24, 92]],
    [0.22, [38, 96, 178]],
    [0.42, [36, 158, 152]],
    [0.58, [132, 184, 76]],
    [0.74, [232, 168, 52]],
    [0.88, [206, 68, 38]],
    [1.0, [244, 232, 224]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return [244, 232, 224];
}

function themisPalette(t: number): [number, number, number] {
  // Thermal inertia scale: dark navy (dusty low TIU) -> teal -> amber -> bright yellow-white (exposed bedrock)
  const x = Math.max(0, Math.min(1, t));
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [14, 18, 38]],
    [0.35, [30, 88, 132]],
    [0.65, [216, 108, 36]],
    [0.88, [246, 198, 72]],
    [1.0, [252, 244, 210]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return [252, 244, 210];
}

export interface MarsTextures {
  albedoMap: THREE.CanvasTexture;
  molaMap: THREE.CanvasTexture;
  themisMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export function generateMarsTextures(maxAnisotropy: number): MarsTextures {
  const width = 1024;
  const height = 512;

  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  };

  const albedoCanvas = makeCanvas();
  const molaCanvas = makeCanvas();
  const themisCanvas = makeCanvas();
  const bumpCanvas = makeCanvas();

  const albedoCtx = albedoCanvas.getContext('2d')!;
  const molaCtx = molaCanvas.getContext('2d')!;
  const themisCtx = themisCanvas.getContext('2d')!;
  const bumpCtx = bumpCanvas.getContext('2d')!;

  const albedoImg = albedoCtx.createImageData(width, height);
  const molaImg = molaCtx.createImageData(width, height);
  const themisImg = themisCtx.createImageData(width, height);
  const bumpImg = bumpCtx.createImageData(width, height);

  for (let py = 0; py < height; py++) {
    // py=0 is North pole (+90°), py=height-1 is South pole (-90°)
    const v = 1 - py / (height - 1);
    const latDeg = v * 180 - 90;

    for (let px = 0; px < width; px++) {
      const u = px / (width - 1);
      const lonDeg = u * 360 - 180;

      const { elevNorm, darkBasalt, iceCap } = sampleMarsField(latDeg, lonDeg);
      const idx = (py * width + px) * 4;

      // Realistic iron-oxide dust + dark basaltic plains + polar caps
      let r = 196 - darkBasalt * 86 + elevNorm * 28;
      let g = 108 - darkBasalt * 48 + elevNorm * 16;
      let b = 68 - darkBasalt * 28 + elevNorm * 10;

      if (iceCap > 0) {
        r = r * (1 - iceCap) + 236 * iceCap;
        g = g * (1 - iceCap) + 234 * iceCap;
        b = b * (1 - iceCap) + 232 * iceCap;
      }

      albedoImg.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      albedoImg.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      albedoImg.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      albedoImg.data[idx + 3] = 255;

      const [mr, mg, mb] = molaPalette(elevNorm);
      molaImg.data[idx] = mr;
      molaImg.data[idx + 1] = mg;
      molaImg.data[idx + 2] = mb;
      molaImg.data[idx + 3] = 255;

      const tiNorm = Math.max(0, Math.min(1, 0.35 + darkBasalt * 0.52 - Math.max(0, elevNorm) * 0.25));
      const [tr, tg, tb] = themisPalette(tiNorm);
      themisImg.data[idx] = tr;
      themisImg.data[idx + 1] = tg;
      themisImg.data[idx + 2] = tb;
      themisImg.data[idx + 3] = 255;

      const bumpVal = Math.max(0, Math.min(255, Math.round((elevNorm + 1) * 0.5 * 255)));
      bumpImg.data[idx] = bumpVal;
      bumpImg.data[idx + 1] = bumpVal;
      bumpImg.data[idx + 2] = bumpVal;
      bumpImg.data[idx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  molaCtx.putImageData(molaImg, 0, 0);
  themisCtx.putImageData(themisImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);

  const configureColorTex = (canvas: HTMLCanvasElement) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  };

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.needsUpdate = true;

  return {
    albedoMap: configureColorTex(albedoCanvas),
    molaMap: configureColorTex(molaCanvas),
    themisMap: configureColorTex(themisCanvas),
    bumpMap,
  };
}

/**
 * Converts Martian geographic (lat, lon) in degrees to 3D Cartesian coordinates
 * matching Three.js SphereGeometry UV mapping exactly.
 */
export function latLonToVector3(latDeg: number, lonDeg: number, radius: number, target = new THREE.Vector3()): THREE.Vector3 {
  const u = (lonDeg + 180) / 360;
  const phi = u * Math.PI * 2;
  const theta = ((90 - latDeg) * Math.PI) / 180;

  const x = -radius * Math.cos(phi) * Math.sin(theta);
  const y = radius * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return target.set(x, y, z);
}

/**
 * Inverse conversion from 3D surface point on sphere to Martian (lat, lon).
 */
export function vector3ToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const r = point.length();
  if (r === 0) return { lat: 0, lon: 0 };
  const theta = Math.acos(THREE.MathUtils.clamp(point.y / r, -1, 1));
  const lat = 90 - (theta * 180) / Math.PI;
  let phi = Math.atan2(point.z, -point.x);
  if (phi < 0) phi += Math.PI * 2;
  const lon = (phi / (Math.PI * 2)) * 360 - 180;
  return {
    lat: Number(lat.toFixed(2)),
    lon: Number(lon.toFixed(2)),
  };
}
