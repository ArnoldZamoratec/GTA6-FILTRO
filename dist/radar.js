import { CityMap, edgePoint, radarCenter } from './city-map.js';

const tileSize = 256;
const baseZoom = 17;
const world = tileSize * 2 ** baseZoom;
const TILT = .8;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

function project(latitude, longitude) {
  const lat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const sine = Math.sin(lat * Math.PI / 180);
  return {
    x: (longitude + 180) / 360 * world,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world
  };
}
function relativeX(x, center) {
  return ((x - center + world * 1.5) % world) - world / 2;
}
// Flecha del jugador al estilo de los juegos de mundo abierto.
function triangle(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const m = ctx.getTransform();
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = 3 * Math.hypot(m.a, m.b);
  ctx.beginPath();
  ctx.moveTo(0, -8.5); ctx.lineTo(6, 6.5); ctx.lineTo(0, 3.6); ctx.lineTo(-6, 6.5); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#1d1e24'; ctx.stroke();
  ctx.restore();
}
function plate(ctx, text, x, y, right = false) {
  ctx.font = 'bold 8.5px Arial, sans-serif';
  const width = ctx.measureText(text).width + 7;
  if (right) x -= width;
  ctx.fillStyle = 'rgba(14,15,19,.82)';
  roundRect(ctx, x, y, width, 12, 3); ctx.fill();
  ctx.fillStyle = '#fbfbfc'; ctx.fillText(text, x + 3.5, y + 9);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export class Radar {
  constructor(onChange, onError) {
    this.onChange = onChange;
    this.onError = onError;
    this.city = new CityMap();
    this.zoomIndex = 0;
    this.walkState = 'off';
    this.watch = null;
    this.generation = 0;
    this.active = false;
    this.point = null;
    this.shown = null;
    this.cam = 0;
    this.trail = [];
    this.heading = null;
    this.tiles = new Map();
    this.visible = [];
    this.hasStreets = false;
    this.lastDraw = null;
    this.darkTiles = (() => { try { const c = document.createElement('canvas').getContext('2d'); return 'filter' in c; } catch { return false; } })();
  }
  changeZoom() {
    this.zoomIndex = (this.zoomIndex + 1) % 3;
    if (this.point) this.loadVisibleTiles();
    this.onChange();
  }
  trackingState(state) {
    this.walkState = state;
    this.onChange();
  }
  location() {
    return this.point ? null : this.city.location();
  }
  start() {
    if (this.active) return;
    if (!navigator.geolocation) {
      this.onError('Este navegador no ofrece ubicación. Puedes usar el mapa ficticio.');
      return;
    }
    this.active = true;
    const version = ++this.generation;
    this.onChange();
    try {
      this.watch = navigator.geolocation.watchPosition(position => {
        if (version !== this.generation) return;
        const coords = position.coords;
        const next = project(coords.latitude, coords.longitude);
        const prior = this.trail.at(-1);
        const dx = prior ? relativeX(next.x, prior.x) : 0;
        const dy = prior ? next.y - prior.y : 0;
        const metersPerPixel = Math.cos(coords.latitude * Math.PI / 180) * 40075016.69 / world;
        const movement = Math.hypot(dx, dy) * Math.max(0.08, metersPerPixel);
        if (Number.isFinite(coords.heading) && (coords.speed ?? 1) > .4) this.heading = coords.heading * Math.PI / 180;
        else if (prior && movement > Math.max(6, Math.min(40, coords.accuracy || 10))) this.heading = Math.atan2(dx, -dy);
        if (!prior || movement > Math.max(3, Math.min(22, (coords.accuracy || 10) / 2))) {
          this.trail.push(next);
          if (this.trail.length > 220) this.trail.shift();
        }
        // Ignora el temblor del GPS en reposo.
        if (!this.point || this.trail.at(-1) === next) this.point = next;
        if (!this.shown) this.shown = { ...this.point };
        this.loadVisibleTiles();
        this.onChange();
      }, error => {
        if (version !== this.generation) return;
        if (this.point && error.code !== 1) return;
        this.stop();
        this.onError(error.code === 1 ? 'La ubicación está desactivada. Permite el acceso al GPS en el navegador para ver tus calles.' : 'No se pudo obtener tu ubicación. Puedes volver a pulsar «Usar GPS».');
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 18000 });
    } catch {
      this.stop();
      this.onError('No se pudo abrir el GPS. Puedes seguir con el mapa ficticio.');
    }
  }
  stop() {
    ++this.generation;
    if (this.watch !== null) navigator.geolocation?.clearWatch(this.watch);
    this.watch = null; this.active = false; this.point = null; this.shown = null;
    this.heading = null; this.trail = []; this.visible = [];
    this.tiles.clear(); this.hasStreets = false;
    this.onChange();
  }
  loadVisibleTiles() {
    const factor = 2 ** this.zoomIndex;
    const zoom = baseZoom + this.zoomIndex;
    const p = { x: this.point.x * factor, y: this.point.y * factor };
    // El mapa gira con la marcha: se cargan las teselas de todo el círculo.
    const reach = 165;
    const x0 = Math.floor((p.x - reach) / tileSize);
    const x1 = Math.floor((p.x + reach) / tileSize);
    const y0 = Math.max(0, Math.floor((p.y - reach) / tileSize));
    const y1 = Math.min(2 ** zoom - 1, Math.floor((p.y + reach) / tileSize));
    this.visible = [];
    for (let row = y0; row <= y1; row++) {
      for (let col = x0; col <= x1; col++) {
        const key = zoom + '/' + col + '/' + row;
        let tile = this.tiles.get(key);
        if (!tile || (tile.failedAt && Date.now() - tile.failedAt > 60000)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.referrerPolicy = 'strict-origin-when-cross-origin';
          tile = { img, loaded: false, failedAt: 0 };
          this.tiles.set(key, tile);
          const version = this.generation;
          img.onload = () => {
            if (version !== this.generation) return;
            tile.loaded = true;
            this.hasStreets = this.visible.some(part => part.tile.loaded);
            this.onChange();
          };
          img.onerror = () => {
            if (version !== this.generation) return;
            tile.failedAt = Date.now();
            this.onChange();
          };
          const x = ((col % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
          img.src = 'https://tile.openstreetmap.org/' + zoom + '/' + x + '/' + row + '.png';
        }
        this.visible.push({ tile, col, row, key });
      }
    }
    this.hasStreets = this.visible.some(part => part.tile.loaded);
    if (this.tiles.size > 48) {
      const current = new Set(this.visible.map(item => item.key));
      for (const key of this.tiles.keys()) {
        if (!current.has(key)) this.tiles.delete(key);
        if (this.tiles.size <= 32) break;
      }
    }
  }
  draw(ctx, x, y, width, height, now = performance.now()) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(width / 200, height / 126);
    // Marco con sombra suave.
    ctx.save();
    const m = ctx.getTransform(), px = Math.hypot(m.a, m.b);
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8 * px; ctx.shadowOffsetY = 2 * px;
    roundRect(ctx, -2.5, -2.5, 205, 131, 7); ctx.fillStyle = 'rgba(10,10,13,.92)'; ctx.fill();
    ctx.restore();
    roundRect(ctx, 0, 0, 200, 126, 5); ctx.clip();
    ctx.fillStyle = '#2a5f78'; ctx.fillRect(0, 0, 200, 126);
    if (this.point) {
      this.drawGps(ctx, now);
      plate(ctx, this.hasStreets ? 'GPS' : 'TRAZA GPS', 196, 4, true);
    } else {
      this.city.draw(ctx, 2 ** this.zoomIndex, triangle, now);
      if (this.zoomIndex) plate(ctx, (2 ** this.zoomIndex) + '×', 196, 4, true);
    }
    // Viñeta interior para dar profundidad.
    const vignette = ctx.createRadialGradient(100, 70, 40, 100, 70, 125);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, 200, 126);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y); ctx.scale(width / 200, height / 126);
    roundRect(ctx, 0, 0, 200, 126, 5); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.stroke();
    ctx.restore();
  }
  drawGps(ctx, now) {
    const dt = this.lastDraw === null ? 0 : Math.min(.25, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    // Deslizamiento suave entre lecturas del GPS.
    const k = 1 - Math.exp(-2.6 * dt);
    if (!this.shown) this.shown = { ...this.point };
    this.shown.x += relativeX(this.point.x, this.shown.x) * k;
    this.shown.y += (this.point.y - this.shown.y) * k;
    if (this.heading !== null) this.cam += wrapAngle(this.heading - this.cam) * (1 - Math.exp(-3 * dt));
    const factor = 2 ** this.zoomIndex;
    const p = { x: this.shown.x * factor, y: this.shown.y * factor };
    const { x: CX, y: CY } = radarCenter;
    ctx.save();
    ctx.translate(CX, CY); ctx.scale(1, TILT); ctx.rotate(-this.cam);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let gx = -192 - (p.x % 24); gx < 192; gx += 24) { ctx.moveTo(gx, -192); ctx.lineTo(gx, 192); }
    for (let gy = -192 - (p.y % 24); gy < 192; gy += 24) { ctx.moveTo(-192, gy); ctx.lineTo(192, gy); }
    ctx.stroke();
    // Teselas de OpenStreetMap en modo oscuro (agua azul, calles claras).
    if (this.darkTiles) ctx.filter = 'invert(1) hue-rotate(180deg) saturate(.75) brightness(.9) contrast(1.05)';
    for (const { tile, col, row } of this.visible) {
      if (tile.loaded) ctx.drawImage(tile.img, col * tileSize - p.x, row * tileSize - p.y, tileSize + .5, tileSize + .5);
    }
    ctx.filter = 'none';
    if (this.trail.length > 1) {
      ctx.beginPath();
      this.trail.forEach((pos, i) => {
        const px = relativeX(pos.x, this.shown.x) * factor;
        const py = (pos.y - this.shown.y) * factor;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#3a1440'; ctx.stroke();
      ctx.lineWidth = 3.6; ctx.strokeStyle = '#d64fc8'; ctx.stroke();
    }
    ctx.restore();
    const north = edgePoint(-Math.sin(this.cam), -Math.cos(this.cam) * TILT, 8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.beginPath(); ctx.arc(north.x, north.y, 5.4, 0, Math.PI * 2);
    ctx.fillStyle = '#16171b'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#e8e8e8'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 6.4px Arial, sans-serif'; ctx.fillText('N', north.x, north.y + .4);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    if (this.heading !== null) triangle(ctx, CX, CY, wrapAngle(this.heading - this.cam));
    else {
      const pulse = 5 + Math.sin(now / 300);
      ctx.beginPath(); ctx.arc(CX, CY, pulse + 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(214,79,200,.25)'; ctx.fill();
      ctx.beginPath(); ctx.arc(CX, CY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#d64fc8'; ctx.fill(); ctx.lineWidth = 2.1; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
}
