import React, { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { useStore } from '../store';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
if (!mapboxgl.accessToken) console.error('[MapBox] VITE_MAPBOX_TOKEN is not set — map will not load.');

// ── Constants ─────────────────────────────────────────────────────────────────
const KM_PER_DEG = 111.32;
const MAX_KNOTS = 35;
const MAX_KM_S = (MAX_KNOTS * 1.852) / 3600;
const MAX_DEG_S = MAX_KM_S / KM_PER_DEG;

// How many degrees apart two coords must be to count as "reached"
const WAYPOINT_REACH_DEG = 0.003;  // ~330 m — tight enough to stay on-path

// Navigable water polygon for the Strait of Hormuz region [lat, lng]
// Source: fleet.json — used to filter route waypoints so ships stay on water
const NAVIGABLE_POLYGON = [
  [29.70,48.55],[29.40,49.50],[28.90,50.30],[28.50,50.90],[28.00,51.50],
  [27.50,52.20],[27.10,52.90],[26.85,53.60],[26.80,54.20],[26.80,54.90],
  [26.85,55.60],[26.90,56.00],[27.00,56.50],[27.10,57.00],[26.80,57.60],
  [26.30,58.10],[25.80,58.60],[25.30,59.10],[24.50,59.60],[23.50,59.90],
  [22.50,60.00],[22.00,60.00],[22.20,58.80],[23.00,58.30],[23.70,58.00],
  [24.40,57.60],[24.90,57.20],[25.30,56.90],[25.70,56.80],[26.10,56.80],
  [26.50,56.75],[26.75,56.50],[26.80,56.10],[26.65,55.80],[26.40,55.50],
  [26.10,55.20],[25.80,55.00],[25.65,54.70],[25.55,54.20],[25.50,53.60],
  [25.60,53.00],[25.80,52.40],[26.10,51.90],[26.40,51.50],[26.60,51.00],
  [26.70,50.50],[26.80,50.10],[27.10,49.70],[27.60,49.30],[28.20,49.00],
  [28.80,48.80],[29.30,48.60],[29.70,48.55],
];

// Ray-cast point-in-polygon test against the navigable water area
function onWater(lat, lng) {
  const poly = NAVIGABLE_POLYGON;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (((xi > lng) !== (xj > lng)) && (lat < (yj - yi) * (lng - xi) / (xj - xi) + yi))
      inside = !inside;
  }
  return inside;
}

