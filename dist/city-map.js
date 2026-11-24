// Ciudad costera ficticia para el minimapa estilo GTA: tierra firme con
// cuadrícula, bahía con puentes, isla de playa y océano. El mapa gira para que
// la dirección de la marcha quede siempre hacia arriba, con una ligera
// inclinación de perspectiva, y se desplaza con el ritmo de los pasos.

const FRAME_W = 200, FRAME_H = 126;
const CX = 100, CY = 84;          // Jugador algo por debajo del centro.
const TILT = .8;                   // Achatamiento vertical (perspectiva).

const bayWest = y => 196 + 10 * Math.sin(y / 70) + 6 * Math.cos(y / 45);
const bayEast = y => 252 + 8 * Math.sin(y / 60 + 1);
const shore = y => 352 + 10 * Math.sin(y / 55) + 6 * Math.cos(y / 90);
const Y0 = -640, Y1 = 680, XW = -640;

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const hash = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };

// Recorrido cerrado por calles reales del mapa (incluye dos puentes y la playa).
const corners = [[40,240],[40,80],[322,80],[322,-160],[120,-160],[120,-320],[-120,-320],[-120,0],[-200,0],[-200,240]]
  .map(([x, y]) => ({ x, y }));
const streetNames = ['Flamingo Ave', 'Sunrise Causeway', 'Ocean Drive', 'Starfish Causeway', 'Bayshore Blvd',
  'Coral Way', 'Palm Avenue', 'Harbor Street', 'Mango Avenue', 'Lagoon Street'];

function makeRoute(points) {
  const path = [];
  points.forEach((corner, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const before = mix(corner, prev, 10 / dist(corner, prev));
    const after = mix(corner, next, 10 / dist(corner, next));
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      path.push({ ...mix(mix(before, corner, t), mix(corner, after, t), t), segment: t < .5 ? (i + points.length - 1) % points.length : i });
    }
  });
  path.push({ ...path[0] });
  let d = 0;
  return path.map((p, i) => { if (i) d += dist(p, path[i - 1]); return { ...p, distance: d }; });
}
const route = makeRoute(corners);
export const routeLength = route.at(-1).distance;

export function alongRoute(distance) {
  const d = (distance % routeLength + routeLength) % routeLength;
  let low = 1, high = route.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (route[mid].distance < d) low = mid + 1; else high = mid;
  }
  const a = route[low - 1], b = route[low];
  const p = mix(a, b, (d - a.distance) / (b.distance - a.distance || 1));
  return { ...p, segment: a.segment, heading: Math.atan2(b.x - a.x, a.y - b.y) };
}
function routeSection(from, to, spacing) {
  const path = new Path2D();
  const a = alongRoute(from); path.moveTo(a.x, a.y);
  for (let d = from + spacing; d < to; d += spacing) { const p = alongRoute(d); path.lineTo(p.x, p.y); }
  const b = alongRoute(to); path.lineTo(b.x, b.y);
  return path;
}

export function districtAt(x, y) {
  if (x > bayEast(y) - 2) return 'Ocean Beach';
  if (x > bayWest(y) - 2) return 'Bahía Azul';
  if (y < -200) return 'Palm Heights';
  if (x > -40 && y < 140) return 'Downtown';
  if (x <= -40 && y < 140) return 'Little Havana';
  return 'Coral Gardens';
}

function edgePath(fn, offset = 0) {
  const p = new Path2D();
  for (let y = Y0; y <= Y1; y += 6) { const x = fn(y) + offset; if (y === Y0) p.moveTo(x, y); else p.lineTo(x, y); }
  return p;
}
function band(left, right) {
  const p = new Path2D();
  for (let y = Y0; y <= Y1; y += 6) { const x = left(y); if (y === Y0) p.moveTo(x, y); else p.lineTo(x, y); }
  for (let y = Y1; y >= Y0; y -= 6) p.lineTo(right(y), y);
  p.closePath();
  return p;
}

