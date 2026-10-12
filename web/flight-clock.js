// One timeline, expressed in seconds from the first telemetry sample.
export function sampleTimes(points) {
  const stamp = value => typeof value === 'number' ? value : Date.parse(String(value).replace(' ', 'T')) / 1000;
  const origin = stamp(points[0]?.t);
  return points.map((point, index) => {
    const delta = stamp(point.t) - origin;
    return Number.isFinite(delta) && delta >= 0 ? delta : index;
  });
}
export function sampleAt(times, seconds) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (times[mid] <= seconds) lo = mid; else hi = mid - 1;
  }
  return lo;
}
export function acceptsShortcut(event) {
  return !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey &&
    !event.target?.closest('input,textarea,select,button,a,summary,video,[contenteditable],dialog,[role="dialog"]');
}
