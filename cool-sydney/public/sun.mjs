/** NOAA-style solar position — same math as src/engine.js (azimuth 0° = north). */
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function localInstant(date, hour, zone = 'Australia/Sydney') {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, Math.floor(hour), Math.round(hour % 1 * 60));
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let stamp = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(stamp)).map(a => [a.type, a.value]));
    stamp += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return new Date(stamp);
}

export function sunPosition(instant, latitude, longitude) {
  const y = instant.getUTCFullYear(), days = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
  const day = (Date.UTC(y, instant.getUTCMonth(), instant.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000 + 1;
  const hour = instant.getUTCHours() + instant.getUTCMinutes() / 60 + instant.getUTCSeconds() / 3600;
  const g = 2 * Math.PI / days * (day - 1 + (hour - 12) / 24);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const dec = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const ha = ((((hour * 60 + eq + 4 * longitude) % 1440) + 1440) % 1440 / 4 - 180) * DEG;
  const lat = latitude * DEG;
  const altitude = Math.asin(clamp(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha), -1, 1)) / DEG;
  const azimuth = ((Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / DEG + 180) % 360 + 360) % 360;
  return { altitude, azimuth, daytime: altitude > 0, instant: instant.toISOString() };
}

export function sunAt(date, hour, area) {
  const instant = localInstant(date, hour, area.timezone || 'Australia/Sydney');
  return sunPosition(instant, area.latitude, area.longitude);
}