function cityGeometry() {
  const g = {
    mainland: band(() => XW, bayWest),
    island: band(bayEast, shore),
    beach: band(y => shore(y) - 18, shore),
    coastWest: edgePath(bayWest), coastIsland: edgePath(bayEast), coastOcean: edgePath(shore),
    surf: edgePath(shore, 3),
    blocks: new Path2D(), shadows: new Path2D(), roofs: [new Path2D(), new Path2D(), new Path2D()],
    parks: new Path2D(), trees: new Path2D(), pools: new Path2D(),
    streets: new Path2D(), avenues: new Path2D(), highway: new Path2D(), bridges: new Path2D(),
    islandRoads: new Path2D(), piers: new Path2D(), palms: new Path2D(), rail: new Path2D()
  };
  const G = 40;
  // Tierra firme: manzanas con edificios de distintas alturas (la sombra
  // desplazada sugiere el volumen).
  for (let row = -16; row <= 17; row++) {
    for (let col = -16; col <= 5; col++) {
      const x = col * G, y = row * G, n = hash(col, row);
      if (x + G > bayWest(y + G / 2) - 4) continue;
      g.blocks.rect(x + 4, y + 4, G - 8, G - 8);
      if (n < .09 || (col === -2 && row === 3) || (col === 1 && row === -6)) {
        g.parks.rect(x + 5, y + 5, G - 10, G - 10);
        for (let k = 0; k < 7; k++) {
          const tx = x + 9 + hash(col + k, row) * (G - 18), ty = y + 9 + hash(row + k, col) * (G - 18);
          g.trees.moveTo(tx + 1.8, ty); g.trees.arc(tx, ty, 1.8, 0, Math.PI * 2);
        }
        continue;
      }
      const tall = (Math.abs(col) < 3 && row > -6 && row < 4) ? 2.6 : 1.2;   // Rascacielos en el centro.
      const parts = 2 + Math.floor(n * 3);
      for (let k = 0; k < parts; k++) {
        const a = hash(col * 3 + k, row * 5 - k), b = hash(row * 7 + k, col * 2 + k);
        const w = 9 + a * 13, h = 8 + b * 13;
        const bx = x + 6 + (k % 2) * (G - 12 - w), by = y + 6 + (k > 1 ? G - 12 - h : (k === 0 ? 0 : (G - 12 - h) * .1));
        const lift = tall * (1 + a * 1.6);
        g.shadows.rect(bx + lift, by + lift, w, h);
        g.roofs[Math.floor(b * 3)].rect(bx, by, w, h);
        if (a > .82) g.pools.rect(bx + 2, by + 2, Math.min(5, w - 4), Math.min(3.5, h - 4));
      }
    }
  }
  for (let row = -16; row <= 17; row++) {
    const y = row * G, end = bayWest(y);
    (row % 3 === 0 ? g.avenues : g.streets).moveTo(XW, y);
    (row % 3 === 0 ? g.avenues : g.streets).lineTo(end, y);
  }
  for (let col = -16; col <= 5; col++) {
    const x = col * G, road = col % 3 === 0 ? g.avenues : g.streets;
    road.moveTo(x, Y0); road.lineTo(x, Y1);
  }
  // Autopista elevada que cruza la ciudad.
  g.highway.moveTo(XW, -300);
  g.highway.bezierCurveTo(-360, -280, -270, -180, -268, -40);
  g.highway.bezierCurveTo(-266, 120, -300, 300, -420, 430);
  g.highway.bezierCurveTo(-480, 500, -560, 560, XW, 600);
  g.highway.moveTo(-268, -40); g.highway.bezierCurveTo(-180, -60, -90, -122, 0, -124);
  g.rail.moveTo(-440, Y0); g.rail.bezierCurveTo(-430, -200, -400, 100, -470, Y1);
  // Puentes sobre la bahía.
  for (const y of [-160, 80, 400]) { g.bridges.moveTo(bayWest(y) - 8, y); g.bridges.lineTo(bayEast(y) + 8, y); }
  // Isla: Collins al oeste y Ocean Drive frente a la playa.
  g.islandRoads.moveTo(286, Y0); g.islandRoads.lineTo(286, Y1);
  g.islandRoads.moveTo(322, Y0); g.islandRoads.lineTo(322, Y1);
  for (let y = -600; y <= 640; y += 40) { g.islandRoads.moveTo(bayEast(y), y); g.islandRoads.lineTo(330, y); }
  for (let y = -600; y < 640; y += 40) {
    const n = hash(y, 9);
    for (const [x0, x1] of [[bayEast(y + 20) + 4, 282], [290, 318]]) {
      if (x1 - x0 < 6) continue;
      const w = x1 - x0, h = 14 + n * 10;
      g.shadows.rect(x0 + 2.6, y + 6 + 2.6, w, h);
      g.roofs[(Math.floor(n * 10) + (x0 > 288 ? 1 : 0)) % 3].rect(x0, y + 6, w, h);
      if (x0 > 288 && n > .4) g.pools.rect(x0 + 4, y + 26, 8, 4);
    }
    g.piers.moveTo(bayWest(y + 20), y + 20); g.piers.lineTo(bayWest(y + 20) + 12, y + 20);
  }
  for (let y = Y0; y < Y1; y += 11) {
    const x = shore(y) - 22;
    g.palms.moveTo(x + 1.6, y); g.palms.arc(x, y, 1.6, 0, Math.PI * 2);
  }
  return g;
}

