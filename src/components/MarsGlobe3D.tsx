import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw } from 'lucide-react';
import type {
  GlobeLayerId,
  HazardZone,
  MarsLocation,
  RouteOption,
  TerrainAnalysisResult,
} from '../types/mars';
import {
  generateMarsTextures,
  latLonToVector3,
  vector3ToLatLon,
  type MarsTextures,
} from '../engine/marsTextureGenerator';

interface MarsGlobe3DProps {
  locations: MarsLocation[];
  selectedLocation: MarsLocation;
  onSelectLocation: (loc: MarsLocation) => void;
  activeLayers: Record<GlobeLayerId, boolean>;
  onToggleLayer: (layer: GlobeLayerId) => void;
  terrain?: TerrainAnalysisResult;
  hazards: HazardZone[];
  activeRoute?: RouteOption;
  heightClass?: string;
}

const GLOBE_RADIUS = 2.15;
const _tmpVec = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

function buildGraticuleGroup(radius: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.18,
  });

  // Latitude parallels every 30°
  for (const lat of [-60, -30, 0, 30, 60]) {
    const pts: THREE.Vector3[] = [];
    for (let lon = -180; lon <= 180; lon += 5) {
      pts.push(latLonToVector3(lat, lon, radius + 0.008, new THREE.Vector3()));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, mat);
    group.add(line);
  }

  // Longitude meridians every 30°
  for (let lon = -180; lon < 180; lon += 30) {
    const pts: THREE.Vector3[] = [];
    for (let lat = -85; lat <= 85; lat += 5) {
      pts.push(latLonToVector3(lat, lon, radius + 0.008, new THREE.Vector3()));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, mat);
    group.add(line);
  }

  return group;
}

function roughnessColorRgba(roughnessIdx: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, roughnessIdx / 100));
  if (t < 0.35) {
    const k = t / 0.35;
    return [
      Math.round(16 + (234 - 16) * k),
      Math.round(185 + (179 - 185) * k),
      Math.round(129 + (8 - 129) * k),
      195,
    ];
  }
  if (t < 0.68) {
    const k = (t - 0.35) / 0.33;
    return [
      Math.round(234 + (249 - 234) * k),
      Math.round(179 + (115 - 179) * k),
      Math.round(8 + (22 - 8) * k),
      215,
    ];
  }
  const k = (t - 0.68) / 0.32;
  return [
    Math.round(249 + (239 - 249) * k),
    Math.round(115 + (44 - 115) * k),
    Math.round(22 + (44 - 22) * k),
    235,
  ];
}

