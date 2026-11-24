let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'start') {
    try {
      const { createDetector } = await import('./pose-runtime.js');
      detector = await createDetector();
      self.postMessage({ type: 'ready' });
    } catch { self.postMessage({ type: 'unavailable' }); }
    return;
  }
  try {
    const keypoints = detector.predict(new Uint8ClampedArray(data.rgba));
    self.postMessage({ type:'pose', keypoints, time:data.time, epoch:data.epoch, crop:data.crop }, [keypoints.buffer]);
  } catch { self.postMessage({ type: 'unavailable' }); }
};