const blips = [
  { x: 300, y: -40, glyph: '$', color: '#6fbf73' },
  { x: -40, y: 120, glyph: 'R', color: '#5aa7e0' },
  { x: 160, y: -280, glyph: '+', color: '#e2565b' },
  { x: -160, y: -200, glyph: 'G', color: '#e8a33c' },
  { x: 340, y: 200, glyph: '☀', color: '#f2c84b' },
  { x: -240, y: 120, glyph: 'C', color: '#b06ce0' },
  { x: 80, y: 40, glyph: '☕', color: '#c98a5a' }
];

function stroke(ctx, path, color, width) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(path); }
function fill(ctx, path, color) { ctx.fillStyle = color; ctx.fill(path); }

export class CityMap {
  constructor() {
    this.geometry = cityGeometry();
    this.travel = 0; this.speed = 0; this.target = 0; this.motionAt = 0; this.lastTick = null;
    const start = alongRoute(13);
    this.camHeading = start.heading;
    this.zoomFactor = 1.12;
  }
  setMotion(pace, now) {
    // El detector devuelve un ritmo en unidades por segundo; se modera para
    // que el avance por las manzanas se sienta como una caminata real.
    this.target = pace * .62; this.motionAt = now;
    if (!pace) this.target = 0;
  }
  pause() { this.target = 0; this.speed = 0; this.motionAt = 0; this.lastTick = null; }
  tick(now) {
    const dt = this.lastTick === null ? 0 : Math.min(.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const goal = this.target && now - this.motionAt <= 520 ? this.target : 0;
    // Aceleración y frenado suaves, como un personaje que empieza a andar.
    this.speed += (goal - this.speed) * (1 - Math.exp(-(goal > this.speed ? 5 : 7) * dt));
    if (this.speed < .05) this.speed = goal ? this.speed : 0;
    this.travel += this.speed * dt;
    const pos = alongRoute(13 + this.travel);
    this.camHeading += wrapAngle(pos.heading - this.camHeading) * (1 - Math.exp(-3.2 * dt));
    const zoomGoal = 1.12 - .16 * Math.min(1, this.speed / 18);
    this.zoomFactor += (zoomGoal - this.zoomFactor) * (1 - Math.exp(-1.5 * dt));
  }
  location() {
    const pos = alongRoute(13 + this.travel);
    return { street: streetNames[pos.segment] || '', district: districtAt(pos.x, pos.y) };
  }
  toScreen(p, pos, z) {
    const c = Math.cos(this.camHeading), s = Math.sin(this.camHeading);
    const rx = p.x - pos.x, ry = p.y - pos.y;
    return { x: CX + (rx * c + ry * s) * z, y: CY + (-rx * s + ry * c) * z * TILT };
  }
  draw(ctx, zoom, drawArrow, now = performance.now()) {
    const g = this.geometry;
    const distance = 13 + this.travel;
    const pos = alongRoute(distance);
    const z = zoom * this.zoomFactor;
    // Agua con degradado de profundidad.
    const water = ctx.createLinearGradient(0, 0, 0, FRAME_H);
    water.addColorStop(0, '#24566f'); water.addColorStop(1, '#2d6c86');
    ctx.fillStyle = water; ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    ctx.save();
    ctx.translate(CX, CY); ctx.scale(z, z * TILT); ctx.rotate(-this.camHeading); ctx.translate(-pos.x, -pos.y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // Aguas poco profundas junto a la costa.
    for (const coast of [g.coastWest, g.coastIsland]) stroke(ctx, coast, '#3b8aa3', 12);
    stroke(ctx, g.coastOcean, '#3f95ad', 18);
    stroke(ctx, g.surf, '#9fd8df', 1.3);
    fill(ctx, g.mainland, '#3a3d44');
    fill(ctx, g.island, '#3d4047');
    fill(ctx, g.beach, '#cdb47d');
    stroke(ctx, g.piers, '#8b8f94', 2.2);
    ctx.save(); ctx.clip(g.mainland);
    fill(ctx, g.blocks, '#43464e');
    fill(ctx, g.parks, '#3f6b4b'); fill(ctx, g.trees, '#5f9a5c');
    stroke(ctx, g.rail, '#2b2d32', 3.4); stroke(ctx, g.rail, '#6d6f75', 1);
    ctx.restore();
    fill(ctx, g.shadows, 'rgba(15,16,20,.55)');
    g.roofs.forEach((path, i) => fill(ctx, path, ['#575a63', '#62656e', '#6c6f78'][i]));
    fill(ctx, g.pools, '#5fd0e0');
    fill(ctx, g.palms, '#5d9a4f');
    ctx.save(); ctx.clip(g.mainland);
    stroke(ctx, g.streets, '#26282d', 6); stroke(ctx, g.streets, '#8d9098', 3.6);
    stroke(ctx, g.avenues, '#23252a', 9); stroke(ctx, g.avenues, '#b4b7be', 6);
    ctx.restore();
    ctx.save(); ctx.clip(g.island);
    stroke(ctx, g.islandRoads, '#26282d', 6.5); stroke(ctx, g.islandRoads, '#a6a9b0', 4);
    ctx.restore();
    stroke(ctx, g.bridges, '#1e2025', 9.5); stroke(ctx, g.bridges, '#bfc2c8', 6.4);
    stroke(ctx, g.highway, '#1d1e22', 12); stroke(ctx, g.highway, '#cdb76e', 8.4); stroke(ctx, g.highway, '#e9d79a', 1.2);
    // Rastro recorrido y ruta GPS por delante.
    if (this.travel > 1) stroke(ctx, routeSection(distance - Math.min(80, this.travel), distance, 2.5), 'rgba(140,220,214,.75)', 3.2 / zoom);
    const ahead = routeSection(distance, distance + 260 / zoom, 2.5);
    stroke(ctx, ahead, '#3a1440', 7.2 / zoom);
    stroke(ctx, ahead, '#d64fc8', 4.4 / zoom);
    ctx.restore();

    // Iconos de lugares (tamaño fijo, siempre derechos).
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const blip of blips) {
      const p = this.toScreen(blip, pos, z);
      if (p.x < -6 || p.x > FRAME_W + 6 || p.y < -6 || p.y > FRAME_H + 6) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = '#16171b'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.3, 0, Math.PI * 2);
      ctx.fillStyle = blip.color; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 6px Arial, sans-serif';
      ctx.fillText(blip.glyph, p.x, p.y + .3);
    }
    // Destino: punto de ruta sujeto al borde cuando sale del radar.
    const waypoint = alongRoute(distance + Math.max(180, 300 / zoom));
    let w = this.toScreen(waypoint, pos, z);
    const inside = w.x > 8 && w.x < FRAME_W - 8 && w.y > 8 && w.y < FRAME_H - 8;
    if (!inside) w = edgePoint(w.x - CX, w.y - CY, 8);
    const pulse = 1 + .12 * Math.sin(now / 260);
    ctx.save(); ctx.translate(w.x, w.y); ctx.scale(pulse, pulse);
    ctx.beginPath(); ctx.moveTo(0, -5.5); ctx.lineTo(4.5, 0); ctx.lineTo(0, 5.5); ctx.lineTo(-4.5, 0); ctx.closePath();
    ctx.fillStyle = '#f2a6e6'; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = '#3a1440'; ctx.stroke();
    ctx.restore();
    // Norte: gira con el mapa sobre el borde del radar.
    const north = edgePoint(-Math.sin(this.camHeading), -Math.cos(this.camHeading) * TILT, 8);
    ctx.beginPath(); ctx.arc(north.x, north.y, 5.4, 0, Math.PI * 2);
    ctx.fillStyle = '#16171b'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#e8e8e8'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 6.4px Arial, sans-serif'; ctx.fillText('N', north.x, north.y + .4);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    drawArrow(ctx, CX, CY, wrapAngle(pos.heading - this.camHeading));
  }
}

// Punto del borde del radar en la dirección (dx, dy) desde el jugador.
export function edgePoint(dx, dy, inset) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tx = ux > 0 ? (FRAME_W - inset - CX) / ux : ux < 0 ? (inset - CX) / ux : Infinity;
  const ty = uy > 0 ? (FRAME_H - inset - CY) / uy : uy < 0 ? (inset - CY) / uy : Infinity;
  const t = Math.min(tx, ty);
  return { x: CX + ux * t, y: CY + uy * t };
}
export const radarCenter = { x: CX, y: CY };
