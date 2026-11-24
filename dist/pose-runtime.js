const assets = new URL('./assets/motion/', import.meta.url);
let backendReady;

function loadScript(filename) {
  const url = new URL(filename, assets).href;
  if (typeof importScripts === 'function') { importScripts(url); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url; script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  });
}
async function prepareBackend() {
  await loadScript('tf.min.js');
  const tf = globalThis.tf;
  try {
    await loadScript('tf-backend-wasm.min.js');
    tf.wasm.setWasmPaths(assets.href);
    tf.wasm.setThreadsCount(1);
    if (!await tf.setBackend('wasm')) throw Error('WASM unavailable');
  } catch { await tf.setBackend('cpu'); }
  await tf.ready();
  return tf;
}

export async function createDetector() {
  backendReady ??= prepareBackend().catch(error => { backendReady = null; throw error; });
  const tf = await backendReady;
  const model = await tf.loadGraphModel(new URL('model/model.json', assets).href);
  const side = 192;
  const pixels = new Int32Array(side * side * 3);
  function predict(rgba) {
    for (let i=0, j=0; j<pixels.length; i+=4) {
      pixels[j++]=rgba[i]; pixels[j++]=rgba[i+1]; pixels[j++]=rgba[i+2];
    }
    return tf.tidy(() => {
      const input = tf.tensor4d(pixels, [1,side,side,3], 'int32');
      return new Float32Array(model.execute(input).dataSync());
    });
  }
  try {
    const black = new Uint8Array(side*side*4);
    try { predict(black); }
    catch (error) {
      if (tf.getBackend() === 'cpu') throw error;
      await tf.setBackend('cpu'); predict(black);
    }
    return { predict, close: () => model.dispose() };
  } catch (error) { model.dispose(); throw error; }
}