// ── Status → color ────────────────────────────────────────────────────────────
const STATUS = {
  normal: { color: '#2e7d6e', label: 'Normal' },
  rerouting: { color: '#c07c2b', label: 'Rerouting' },
  distressed: { color: '#c0392b', label: 'Distressed' },
  stopped: { color: '#81A6C6', label: 'Stopped' },
  stranded: { color: '#7b3fa0', label: 'Stranded' },
  arrived: { color: '#1a6b95', label: 'Arrived' },
  insufficient_fuel: { color: '#b85c00', label: 'Low Fuel' },
  predictive: { color: '#c07c2b', label: 'Warning' },
};
function getStatus(s) { return STATUS[s] || { color: '#81A6C6', label: s }; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAngleDiff(from, to) {
  let d = ((to - from) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

// Inject ship animation CSS once
if (typeof document !== 'undefined' && !document.getElementById('ship-anim-css')) {
  const s = document.createElement('style');
  s.id = 'ship-anim-css';
  s.textContent = `
    @keyframes ship-pulse {
      0%   { transform: scale(1);   opacity: 0.55; }
      50%  { transform: scale(1.7); opacity: 0.15; }
      100% { transform: scale(1);   opacity: 0.55; }
    }
    @keyframes ship-ping {
      0%   { transform: scale(0.8); opacity: 0.7; }
      100% { transform: scale(2.4); opacity: 0;   }
    }
    @keyframes ship-wake {
      0%   { opacity: 0.45; transform: scaleX(1);   }
      100% { opacity: 0;    transform: scaleX(2.2); }
    }
    .ship-marker:hover .ship-inner { filter: brightness(1.25); }
    .ship-marker { transition: transform 0.15s ease; }
    .ship-marker:hover { transform: scale(1.12); }
    /* Popup fade-in */
    .mapboxgl-popup { animation: popup-fadein 0.18s ease; }
    @keyframes popup-fadein {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .mapboxgl-popup-content {
      border-radius: 14px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12) !important;
      padding: 0 !important;
      overflow: hidden;
      border: 1px solid rgba(129,166,198,0.25) !important;
    }
    .mapboxgl-popup-tip { border-top-color: #fff !important; }
  `;
  document.head.appendChild(s);
}

function makeShipEl(color, isSelected, status) {
  const outer = document.createElement('div');
  const SIZE = 44;
  outer.className = 'ship-marker';
  outer.style.cssText = `width:${SIZE}px;height:${SIZE}px;position:relative;cursor:pointer;`;

  const isDistressed = status === 'distressed' || status === 'stranded';
  const isWarning    = status === 'rerouting'  || status === 'insufficient_fuel';

  // Ping ring for distressed/warning ships
  const pingRing = isDistressed || isWarning ? `
    <div style="
      position:absolute;inset:0;border-radius:50%;
      border:2px solid ${color};
      animation:ship-ping ${isDistressed ? '1s' : '1.6s'} cubic-bezier(0,0,0.2,1) infinite;
      pointer-events:none;
    "></div>` : '';

  // Outer glow pulse
  const glowRing = `
    <div style="
      position:absolute;inset:4px;border-radius:50%;
      background:${color};
      animation:ship-pulse 2.4s ease-in-out infinite;
      pointer-events:none;
    "></div>`;

  // Wake trail (ellipse behind the ship — rotated via parent)
  const wake = `
    <div style="
      position:absolute;left:50%;bottom:-6px;
      width:10px;height:18px;
      transform:translateX(-50%);
      background:radial-gradient(ellipse at top, ${color}55 0%, transparent 70%);
      animation:ship-wake 1.2s ease-out infinite;
      pointer-events:none;
    "></div>`;

  outer.innerHTML = `
    ${pingRing}
    ${glowRing}
    ${wake}
    <div class="ship-inner" style="
      position:absolute;inset:0;
      display:flex;align-items:center;justify-content:center;
      transition:filter 0.2s;
    ">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="ship-glow-${color.replace('#','')}" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <!-- hull -->
        <polygon points="16,2 22,26 16,22 10,26"
          fill="${color}" stroke="white" stroke-width="1.6" stroke-linejoin="round"
          filter="url(#ship-glow-${color.replace('#','')})"/>
        <!-- superstructure -->
        <rect x="13" y="12" width="6" height="5" rx="1.5" fill="white" opacity="0.9"/>
        <!-- bow light -->
        <circle cx="16" cy="4" r="1.5" fill="white" opacity="0.8"/>
        ${isSelected ? `<circle cx="16" cy="16" r="14" stroke="${color}" stroke-width="2" fill="none" opacity="0.5"/>` : ''}
      </svg>
    </div>
  `;
  return outer;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MapBox({ isCommand }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const draw = useRef(null);
  const rafRef = useRef(null);
  const zonesAdded = useRef(false);
  const weatherAdded = useRef(false);
  const routeAdded = useRef(false);

  // Per-ship interpolation state lives entirely outside React state.
  // Shape: { [shipId]: { marker, popup, el,
  //   curLng, curLat, curHdg,   ← currently rendered position
  //   pathQueue,                ← [[lng,lat],...] waypoints yet to visit (Mapbox order)
  //   speed,                    ← knots from server
  //   _pinned, _lastShip } }
  const ships$ = useRef({});

  const ships = useStore(s => s.ships);
  const zones = useStore(s => s.zones);
  const weatherZones = useStore(s => s.weatherZones);
  const selectedShipId = useStore(s => s.selectedShipId);
  const setSelectedShipId = useStore(s => s.setSelectedShipId);
  const createZone = useStore(s => s.createZone);
  const routeOptions = useStore(s => s.routeOptions);
  const previewRouteId = useStore(s => s.previewRouteId);
  const routeOptAdded = useRef(false);

  const popupHtml = useCallback((ship) => {
    const st = getStatus(ship.status);
    const fuelPct = Math.min(100, ((ship.fuel || 0) / 8500) * 100);
    const fuelColor = fuelPct > 50 ? '#2e7d6e' : fuelPct > 20 ? '#e67e22' : '#c0392b';
    const eta = ship.eta_seconds ? (() => {
      const h = Math.floor(ship.eta_seconds / 3600);
      const m = Math.floor((ship.eta_seconds % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    })() : '—';
    const distKm = ship.dist_to_dest_km != null ? `${Number(ship.dist_to_dest_km).toFixed(0)} km` : '—';
    const speedKn = ship.speed?.toFixed(1) ?? '0';
    const fuelT = ship.fuel?.toFixed(0) ?? '0';
    return `
    <div style="font-family:system-ui,sans-serif;width:260px;background:#fff;overflow:hidden">
      <!-- Header strip -->
      <div style="background:${st.color};padding:10px 14px 8px;">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:-0.02em">${ship.name}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.75);font-weight:600;letter-spacing:0.1em;text-transform:uppercase">${ship.id} · ${ship.type || 'Cargo'}</div>
          </div>
          <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,0.22);color:#fff;white-space:nowrap">${st.label}</span>
        </div>
        <!-- Fuel bar -->
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,0.75);margin-bottom:3px">
            <span>FUEL</span><span>${fuelT}t · ${fuelPct.toFixed(0)}%</span>
          </div>
          <div style="height:4px;background:rgba(255,255,255,0.25);border-radius:2px">
            <div style="height:100%;width:${fuelPct}%;background:rgba(255,255,255,0.9);border-radius:2px;transition:width 0.4s"></div>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e8f0f5">
        ${[['Speed', speedKn + ' kn'], ['ETA', eta], ['Distance', distKm]].map(([label, val]) =>
          `<div style="background:#fff;padding:7px 8px;text-align:center">
            <div style="font-size:9px;color:#8ba8bc;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">${label}</div>
            <div style="font-size:12px;font-weight:800;color:#1a2b38">${val}</div>
          </div>`).join('')}
      </div>

      <!-- Destination row -->
      <div style="padding:8px 14px;border-top:1px solid #eef3f7;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:#8ba8bc;font-weight:600">→ TO</span>
        <span style="font-size:12px;font-weight:800;color:#1a2b38">${ship.destination_port || '—'}</span>
      </div>

      ${!ship.can_reach_dest ? `
      <div style="padding:6px 14px 8px;background:#fef6f6;border-top:1px solid #fccaca">
        <span style="font-size:11px;color:#c0392b;font-weight:700">⚠ Insufficient fuel to reach ${ship.destination_port}</span>
      </div>` : ''}
    </div>`;
  }, []);

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [55.5, 26.0],
      zoom: 6.2,
      minZoom: 4,
      maxZoom: 14,
      projection: 'mercator',
      maxBounds: [[44.0, 19.0], [64.0, 33.0]],
    });

    // ── Apply maritime color palette after style loads ───────────────────────
    map.current.on('style.load', () => {
      // Soft teal-blue water
      const waterLayers = ['water', 'water-shadow', 'waterway'];
      waterLayers.forEach(id => {
        if (map.current.getLayer(id)) {
          const type = map.current.getLayer(id).type;
          if (type === 'fill') map.current.setPaintProperty(id, 'fill-color', '#a8d8ea');
          if (type === 'line') map.current.setPaintProperty(id, 'line-color', '#7bbfd4');
        }
      });
      // Soft warm land
      if (map.current.getLayer('land')) map.current.setPaintProperty('land', 'background-color', '#f2ede6');
      if (map.current.getLayer('landcover')) map.current.setPaintProperty('landcover', 'fill-color', '#e8e2d8');
      if (map.current.getLayer('national-park')) map.current.setPaintProperty('national-park', 'fill-color', '#dce8d0');
      if (map.current.getLayer('landuse')) map.current.setPaintProperty('landuse', 'fill-color', '#e5dfd6');
    });

    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.current.addControl(new mapboxgl.ScaleControl({ unit: 'nautical' }), 'bottom-right');

    if (isCommand) {
      draw.current = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: 'simple_select',
        styles: [
          {
            id: 'fill', type: 'fill', filter: ['all', ['==', '$type', 'Polygon']],
            paint: { 'fill-color': '#c0392b', 'fill-opacity': 0.18 }
          },
          {
            id: 'stroke', type: 'line', filter: ['all', ['==', '$type', 'Polygon']],
            paint: { 'line-color': '#c0392b', 'line-width': 2, 'line-dasharray': [3, 3] }
          },
          {
            id: 'fill-active', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
            paint: { 'fill-color': '#c0392b', 'fill-opacity': 0.28 }
          },
          {
            id: 'stroke-active', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
            paint: { 'line-color': '#c0392b', 'line-width': 2.5 }
          },
          {
            id: 'vertex', type: 'circle', filter: ['all', ['==', '$type', 'Point']],
            paint: { 'circle-color': '#c0392b', 'circle-radius': 5, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
          },
          {
            // midpoint handles for inserting vertices
            id: 'midpoint', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
            paint: { 'circle-color': '#fff', 'circle-radius': 4, 'circle-stroke-width': 2, 'circle-stroke-color': '#c0392b' }
          },
        ],
      });
      map.current.addControl(draw.current, 'top-left');

      // Zone created — persist to backend
      map.current.on('draw.create', async e => {
        const coords = e.features[0].geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
        await createZone(`Zone-${new Date().toLocaleTimeString()}`, coords);
        draw.current.deleteAll();
      });
    }

    map.current.on('load', () => {
      // Zones
      map.current.addSource('zones-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.current.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones-src', paint: { 'fill-color': '#c0392b', 'fill-opacity': 0.12 } });
      map.current.addLayer({ id: 'zones-stroke', type: 'line', source: 'zones-src', paint: { 'line-color': '#c0392b', 'line-width': 2, 'line-dasharray': [4, 3] } });
      map.current.addLayer({
        id: 'zones-label', type: 'symbol', source: 'zones-src',
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-anchor': 'center' },
        paint: { 'text-color': '#c0392b', 'text-halo-color': '#fff', 'text-halo-width': 2 }
      });
      zonesAdded.current = true;

      // Weather
      map.current.addSource('weather-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.current.addLayer({ id: 'weather-fill', type: 'fill', source: 'weather-src', paint: { 'fill-color': '#FFFAF0', 'fill-opacity': 0.22 } });
      map.current.addLayer({ id: 'weather-stroke', type: 'line', source: 'weather-src', paint: { 'line-color': '#81A6C6', 'line-width': 1.5, 'line-dasharray': [5, 4] } });
      map.current.addLayer({
        id: 'weather-label', type: 'symbol', source: 'weather-src',
        layout: { 'text-field': ['get', 'desc'], 'text-size': 10, 'text-anchor': 'center' },
        paint: { 'text-color': '#1a6b95', 'text-halo-color': '#FFFAF0', 'text-halo-width': 2 }
      });
      weatherAdded.current = true;

      // Routes (live ship paths) — drawn beneath ship markers
      map.current.addSource('routes-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // Soft glow beneath the route line
      map.current.addLayer({
        id: 'routes-glow', type: 'line', source: 'routes-src',
        paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.12, 'line-blur': 4 },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      // Dashed active route line
      map.current.addLayer({
        id: 'routes-line', type: 'line', source: 'routes-src',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [5, 3] },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      routeAdded.current = true;

      // Candidate route options overlay
      map.current.addSource('route-options-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.current.addLayer({
        id: 'route-options-bg', type: 'line', source: 'route-options-src',
        paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.18 },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      map.current.addLayer({
        id: 'route-options-line', type: 'line', source: 'route-options-src',
        filter: ['==', ['get', 'selected'], false],
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [6, 4] },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      map.current.addLayer({
        id: 'route-options-sel', type: 'line', source: 'route-options-src',
        filter: ['==', ['get', 'selected'], true],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.95 },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      routeOptAdded.current = true;
    });

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update zones ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !zonesAdded.current) return;
    map.current.getSource('zones-src')?.setData({
      type: 'FeatureCollection',
      features: zones.map(z => ({
        type: 'Feature',
        properties: { name: z.name, id: z.id },
        geometry: { type: 'Polygon', coordinates: [z.polygon.map(([lat, lng]) => [lng, lat])] },
      })),
    });
  }, [zones]);

  // ── Update weather ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !weatherAdded.current) return;
    map.current.getSource('weather-src')?.setData({
      type: 'FeatureCollection',
      features: weatherZones.map(wz => {
        const pts = [];
        for (let a = 0; a <= 360; a += 8) {
          const r = wz.radius_km / KM_PER_DEG;
          pts.push([wz.lng + r * Math.sin(a * Math.PI / 180), wz.lat + r * Math.cos(a * Math.PI / 180)]);
        }
        pts.push(pts[0]);
        // Intensity color: mild → dark orange → deep red
        const intensity = (wz.intensity || 50) / 100;
        const fillColor = intensity > 0.7 ? '#c0392b' : intensity > 0.4 ? '#e67e22' : '#f39c12';
        const fillOpacity = 0.12 + (intensity * 0.18);
        return {
          type: 'Feature',
          properties: {
            desc: `${wz.description || 'Storm'}`,
            intensity: wz.intensity || 50,
            wind: wz.wind_knots || 0,
            waves: wz.wave_height_m || 0,
          },
          geometry: { type: 'Polygon', coordinates: [pts] },
        };
      }),
    });
    // Update layer styling based on intensity
    if (map.current.getLayer('weather-fill')) {
      map.current.setPaintProperty('weather-fill', 'fill-color', ['interpolate', ['linear'], ['get', 'intensity'],
        0, '#f39c12',
        50, '#e67e22',
        100, '#c0392b']);
      map.current.setPaintProperty('weather-fill', 'fill-opacity', ['interpolate', ['linear'], ['get', 'intensity'],
        0, 0.12,
        50, 0.20,
        100, 0.30]);
    }
    if (map.current.getLayer('weather-stroke')) {
      map.current.setPaintProperty('weather-stroke', 'line-color', ['interpolate', ['linear'], ['get', 'intensity'],
        0, '#f39c12',
        50, '#e67e22',
        100, '#c0392b']);
    }
  }, [weatherZones]);

  // ── Update route paths ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !routeAdded.current) return;
    const src = map.current.getSource('routes-src');
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: ships
        .filter(s => s.route_path && s.route_path.length >= 2)
        .map(s => {
          // Convert [lat,lng] → [lng,lat] and filter out of nav polygon
          let pts = s.route_path
            .map(([la, ln]) => [ln, la])
            .filter(([wLng, wLat]) => onWater(wLat, wLng));
          
          const shipLat = s.lat, shipLng = s.lng;
          let pathStart = 0;
          while (pathStart < pts.length - 1) {
            const [wLng, wLat] = pts[pathStart];
            if (Math.abs(wLng - shipLng) < 0.08 && Math.abs(wLat - shipLat) < 0.08) pathStart++;
            else break;
          }
          const coords = [[shipLng, shipLat], ...pts.slice(pathStart)];
          return {
            type: 'Feature',
            properties: { id: s.id, color: getStatus(s.status).color },
            geometry: { type: 'LineString', coordinates: coords },
          };
        }),
    });
  }, [ships]);

  // ── Update candidate route options overlay ─────────────────────────────────
  useEffect(() => {
    if (!map.current || !routeOptAdded.current) return;
    const src = map.current.getSource('route-options-src');
    if (!src) return;
    if (!routeOptions?.routes?.length) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: routeOptions.routes.map(r => ({
        type: 'Feature',
        properties: { id: r.id, color: r.color, selected: r.id === previewRouteId },
        geometry: { type: 'LineString', coordinates: r.path.map(([la, ln]) => [ln, la]) },
      })),
    });
  }, [routeOptions, previewRouteId]);

  // ── Absorb server ticks into ships$ interpolation state ────────────────────
  useEffect(() => {
    if (!map.current) return;

    ships.forEach(ship => {
      const st = getStatus(ship.status);
      const isSelected = ship.id === selectedShipId;
      const ref = ships$.current[ship.id];

      // Build a path queue [[lng,lat],...], filtering to water-only waypoints
      const buildQueue = (curLng, curLat) => {
        if (!ship.route_path || ship.route_path.length === 0) return [[ship.lng, ship.lat]];
        let all = ship.route_path
          .map(([la, ln]) => [ln, la])
          .filter(([wLng, wLat]) => onWater(wLat, wLng));
        if (all.length === 0) all = [[ship.lng, ship.lat]];
        let start = 0;
        while (start < all.length - 1) {
          const [wLng, wLat] = all[start];
          if (Math.abs(wLng - curLng) < WAYPOINT_REACH_DEG && Math.abs(wLat - curLat) < WAYPOINT_REACH_DEG) start++;
          else break;
        }
        return all.slice(start);
      };

      if (!ref) {
        // ── First time: spawn marker exactly at server position ───────────────
        const el = makeShipEl(st.color, isSelected, ship.status);

        // No fixed anchor — Mapbox auto-picks best direction to stay on screen
        const popup = new mapboxgl.Popup({
          offset: { 'bottom': [0, -50], 'bottom-left': [6, -50], 'bottom-right': [-6, -50],
                    'top': [0, 10], 'top-left': [6, 10], 'top-right': [-6, 10],
                    'left': [10, 0], 'right': [-10, 0] },
          closeButton: true, closeOnClick: false,
          className: 'ship-popup', maxWidth: '260px',
        }).setHTML(popupHtml(ship));

        // Spawn ship at first WATER waypoint from route_path, fallback to server pos
        const firstWaterWp = ship.route_path?.find(([la, ln]) => onWater(la, ln));
        const spawnLng = firstWaterWp ? firstWaterWp[1] : ship.lng;
        const spawnLat = firstWaterWp ? firstWaterWp[0] : ship.lat;

        let pinned = false;
        let hideTimer = null;

        const showPopup = () => {
          clearTimeout(hideTimer);
          const curRef = ships$.current[ship.id];
          popup.setHTML(popupHtml((curRef && curRef._lastShip) || ship));
          popup.setLngLat([curRef ? curRef.curLng : ship.lng, curRef ? curRef.curLat : ship.lat]);
          if (!popup.isOpen()) popup.addTo(map.current);
        };

        const hidePopup = () => {
          clearTimeout(hideTimer);
          if (!pinned) hideTimer = setTimeout(() => popup.remove(), 120);
        };

        el.addEventListener('mouseenter', showPopup);
        el.addEventListener('mouseleave', hidePopup);

        // Keep popup open when mouse is over the popup itself
        popup.on('open', () => {
          const pe = popup.getElement();
          if (pe) {
            pe.addEventListener('mouseenter', () => clearTimeout(hideTimer));
            pe.addEventListener('mouseleave', hidePopup);
          }
        });

        el.addEventListener('click', e => {
          e.stopPropagation();
          setSelectedShipId(ship.id);
          Object.values(ships$.current).forEach(m => { m._pinned = false; });
          pinned = true;
          ships$.current[ship.id] && (ships$.current[ship.id]._pinned = true);
          Object.values(ships$.current).forEach(m => {
            if (m !== ships$.current[ship.id]) m.popup.remove();
          });
          popup.addTo(map.current);
        });

        const marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map', anchor: 'center' })
          .setLngLat([spawnLng, spawnLat])
          .setRotation(ship.heading || 0)
          .addTo(map.current);

        ships$.current[ship.id] = {
          marker, popup, el,
          curLng: spawnLng, curLat: spawnLat, curHdg: ship.heading || 0,
          pathQueue: buildQueue(spawnLng, spawnLat),
          speed: ship.speed || 0,
          _pinned: false, _lastShip: ship,
        };
      } else {
        // ── Subsequent tick: refresh waypoint queue ──────────────────────────
        ref.pathQueue = buildQueue(ref.curLng, ref.curLat);
        ref.speed = ship.speed || 0;
        ref._lastShip = ship;
        if (ref.popup.isOpen()) ref.popup.setHTML(popupHtml(ship));
      }
    });

    // Remove stale markers
    const liveIds = new Set(ships.map(s => s.id));
    Object.keys(ships$.current).forEach(id => {
      if (!liveIds.has(id)) {
        ships$.current[id].marker.remove();
        ships$.current[id].popup.remove();
        delete ships$.current[id];
      }
    });
  }, [ships, selectedShipId, popupHtml, setSelectedShipId]);

  // ── RAF loop: path-following movement at 60 fps ─────────────────────────────
  // Ships move along their route_path waypoints so they NEVER cut across land.
  useEffect(() => {
    let prevMs = performance.now();

    function frame(nowMs) {
      const dtSec = Math.min((nowMs - prevMs) / 1000, 0.1);
      prevMs = nowMs;

      Object.values(ships$.current).forEach(ref => {
        if (!ref.pathQueue || ref.pathQueue.length === 0) return;

        // Distance (in degrees) the ship can travel this frame
        const maxDelta = MAX_DEG_S * dtSec;
        let budget = maxDelta;

        // Walk along waypoints, consuming budget
        while (budget > 0 && ref.pathQueue.length > 0) {
          const [wLng, wLat] = ref.pathQueue[0];
          const dLng = wLng - ref.curLng;
          const dLat = wLat - ref.curLat;
          const dist = Math.sqrt(dLng * dLng + dLat * dLat);

          if (dist <= budget) {
            // Reach this waypoint exactly and pop it
            ref.curLng = wLng;
            ref.curLat = wLat;
            budget -= dist;
            ref.pathQueue.shift();
          } else {
            // Move as far as budget allows toward this waypoint
            const ratio = budget / dist;
            ref.curLng += dLng * ratio;
            ref.curLat += dLat * ratio;
            budget = 0;
          }
        }

        // ── heading: point toward next waypoint ─────────────────────────────
        if (ref.pathQueue.length > 0) {
          const [wLng, wLat] = ref.pathQueue[0];
          const dLng = wLng - ref.curLng;
          const dLat = wLat - ref.curLat;
          if (Math.abs(dLng) > 1e-6 || Math.abs(dLat) > 1e-6) {
            const targetHdg = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
            const dHdg = shortAngleDiff(ref.curHdg, targetHdg);
            ref.curHdg = Math.abs(dHdg) < 0.2 ? targetHdg : ref.curHdg + dHdg * 6 * dtSec;
          }
        }

        ref.marker.setLngLat([ref.curLng, ref.curLat]).setRotation(ref.curHdg);
        if (ref.popup && ref.popup.isOpen()) ref.popup.setLngLat([ref.curLng, ref.curLat]);
      });

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </>
  );
}
