import { Walker } from './walker.js';
import { nativeFrame } from './quality.js';
import { createGrader } from './grade-gl.js';

function sourceSize(source) {
  return { sw: source.videoWidth || source.naturalWidth || source.width || 0, sh: source.videoHeight || source.naturalHeight || source.height || 0 };
}
function drawCover(ctx, source, width, height, mirrored) {
  const { sw, sh } = sourceSize(source);
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const cropW = width / scale;
  const cropH = height / scale;
  ctx.save();
  if (mirrored) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, (sw - cropW) / 2, (sh - cropH) / 2, cropW, cropH, 0, 0, width, height);
  ctx.restore();
}
function deviceScale(ctx) { const m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; }

function star(ctx, x, y, radius, lit) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? radius * .46 : radius;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.stroke();
  ctx.fillStyle = lit ? '#ffffff' : 'rgba(30,30,34,.55)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = lit ? '#ffffff' : 'rgba(235,235,235,.75)'; ctx.stroke();
}
function outlinedText(ctx, text, x, y, fill, outline, width) {
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.lineWidth = width; ctx.strokeStyle = outline; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
const HUD_FONT = "'Arial Black', 'Segoe UI Black', 'Helvetica Neue', Arial, sans-serif";

export class Scene {
  constructor(canvas, video, view, settings, radar) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: false });
    this.video = video;
    this.view = view;
    this.settings = settings;
    this.radar = radar;
    this.walker = new Walker((pace,time) => radar.city.setMotion(pace,time), state => radar.trackingState(state));
    this.mapButton = document.getElementById('mapZoom');
    this.safe = { top:0, left:0, bottom:0, right:0 };
    // Tamaño de trabajo en vivo: 1080p, baja a 720p si el equipo no da abasto.
    this.liveEdge = 1920; this.maxEdge = this.liveEdge; this.cost = 0; this.slow = 0;
    this.live = false;
    this.mirrored = false;
    this.locked = false;
    this.dirty = true;
    this.place = null; this.placeAt = -1e9;
    this.cash = 0;
    this.demo = new Image();
    this.demo.onload = () => this.resize();
    this.demo.src = 'assets/ocean-drive.webp';
    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    this.onFrame = this.onFrame.bind(this);
    this.useFrames = typeof video.requestVideoFrameCallback === 'function';
    this.frameRequest = 0;
    if (window.ResizeObserver) new ResizeObserver(this.resize).observe(view);
    window.addEventListener('resize', this.resize);
    video.addEventListener('resize', this.resize);
    this.request = 0;
    this.resize();
  }
  resize() {
    const { width, height } = this.view.getBoundingClientRect();
    if (!width || !height) return;
    this.box = { width, height };
    const css = getComputedStyle(this.view);
    this.safe = { top:parseFloat(css.paddingTop)||0, left:parseFloat(css.paddingLeft)||0, bottom:parseFloat(css.paddingBottom)||0, right:parseFloat(css.paddingRight)||0 };
    if (!this.locked) {
      const sourceW = this.live ? this.video.videoWidth : this.demo.naturalWidth || 1672;
      const sourceH = this.live ? this.video.videoHeight : this.demo.naturalHeight || 941;
      if (sourceW && sourceH) {
        // Nunca por debajo de la nitidez de la pantalla, nunca por encima de la cámara.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const frame = nativeFrame(width, height, Math.max(sourceW, width * dpr), Math.max(sourceH, height * dpr), this.maxEdge);
        if (frame.width !== this.canvas.width || frame.height !== this.canvas.height) {
          this.canvas.width = frame.width; this.canvas.height = frame.height;
          this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
          this.gradients = null;
        }
      }
    }
    this.invalidate();
  }
  invalidate() {
    this.dirty = true;
    if (!this.request) this.request = requestAnimationFrame(this.loop);
  }
  loop(time) {
    this.request = 0;
    if (!this.view.offsetWidth) return;
    const timed = this.live && !this.useFrames;
    if (this.dirty || (timed && time - (this.lastDraw || 0) >= 31)) {
      this.draw();
      this.lastDraw = time;
    }
    if (timed && !this.request) this.request = requestAnimationFrame(this.loop);
  }
  // Un dibujo por cada fotograma nuevo de la cámara: movimiento sin saltos.
  onFrame(now) {
    this.frameRequest = 0;
    if (!this.live) return;
    if (this.view.offsetWidth && now - (this.lastDraw || 0) >= 27) { this.draw(); this.lastDraw = now; }
    this.frameRequest = this.video.requestVideoFrameCallback(this.onFrame);
  }
  setLive(live, mirrored = false) {
    this.live = live; this.mirrored = mirrored;
    if (this.frameRequest) { this.video.cancelVideoFrameCallback?.(this.frameRequest); this.frameRequest = 0; }
    if (live && this.useFrames) this.frameRequest = this.video.requestVideoFrameCallback(this.onFrame);
    if (!live) { this.walker.stop(); this.radar.city.pause(); }
    else { this.placeKey = null; this.place = null; this.placeAt = -1e9; }
    this.resize(); this.invalidate();
  }
  makeGradients(ctx, w, h) {
    const sunset = ctx.createLinearGradient(0, 0, w * .9, h);
    sunset.addColorStop(0, '#ffac77'); sunset.addColorStop(.53, '#ed8b8a'); sunset.addColorStop(1, '#706c8d');
    const neon = ctx.createLinearGradient(0, h, w, 0);
    neon.addColorStop(0, '#ff4fba'); neon.addColorStop(.52, '#9558c3'); neon.addColorStop(1, '#4bd8dc');
    const shade = ctx.createLinearGradient(0, h * .63, 0, h);
    shade.addColorStop(0, 'rgba(16,12,25,0)'); shade.addColorStop(1, 'rgba(15,12,22,0.30)');
    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .35, w / 2, h / 2, Math.hypot(w, h) * .56);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.32)');
    return { sunset, neon, shade, vignette };
  }
  paint(ctx, source, w, h) {
    let graded = null;
    if (this.grader === undefined) this.grader = createGrader();
    if (this.grader && this.settings.strength) {
      try { graded = this.grader(source, w, h, this.mirrored, this.settings); }
      catch { this.grader = null; }
    }
    if (graded) ctx.drawImage(graded, 0, 0);
    else {
      drawCover(ctx, source, w, h, this.mirrored);
      const gradients = ctx === this.ctx ? (this.gradients ||= this.makeGradients(ctx, w, h)) : this.makeGradients(ctx, w, h);
      this.grade(ctx, w, h, gradients);
    }
  }
  draw() {
    const begin = performance.now();
    this.render();
    if (!this.live || this.locked) return;
    // Rendimiento adaptativo: si cada fotograma tarda demasiado, se reduce la resolución de trabajo.
    const spent = performance.now() - begin;
    this.cost = this.cost ? this.cost * .9 + spent * .1 : spent;
    if (this.cost > 20 && this.liveEdge > 1280 && ++this.slow > 45) {
      this.liveEdge = 1280; this.maxEdge = 1280; this.slow = 0; this.cost = 0; this.resize();
    } else if (this.cost <= 20) this.slow = 0;
  }
  render() {
    const { canvas, ctx } = this;
    const w = canvas.width, h = canvas.height;
    this.dirty = false;
    const now = performance.now();
    if (this.live && this.video.readyState >= 2 && this.video.videoWidth) this.paint(ctx, this.video, w, h);
    else if (!this.live && this.demo.complete && this.demo.naturalWidth) {
      drawCover(ctx, this.demo, w, h, false);
      this.grade(ctx, w, h, this.gradients ||= this.makeGradients(ctx, w, h));
    } else { ctx.fillStyle = '#201d24'; ctx.fillRect(0, 0, w, h); }
    if (this.live && this.settings.map && !this.radar.point && !document.hidden) {
      this.walker.start();
      this.walker.sample(this.video, w / h, now);
      this.radar.city.tick(now);
    } else {
      this.walker.stop();
      this.radar.city.pause();
    }
    this.hud(ctx, w, h, now, false);
  }
  // Foto a resolución completa del sensor con el mismo encuadre de la vista.
  renderStill(source) {
    const aspect = this.canvas.width / this.canvas.height;
    const { sw, sh } = sourceSize(source);
    let w = Math.min(sw, sh * aspect), h = w / aspect;
    const limit = Math.min(8192, this.grader?.maxEdge || 8192);
    const scale = Math.min(1, limit / Math.max(w, h), Math.sqrt(25e6 / (w * h)));
    const even = v => Math.max(2, 2 * Math.floor(v / 2));
    w = even(w * scale); h = even(h * scale);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    this.paint(ctx, source, w, h);
    this.hud(ctx, w, h, performance.now(), true);
    return out;
  }
  grade(ctx, w, h, gradients) {
    const { settings } = this;
    const strength = settings.strength / 100;
    if (!strength) return;
    ctx.save();
    if (settings.look === 'noir') {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = strength;
      ctx.fillStyle = '#777'; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = .25 * strength;
      ctx.fillStyle = '#515968'; ctx.fillRect(0, 0, w, h);
    } else if (settings.look !== 'natural') {
      const neon = settings.look === 'neon';
      ctx.globalAlpha = (neon ? .90 : .65) * strength;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = neon ? gradients.neon : gradients.sunset;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = (neon ? .42 : .10) * strength;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = (neon ? .09 : .10) * strength;
      ctx.fillStyle = neon ? '#79398b' : '#ce826b'; ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = strength;
    ctx.fillStyle = gradients.shade; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = gradients.vignette; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  hud(ctx, w, h, now, still) {
    const { settings, radar } = this;
    const portrait = h > w;
    const unit = portrait ? Math.min(w / 415, h / 450) : Math.min(w / 905, h / 455);
    const width = w / unit, height = h / unit;
    const margin = portrait ? 16 : 22;
    const mapW = portrait ? 140 : 172;
    const mapH = mapW * .63;
    const fit = !still && this.box ? Math.min(this.box.width / w, this.box.height / h) : 1;
    const insetScale = Math.max(.01, fit * unit);
    const safe = still ? { top:0, left:0, bottom:0, right:0 } : this.safe;
    const mapLeft = margin + safe.left / insetScale;
    const bottom = height - margin - safe.bottom / insetScale;
    const right = width - margin - safe.right / insetScale;
    const top = margin + safe.top / insetScale;
    ctx.save(); ctx.scale(unit, unit);
    const px = deviceScale(ctx);
    if (!still) this.mapButton.hidden = !settings.map;
    const mapTop = bottom - mapH - (settings.vitals ? 11 : 0);
    if (settings.map) {
      radar.draw(ctx, mapLeft, mapTop, mapW, mapH, now);
      if (!still && this.box) {
        const left = (this.box.width-w*fit)/2 + mapLeft*insetScale;
        const topPx = (this.box.height-h*fit)/2 + mapTop*insetScale;
        const bounds = 'left:'+left.toFixed(2)+'px;top:'+topPx.toFixed(2)+'px;width:'+(mapW*insetScale).toFixed(2)+'px;height:'+(mapH*insetScale).toFixed(2)+'px';
        if (bounds !== this.mapBounds) { this.mapButton.style.cssText = bounds; this.mapBounds = bounds; }
      }
      if (radar.hasStreets) {
        ctx.save();
        ctx.font = 'bold ' + (portrait ? '10.5' : '10') + 'px Arial, sans-serif';
        const credit = '© OpenStreetMap contributors';
        ctx.fillStyle = 'rgba(14,15,19,.82)';
        ctx.fillRect(mapLeft - 2, mapTop - 18, ctx.measureText(credit).width + 9, 14);
        ctx.fillStyle = '#fff'; ctx.fillText(credit, mapLeft + 2, mapTop - 7.5);
        ctx.restore();
      }
    }
    if (settings.vitals) {
      // Salud (verde) y blindaje (azul) bajo el radar.
      const y = bottom - 7, half = (mapW - 3) / 2;
      ctx.fillStyle = 'rgba(10,10,13,.9)'; ctx.fillRect(mapLeft - 2.5, y - 2, mapW + 5, 9);
      ctx.fillStyle = '#2f4d36'; ctx.fillRect(mapLeft, y, half, 5);
      const health = ctx.createLinearGradient(0, y, 0, y + 5);
      health.addColorStop(0, '#8fe08f'); health.addColorStop(1, '#4f9a5a');
      ctx.fillStyle = health; ctx.fillRect(mapLeft, y, half * .94, 5);
      ctx.fillStyle = '#2c4250'; ctx.fillRect(mapLeft + half + 3, y, half, 5);
      const armor = ctx.createLinearGradient(0, y, 0, y + 5);
      armor.addColorStop(0, '#8fd3f0'); armor.addColorStop(1, '#3f8db5');
      ctx.fillStyle = armor; ctx.fillRect(mapLeft + half + 3, y, half * .78, 5);
    }
    let rightTop = top;
    if (settings.stars) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 4 * px;
      for (let i = 0; i < 5; i++) star(ctx, right - 9 - (4 - i) * 20, top + 9, 8.6, i < 2);
      ctx.restore();
      rightTop += 24;
    }
    if (settings.money !== false) {
      // El dinero sube con la distancia recorrida.
      const goal = 1250 + Math.floor(radar.city.travel * 4);
      this.cash = !this.cash || !this.live ? goal : this.cash < goal ? Math.min(goal, this.cash + Math.max(1, Math.ceil((goal - this.cash) * .2))) : goal;
      ctx.save();
      ctx.font = 'italic 900 ' + (portrait ? 21 : 23) + 'px ' + HUD_FONT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 5 * px;
      outlinedText(ctx, '$' + this.cash.toLocaleString('en-US'), right, rightTop + 2, '#7ad27a', '#0d1a0e', 4);
      ctx.restore();
    }
    // Zona y calle: aparecen unos segundos al cambiar, como en los juegos.
    const place = settings.map && settings.money !== false ? radar.location() : null;
    const key = place ? place.district + '|' + place.street : '';
    if (key !== this.placeKey) { this.placeKey = key; this.place = place; this.placeAt = place ? now : -1e9; }
    const age = (now - this.placeAt) / 1000;
    if (this.place && age < 6) {
      const alpha = Math.min(1, age / .45, (6 - age) / .9);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6 * px;
      const slide = (1 - Math.min(1, age / .45)) * 12;
      ctx.font = 'italic 900 ' + (portrait ? 20 : 25) + 'px ' + HUD_FONT;
      outlinedText(ctx, this.place.district, right + slide, bottom - 20, '#ffffff', '#111', 4);
      ctx.font = 'bold ' + (portrait ? 12 : 14) + 'px Arial, sans-serif';
      outlinedText(ctx, this.place.street.toUpperCase(), right + slide, bottom - 2, '#e9e3ea', '#111', 3);
      ctx.restore();
    }
    ctx.restore();
  }
}