export function MarsGlobe3D({
  locations,
  selectedLocation,
  onSelectLocation,
  activeLayers,
  onToggleLayer,
  terrain,
  hazards,
  activeRoute,
  heightClass = 'h-[560px]',
}: MarsGlobe3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  // Refs synced from props so Three.js scene mounts once without tearing down WebGL context
  const onSelectLocationRef = useRef(onSelectLocation);
  onSelectLocationRef.current = onSelectLocation;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const prevRoughnessActiveRef = useRef(activeLayers['terrain-roughness']);

  const sceneRefs = useRef<{
    marsMat: THREE.MeshStandardMaterial;
    textures: MarsTextures;
    graticuleGroup: THREE.Group;
    roughnessGroup: THREE.Group;
    markerGroup: THREE.Group;
    hazardGroup: THREE.Group;
    routeGroup: THREE.Group;
    markerMeshes: THREE.Mesh[];
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    flyActive: boolean;
    flyGoalPos: THREE.Vector3;
  } | null>(null);

  const triggerFlyTo = (lat: number, lon: number, dist = 5.4) => {
    const sr = sceneRefs.current;
    if (!sr) return;
    const dir = latLonToVector3(lat, lon, 1, _tmpVec).normalize();
    sr.flyGoalPos.copy(dir).multiplyScalar(dist);
    sr.flyActive = true;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Software WebGL detection per Three.js skill standard
    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 540;
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070b);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 120);
    const initialDir = latLonToVector3(selectedLocation.lat, selectedLocation.lon, 1, new THREE.Vector3()).normalize();
    camera.position.copy(initialDir).multiplyScalar(5.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 2.52;
    controls.maxDistance = 10.5;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.85;

    // Lighting rig: warm solar key + cool cosmic fill + rim highlight
    const sunLight = new THREE.DirectionalLight(0xfff1e0, 2.3);
    sunLight.position.set(8, 3.5, 6);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x3a4f78, 0x1a0c08, 0.55);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.55);
    rimLight.position.set(-7, -2, -6);
    scene.add(rimLight);

    // Subtle deep-space starfield (Instanced / Points)
    const starCount = 650;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2 * Math.PI;
      const phi = Math.acos(2 * v - 1);
      const r = 34 + Math.random() * 24;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xcbd5e1, size: 0.09, transparent: true, opacity: 0.7 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Mars sphere with procedural textures
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const textures = generateMarsTextures(maxAniso);

    const marsGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 72, 48);
    const marsMat = new THREE.MeshStandardMaterial({
      map: textures.albedoMap,
      bumpMap: textures.bumpMap,
      bumpScale: 0.045,
      roughness: 0.86,
      metalness: 0.04,
    });
    const marsMesh = new THREE.Mesh(marsGeo, marsMat);
    scene.add(marsMesh);

    // Thin Martian CO2 dust atmospheric halo
    const atmoGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.028, 48, 32);
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
          gl_FragColor = vec4(0.92, 0.39, 0.18, 1.0) * max(0.0, intensity) * 0.55;
        }
      `,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // Overlay groups
    const graticuleGroup = buildGraticuleGroup(GLOBE_RADIUS);
    const roughnessGroup = new THREE.Group();
    const markerGroup = new THREE.Group();
    const hazardGroup = new THREE.Group();
    const routeGroup = new THREE.Group();
    scene.add(graticuleGroup);
    scene.add(roughnessGroup);
    scene.add(markerGroup);
    scene.add(hazardGroup);
    scene.add(routeGroup);

    const markerMeshes: THREE.Mesh[] = [];

    sceneRefs.current = {
      marsMat,
      textures,
      graticuleGroup,
      roughnessGroup,
      markerGroup,
      hazardGroup,
      routeGroup,
      markerMeshes,
      camera,
      controls,
      flyActive: false,
      flyGoalPos: camera.position.clone(),
    };

    const onControlStart = () => {
      if (sceneRefs.current) sceneRefs.current.flyActive = false;
    };
    controls.addEventListener('start', onControlStart);

    // Pointer hover (throttled) for live surface coordinate readout + click picking for pins
    let lastHoverTs = 0;
    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTs < 65) return;
      lastHoverTs = now;
      const rect = renderer.domElement.getBoundingClientRect();
      _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_mouse, camera);

      const pinHits = _raycaster.intersectObjects(markerMeshes, false);
      if (pinHits.length > 0) {
        renderer.domElement.style.cursor = 'pointer';
      } else {
        renderer.domElement.style.cursor = 'grab';
      }

      const hits = _raycaster.intersectObject(marsMesh, false);
      if (hits.length > 0) {
        setHoverCoords(vector3ToLatLon(hits[0].point));
      } else {
        setHoverCoords(null);
      }
    };

    let downPos = { x: 0, y: 0 };
    const onPointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_mouse, camera);
      const pinHits = _raycaster.intersectObjects(markerMeshes, false);
      if (pinHits.length > 0) {
        const loc = pinHits[0].object.userData.location as MarsLocation | undefined;
        if (loc) {
          onSelectLocationRef.current(loc);
        }
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Continuous loop with software-WebGL afterDraw pacing per Three.js skill
    let frameId = 0;
    let disposed = false;
    let lastTickMs = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      const delta = Math.min(0.1, Math.max(0.001, (nowMs - lastTickMs) / 1000));
      lastTickMs = nowMs;
      const sr = sceneRefs.current;

      if (sr) {
        if (sr.flyActive) {
          const t = 1 - Math.exp(-5.5 * delta);
          camera.position.lerp(sr.flyGoalPos, t);
          // Keep camera on orbital radius during interpolation
          const targetDist = sr.flyGoalPos.length();
          camera.position.normalize().multiplyScalar(THREE.MathUtils.lerp(camera.position.length(), targetDist, t));
          if (camera.position.distanceTo(sr.flyGoalPos) < 0.04) {
            sr.flyActive = false;
          }
        } else if (autoRotateRef.current && !isSoftwareGl) {
          // Gentle sidereal rotation of camera around Y axis
          const angle = delta * 0.085;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const px = camera.position.x;
          const pz = camera.position.z;
          camera.position.x = px * cosA - pz * sinA;
          camera.position.z = px * sinA + pz * cosA;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      while (roughnessGroup.children.length > 0) {
        const child = roughnessGroup.children[0] as THREE.Mesh | THREE.LineLoop;
        child.geometry?.dispose();
        const mat = child.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial | undefined;
        if (mat && 'map' in mat && mat.map) mat.map.dispose();
        mat?.dispose();
        roughnessGroup.remove(child);
      }

      marsGeo.dispose();
      marsMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      textures.albedoMap.dispose();
      textures.molaMap.dispose();
      textures.themisMap.dispose();
      textures.bumpMap.dispose();
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
      sceneRefs.current = null;
    };
  }, []);

  // Sync active surface texture & overlay visibility
  useEffect(() => {
    const sr = sceneRefs.current;
    if (!sr) return;

    if (activeLayers['mola-elevation']) {
      sr.marsMat.map = sr.textures.molaMap;
    } else if (activeLayers['themis-thermal']) {
      sr.marsMat.map = sr.textures.themisMap;
    } else {
      sr.marsMat.map = sr.textures.albedoMap;
    }
    sr.marsMat.needsUpdate = true;
    sr.graticuleGroup.visible = activeLayers.graticule;
    sr.roughnessGroup.visible = activeLayers['terrain-roughness'];
    sr.hazardGroup.visible = activeLayers.hazards;
    sr.routeGroup.visible = activeLayers.route;

    const roughnessJustEnabled = activeLayers['terrain-roughness'] && !prevRoughnessActiveRef.current;
    prevRoughnessActiveRef.current = activeLayers['terrain-roughness'];
    if (roughnessJustEnabled) {
      setAutoRotate(false);
      triggerFlyTo(selectedLocation.lat, selectedLocation.lon, 2.75);
    }
  }, [activeLayers, selectedLocation.lat, selectedLocation.lon]);

  // Build spherical Terrain Roughness heatmap patch on 3D globe from routePlan.terrain
  useEffect(() => {
    const sr = sceneRefs.current;
    if (!sr) return;

    while (sr.roughnessGroup.children.length > 0) {
      const child = sr.roughnessGroup.children[0] as THREE.Mesh | THREE.LineLoop;
      child.geometry?.dispose();
      const mat = child.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial | undefined;
      if (mat && 'map' in mat && mat.map) {
        mat.map.dispose();
      }
      mat?.dispose();
      sr.roughnessGroup.remove(child);
    }

    if (!terrain || terrain.gridSize < 2) return;
    const N = terrain.gridSize;

    // Offscreen CanvasTexture mapping terrain roughnessIdx (0..100)
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(N, N);
    for (let gy = 0; gy < N; gy++) {
      const py = N - 1 - gy;
      for (let gx = 0; gx < N; gx++) {
        const cell = terrain.cells[gy][gx];
        const [r, g, b, a] = roughnessColorRgba(cell.roughnessIdx);
        const idx = (py * N + gx) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    // Build curved spherical grid patch matching exact cell lat/lon coordinates
    const positions = new Float32Array(N * N * 3);
    const uvs = new Float32Array(N * N * 2);
    const vPos = new THREE.Vector3();

    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const cell = terrain.cells[gy][gx];
        latLonToVector3(cell.lat, cell.lon, GLOBE_RADIUS + 0.011, vPos);
        const vi = gy * N + gx;
        positions[vi * 3] = vPos.x;
        positions[vi * 3 + 1] = vPos.y;
        positions[vi * 3 + 2] = vPos.z;
        uvs[vi * 2] = gx / (N - 1);
        uvs[vi * 2 + 1] = gy / (N - 1);
      }
    }

    const indices: number[] = [];
    for (let gy = 0; gy < N - 1; gy++) {
      for (let gx = 0; gx < N - 1; gx++) {
        const a = gy * N + gx;
        const b = gy * N + (gx + 1);
        const c = (gy + 1) * N + gx;
        const d = (gy + 1) * N + (gx + 1);
        indices.push(a, b, d, a, d, c);
      }
    }

    const patchGeo = new THREE.BufferGeometry();
    patchGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    patchGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    patchGeo.setIndex(indices);
    patchGeo.computeVertexNormals();

    const patchMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    const patchMesh = new THREE.Mesh(patchGeo, patchMat);
    sr.roughnessGroup.add(patchMesh);

    // Sector perimeter outline on the globe surface
    const perimeterPts: THREE.Vector3[] = [];
    for (let gx = 0; gx < N; gx++) {
      const c = terrain.cells[0][gx];
      perimeterPts.push(latLonToVector3(c.lat, c.lon, GLOBE_RADIUS + 0.014, new THREE.Vector3()));
    }
    for (let gy = 1; gy < N; gy++) {
      const c = terrain.cells[gy][N - 1];
      perimeterPts.push(latLonToVector3(c.lat, c.lon, GLOBE_RADIUS + 0.014, new THREE.Vector3()));
    }
    for (let gx = N - 2; gx >= 0; gx--) {
      const c = terrain.cells[N - 1][gx];
      perimeterPts.push(latLonToVector3(c.lat, c.lon, GLOBE_RADIUS + 0.014, new THREE.Vector3()));
    }
    for (let gy = N - 2; gy > 0; gy--) {
      const c = terrain.cells[gy][0];
      perimeterPts.push(latLonToVector3(c.lat, c.lon, GLOBE_RADIUS + 0.014, new THREE.Vector3()));
    }
    const borderGeo = new THREE.BufferGeometry().setFromPoints(perimeterPts);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
    const borderLoop = new THREE.LineLoop(borderGeo, borderMat);
    sr.roughnessGroup.add(borderLoop);
  }, [terrain]);

  // Sync clickable location markers & fly camera to selected location
  useEffect(() => {
    const sr = sceneRefs.current;
    if (!sr) return;

    while (sr.markerGroup.children.length > 0) {
      const child = sr.markerGroup.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      (child.material as THREE.Material)?.dispose();
      sr.markerGroup.remove(child);
    }
    sr.markerMeshes.length = 0;

    for (const loc of locations) {
      const isSelected = loc.id === selectedLocation.id;
      const pos = latLonToVector3(loc.lat, loc.lon, GLOBE_RADIUS + 0.025, new THREE.Vector3());

      // Composite beacon stem + marker head
      const pinGeo = new THREE.SphereGeometry(isSelected ? 0.068 : 0.044, 16, 16);
      const pinMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0xf97316 : 0x38bdf8,
        emissive: isSelected ? 0xea580c : 0x0284c7,
        emissiveIntensity: isSelected ? 0.9 : 0.45,
        roughness: 0.35,
      });
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.copy(pos);
      pin.userData.location = loc;
      sr.markerGroup.add(pin);
      sr.markerMeshes.push(pin);

      if (isSelected) {
        const ringGeo = new THREE.RingGeometry(0.085, 0.115, 28);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf97316,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(latLonToVector3(loc.lat, loc.lon, GLOBE_RADIUS + 0.015, new THREE.Vector3()));
        ring.lookAt(ring.position.clone().multiplyScalar(2));
        sr.markerGroup.add(ring);
      }
    }

    const targetDist = activeLayers['terrain-roughness']
      ? 2.75
      : Math.max(3.6, Math.min(6.2, sr.camera.position.length()));
    triggerFlyTo(selectedLocation.lat, selectedLocation.lon, targetDist);
  }, [locations, selectedLocation, activeLayers['terrain-roughness']]);

  // Sync hazard dots & active route arc on 3D globe
  useEffect(() => {
    const sr = sceneRefs.current;
    if (!sr) return;

    while (sr.hazardGroup.children.length > 0) {
      const c = sr.hazardGroup.children[0] as THREE.Mesh;
      c.geometry?.dispose();
      (c.material as THREE.Material)?.dispose();
      sr.hazardGroup.remove(c);
    }

    for (const h of hazards) {
      const color =
        h.riskLevel === 'CRITICAL'
          ? 0xef4444
          : h.riskLevel === 'HIGH'
            ? 0xf97316
            : h.riskLevel === 'MODERATE'
              ? 0xf59e0b
              : 0x22c55e;
      const radius = h.riskLevel === 'CRITICAL' ? 0.034 : h.riskLevel === 'HIGH' ? 0.028 : 0.022;
      const geo = new THREE.SphereGeometry(radius, 10, 10);
      const mat = new THREE.MeshBasicMaterial({ color });
      const dot = new THREE.Mesh(geo, mat);
      latLonToVector3(h.lat, h.lon, GLOBE_RADIUS + 0.018, dot.position);
      sr.hazardGroup.add(dot);
    }

    while (sr.routeGroup.children.length > 0) {
      const c = sr.routeGroup.children[0] as THREE.Mesh | THREE.Line;
      c.geometry?.dispose();
      (c.material as THREE.Material)?.dispose();
      sr.routeGroup.remove(c);
    }

    if (activeRoute && activeRoute.waypoints.length >= 2) {
      const pts = activeRoute.waypoints.map((wp) =>
        latLonToVector3(wp.lat, wp.lon, GLOBE_RADIUS + 0.024, new THREE.Vector3()),
      );
      const routeGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const routeMat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
      const line = new THREE.Line(routeGeo, routeMat);
      sr.routeGroup.add(line);

      const riskRank: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
      for (let i = 1; i < activeRoute.waypoints.length; i++) {
        const prevWp = activeRoute.waypoints[i - 1];
        const wp = activeRoute.waypoints[i];
        const segRisk =
          riskRank[wp.hazardLevel] >= riskRank[prevWp.hazardLevel]
            ? wp.hazardLevel
            : prevWp.hazardLevel;
        if (segRisk === 'LOW') continue;
        const segColor =
          segRisk === 'CRITICAL' ? 0xef4444 : segRisk === 'HIGH' ? 0xf97316 : 0xf59e0b;
        const p1 = latLonToVector3(prevWp.lat, prevWp.lon, GLOBE_RADIUS + 0.028, new THREE.Vector3());
        const p2 = latLonToVector3(wp.lat, wp.lon, GLOBE_RADIUS + 0.028, new THREE.Vector3());
        const segGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const segMat = new THREE.LineBasicMaterial({ color: segColor });
        sr.routeGroup.add(new THREE.Line(segGeo, segMat));
      }

      const startPin = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x22c55e }),
      );
      startPin.position.copy(pts[0]);
      sr.routeGroup.add(startPin);

      const destPin = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xe85d2a }),
      );
      destPin.position.copy(pts[pts.length - 1]);
      sr.routeGroup.add(destPin);
    }
  }, [hazards, activeRoute]);

  const layerButtons: Array<{ id: GlobeLayerId; label: string }> = [
    { id: 'albedo', label: 'Surface Albedo' },
    { id: 'mola-elevation', label: 'MOLA Elevation' },
    { id: 'themis-thermal', label: 'THEMIS Thermal' },
    { id: 'terrain-roughness', label: 'Terrain Roughness' },
    { id: 'graticule', label: 'Lat/Lon Grid' },
    { id: 'hazards', label: 'Hazards' },
    { id: 'route', label: 'Active Route' },
  ];

  return (
    <div className={`relative w-full ${heightClass} rounded border border-white/10 bg-[#05070B] overflow-hidden`}>
      {/* Dedicated WebGL Mount */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Fallback UI when WebGL unavailable or lost */}
      {(webglUnavailable || contextLost) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07090E] text-center p-6">
          <div className="text-sm font-display text-white">
            {contextLost ? 'WebGL Context Interrupted' : '3D WebGL Renderer Unavailable'}
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-md">
            Interactive 2D terrain &amp; A* route maps remain fully operational in Terrain Intelligence and Smart Route Planner.
          </p>
        </div>
      )}

      {/* Top-Left Minimal Target & Coordinate HUD (non-blocking) */}
      <div className="pointer-events-none absolute top-3.5 left-3.5 bg-[#090C12]/85 border border-white/10 rounded px-3 py-2 space-y-0.5">
        <div className="text-[11px] font-mono uppercase tracking-wider text-[#E85D2A]">
          {selectedLocation.name}
        </div>
        <div className="text-xs font-mono text-slate-200 tabular-nums">
          {selectedLocation.lat.toFixed(2)}°{selectedLocation.lat >= 0 ? 'N' : 'S'},{' '}
          {Math.abs(selectedLocation.lon).toFixed(2)}°{selectedLocation.lon >= 0 ? 'E' : 'W'} ·{' '}
          {selectedLocation.elevationM} m MOLA
        </div>
        {hoverCoords && (
          <div className="text-[11px] font-mono text-cyan-400 tabular-nums">
            Cursor: {hoverCoords.lat.toFixed(2)}°, {hoverCoords.lon.toFixed(2)}°
          </div>
        )}
      </div>

      {/* Top-Right 3D Terrain Roughness Heatmap Legend */}
      {activeLayers['terrain-roughness'] && terrain && (
        <div className="pointer-events-none absolute top-3.5 right-3.5 bg-[#090C12]/90 border border-white/15 rounded px-3 py-2 text-[10px] font-mono space-y-1.5">
          <div className="text-cyan-300 uppercase tracking-wider">
            3D Terrain Roughness ({terrain.spanKm} km TRI)
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">0</span>
            <div className="w-28 h-2 rounded-sm border border-white/15 bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500" />
            <span className="text-red-400">100</span>
          </div>
          <div className="text-[9px] text-slate-400 tabular-nums">
            Mean {terrain.meanRoughness}/100 · Peak {terrain.maxRoughness}/100
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (per Three.js ergonomic HUD guideline) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[94%] z-10 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="px-3 py-1 bg-[#0C1018]/90 border border-white/15 border-b-0 rounded-t text-[11px] font-mono text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {dockCollapsed ? 'Show Globe Controls' : 'Hide Controls'}
        </button>

        {!dockCollapsed && (
          <div className="bg-[#0C1018]/92 border border-white/15 rounded px-2.5 py-2 flex flex-wrap items-center justify-center gap-1.5">
            {layerButtons.map((btn) => {
              const isActive = activeLayers[btn.id];
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onToggleLayer(btn.id)}
                  className={`px-2.5 py-1.5 rounded text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-[#E85D2A] text-white font-medium'
                      : 'bg-white/[0.04] text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}

            <span className="h-4 w-px bg-white/15 mx-1" aria-hidden="true" />

            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className="px-2.5 py-1.5 rounded text-[11px] font-mono bg-white/[0.04] text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {autoRotate ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {autoRotate ? 'Pause Spin' : 'Auto Spin'}
            </button>

            <button
              type="button"
              onClick={() => triggerFlyTo(selectedLocation.lat, selectedLocation.lon, 5.4)}
              className="px-2.5 py-1.5 rounded text-[11px] font-mono bg-white/[0.04] text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              Reset View
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
