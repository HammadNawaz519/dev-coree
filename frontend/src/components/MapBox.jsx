import React, { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { useStore } from '../store';

mapboxgl.accessToken =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  'ur api key ';

// ── Constants ─────────────────────────────────────────────────────────────────
// 1 degree latitude ≈ 111.32 km. Max ship speed ~30 knots = 55.56 km/h = 0.01543 km/s
// Converted to degrees/sec for the speed cap: 0.01543 / 111.32 ≈ 0.0001386 °/s
const KM_PER_DEG = 111.32;
const MAX_KNOTS = 35;                               // absolute physical ceiling
const MAX_KM_S = (MAX_KNOTS * 1.852) / 3600;      // km per second
const MAX_DEG_S = MAX_KM_S / KM_PER_DEG;           // degrees per second (lat)

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

// Clamp delta-degrees so it never implies speed > MAX_DEG_S * dtSec
function clampDeg(delta, dtSec) {
  const maxDelta = MAX_DEG_S * dtSec;
  return Math.max(-maxDelta, Math.min(maxDelta, delta));
}

function makeShipEl(color, isSelected) {
  const el = document.createElement('div');
  const size = isSelected ? 36 : 30;
  el.style.cssText = `
    width:${size}px;height:${size}px;position:relative;cursor:pointer;
    transition:all 0.2s;will-change:transform;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));
  `;
  // Outer glow ring + ship body
  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- glow ring -->
      <circle cx="18" cy="18" r="16" fill="${color}" opacity="${isSelected ? '0.28' : '0.14'}" />
      <circle cx="18" cy="18" r="16" stroke="${color}" stroke-width="${isSelected ? '2' : '1.2'}" fill="none" opacity="0.7" />
      <!-- ship hull: narrow bow at top, wide stern -->
      <polygon points="18,4 25,28 18,24 11,28" fill="${color}" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
      <!-- bridge superstructure -->
      <rect x="15" y="14" width="6" height="5" rx="1" fill="white" opacity="0.85"/>
    </svg>
  `;
  return el;
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
  //   curLng, curLat, curHdg,   ← what's visually on screen right now
  //   tgtLng, tgtLat, tgtHdg,  ← server-authoritative target
  //   speed,                    ← knots (from server) for max-speed cap
  //   lastMs } }               ← performance.now() when target was last set
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

  // ── Build popup HTML ────────────────────────────────────────────────────────
  const popupHtml = useCallback((ship) => {
    const st = getStatus(ship.status);
    const fuelPct = Math.min(100, ((ship.fuel || 0) / 8500) * 100);
    const fuelBar = `<div style="height:4px;background:#FFFAF0;border-radius:2px;margin-top:4px"><div style="height:100%;width:${fuelPct}%;background:${fuelPct > 50 ? '#2e7d6e' : fuelPct > 20 ? '#c07c2b' : '#c0392b'};border-radius:2px"></div></div>`;
    const eta = ship.eta_seconds ? (() => {
      const h = Math.floor(ship.eta_seconds / 3600);
      const m = Math.floor((ship.eta_seconds % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    })() : '—';
    return `<div style="font-family:'Sora',sans-serif;min-width:200px;color:#2b3b49;padding:2px">
      <div style="font-weight:800;font-size:14px;margin-bottom:2px">${ship.name} <span style="font-size:10px;color:#81A6C6;font-weight:600">${ship.id}</span></div>
      <div style="font-size:10px;color:#81A6C6;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.1em">${ship.type || 'Cargo'} · ${ship.flag || '—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px">
        <div style="background:#FFFAF0;border-radius:7px;padding:6px 8px;border:1px solid #FFFAF0">
          <div style="font-size:9px;color:#81A6C6;text-transform:uppercase;font-weight:700;margin-bottom:1px">Speed</div>
          <div style="font-size:13px;font-weight:700;font-family:monospace">${ship.speed || 0} kn</div>
        </div>
        <div style="background:#FFFAF0;border-radius:7px;padding:6px 8px;border:1px solid #FFFAF0">
          <div style="font-size:9px;color:#81A6C6;text-transform:uppercase;font-weight:700;margin-bottom:1px">Heading</div>
          <div style="font-size:13px;font-weight:700;font-family:monospace">${Math.round(ship.heading || 0)}°</div>
        </div>
        <div style="background:#FFFAF0;border-radius:7px;padding:6px 8px;border:1px solid #FFFAF0">
          <div style="font-size:9px;color:#81A6C6;text-transform:uppercase;font-weight:700;margin-bottom:1px">Fuel</div>
          <div style="font-size:13px;font-weight:700;font-family:monospace">${ship.fuel?.toFixed(0) || 0}t</div>
          ${fuelBar}
        </div>
        <div style="background:#FFFAF0;border-radius:7px;padding:6px 8px;border:1px solid #FFFAF0">
          <div style="font-size:9px;color:#81A6C6;text-transform:uppercase;font-weight:700;margin-bottom:1px">ETA</div>
          <div style="font-size:13px;font-weight:700;font-family:monospace">${eta}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:11px;color:#5f6b77">→ <strong>${ship.destination_port}</strong></span>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${st.color}22;color:${st.color};border:1px solid ${st.color}44">${st.label}</span>
      </div>
      <div style="font-size:11px;color:#5f6b77">Cargo: <strong>${ship.cargo || '—'}</strong></div>
      ${!ship.can_reach_dest ? `<div style="margin-top:6px;padding:5px 8px;background:#fef0f0;border:1px solid #c0392b33;border-radius:6px;font-size:11px;color:#c0392b;font-weight:600">Insufficient fuel to reach ${ship.destination_port}</div>` : ''}
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

    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.current.addControl(new mapboxgl.ScaleControl({ unit: 'nautical' }), 'bottom-right');

    if (isCommand) {
      draw.current = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
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
        ],
      });
      map.current.addControl(draw.current, 'top-left');

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

      // Routes (live ship paths)
      map.current.addSource('routes-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.current.addLayer({
        id: 'routes-line', type: 'line', source: 'routes-src',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [4, 3] },
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
    map.current.getSource('routes-src')?.setData({
      type: 'FeatureCollection',
      features: ships
        .filter(s => s.route_path && s.route_path.length >= 2)
        .map(s => ({
          type: 'Feature',
          properties: { id: s.id, color: getStatus(s.status).color },
          geometry: {
            type: 'LineString',
            coordinates: [[s.lng, s.lat], ...s.route_path.map(([la, ln]) => [ln, la])]
          },
        })),
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
  // This effect ONLY updates the target position; the RAF loop does all movement.
  useEffect(() => {
    if (!map.current) return;

    const now = performance.now();

    ships.forEach(ship => {
      const st = getStatus(ship.status);
      const isSelected = ship.id === selectedShipId;
      const ref = ships$.current[ship.id];

      if (!ref) {
        // ── First time: spawn marker exactly at server position ───────────────
        const el = makeShipEl(st.color, isSelected);

        const popup = new mapboxgl.Popup({
          offset: 22, closeButton: true, closeOnClick: false,
          className: 'ship-popup', maxWidth: '280px',
        }).setHTML(popupHtml(ship));

        let pinned = false;

        el.addEventListener('mouseenter', () => {
          popup.setHTML(popupHtml(
            (ships$.current[ship.id] && ships$.current[ship.id]._lastShip) || ship
          ));
          if (!popup.isOpen()) popup.addTo(map.current);
        });

        el.addEventListener('mouseleave', () => {
          if (!pinned) popup.remove();
        });

        el.addEventListener('click', e => {
          e.stopPropagation();
          setSelectedShipId(ship.id);
          // un-pin all others
          Object.values(ships$.current).forEach(m => { m._pinned = false; });
          pinned = true;
          ships$.current[ship.id] && (ships$.current[ship.id]._pinned = true);
          Object.values(ships$.current).forEach(m => {
            if (m !== ships$.current[ship.id]) m.popup.remove();
          });
          popup.addTo(map.current);
        });

        const marker = new mapboxgl.Marker({
          element: el, rotationAlignment: 'map',
          pitchAlignment: 'map', anchor: 'center',
        })
          .setLngLat([ship.lng, ship.lat])
          .setRotation(ship.heading || 0)
          .addTo(map.current);

        ships$.current[ship.id] = {
          marker, popup, el,
          curLng: ship.lng, curLat: ship.lat, curHdg: ship.heading || 0,
          tgtLng: ship.lng, tgtLat: ship.lat, tgtHdg: ship.heading || 0,
          speed: ship.speed || 0,
          lastMs: now,
          _pinned: false,
          _lastShip: ship,
        };

      } else {
        // ── Subsequent tick: update target, keep cur as-is (RAF interpolates) ─
        ref.tgtLng = ship.lng;
        ref.tgtLat = ship.lat;
        ref.tgtHdg = ship.heading || 0;
        ref.speed = ship.speed || 0;
        ref.lastMs = now;
        ref._lastShip = ship;

        // Visual updates
        const svg = ref.el.querySelector('polygon');
        if (svg) svg.setAttribute('fill', st.color);
        ref.el.style.filter = isSelected
          ? 'drop-shadow(0 0 8px rgba(129,166,198,0.9))'
          : 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))';

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

  // ── RAF loop: smooth interpolation at 60 fps ────────────────────────────────
  useEffect(() => {
    let prevMs = performance.now();

    function frame(nowMs) {
      const dtSec = Math.min((nowMs - prevMs) / 1000, 0.1); // cap at 100 ms to survive tab-hide
      prevMs = nowMs;

      Object.values(ships$.current).forEach(ref => {
        // ── latitude / longitude ─────────────────────────────────────────────
        const dLat = ref.tgtLat - ref.curLat;
        const dLng = ref.tgtLng - ref.curLng;

        // Max degrees the ship can physically travel this frame
        const maxDelta = MAX_DEG_S * dtSec;

        // Step size: lerp coefficient = 8 gives ~95 % convergence in 0.375 s
        // but never exceed what the ship speed allows
        const stepLat = Math.max(-maxDelta, Math.min(maxDelta, dLat * 8 * dtSec));
        const stepLng = Math.max(-maxDelta, Math.min(maxDelta, dLng * 8 * dtSec));

        // If already very close, snap to avoid floating-point drift
        ref.curLat = Math.abs(dLat) < 1e-7 ? ref.tgtLat : ref.curLat + stepLat;
        ref.curLng = Math.abs(dLng) < 1e-7 ? ref.tgtLng : ref.curLng + stepLng;

        // ── heading ──────────────────────────────────────────────────────────
        const dHdg = shortAngleDiff(ref.curHdg, ref.tgtHdg);
        const stepHdg = dHdg * 5 * dtSec;           // 5 rad/s-equivalent convergence
        ref.curHdg = Math.abs(dHdg) < 0.1 ? ref.tgtHdg : ref.curHdg + stepHdg;

        ref.marker.setLngLat([ref.curLng, ref.curLat]).setRotation(ref.curHdg);
      });

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []); // stable — reads ships$.current live

  return (
    <>
      <style>{`
        .ship-popup .mapboxgl-popup-content {
          background:#ffffff !important;border:1px solid #FFFAF0 !important;
          border-radius:14px !important;padding:14px 16px !important;
          box-shadow:0 8px 28px rgba(43,59,73,0.18) !important;font-size:13px !important;
        }
        .ship-popup .mapboxgl-popup-tip { border-top-color:#ffffff !important; }
        .ship-popup .mapboxgl-popup-close-button {
          color:#81A6C6 !important;font-size:16px !important;top:6px !important;right:10px !important;
        }
        .mapboxgl-ctrl-group {
          background:#ffffff !important;border:1px solid #FFFAF0 !important;
          border-radius:10px !important;box-shadow:0 2px 8px rgba(43,59,73,0.12) !important;
        }
        .mapboxgl-ctrl-group button { background:#ffffff !important;color:#81A6C6 !important; }
        .mapboxgl-ctrl-group button:hover { background:#FFFAF0 !important; }
        .mapboxgl-ctrl-scale {
          background:rgba(255,255,255,0.9) !important;border-color:#FFFAF0 !important;
          color:#5f6b77 !important;border-radius:4px !important;font-size:10px !important;
        }
        .mapbox-gl-draw_ctrl-draw-btn { background-color:#ffffff !important; }
      `}</style>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </>
  );
}
