import { LOCALE } from './i18n.js';

export const TIME_ZONE = 'Australia/Sydney';
export const DEFAULT_DATE = '2026-10-27';
export function validScenarioDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
// Convert Sydney's local scenario hour into an instant; do not assume daylight saving.
export function scenarioInstant(date, hour) {
  if (!validScenarioDate(date)) throw new RangeError('Invalid scenario date');
  const nominal = Date.parse(`${date}T00:00:00Z`) + Math.round(hour * 60) * 60000;
  let instant = nominal;
  for (let i = 0; i < 3; i++) instant = nominal - utcOffsetHours(new Date(instant)) * 3600000;
  return new Date(instant);
}
function utcOffsetHours(instant) {
  const zone = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, timeZoneName: 'longOffset' }).formatToParts(instant).find(p => p.type === 'timeZoneName').value;
  const [, sign, h, m] = zone.match(/GMT([+-])(\d{2}):(\d{2})/) || [];
  return sign ? (sign === '+' ? 1 : -1) * (Number(h) + Number(m) / 60) : 0;
}
export function scenarioOffset(date, hour = 12) { return utcOffsetHours(scenarioInstant(date, hour)); }
export function formatHour(hour, date = DEFAULT_DATE) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(scenarioInstant(date, hour));
}
export function formatScenarioDate(date) {
  const instant = scenarioInstant(date, 12);
  const day = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(instant);
  const zone = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, timeZoneName: 'short' }).formatToParts(instant).find(p => p.type === 'timeZoneName').value;
  return `${day} · ${zone}`;
}
export function naturalComparisonHour(hour) { return Math.min(18, hour + 1); }

// NOAA-style solar approximation shared by rendered light and calculated shade.
export function solarAt(hour, date = DEFAULT_DATE) {
  const start = Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`);
  const day = Math.floor((Date.parse(`${date}T00:00:00Z`) - start) / 86400000) + 1;
  const lat = -33.8688 * Math.PI / 180, lon = 151.2093;
  const gamma = 2 * Math.PI / 365 * (day - 1 + (hour - 12) / 24);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(gamma) - .032077 * Math.sin(gamma) - .014615 * Math.cos(2 * gamma) - .040849 * Math.sin(2 * gamma));
  const dec = .006918 - .399912 * Math.cos(gamma) + .070257 * Math.sin(gamma) - .006758 * Math.cos(2 * gamma) + .000907 * Math.sin(2 * gamma) - .002697 * Math.cos(3 * gamma) + .00148 * Math.sin(3 * gamma);
  const ha = (hour * 60 + eq + 4 * lon - 60 * scenarioOffset(date, hour)) / 4 * Math.PI / 180 - Math.PI;
  const east = -Math.cos(dec) * Math.sin(ha);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha);
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  return { direction: [east, up, -north], altitude: Math.asin(up) * 180 / Math.PI };
}
