import { Scene } from './scene.js';
import { Radar } from './radar.js';
import { Gallery } from './gallery.js';
import { videoRate } from './quality.js';

const $ = id => document.getElementById(id);
const video = $('sourceVideo');
const canvas = $('screen');
const looks = ['sunset', 'neon', 'noir', 'natural'];
const lookNames = { sunset: 'Atardecer', neon: 'Neón', noir: 'Noir', natural: 'Natural' };
const defaults = { look: 'sunset', strength: 70, map: true, vitals: true, stars: true, money: true };
const settings = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem('vicelens-ajustes') || '{}');
  if (looks.includes(saved.look)) settings.look = saved.look;
  if (Number.isFinite(saved.strength)) settings.strength = Math.min(100, Math.max(0, saved.strength));
  for (const key of ['map', 'vitals', 'stars', 'money']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
} catch { /* Browser storage is optional. */ }

let scene;
let stream = null;
let microphone = null;
let cameraVersion = 0;
let micVersion = 0;
let cameraPending = false;
let micPending = false;
let pendingCapture = false;
let captureVersion = 0;
let facing = 'environment';
let mode = 'video';
let recording = null;
let toastTimer;
let selectedTake = null;
let takeUrl = '';
let galleryUrls = [];
const gallery = new Gallery();
const walkStates = {
  off: 'Recorrido virtual con tus pasos',
  loading: 'Preparando seguimiento…',
  search: 'Encuadra las piernas y los pies',
  still: 'Persona en cuadro · En pausa',
  walking: 'Siguiendo los pasos',
  unavailable: 'Seguimiento visual no disponible'
};
const radar = new Radar(() => {
  $('gps').textContent = radar.active ? 'Quitar GPS' : 'Usar GPS';
  $('gps').setAttribute('aria-pressed', String(radar.active));
  $('mapState').textContent = radar.point
    ? (radar.hasStreets ? 'Calles de tu ubicación' : 'Traza de tu ubicación')
    : (radar.active ? 'Buscando ubicación…' : walkStates[radar.walkState]);
  const zoom = 2 ** radar.zoomIndex;
  const zoomLabel = 'Cambiar zoom del minimapa. Actual ' + zoom + '×';
  $('mapZoom').setAttribute('aria-label', zoomLabel);
  $('mapZoom').title = zoomLabel;
  const hint = radar.walkState === 'loading' ? 'Preparando minimapa…' : radar.walkState === 'search' ? 'Encuadra las piernas y los pies' : radar.walkState === 'unavailable' ? 'Seguimiento no disponible. Puedes usar GPS en Ajustes.' : '';
  $('walkHint').textContent = hint;
  $('walkHint').hidden = !hint || radar.active || !settings.map;

  $('attribution').hidden = !radar.hasStreets;
  scene?.invalidate();
}, showNotice);
scene = new Scene(canvas, video, $('view'), settings, radar);

$('mapZoom').onclick = () => {
  radar.changeZoom();
  toast('Zoom del minimapa · ' + (2 ** radar.zoomIndex) + '×');
};

