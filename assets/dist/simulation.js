// Illustrative scenario model only. Coefficients are design assumptions, not measured performance.
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function ambientTemperature(hour, cloudy = false) {
  return 26 + 5.5 * Math.exp(-Math.pow((hour - 14.5) / 4.2, 2)) - (cloudy ? 3 : 0);
}
export function streetTemperature(hour, shadeFraction, heatOffset = 0, cloudy = false) {
  return ambientTemperature(hour, cloudy) + heatOffset + (cloudy ? .35 : 1.4) * (1 - shadeFraction) - .9 * shadeFraction;
}
export function footfallAtHour(base, hour) {
  return Math.round(base * (.45 + .4 * Math.exp(-Math.pow((hour - 12.5) / 2.2, 2)) + .45 * Math.exp(-Math.pow((hour - 17) / 1.8, 2))) / 10) * 10;
}
export function coolingRadius(power) { return power > 0 ? 20 + .24 * power : 0; }
export function coolingDrop({ power, humidity, windKmh, temperature, distanceMeters = 0 }) {
  const radius = coolingRadius(power);
  if (radius <= 0 || distanceMeters >= radius) return 0;
  const dryness = clamp(1 - humidity / 100, 0, 1);
  const heat = clamp((temperature - 23) / 8, 0, 1);
  const peak = 7.5 * clamp(power / 100, 0, 1) * dryness * (1 / (1 + windKmh / 30)) * heat;
  return peak * (1 - (distanceMeters / radius) ** 2) ** 2;
}
export function coolingPriority({ temperature, footfall, minutesToShade }) {
  const heat = clamp((temperature - 25) / 10, 0, 1);
  const people = clamp(footfall / 2400, 0, 1);
  const persistence = clamp(minutesToShade / 120, 0, 1);
  return Math.round(100 * (.5 * heat + .35 * people + .15 * persistence));
}
export function scenarioTemperature(before, drops, after = true) {
  // Overlapping installations never add their effects twice; take the strongest local influence.
  return before - (after ? Math.max(0, ...drops) : 0);
}
