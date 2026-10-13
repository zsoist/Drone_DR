/** Display values use es-CO. Inputs: seconds, metres, hectares, and epoch milliseconds. */
const missing = '—';
const valid = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numeric = new Map();
function number(value, decimals = 0) {
  if (!valid(value)) return missing;
  const digits = Math.max(0, Math.min(6, Math.trunc(decimals) || 0));
  if (!numeric.has(digits)) numeric.set(digits, new Intl.NumberFormat('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return numeric.get(digits).format(Number(value));
}
function duration(value) {
  if (!valid(value)) return missing;
  const seconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  if (hours) return `${number(hours)} h${minutes ? ` ${minutes} min` : ''}`;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ''}` : `${rest} s`;
}
function clock(value) {
  if (!valid(value)) return missing;
  const seconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(seconds / 3600);
  return hours ? `${hours}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function asDate(value) {
  if (value === null || value === undefined || value === '') return null;
  // Date-only fields refer to a Colombian calendar day, not UTC midnight.
  const date = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-05:00` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}
const calendar = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
function date(value) {
  const parsed = asDate(value);
  if (!parsed) return '';
  const parts = calendar.formatToParts(parsed);
  return ['day', 'month', 'year'].map(type => parts.find(part => part.type === type).value.replace(/\.$/, '')).join(' ');
}
const relativeFormat = new Intl.RelativeTimeFormat('es-CO', { numeric: 'always', style: 'short' });
function relative(value, now = Date.now()) {
  const parsed = asDate(value), reference = asDate(now);
  if (!parsed || !reference) return missing;
  const seconds = (parsed - reference) / 1000, magnitude = Math.abs(seconds);
  const [unit, divisor] = magnitude < 60 ? ['second', 1] : magnitude < 3600 ? ['minute', 60] : magnitude < 86400 ? ['hour', 3600] : magnitude < 2592000 ? ['day', 86400] : magnitude < 31536000 ? ['month', 2592000] : ['year', 31536000];
  return relativeFormat.format(Math.trunc(seconds / divisor), unit).replace(/\./g, '').replace(/\s+/g, ' ');
}
function shutter(value) {
  if (typeof value === 'string' && /^1\s*\/\s*\d+(?:\.\d+)?$/.test(value.trim())) {
    const denominator = Number(value.split('/')[1]);
    return denominator > 0 ? `1/${number(denominator)}` : missing;
  }
  if (!valid(value) || Number(value) <= 0) return missing;
  return Number(value) < 1 ? `1/${number(1 / Number(value))}` : `${number(value, Number.isInteger(Number(value)) ? 0 : 1)} s`;
}
const distance = value => !valid(value) ? missing : Math.abs(Number(value)) < 1000 ? `${number(value)} m` : `${number(Number(value) / 1000, 1)} km`;
const area = value => valid(value) ? `${number(value, 1)} ha` : missing;
const bytes = value => !valid(value) ? missing : Number(value) >= 1e9 ? `${number(Number(value) / 1e9, 1)} GB` : `${number(Number(value) / 1e6)} MB`;
export const fmt = Object.freeze({ number, duration, clock, distance, area, date, relative, shutter,
  // Compatibility names. Use duration for prose, clock for media timelines.
  dur: clock, km: distance, gb: bytes, hours: duration });
// The classic shell and ES pages share the same object, including across versioned imports.
if (typeof window !== 'undefined') window.fmt = fmt;
export default fmt;