function icon(name) {
  return '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}
function setIcon(target, name) {
  target.querySelector('use').setAttribute('href', '#i-' + name);
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
}
function showNotice(message, direct = false) {
  $('noticeText').textContent = message;
  $('directLink').hidden = !(direct && window.top !== window.self);
  $('directLink').href = new URL(location.pathname + '#estudio', location.origin).href;
  $('notice').hidden = false;
}
$('noticeClose').onclick = () => { $('notice').hidden = true; };
function persist() {
  try { localStorage.setItem('vicelens-ajustes', JSON.stringify(settings)); } catch { /* Private browsing. */ }
  scene.invalidate();
}
function refreshSettings() {
  document.querySelectorAll('[data-look]').forEach(button => {
    const selected = button.dataset.look === settings.look;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('strength').value = settings.strength;
  $('strength').style.setProperty('--fill', settings.strength + '%');
  $('strengthValue').textContent = settings.strength + ' %';
  $('showMap').checked = settings.map;
  $('showVitals').checked = settings.vitals;
  $('showStars').checked = settings.stars;
  $('showMoney').checked = settings.money;
}
document.querySelectorAll('[data-look]').forEach(button => {
  button.onclick = () => { settings.look = button.dataset.look; refreshSettings(); persist(); };
});
$('strength').oninput = event => { settings.strength = Number(event.target.value); refreshSettings(); persist(); };
for (const [id, key] of [['showMap', 'map'], ['showVitals', 'vitals'], ['showStars', 'stars'], ['showMoney', 'money']]) {
  $(id).onchange = event => {
    settings[key] = event.target.checked;
    if (!settings.map && radar.active) radar.stop();
    persist();
  };
}
$('gps').onclick = () => {
  if (radar.active) { radar.stop(); return; }
  settings.map = true; refreshSettings(); persist();
  radar.start();
};
$('reset').onclick = () => {
  Object.assign(settings, defaults);
  radar.zoomIndex = 0;
  if (radar.active) radar.stop(); else radar.onChange();
  refreshSettings(); persist(); toast('Ajustes restablecidos.');
};
refreshSettings();

function stopTracks(media) {
  media?.getTracks().forEach(track => track.stop());
}
function stopMic() {
  ++micVersion; micPending = false;
  stopTracks(microphone); microphone = null;
}
function formatTimer(ms) {
  const t = Math.floor(ms / 1000);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
function refreshControls() {
  const live = !!stream && scene.live;
  const busy = cameraPending || pendingCapture;
  const power = $('cameraPower');
  power.querySelector('span').textContent = cameraPending ? 'Cancelar' : live ? 'Apagar cámara' : 'Activar cámara';
  power.classList.toggle('live', live);
  power.disabled = !!recording || (pendingCapture && !cameraPending);
  setIcon(power, cameraPending ? 'close' : live ? 'power' : 'video');
  $('flip').disabled = busy || !!recording;
  const flipLabel = facing === 'user' ? 'Cambiar a cámara trasera' : 'Cambiar a cámara frontal';
  $('flip').title = flipLabel; $('flip').setAttribute('aria-label', flipLabel);
  $('mic').disabled = busy || micPending || !!recording || mode === 'photo';
  $('mic').setAttribute('aria-pressed', String(!!microphone));
  const micLabel = microphone ? 'Silenciar micrófono' : 'Activar micrófono';
  $('mic').title = micLabel; $('mic').setAttribute('aria-label', micLabel);
  setIcon($('mic'), microphone ? 'mic' : 'mute');
  $('shutter').disabled = busy || micPending || !!recording?.stopping;
  $('shutter').classList.toggle('photo', mode === 'photo');
  $('shutter').classList.toggle('is-recording', !!recording);
  $('shutterText').textContent = recording ? (recording.stopping ? 'Guardando…' : 'Detener') : mode === 'photo' ? 'Capturar' : 'Grabar';
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    button.disabled = busy || !!recording;
  });
  $('viewBadge').classList.toggle('live', live);
  $('viewBadge').classList.toggle('recording', !!recording);
  $('feedState').textContent = recording ? 'Grabando' : live ? 'En directo' : cameraPending ? 'Abriendo cámara…' : 'Vista previa';
}
function cameraMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Permite el acceso a la cámara en el navegador y vuelve a pulsar «Activar cámara». Si estás en una vista integrada, abre el filtro directamente.';
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'No se encontró una cámara. Abre el filtro en tu celular o conecta una webcam.';
  if (error?.name === 'NotReadableError') return 'La cámara está ocupada. Cierra la otra aplicación que la usa y vuelve a activarla.';
  return 'No llegó imagen de la cámara. Vuelve a activarla o abre el filtro en Safari o Chrome.';
}
function waitForFrame(source, version) {
  if (source.readyState >= 2 && source.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    function finish(error) {
      clearTimeout(timer);
      source.removeEventListener('loadeddata', check);
      source.removeEventListener('playing', check);
      source.removeEventListener('resize', check);
      source.removeEventListener('error', fail);
      if (error) reject(error); else resolve();
    }
    function check() {
      if (version !== cameraVersion) finish(new Error('cancelled'));
      else if (source.readyState >= 2 && source.videoWidth) finish();
    }
    function fail() { finish(new Error('No se pudo leer el video')); }
    source.addEventListener('loadeddata', check);
    source.addEventListener('playing', check);
    source.addEventListener('resize', check);
    source.addEventListener('error', fail);
    timer = setTimeout(fail, 10000);
    check();
  });
}
async function tuneTrack(track) {
  const caps = track.getCapabilities?.() || {};
  const advanced = {};
  for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode']) if (caps[key]?.includes?.('continuous')) advanced[key] = 'continuous';
  try { if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] }); } catch { /* Opcional. */ }
  // La vista en vivo se queda en 1080p para ir fluida; las fotos usan el sensor completo aparte.
}
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (!on) { await wakeLock?.release(); wakeLock = null; return; }
    if (!wakeLock && navigator.wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { wakeLock = null; }
}
function releaseCamera() {
  ++cameraVersion; cameraPending = false;
  void keepAwake(false);
  stopTracks(stream); stream = null;
  video.pause(); video.srcObject = null;
  scene.setLive(false); refreshControls();
}
function closeDevices() {
  ++captureVersion; pendingCapture = false;
  if (recording && !recording.stopping) stopRecording();
  releaseCamera(); stopMic(); setImmersive(false);
  if (radar.active) radar.stop();
  refreshControls();
}
async function startCamera(requested = facing, silent = false) {
  if (cameraPending) return false;
  if (!navigator.mediaDevices?.getUserMedia) {
    showNotice('Abre el filtro directamente en Safari o Chrome y permite el acceso a la cámara.', true);
    return false;
  }
  const expandOnStart = !stream && !silent && !document.body.classList.contains('immersive-body');
  $('notice').hidden = true;
  releaseCamera();
  const version = cameraVersion;
  cameraPending = true; refreshControls();
  let next;
  try {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const opening = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: requested }, width: { ideal: portrait ? 1080 : 1920 },
        height: { ideal: portrait ? 1920 : 1080 }, frameRate: { ideal: 30 }, resizeMode: { ideal: 'none' }
      }, audio: false
    });
    if (expandOnStart) setImmersive(true, true);
    next = await opening;
    if (version !== cameraVersion) { stopTracks(next); return false; }
    stream = next; video.srcObject = next;
    await Promise.all([video.play(), waitForFrame(video, version)]);
    if (version !== cameraVersion) { stopTracks(next); return false; }
    const track = next.getVideoTracks()[0];
    await tuneTrack(track);
    if (version !== cameraVersion) { stopTracks(next); return false; }
    facing = track.getSettings?.().facingMode || requested;
    void keepAwake(true);
    scene.setLive(true, facing === 'user'); scene.draw();
    track.addEventListener('ended', () => {
      if (version !== cameraVersion) return;
      closeDevices();
      showNotice('Se interrumpió la cámara. Pulsa «Activar cámara» para volver al directo.', true);
    }, { once: true });
    return true;
  } catch (error) {
    stopTracks(next);
    if (version === cameraVersion) {
      stream = null; video.srcObject = null; scene.setLive(false);
      if (expandOnStart) setImmersive(false);
      if (!silent) showNotice(cameraMessage(error), true);
    }
    return false;
  } finally {
    if (version === cameraVersion) { cameraPending = false; refreshControls(); }
  }
}
$('cameraPower').onclick = () => {
  if (cameraPending || stream) { closeDevices(); return; }
  void startCamera();
};
$('flip').onclick = async () => {
  const hadCamera = !!stream;
  const previous = facing;
  const target = facing === 'environment' ? 'user' : 'environment';
  const pendingVersion = cameraVersion + 1;
  const ok = await startCamera(target, hadCamera);
  if (ok && facing !== target) toast('El dispositivo ha abierto la cámara disponible.');
  if (!ok && hadCamera && cameraVersion === pendingVersion && !$('studioPage').hidden) {
    const restored = await startCamera(previous);
    if (restored) toast('Se mantuvo la cámara disponible.');
  }
};
$('mic').onclick = async () => {
  if (microphone) { stopMic(); refreshControls(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { showNotice('Abre el filtro directamente para activar el micrófono.', true); return; }
  const version = ++micVersion;
  micPending = true; refreshControls();
  try {
    const next = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (version !== micVersion) { stopTracks(next); return; }
    microphone = next;
    next.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (version === micVersion) { stopMic(); refreshControls(); }
    }, { once: true });
  } catch {
    if (version === micVersion) showNotice('No se pudo activar el micrófono. Puedes grabar en silencio o permitir el acceso en el navegador.');
  } finally {
    if (version === micVersion) { micPending = false; refreshControls(); }
  }
};
document.querySelectorAll('[data-mode]').forEach(button => {
  button.onclick = () => {
    mode = button.dataset.mode;
    if (mode === 'photo' && (microphone || micPending)) stopMic();
    refreshControls();
  };
});

