import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 5500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MARSWALK-AI-SpaceApps2026/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface CuratedArchiveRecord {
  id: string;
  title: string;
  mission: string;
  instrument: string;
  observationDate: string;
  sol?: number;
  imageUrl: string;
  sourceUrl: string;
  description: string;
}

const CURATED_ARCHIVE_FALLBACK: Record<string, CuratedArchiveRecord[]> = {
  'Jezero Crater': [
    {
      id: 'PIA24464',
      title: 'Jezero Crater Western River Delta Mosaic (Perseverance Context)',
      mission: 'Mars 2020 Perseverance',
      instrument: 'MRO HiRISE / Mastcam-Z',
      observationDate: '2021-02-18 (Archival Reference)',
      sol: 12,
      imageUrl: '',
      sourceUrl: 'https://mars.nasa.gov/mars2020/',
      description:
        'Historical archival reference for the Neretva Vallis delta escarpment and Octavia E. Butler landing corridor in Jezero Crater.',
    },
    {
      id: 'PIA25680',
      title: 'Belva Crater Rim & Exposed Delta Cross-Strata',
      mission: 'Mars 2020 Perseverance',
      instrument: 'Mastcam-Z',
      observationDate: '2023-04-22 (Archival Sol 772)',
      sol: 772,
      imageUrl: '',
      sourceUrl: 'https://pds.nasa.gov/',
      description:
        'Steeply dipping sedimentary beds preserved inside Belva Crater walls along the upper Jezero fan.',
    },
  ],
  'Gale Crater': [
    {
      id: 'PIA16051',
      title: 'Aeolis Mons (Mount Sharp) & Bradbury Landing Traverse Context',
      mission: 'Mars Science Laboratory (Curiosity)',
      instrument: 'Mastcam / MRO CTX',
      observationDate: '2012-08-06 (Archival Reference)',
      sol: 3,
      imageUrl: '',
      sourceUrl: 'https://pds.nasa.gov/',
      description:
        'Historical MSL archive documenting the transition from Peace Vallis alluvial gravels to Mount Sharp clay-sulfate strata.',
    },
  ],
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY'),
      timestamp: new Date().toISOString(),
    });
  });

  // Verified NASA Mars Trek WMTS & USGS Astrogeology WMS Equirectangular Tile Proxy
  app.get('/api/mars/tile', async (req, res) => {
    const layer = String(req.query.layer || 'surface');
    const z = Math.max(0, Math.min(7, Number(req.query.z ?? 0)));
    const matrixWidth = Math.pow(2, z + 1);
    const matrixHeight = Math.pow(2, z);

    let x = Math.floor(Number(req.query.x ?? 0));
    const y = Math.floor(Number(req.query.y ?? 0));

    // Wrap longitude tile index cleanly
    x = ((x % matrixWidth) + matrixWidth) % matrixWidth;

    if (y < 0 || y >= matrixHeight || Number.isNaN(z) || Number.isNaN(x) || Number.isNaN(y)) {
      res.status(400).json({ error: 'Tile coordinates out of bounds' });
      return;
    }

    let upstreamUrl = '';
    if (layer === 'surface') {
      upstreamUrl = `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`;
    } else if (layer === 'elevation') {
      upstreamUrl = `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`;
    } else if (layer === 'terrain' || layer === 'themis-night') {
      // Compute exact EPSG:4326 bounding box matching Mars Trek EQ tile matrix
      const degPerTileX = 360 / matrixWidth;
      const degPerTileY = 180 / matrixHeight;
      const minLon = -180 + x * degPerTileX;
      const maxLon = minLon + degPerTileX;
      const maxLat = 90 - y * degPerTileY;
      const minLat = maxLat - degPerTileY;
      const wmsLayer = layer === 'themis-night' ? 'THEMIS_night' : 'HRSC_MOLA_Blend_Hillshade';
      upstreamUrl = `https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${wmsLayer}&STYLES=&SRS=EPSG:4326&BBOX=${minLon},${minLat},${maxLon},${maxLat}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg`;
    } else {
      res.status(400).json({ error: 'Unsupported Mars tile layer' });
      return;
    }

    try {
      const upstream = await fetchWithTimeout(upstreamUrl, 7000);
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Upstream NASA/USGS tile returned HTTP ${upstream.status}` });
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch NASA/USGS planetary tile',
      });
    }
  });

  interface CachedEntry {
    expiresAt: number;
    payload: unknown;
  }

  const nasaCache = new Map<string, CachedEntry>();
  const lastSuccessfulRetrieval = new Map<string, string>();

  async function fetchWithRetry(url: string, timeoutMs = 8500, retries = 1): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, timeoutMs);
        if (res.ok || attempt === retries || res.status < 500) {
          return res;
        }
      } catch (err) {
        lastErr = err;
        if (attempt === retries) throw err;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    throw lastErr instanceof Error ? lastErr : new Error('Request failed');
  }

  app.get('/api/nasa/status', async (req, res) => {
    const refresh = req.query.refresh === '1';
    const onlyKey = typeof req.query.endpoint === 'string' ? req.query.endpoint.trim() : '';
    const cacheKey = `status:${onlyKey || 'all'}`;

    if (!refresh) {
      const hit = nasaCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({ ...(hit.payload as Record<string, unknown>), cached: true });
        return;
      }
    }

    type ProbeStatus = 'VERIFIED' | 'CONNECTED' | 'UNAVAILABLE';
    interface ProbeSpec {
      key: string;
      url: string;
      timeoutMs: number;
      verify: (r: Response) => Promise<{
        status: ProbeStatus;
        recordCount?: number;
        bytes?: number;
        observationDate?: string;
        detail: string;
      }>;
    }

    const probeSpecs: ProbeSpec[] = [
      {
        key: 'trek-mola',
        url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/0/0/0.jpg',
        timeoutMs: 8000,
        verify: async (r) => {
          const buf = await r.arrayBuffer();
          const valid = buf.byteLength > 1000;
          return {
            status: valid ? 'CONNECTED' : 'UNAVAILABLE',
            bytes: buf.byteLength,
            observationDate: '1997–2001 Global Mosaic',
            detail: valid
              ? `Archival WMTS shaded-relief raster tile stream reachable (${buf.byteLength} B JPEG); numeric MOLA elevation profile API unavailable (HTTP 404).`
              : `HTTP 200 returned unexpected small tile payload (${buf.byteLength} bytes).`,
          };
        },
      },
      {
        key: 'trek-viking',
        url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/0/0/0.jpg',
        timeoutMs: 8000,
        verify: async (r) => {
          const buf = await r.arrayBuffer();
          const valid = buf.byteLength > 1000;
          return {
            status: valid ? 'CONNECTED' : 'UNAVAILABLE',
            bytes: buf.byteLength,
            observationDate: '1976–1980 / 2003 MDIM21',
            detail: valid
              ? `Archival WMTS Viking MDIM 2.1 optical tile stream reachable (${buf.byteLength} B JPEG); rendered basemap reference only.`
              : `HTTP 200 returned unexpected small tile payload (${buf.byteLength} bytes).`,
          };
        },
      },
      {
        key: 'usgs-themis',
        url: 'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities',
        timeoutMs: 9000,
        verify: async (r) => {
          const xml = await r.text();
          const valid = xml.includes('WMT_MS_Capabilities') && xml.includes('THEMIS');
          return {
            status: valid ? 'CONNECTED' : 'UNAVAILABLE',
            bytes: Buffer.byteLength(xml),
            observationDate: '2002–Ongoing Global IR Mosaic',
            detail: valid
              ? 'WMS GetCapabilities XML reachable (confirms THEMIS_night layer catalog); rendered raster map tiles only — raw Kelvin/TIU arrays not retrieved.'
              : 'Endpoint responded HTTP 200 without expected WMS THEMIS capabilities XML.',
          };
        },
      },
      {
        key: 'nasa-images',
        url: 'https://images-api.nasa.gov/search?q=HiRISE%20Jezero%20Crater&media_type=image&page_size=2',
        timeoutMs: 8500,
        verify: async (r) => {
          const data = (await r.json()) as {
            collection?: { items?: Array<{ data?: Array<{ date_created?: string }> }> };
          };
          const items = data.collection?.items || [];
          const obsDate = items[0]?.data?.[0]?.date_created?.slice(0, 10);
          return {
            status: items.length > 0 ? 'VERIFIED' : 'CONNECTED',
            recordCount: items.length,
            observationDate: obsDate || 'Archival',
            detail:
              items.length > 0
                ? `Retrieved ${items.length} NASA Image Library records (latest sample ${obsDate || 'archival'}).`
                : 'NASA Image API connected (HTTP 200) but returned 0 records.',
          };
        },
      },
      {
        key: 'jpl-mars2020',
        url: 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&ver=1.2&num=2',
        timeoutMs: 9000,
        verify: async (r) => {
          const data = (await r.json()) as {
            images?: Array<{ sol?: number; date_taken_utc?: string }>;
          };
          const imgs = data.images || [];
          const latest = imgs[0];
          const obsDate = latest?.date_taken_utc
            ? `${latest.date_taken_utc.slice(0, 10)}${typeof latest.sol === 'number' ? ` (Sol ${latest.sol})` : ''}`
            : undefined;
          return {
            status: imgs.length > 0 ? 'VERIFIED' : 'CONNECTED',
            recordCount: imgs.length,
            observationDate: obsDate,
            detail:
              imgs.length > 0
                ? `Retrieved ${imgs.length} Perseverance surface frames (${obsDate || 'latest downlink'}).`
                : 'JPL Mars 2020 feed connected (HTTP 200) with 0 images.',
          };
        },
      },
      {
        key: 'jpl-msl',
        url: 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&ver=1.2&num=2',
        timeoutMs: 13000,
        verify: async (r) => {
          const data = (await r.json()) as {
            images?: Array<{ sol?: number; date_taken_utc?: string }>;
          };
          const imgs = data.images || [];
          const latest = imgs[0];
          const obsDate = latest?.date_taken_utc
            ? `${latest.date_taken_utc.slice(0, 10)}${typeof latest.sol === 'number' ? ` (Sol ${latest.sol})` : ''}`
            : undefined;
          return {
            status: imgs.length > 0 ? 'VERIFIED' : 'CONNECTED',
            recordCount: imgs.length,
            observationDate: obsDate,
            detail:
              imgs.length > 0
                ? `Retrieved ${imgs.length} Curiosity surface frames (${obsDate || 'latest downlink'}).`
                : 'JPL MSL Curiosity feed connected (HTTP 200) with 0 images.',
          };
        },
      },
      {
        key: 'meda-weather',
        url: 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json',
        timeoutMs: 9000,
        verify: async (r) => {
          const data = (await r.json()) as {
            sols?: Array<{ sol?: string; terrestrial_date?: string }>;
          };
          const sols = data.sols || [];
          const latest = sols[sols.length - 1];
          const obsDate = latest?.terrestrial_date
            ? `${latest.terrestrial_date} (Sol ${latest.sol || '?'})`
            : undefined;
          return {
            status: sols.length > 0 ? 'VERIFIED' : 'CONNECTED',
            recordCount: sols.length,
            observationDate: obsDate,
            detail:
              sols.length > 0
                ? `Retrieved ${sols.length} archived MEDA meteorological sols (through ${obsDate}).`
                : 'MEDA weather endpoint connected (HTTP 200) with empty sols array.',
          };
        },
      },
      {
        key: 'rems-weather',
        url: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
        timeoutMs: 10000,
        verify: async (r) => {
          const data = (await r.json()) as {
            soles?: Array<{ sol?: string; terrestrial_date?: string }>;
          };
          const soles = data.soles || [];
          const latest = soles[0];
          const obsDate = latest?.terrestrial_date
            ? `${latest.terrestrial_date} (Sol ${latest.sol || '?'})`
            : undefined;
          return {
            status: soles.length > 0 ? 'VERIFIED' : 'CONNECTED',
            recordCount: soles.length,
            observationDate: obsDate,
            detail:
              soles.length > 0
                ? `Retrieved ${soles.length} archived MSL REMS sols (latest ${obsDate}).`
                : 'MSL REMS endpoint connected (HTTP 200) with 0 records.',
          };
        },
      },
      {
        key: 'pds-ode',
        url: 'https://oderest.rsl.wustl.edu/live2/?query=product&results=m&output=JSON&minlat=18.2&maxlat=18.6&westernlon=77.2&easternlon=77.7&target=mars&ihid=MRO&iid=HIRISE&pt=RDRV11&limit=2',
        timeoutMs: 9500,
        verify: async (r) => {
          const data = (await r.json()) as {
            ODEResults?: { Products?: { Product?: Array<{ Observation_time?: string }> | { Observation_time?: string } } };
          };
          const rawProd = data.ODEResults?.Products?.Product;
          const prods = Array.isArray(rawProd) ? rawProd : rawProd ? [rawProd] : [];
          const obsDate = prods[0]?.Observation_time?.slice(0, 10);
          return {
            status: prods.length > 0 ? 'VERIFIED' : 'CONNECTED',
            recordCount: prods.length,
            observationDate: obsDate,
            detail:
              prods.length > 0
                ? `Retrieved ${prods.length} georeferenced PDS HiRISE RDRV11 product(s) near Jezero.`
                : 'PDS ODE REST API connected (HTTP 200) but returned 0 products.',
          };
        },
      },
    ];

    const selectedSpecs = onlyKey ? probeSpecs.filter((p) => p.key === onlyKey) : probeSpecs;
    const nowIso = new Date().toISOString();

    const probesList = await Promise.all(
      selectedSpecs.map(async (spec) => {
        const started = Date.now();
        try {
          const upstream = await fetchWithRetry(spec.url, spec.timeoutMs, 1);
          const latencyMs = Date.now() - started;
          if (!upstream.ok) {
            return {
              key: spec.key,
              status: 'UNAVAILABLE' as ProbeStatus,
              httpStatus: upstream.status,
              retrievedAt: nowIso,
              lastSuccessfulAt: lastSuccessfulRetrieval.get(spec.key),
              latencyMs,
              detail: `Upstream responded HTTP ${upstream.status}.`,
              error: `HTTP ${upstream.status} from upstream NASA/PDS endpoint`,
            };
          }
          const verified = await spec.verify(upstream);
          if (verified.status === 'VERIFIED') {
            lastSuccessfulRetrieval.set(spec.key, nowIso);
          }
          return {
            key: spec.key,
            status: verified.status,
            httpStatus: upstream.status,
            retrievedAt: nowIso,
            lastSuccessfulAt: lastSuccessfulRetrieval.get(spec.key),
            observationDate: verified.observationDate,
            recordCount: verified.recordCount,
            bytes: verified.bytes,
            latencyMs,
            detail: verified.detail,
          };
        } catch (err) {
          return {
            key: spec.key,
            status: 'UNAVAILABLE' as ProbeStatus,
            retrievedAt: nowIso,
            lastSuccessfulAt: lastSuccessfulRetrieval.get(spec.key),
            latencyMs: Date.now() - started,
            detail: 'Failed to retrieve data from upstream endpoint.',
            error: err instanceof Error ? err.message : 'Network or timeout error',
          };
        }
      }),
    );

    const endpoints: Record<string, 'REACHABLE' | 'UNAVAILABLE'> = {};
    const probes: Record<string, unknown> = {};
    for (const p of probesList) {
      endpoints[p.key] = p.status === 'VERIFIED' || p.status === 'CONNECTED' ? 'REACHABLE' : 'UNAVAILABLE';
      probes[p.key] = p;
    }

    const payload = {
      checkedAt: nowIso,
      cached: false,
      endpoints,
      probes,
    };

    nasaCache.set(cacheKey, { expiresAt: Date.now() + 2 * 60 * 1000, payload });
    res.json(payload);
  });

  app.get('/api/nasa/environment', async (req, res) => {
    const refresh = req.query.refresh === '1';
    const cacheKey = 'nasa-environment';
    if (!refresh) {
      const hit = nasaCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({ ...(hit.payload as Record<string, unknown>), cached: true });
        return;
      }
    }

    const retrievedAt = new Date().toISOString();

    const fetchMeda = async () => {
      try {
        const r = await fetchWithRetry(
          'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json',
          9500,
          1,
        );
        if (!r.ok) {
          return {
            status: 'UNAVAILABLE' as const,
            sourceUrl: 'https://mars.nasa.gov/mars2020/weather/',
            error: `JPL MEDA weather API returned HTTP ${r.status}`,
            note: 'Unable to retrieve Mars 2020 MEDA weather archive.',
            records: [],
          };
        }
        const data = (await r.json()) as {
          sols?: Array<{
            sol?: string;
            terrestrial_date?: string;
            season?: string;
            ls?: string;
            min_temp?: number | string;
            max_temp?: number | string;
            pressure?: number | string;
            sunrise?: string;
            sunset?: string;
          }>;
        };
        const sols = Array.isArray(data.sols) ? data.sols : [];
        const records = [...sols].reverse().map((s) => {
          const pNum = typeof s.pressure === 'number' ? s.pressure : Number(s.pressure);
          const pValid = Number.isFinite(pNum);
          return {
            mission: 'Mars 2020 Perseverance' as const,
            instrument: 'MEDA' as const,
            locationName: 'Jezero Crater',
            sol: String(s.sol ?? '—'),
            terrestrialDate: String(s.terrestrial_date ?? '—'),
            season: String(s.season ?? '—'),
            ls: String(s.ls ?? '—'),
            minTempC: s.min_temp === '--' || s.min_temp === undefined ? '—' : `${s.min_temp}`,
            maxTempC: s.max_temp === '--' || s.max_temp === undefined ? '—' : `${s.max_temp}`,
            pressurePa: pValid ? `${pNum.toFixed(1)}` : '—',
            pressureMbar: pValid ? `${(pNum / 100).toFixed(2)}` : '—',
            sunrise: s.sunrise,
            sunset: s.sunset,
          };
        });
        if (records.length > 0) {
          lastSuccessfulRetrieval.set('meda-weather', retrievedAt);
        }
        return {
          status: records.length > 0 ? ('VERIFIED' as const) : ('CONNECTED' as const),
          latestObservationDate: records[0]?.terrestrialDate,
          latestSol: records[0]?.sol,
          sourceUrl: 'https://mars.nasa.gov/mars2020/weather/',
          note:
            records.length > 0
              ? 'Official JPL Mars 2020 MEDA public weather archive (historical window; public RSS feed halted new sol updates after Sol 1133 / 2024-04-27).'
              : 'MEDA endpoint connected but returned 0 sol records.',
          records,
        };
      } catch (err) {
        return {
          status: 'UNAVAILABLE' as const,
          sourceUrl: 'https://mars.nasa.gov/mars2020/weather/',
          error: err instanceof Error ? err.message : 'Failed to fetch MEDA archive',
          note: 'MEDA upstream weather archive timed out or failed.',
          records: [],
        };
      }
    };

    const fetchRems = async () => {
      try {
        const r = await fetchWithRetry(
          'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
          10500,
          1,
        );
        if (!r.ok) {
          return {
            status: 'UNAVAILABLE' as const,
            sourceUrl: 'https://mars.nasa.gov/msl/weather/',
            error: `JPL/CAB MSL REMS API returned HTTP ${r.status}`,
            note: 'Unable to retrieve MSL Curiosity REMS weather archive.',
            records: [],
          };
        }
        const data = (await r.json()) as {
          soles?: Array<{
            sol?: string;
            terrestrial_date?: string;
            season?: string;
            ls?: string;
            min_temp?: string | number;
            max_temp?: string | number;
            pressure?: string | number;
            atmo_opacity?: string;
            local_uv_irradiance_index?: string;
            sunrise?: string;
            sunset?: string;
          }>;
        };
        const soles = Array.isArray(data.soles) ? data.soles.slice(0, 7) : [];
        const records = soles.map((s) => {
          const pNum = Number(s.pressure);
          const pValid = Number.isFinite(pNum);
          return {
            mission: 'MSL Curiosity' as const,
            instrument: 'REMS' as const,
            locationName: 'Gale Crater',
            sol: String(s.sol ?? '—'),
            terrestrialDate: String(s.terrestrial_date ?? '—'),
            season: String(s.season ?? '—'),
            ls: String(s.ls ?? '—'),
            minTempC: s.min_temp === '--' || s.min_temp === undefined ? '—' : `${s.min_temp}`,
            maxTempC: s.max_temp === '--' || s.max_temp === undefined ? '—' : `${s.max_temp}`,
            pressurePa: pValid ? `${pNum.toFixed(0)}` : '—',
            pressureMbar: pValid ? `${(pNum / 100).toFixed(2)}` : '—',
            opacity: s.atmo_opacity,
            uvIndex: s.local_uv_irradiance_index,
            sunrise: s.sunrise,
            sunset: s.sunset,
          };
        });
        if (records.length > 0) {
          lastSuccessfulRetrieval.set('rems-weather', retrievedAt);
        }
        return {
          status: records.length > 0 ? ('VERIFIED' as const) : ('CONNECTED' as const),
          latestObservationDate: records[0]?.terrestrialDate,
          latestSol: records[0]?.sol,
          sourceUrl: 'https://mars.nasa.gov/msl/weather/',
          note:
            records.length > 0
              ? 'Official JPL / Centro de Astrobiología (CAB) MSL Curiosity REMS weather archive (outreach archival feed; PDS holds calibrated science records).'
              : 'REMS endpoint connected but returned 0 sol records.',
          records,
        };
      } catch (err) {
        return {
          status: 'UNAVAILABLE' as const,
          sourceUrl: 'https://mars.nasa.gov/msl/weather/',
          error: err instanceof Error ? err.message : 'Failed to fetch REMS archive',
          note: 'MSL REMS upstream weather archive timed out or failed.',
          records: [],
        };
      }
    };

    const [meda, rems] = await Promise.all([fetchMeda(), fetchRems()]);
    const payload = { retrievedAt, cached: false, meda, rems };
    nasaCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, payload });
    res.json(payload);
  });

  app.get('/api/nasa/pds-products', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const site = String(req.query.site || 'Mars Target').trim();
    const refresh = req.query.refresh === '1';

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Valid lat and lon query parameters are required.' });
      return;
    }

    const cacheKey = `pds:${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (!refresh) {
      const hit = nasaCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({ ...(hit.payload as Record<string, unknown>), cached: true });
        return;
      }
    }

    const marsDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 3389.5 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const delta = 0.35;
    const minlat = Math.max(-89, lat - delta).toFixed(4);
    const maxlat = Math.min(89, lat + delta).toFixed(4);
    const normLon = ((lon + 360) % 360);
    const wlon = Math.max(0, normLon - delta).toFixed(4);
    const elon = Math.min(360, normLon + delta).toFixed(4);

    const queryOde = async (iid: 'HIRISE' | 'CTX', pt: 'RDRV11' | 'EDR') => {
      const url = `https://oderest.rsl.wustl.edu/live2/?query=product&results=m&output=JSON&minlat=${minlat}&maxlat=${maxlat}&westernlon=${wlon}&easternlon=${elon}&target=mars&ihid=MRO&iid=${iid}&pt=${pt}&limit=6`;
      const r = await fetchWithRetry(url, 9500, 1);
      if (!r.ok) {
        throw new Error(`PDS ODE ${iid} returned HTTP ${r.status}`);
      }
      const data = (await r.json()) as {
        ODEResults?: {
          Products?: {
            Product?: Array<Record<string, string>> | Record<string, string>;
          };
        };
      };
      const raw = data.ODEResults?.Products?.Product;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return list.map((p) => {
        const externalUrl = p.External_url || p.External_url2 || p.FilesURL || 'https://ode.rsl.wustl.edu/mars/';
        const extractedId =
          p.pdsid ||
          externalUrl.split('/').filter(Boolean).pop()?.replace(/#.*$/, '') ||
          `MRO-${iid}-${p.Observation_time?.slice(0, 10) || 'OBS'}`;
        const centerLat = Number(p.Center_latitude ?? lat);
        const centerLonRaw = Number(p.Center_longitude ?? lon);
        const centerLon = centerLonRaw > 180 ? centerLonRaw - 360 : centerLonRaw;
        const targetLon = lon > 180 ? lon - 360 : lon;
        const distKm = Number(marsDistanceKm(lat, targetLon, centerLat, centerLon).toFixed(1));
        const geographicMatch: 'IN_SECTOR' | 'ADJACENT_REGION' | 'OUT_OF_SECTOR' =
          distKm <= 18 ? 'IN_SECTOR' : distKm <= 45 ? 'ADJACENT_REGION' : 'OUT_OF_SECTOR';
        return {
          productId: extractedId,
          mission: 'Mars Reconnaissance Orbiter (MRO)',
          instrument: iid === 'HIRISE' ? 'HiRISE (0.25–0.50 m/px)' : 'Context Camera (CTX · 6 m/px)',
          productType: pt,
          observationDate: p.Observation_time ? p.Observation_time.slice(0, 10) : 'Archival PDS',
          centerLat,
          centerLon,
          distanceKm: distKm,
          geographicMatch,
          description: p.Comment || p.Description || `Official PDS ${iid} ${pt} orbital observation.`,
          sourceUrl: externalUrl.startsWith('http') ? externalUrl : p.FilesURL || 'https://ode.rsl.wustl.edu/mars/',
          labelUrl: p.LabelURL,
        };
      });
    };

    const retrievedAt = new Date().toISOString();
    try {
      const [hiriseRes, ctxRes] = await Promise.allSettled([
        queryOde('HIRISE', 'RDRV11'),
        queryOde('CTX', 'EDR'),
      ]);

      const rawCombined = [
        ...(hiriseRes.status === 'fulfilled' ? hiriseRes.value : []),
        ...(ctxRes.status === 'fulfilled' ? ctxRes.value : []),
      ];
      const seenIds = new Set<string>();
      const products = rawCombined
        .filter((item) => {
          if (seenIds.has(item.productId)) return false;
          seenIds.add(item.productId);
          return true;
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 6);

      const errors = [
        ...(hiriseRes.status === 'rejected' ? [String(hiriseRes.reason)] : []),
        ...(ctxRes.status === 'rejected' ? [String(ctxRes.reason)] : []),
      ];

      const status =
        products.length > 0
          ? 'VERIFIED'
          : errors.length === 2
            ? 'UNAVAILABLE'
            : 'CONNECTED';

      if (status === 'VERIFIED') {
        lastSuccessfulRetrieval.set('pds-ode', retrievedAt);
      }

      const payload = {
        site,
        lat,
        lon,
        retrievedAt,
        cached: false,
        status,
        apiSource: 'NASA PDS Geosciences Orbital Data Explorer (ODE REST v2.1)',
        error: errors.length > 0 ? errors.join('; ') : undefined,
        products,
      };
      nasaCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, payload });
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        site,
        lat,
        lon,
        retrievedAt,
        cached: false,
        status: 'UNAVAILABLE',
        apiSource: 'NASA PDS Geosciences Orbital Data Explorer (ODE REST v2.1)',
        error: err instanceof Error ? err.message : 'PDS ODE query failed',
        products: [],
      });
    }
  });

  app.get('/api/nasa/imagery', async (req, res) => {
    const site = String(req.query.site || 'Jezero Crater').trim();
    const rover = String(req.query.rover || '').trim().toLowerCase();
    const instrument = String(req.query.instrument || '').trim().toLowerCase();
    const refresh = req.query.refresh === '1';

    const cacheKey = `imagery:${site}|${rover}|${instrument}`;
    if (!refresh) {
      const hit = nasaCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({ ...(hit.payload as Record<string, unknown>), cached: true });
        return;
      }
    }

    const items: Array<{
      id: string;
      title: string;
      mission: string;
      instrument: string;
      observationDate: string;
      sol?: number;
      imageUrl: string;
      sourceUrl: string;
      description: string;
      isFallback: boolean;
      locationMatch?: 'REGIONAL_MATCH' | 'CROSS_SITE_REFERENCE' | 'ARCHIVAL_REFERENCE';
      locationNote?: string;
    }> = [];

    let apiSource = 'NASA Image & Video Library API';
    let fallbackMode = false;
    let fallbackReason = '';
    let jplFailureNote = '';

    // 1. Try JPL Rover Raw Feed when querying Perseverance or Curiosity
    if (rover === 'perseverance' || rover === 'curiosity') {
      const category = rover === 'perseverance' ? 'mars2020' : 'msl';
      const roverTimeoutMs = rover === 'curiosity' ? 13000 : 9500;
      const siteLower = site.toLowerCase();
      const isExpectedSite =
        (rover === 'perseverance' && siteLower.includes('jezero')) ||
        (rover === 'curiosity' && siteLower.includes('gale'));
      const roverHome = rover === 'perseverance' ? 'Jezero Crater' : 'Gale Crater';
      try {
        const jplRes = await fetchWithRetry(
          `https://mars.nasa.gov/rss/api/?feed=raw_images&category=${category}&feedtype=json&ver=1.2&num=6`,
          roverTimeoutMs,
          1,
        );
        if (jplRes.ok) {
          const data = (await jplRes.json()) as {
            images?: Array<{
              imageid?: string;
              title?: string;
              sol?: number;
              date_taken_utc?: string;
              camera?: { instrument?: string };
              image_files?: { medium?: string; small?: string };
              link?: string;
              caption?: string;
            }>;
          };
          if (Array.isArray(data.images) && data.images.length > 0) {
            apiSource = `JPL ${rover === 'perseverance' ? 'Mars 2020' : 'MSL'} Raw Image Archive`;
            for (const img of data.images.slice(0, 6)) {
              const url = img.image_files?.medium || img.image_files?.small || '';
              if (!url) continue;
              items.push({
                id: String(img.imageid || `${category}-${items.length}`),
                title:
                  img.title ||
                  `${rover === 'perseverance' ? 'Perseverance' : 'Curiosity'} Sol ${img.sol ?? '—'} Frame`,
                mission: rover === 'perseverance' ? 'Mars 2020 Perseverance' : 'MSL Curiosity',
                instrument: img.camera?.instrument || 'Surface Camera',
                observationDate: img.date_taken_utc ? img.date_taken_utc.slice(0, 10) : 'Historical Sol Archive',
                sol: typeof img.sol === 'number' ? img.sol : undefined,
                imageUrl: url,
                sourceUrl: img.link || 'https://mars.nasa.gov/',
                description: (img.caption || 'Official JPL surface camera frame from NASA archival feed.').slice(0, 220),
                isFallback: false,
                locationMatch: isExpectedSite ? 'REGIONAL_MATCH' : 'CROSS_SITE_REFERENCE',
                locationNote: isExpectedSite
                  ? `Acquired in ${roverHome}`
                  : `Cross-site reference from ${roverHome} (not ${site})`,
              });
            }
          }
        } else {
          jplFailureNote = `JPL ${category} feed returned HTTP ${jplRes.status}`;
          console.warn(jplFailureNote);
        }
      } catch (err) {
        jplFailureNote = err instanceof Error ? `JPL ${category} feed failed: ${err.message}` : `JPL ${category} feed timed out`;
        console.warn(jplFailureNote);
      }
    }

    // 2. Query NASA Images API (supports HiRISE, CTX, THEMIS, or site search)
    if (items.length === 0) {
      try {
        const instPrefix =
          instrument === 'hirise'
            ? 'HiRISE'
            : instrument === 'ctx'
              ? 'CTX'
              : instrument === 'crism'
                ? 'CRISM'
                : instrument === 'themis'
                  ? 'THEMIS'
                  : 'Mars';
        const cleanSite = site.replace(/\s*\([^)]*\)/g, '').trim() || site;
        const query = encodeURIComponent(`${instPrefix} ${cleanSite}`);
        const nasaRes = await fetchWithRetry(
          `https://images-api.nasa.gov/search?q=${query}&media_type=image&page_size=6`,
          9000,
          1,
        );
        if (nasaRes.ok) {
          const payload = (await nasaRes.json()) as {
            collection?: {
              items?: Array<{
                data?: Array<{
                  nasa_id?: string;
                  title?: string;
                  date_created?: string;
                  center?: string;
                  description?: string;
                }>;
                links?: Array<{ href?: string; rel?: string }>;
              }>;
            };
          };
          const rawItems = payload.collection?.items || [];
          for (const entry of rawItems.slice(0, 6)) {
            const meta = entry.data?.[0];
            const thumb = entry.links?.find((l) => l.rel === 'preview')?.href || entry.links?.[0]?.href || '';
            if (!meta || !thumb) continue;
            const cleanDesc = (meta.description || 'Verified NASA Image Library record.')
              .replace(/<[^>]+>/g, '')
              .slice(0, 220);
            const hay = `${meta.title || ''} ${cleanDesc}`.toLowerCase();
            const siteTokens = cleanSite
              .toLowerCase()
              .split(/\s+/)
              .filter((t) => t.length > 3 && t !== 'crater' && t !== 'planitia' && t !== 'mons' && t !== 'vallis' && t !== 'aureole' && t !== 'rim');
            const mentionsSite =
              siteTokens.length > 0 && siteTokens.some((tok) => hay.includes(tok));
            items.push({
              id: meta.nasa_id || meta.title || 'NASA-IMG',
              title: meta.title || `Mars ${site} Observation`,
              mission: meta.center ? `NASA ${meta.center} Archive` : 'NASA / JPL Planetary Archive',
              instrument:
                instrument === 'hirise'
                  ? 'MRO HiRISE'
                  : instrument === 'ctx'
                    ? 'MRO CTX'
                    : instrument === 'crism'
                      ? 'MRO CRISM'
                      : instrument === 'themis'
                        ? 'Mars Odyssey THEMIS'
                        : 'Orbital / Surface Archive',
              observationDate: meta.date_created ? meta.date_created.slice(0, 10) : 'Archival',
              imageUrl: thumb,
              sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id || '')}`,
              description: cleanDesc,
              isFallback: false,
              locationMatch: mentionsSite ? 'REGIONAL_MATCH' : 'ARCHIVAL_REFERENCE',
              locationNote: mentionsSite
                ? `Metadata explicitly references ${cleanSite}`
                : `Returned by archive text search for "${cleanSite}" — verify exact image coordinates`,
            });
          }
        } else {
          fallbackMode = true;
          fallbackReason = [jplFailureNote, `NASA Images API returned HTTP ${nasaRes.status}`]
            .filter(Boolean)
            .join('; ');
        }
      } catch (err) {
        console.warn('NASA Images API request failed:', err);
        fallbackMode = true;
        fallbackReason = [
          jplFailureNote,
          err instanceof Error ? err.message : 'Network timeout contacting NASA public endpoints',
        ]
          .filter(Boolean)
          .join('; ');
      }
    }

    if (items.length === 0) {
      fallbackMode = true;
      if (!fallbackReason)
        fallbackReason =
          jplFailureNote ||
          'No live archival frames returned for query; showing curated historical PDS references where available.';
      const siteLower = site.toLowerCase();
      const matchedKey = Object.keys(CURATED_ARCHIVE_FALLBACK).find((k) =>
        siteLower.includes(k.toLowerCase().split(' ')[0]),
      );
      const curated = matchedKey ? CURATED_ARCHIVE_FALLBACK[matchedKey] : [];
      for (const c of curated) {
        items.push({ ...c, isFallback: true });
      }
    }

    const payload = {
      site,
      apiSource,
      fallbackMode,
      fallbackReason,
      cached: false,
      retrievedAt: new Date().toISOString(),
      items,
    };

    if (!fallbackMode) {
      nasaCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, payload });
    }
    res.json(payload);
  });

  app.post('/api/assistant', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured in the server environment. Configure it in Settings > Secrets to enable Gemini responses.',
      });
      return;
    }

    const { question, missionContext, history, mode } = req.body as {
      question?: string;
      missionContext?: Record<string, unknown>;
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
      mode?: 'chat' | 'quick-action' | 'summary' | 'risk-analysis' | 'what-if';
    };

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'Question is required.' });
      return;
    }

    const systemInstruction = `You are MARSWALK AI Mission Assistant, an aerospace flight-operations, terrain-safety, life-support, and planetary-geology advisor for NASA Space Apps Challenge 2026.

CRITICAL SCIENTIFIC & SAFETY RULES:
1. Ground EVERY numeric claim, coordinate, elevation, slope, roughness, crater proximity, hazard category, route comparison, oxygen/energy/water/duration value, reserve margin, readiness score, and dataset citation STRICTLY in the provided APPLICATION CONTEXT JSON.
2. NEVER invent NASA observations, rover discoveries, real-time dust storm telemetry, or Martian measurements not present in APPLICATION CONTEXT.
3. NEVER claim simulated demonstration data is real NASA telemetry, and NEVER describe parametric planning estimates as flight-certified engineering specs.
4. Distinguish data provenance explicitly using the exact classification labels:
   - \`ACTUAL NASA OBSERVATION\` (e.g., Perseverance/Curiosity raw frames, MEDA/REMS archived sols, georeferenced PDS ODE HiRISE/CTX footprints)
   - \`PUBLISHED SCIENTIFIC DATASET\` (e.g., MGS MOLA datum, Viking MDIM21, Odyssey THEMIS IR baselines, IAU craters)
   - \`DERIVED CALCULATION\` (e.g., A* route scores & segment exposure, slope/roughness physics, parametric O2/energy/water & readiness formulas, Prototype Science Priority Score)
   - \`SIMULATED DEMONSTRATION\` (e.g., synthetic 25x25 km regional terrain demonstration grid, 500 m hazard zones)
   - \`SIMULATED SCENARIO\` (when discussing hypothetical What-If simulation inputs/outputs inside \`whatIfScenario\`)
5. NEVER claim extraterrestrial life has been discovered on Mars.
6. NEVER claim to certify any route or consumable plan as safe for real astronauts; state clearly that outputs are planning estimates that do not replace official NASA engineering validation.
7. If requested data is unavailable in APPLICATION CONTEXT (e.g., live Mars weather for regions without MEDA/REMS stations, raw numeric MOLA elevation REST profiles, 0.25 m/px HiRISE stereo DTMs for unverified coordinates, or unmodeled consumables like food/radiation shielding), explicitly state that it is UNAVAILABLE and cite the recorded dataset limitations instead of guessing.

FORMATTING & STRUCTURE:
- Use clean Markdown with concise headings, bullet points, and Markdown tables when comparing routes (Shortest vs Balanced vs Safest), What-If scenarios (Original vs Simulated Scenario), or emergency contingencies (+10% / +20% / +30%).
- Highlight critical hazards, steep slopes (>= 20 deg), crater rims (< 450 m), or resource shortfalls using Markdown blockquotes starting with \"> **WARNING:**\".
- Every recommendation MUST state its reason and cite exact supporting metrics/datasets from APPLICATION CONTEXT.
- When asked for a **Risk Assessment / Mission Risk Analysis** (evaluate terrain difficulty, slope exposure, surface roughness, crater proximity, hazard distribution along the route, resource sufficiency, mission duration, emergency reserves, and scientific objectives), organize the answer into these 5 sections:
  ### 1. Overall Assessment
  ### 2. Major Risks
  ### 3. Supporting Evidence
  ### 4. Recommended Actions
  ### 5. Remaining Uncertainties
- When asked for a **What-If Scenario** analysis, clearly label hypothetical metrics as **SIMULATED SCENARIO** and show Original vs Modified values, Resource Differences, New Readiness Status, and New Warnings.
- When asked for a **Full Mission Summary**, organize with: Mission Overview, Route Assessment, Terrain Conditions, Hazard Warnings, Resource Requirements, Scientific Opportunities, Recommendations, and Data Limitations.`;

    const recentHistory = Array.isArray(history)
      ? history
          .slice(-6)
          .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
          .map((h) => `${h.role === 'user' ? 'CREW' : 'ADVISOR'}: ${h.text.slice(0, 1200)}`)
          .join('\n\n')
      : '';

    const modeHint =
      mode === 'summary'
        ? 'REQUEST MODE: Full Structured Mission Summary covering objective, start/destination, planned route, distance, terrain difficulty, major hazards, estimated duration, O2/energy/water & reserves, scientific targets, data provenance, and limitations.'
        : mode === 'risk-analysis'
          ? 'REQUEST MODE: Complete 5-Section Mission Risk Analysis (Overall Assessment, Major Risks, Supporting Evidence, Recommended Actions, Remaining Uncertainties) evaluating all 9 risk dimensions.'
          : mode === 'what-if'
            ? 'REQUEST MODE: What-If Scenario Comparison (clearly label hypothetical outcomes as SIMULATED SCENARIO alongside Original Active Mission values).'
            : mode === 'quick-action'
              ? 'REQUEST MODE: Structured Cross-Module Mission Analysis with Markdown comparison table and explicit warnings.'
              : 'REQUEST MODE: Interactive Mission Consultation.';

    const prompt = `APPLICATION CONTEXT (Live Multi-Module App State):
${JSON.stringify(missionContext || {}, null, 2)}

${recentHistory ? `RECENT CONVERSATION HISTORY:\n${recentHistory}\n\n` : ''}${modeHint}

USER REQUEST:
${question.trim()}`;

    const modelName = 'gemini-4-hydrogen';
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });

        res.json({
          answer: response.text || 'No response generated.',
          model: modelName,
          timestamp: new Date().toISOString(),
        });
        return;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient =
          msg.includes('503') ||
          msg.includes('500') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('ECONNRESET');
        if (attempt === 0 && isTransient) {
          await new Promise((resolve) => setTimeout(resolve, 650));
          continue;
        }
        break;
      }
    }

    const rawMessage = lastError instanceof Error ? lastError.message : 'Gemini API request failed.';
    let statusCode = 500;
    let userMessage = rawMessage;

    if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('403')) {
      statusCode = 403;
      userMessage =
        'Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets.';
    } else if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
      statusCode = 429;
      userMessage =
        'Gemini API rate limit or quota reached (429). Please retry in a moment or verify quota in Settings > Secrets.';
    } else if (rawMessage.includes('NOT_FOUND') || rawMessage.includes('404')) {
      statusCode = 404;
      userMessage = `Configured Gemini model (${modelName}) was not found by the API endpoint.`;
    }

    res.status(statusCode).json({ error: userMessage });
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MARSWALK AI server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MARSWALK AI server:', err);
  process.exit(1);
});
