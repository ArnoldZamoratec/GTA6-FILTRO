export function nativeFrame(viewWidth, viewHeight, sourceWidth, sourceHeight, maxEdge = 3840) {
  const scale = Math.min(sourceWidth / viewWidth, sourceHeight / viewHeight, maxEdge / Math.max(viewWidth, viewHeight),
    Math.sqrt(3840 * 2160 / (viewWidth * viewHeight)));
  const even = value => Math.max(2, 2 * Math.floor(value / 2));
  return { width: even(viewWidth * scale), height: even(viewHeight * scale) };
}
export function videoRate(width, height, fps = 30) {
  return Math.round(Math.max(3500000, Math.min(55000000, width * height * fps * .205)));
}