let idleTimer = 0;
function nativeFull() { return document.fullscreenElement || document.webkitFullscreenElement; }
let fullVersion = 0;
function setImmersive(open, useNative = false) {
  const version = ++fullVersion;
  $('cameraDeck').classList.toggle('immersive', open);
  document.body.classList.toggle('immersive-body', open);
  const label = open ? 'Salir de pantalla completa' : 'Pantalla completa';
  $('expand').setAttribute('aria-label', label); $('expand').title = label;
  setIcon($('expand'), open ? 'shrink' : 'expand');
  const page = document.documentElement;
  if (open && useNative && !nativeFull()) {
    const request = page.requestFullscreen || page.webkitRequestFullscreen;
    if (request) {
      try {
        Promise.resolve(request.call(page)).then(() => {
          if (version !== fullVersion && !document.body.classList.contains('immersive-body') && nativeFull()) setImmersive(false);
        }).catch(() => {});
      } catch { /* The edge-to-edge view is already active. */ }
    }
  } else if (!open && nativeFull()) {
    try { Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {}); }
    catch { /* The CSS viewport has already been restored. */ }
  }
  if (open) wakeControls(); else { clearTimeout(idleTimer); $('cameraDeck').classList.remove('idle'); }
  scene?.resize();
}
function onFullscreenChange() {
  if (!nativeFull()) setImmersive(false);
  else scene?.resize();
}
$('expand').onclick = () => setImmersive(!$('cameraDeck').classList.contains('immersive'), true);
// Los controles se ocultan solos en pantalla completa y vuelven al tocar o mover el ratón.
function wakeControls() {
  const deck = $('cameraDeck');
  deck.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!deck.classList.contains('immersive')) return;
  idleTimer = setTimeout(() => {
    if (deck.classList.contains('immersive') && !deck.contains(document.activeElement?.matches?.(':focus-visible') ? document.activeElement : null)) deck.classList.add('idle');
  }, 3200);
}
for (const type of ['pointermove', 'pointerdown', 'keydown']) $('cameraDeck').addEventListener(type, wakeControls, { passive: true });
let lastTap = 0;
$('view').addEventListener('pointerup', event => {
  if (event.target.closest('button, a')) return;
  const now = performance.now();
  if (now - lastTap < 320) { lastTap = 0; setImmersive(!$('cameraDeck').classList.contains('immersive'), true); }
  else lastTap = now;
});
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.closest?.('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (location.hash === '#galeria') return;
  if (event.key === 'f' || event.key === 'F') { event.preventDefault(); setImmersive(!$('cameraDeck').classList.contains('immersive'), true); }
  else if (event.key === ' ' && $('cameraDeck').classList.contains('immersive') && !event.target.closest?.('button')) { event.preventDefault(); $('shutter').click(); }
  else if (event.key === 'm' || event.key === 'M') { $('mapZoom').click(); }
});
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setImmersive(false);
});
function canvasBlob(source, type, quality) {
  return new Promise((resolve, reject) => {
    try { source.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error('Captura vacía')), type, quality); }
    catch (error) { reject(error); }
  });
}
function thumbnail() {
  const thumb = document.createElement('canvas');
  const scale = Math.min(1, 420 / Math.max(canvas.width, canvas.height));
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return canvasBlob(thumb, 'image/jpeg', .82).catch(() => null);
}
function makeTake(kind, blob, thumb, duration, look) {
  return { id: crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2), created: Date.now(), kind, blob, thumb, duration, look };
}
async function keepTake(take) {
  const persisted = await gallery.add(take);
  updateGallery();
  if (!$('studioPage').hidden && !document.hidden) openTake(take, persisted);
  if (!persisted && ($('studioPage').hidden || document.hidden)) toast('Toma disponible en esta sesión. Descárgala desde Galería.');
}
async function sensorPhoto() {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof window.ImageCapture !== 'function' || typeof createImageBitmap !== 'function') return null;
  try {
    const capture = new ImageCapture(track);
    const caps = await capture.getPhotoCapabilities().catch(() => null);
    const options = caps?.imageWidth?.max ? { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight?.max } : {};
    const blob = await Promise.race([capture.takePhoto(options), new Promise((_, reject) => setTimeout(() => reject(new Error('tiempo')), 4500))]);
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    if (bitmap.width * bitmap.height <= video.videoWidth * video.videoHeight * 1.1) { bitmap.close?.(); return null; }
    return bitmap;
  } catch { return null; }
}
async function photograph() {
  const look = settings.look;
  let source = canvas;
  const bitmap = await sensorPhoto();
  if (bitmap) {
    try { source = scene.renderStill(bitmap); } catch { source = canvas; } finally { bitmap.close?.(); }
  }
  if (source === canvas) scene.draw();
  const [blob, thumb] = await Promise.all([canvasBlob(source, 'image/jpeg', .96), thumbnail()]);
  if (source !== canvas) toast('Foto en resolución completa · ' + source.width + ' × ' + source.height);
  $('flash').classList.remove('flash-on');
  void $('flash').offsetWidth;
  $('flash').classList.add('flash-on');
  await keepTake(makeTake('photo', blob, thumb, 0, look));
}
function recorderTypes(withAudio) {
  const preferred = withAudio
    ? ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.4d0033,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1.4d0033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return preferred.filter(type => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)).concat('');
}
function beginRecording(canReduce = true) {
  if (typeof canvas.captureStream !== 'function' || typeof window.MediaRecorder !== 'function') {
    showNotice('Este navegador admite fotos. Para grabar video con el filtro, abre el enlace en una versión reciente de Safari o Chrome.', true);
    return;
  }
  scene.resize(); scene.draw();
  const feed = canvas.captureStream(30);
  try {
    const audio = microphone?.getAudioTracks().find(track => track.readyState === 'live');
    if (audio) feed.addTrack(audio.clone());
    const take = { feed, chunks: [], started: performance.now(), thumb: thumbnail(), look: settings.look, stopping: false };
    for (const type of recorderTypes(!!audio)) {
      try {
        const options = { videoBitsPerSecond: videoRate(canvas.width,canvas.height) };
        if (type) options.mimeType = type;
        const recorder = new MediaRecorder(feed, options);
        recorder.ondataavailable = event => { if (event.data?.size) take.chunks.push(event.data); };
        recorder.onstop = () => { if (recording === take) void finishRecording(take); };
        recorder.onerror = () => {
          if (recording !== take) return;
          take.failed = true;
          if (recorder.state !== 'inactive') stopRecording();
          else void finishRecording(take);
        };
        recorder.start(400);
        take.recorder = recorder;
        recording = take; scene.locked = true;
        scene.invalidate(); refreshControls();
        return;
      } catch { /* Try the next encoder offered by this browser. */ }
    }
    throw new Error('No se encontró un codificador');
  } catch (error) {
    stopTracks(feed);
    if (canReduce && Math.max(canvas.width,canvas.height) > 1280) {
      scene.maxEdge = 1280;
      try { return beginRecording(false); }
      finally { if (!recording) { scene.maxEdge = scene.liveEdge; scene.resize(); } }
    }
    throw error;
  }
}
function stopRecording() {
  const take = recording;
  if (!take || take.stopping) return;
  take.stopping = true; take.ended = performance.now();
  refreshControls();
  if (take.recorder.state === 'inactive') { void finishRecording(take); return; }
  try { take.recorder.stop(); } catch { void finishRecording(take); }
}
async function finishRecording(take) {
  if (take.finishing) return;
  take.finishing = true; take.stopping = true;
  const duration = Math.max(0, (take.ended || performance.now()) - take.started);
  stopTracks(take.feed);
  scene.locked = false; scene.maxEdge = scene.liveEdge; scene.resize();
  try {
    if (!take.chunks.length) throw new Error('Video vacío');
    const mime = take.chunks.find(chunk => chunk.type)?.type || take.recorder.mimeType || 'video/webm';
    const blob = new Blob(take.chunks, { type: mime });
    await keepTake(makeTake('video', blob, await take.thumb, duration, take.look));
    if (take.failed) showNotice('La grabación se interrumpió. Se guardó el fragmento recuperado.');
  } catch {
    showNotice('El navegador no pudo guardar el video. Prueba una toma más corta o cambia a Foto.');
  } finally {
    if (recording === take) recording = null;
    refreshControls();
  }
}
$('shutter').onclick = async () => {
  if (recording) { stopRecording(); return; }
  if (pendingCapture || cameraPending) return;
  const version = ++captureVersion;
  pendingCapture = true; refreshControls();
  try {
    if (!stream || !scene.live) {
      const available = await startCamera();
      if (!available || version !== captureVersion) return;
    }
    if (!scene.live || !stream?.active || video.readyState < 2) { showNotice('Espera a que aparezca la imagen de la cámara.'); return; }
    if (mode === 'photo') await photograph(); else beginRecording();
  } catch {
    showNotice(mode === 'photo' ? 'No se pudo guardar la foto. Vuelve a capturarla.' : 'No se pudo iniciar la grabación con este navegador. Puedes tomar una foto o volver a intentar el video.');
  } finally {
    if (version === captureVersion) { pendingCapture = false; refreshControls(); }
  }
};

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }).format(timestamp);
}
function filename(take) {
  const ext = take.kind === 'photo' ? 'jpg' : take.blob.type.includes('mp4') ? 'mp4' : 'webm';
  return 'ViceLens-' + new Date(take.created).toISOString().replace(/[.:]/g, '-') + '.' + ext;
}
function updateGallery() {
  const records = gallery.sorted();
  $('galleryCount').textContent = records.length;
  $('galleryCount').hidden = records.length === 0;
  if ($('galleryPage').hidden) return;
  galleryUrls.forEach(url => URL.revokeObjectURL(url)); galleryUrls = [];
  const grid = $('galleryGrid'); grid.replaceChildren();
  $('emptyGallery').hidden = records.length !== 0;
  records.forEach(take => {
    const card = document.createElement('button');
    card.className = 'gallery-card'; card.type = 'button';
    const thumb = document.createElement('div'); thumb.className = 'gallery-thumb';
    const image = take.thumb || (take.kind === 'photo' && take.blob);
    if (image) {
      const img = new Image(); img.alt = ''; img.src = URL.createObjectURL(image);
      galleryUrls.push(img.src); thumb.append(img);
    } else thumb.innerHTML = icon('video');
    const caption = document.createElement('div'); caption.className = 'card-caption';
    const title = document.createElement('strong');
    title.textContent = take.kind === 'video' ? 'Video · ' + formatTimer(take.duration) : 'Foto';
    const date = document.createElement('time'); date.textContent = formatDate(take.created);
    caption.append(title, date); card.append(thumb, caption);
    card.onclick = () => openTake(take);
    grid.append(card);
  });
}
function openTake(take, persisted = true) {
  const dialog = $('takeDialog');
  if (dialog.open) dialog.close();
  clearPreview();
  selectedTake = take; takeUrl = URL.createObjectURL(take.blob);
  const isVideo = take.kind === 'video';
  const media = document.createElement(isVideo ? 'video' : 'img');
  if (isVideo) { media.controls = true; media.playsInline = true; media.preload = 'metadata'; }
  else media.alt = 'Foto con el filtro de ViceLens';
  media.src = takeUrl; $('takePreview').replaceChildren(media);
  $('takeTitle').textContent = isVideo ? 'Tu video' : 'Tu foto';
  $('takeMeta').textContent = (lookNames[take.look] || '') + ' · ' + (isVideo ? formatTimer(take.duration) + ' · ' : '') + formatDate(take.created) + (persisted ? '' : ' · Descárgala antes de cerrar esta sesión.');
  $('downloadTake').href = takeUrl; $('downloadTake').download = filename(take);
  $('shareTake').hidden = true;
  if (navigator.canShare && typeof File === 'function') {
    try { $('shareTake').hidden = !navigator.canShare({ files: [new File([take.blob], filename(take), { type: take.blob.type.split(';')[0] })] }); } catch { /* Download remains available. */ }
  }
  dialog.showModal();
}
function clearPreview() {
  $('takePreview').querySelector('video')?.pause();
  $('takePreview').replaceChildren();
  if (takeUrl) URL.revokeObjectURL(takeUrl);
  takeUrl = ''; selectedTake = null;
}
$('takeDialog').addEventListener('close', () => { if (!$('takeDialog').open) clearPreview(); });
$('shareTake').onclick = async () => {
  const take = selectedTake;
  if (!take) return;
  try {
    const file = new File([take.blob], filename(take), { type: take.blob.type.split(';')[0] });
    await navigator.share({ files: [file], title: 'ViceLens' });
  } catch (error) { if (error.name !== 'AbortError') toast('Puedes guardar la toma con «Descargar».'); }
};
$('deleteTake').onclick = async () => {
  const take = selectedTake;
  if (!take || !window.confirm('¿Eliminar esta toma de la galería?')) return;
  try { await gallery.remove(take.id); $('takeDialog').close(); updateGallery(); toast('Toma eliminada.'); }
  catch { toast('No se pudo eliminar la toma.'); }
};
$('guideOpen').onclick = () => $('guide').showModal();
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(button.dataset.close).close(); });
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
});
function route() {
  const showGallery = location.hash === '#galeria';
  $('studioPage').hidden = showGallery; $('galleryPage').hidden = !showGallery;
  for (const [id, active] of [['navStudio', !showGallery], ['navGallery', showGallery]]) {
    $(id).classList.toggle('active', active);
    if (active) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  document.title = (showGallery ? 'Galería' : 'Estudio de cámara') + ' · ViceLens';
  if (showGallery) {
    closeDevices(); setImmersive(false); updateGallery();
  } else {
    galleryUrls.forEach(url => URL.revokeObjectURL(url)); galleryUrls = [];
    requestAnimationFrame(() => scene.resize());
  }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (recording && !recording.stopping) stopRecording();
    scene.walker.stop(); radar.city.pause();
  } else { scene.invalidate(); if (stream) void keepAwake(true); }
});
window.addEventListener('pagehide', closeDevices);
gallery.ready.then(updateGallery);
route(); refreshControls();
