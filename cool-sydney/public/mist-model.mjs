// Screening model, not a calibrated outdoor plume or thermal-comfort solver.
// Adiabatic moist-air balance: h_out = h_in + (w_out - w_in) * h_water.
// Reference: EnergyPlus Engineering Reference, Evaporative Coolers, eq. 16.123.
// Water assumed at thermodynamic wet-bulb temperature; pressure 101.325 kPa.
const P = 101325;
// Product facts are separate from unverified operating assumptions.
// Nozzle bore is NOT the diameter of the emitted droplets.
export const FOG_DEVICE = Object.freeze({
  model: 'FEC-MP003', manufacturer: 'Filtertech', shape: 'L', nozzleCount: 10,
  nozzleBoreMm: .1, lighting: 'LED', ratedFlowLpm: null, dimensionsM: null,
  productUrl: 'https://water777.co.kr/goods/view?no=189465',
  catalogUrl: 'https://filtertech.co.kr/wp-content/uploads/2025/01/%E2%98%85filtertech-cooling-fog-system-catalogNomination-form_English-version.pdf',
});
export function fogWaterLph(nozzleFlowLpm) {
  number(nozzleFlowLpm, 0, 1, '노즐당 유량 가정 (L/min)');
  return nozzleFlowLpm * FOG_DEVICE.nozzleCount * 60;
}
// Relative air-temperature palette: ambient red, lower temperature blue.
// The span is a user-visible color scale, never an input to the physics.
export function mistHeatRgb(dropC, spanC = 2) {
  number(spanC, .5, 10, '열지도 색 범위');
  const t = Math.max(0, Math.min(1, dropC / spanC));
  const stops = [[0,[232,93,74]],[.35,[244,217,156]],[.7,[14,165,233]],[1,[29,78,216]]];
  for (let i=1;i<stops.length;i++) if(t<=stops[i][0]) {
    const [a,ca]=stops[i-1],[b,cb]=stops[i],weight=(t-a)/(b-a);
    return ca.map((v,j)=>Math.round(v+(cb[j]-v)*weight));
  }
}
const saturationPressure = t => 611.21 * Math.exp((18.678 - t / 234.5) * t / (257.14 + t));
const ratio = pv => .621945 * pv / (P - pv);
const enthalpy = (t, w) => 1006 * t + w * (2501000 + 1860 * t);
function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label}: ${min}–${max} 범위의 값이 필요합니다.`);
  return value;
}
export function mistSource({ temperatureC, humidityPct, waterLph, evaporationFraction, airflowM3s }) {
  // Restrict this liquid-water approximation to warm-weather scenarios.
  number(temperatureC, 10, 50, '기온'); number(humidityPct, 0, 100, '습도');
  number(waterLph, 0, 600, '분사량'); number(evaporationFraction, 0, 1, '증발 비율'); number(airflowM3s, .1, 100, '공기 유량');
  const pv = saturationPressure(temperatureC) * humidityPct / 100;
  const w = ratio(pv), h = enthalpy(temperatureC, w);
  let lo = 0, hi = temperatureC;
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2, ws = ratio(saturationPressure(t));
    if (enthalpy(t, ws) - (ws - w) * 4186 * t > h) hi = t; else lo = t;
  }
  const wetBulbC = (lo + hi) / 2;
  const dryAirKgS = (P - pv) * airflowM3s / (287.05 * (temperatureC + 273.15));
  const capacityKgS = Math.max(0, dryAirKgS * (ratio(saturationPressure(wetBulbC)) - w));
  const evaporatedKgS = Math.min(waterLph / 3600 * evaporationFraction, capacityKgS);
  const wo = w + evaporatedKgS / dryAirKgS;
  const afterC = Math.max(wetBulbC, Math.min(temperatureC, (h + (wo - w) * 4186 * wetBulbC - 2501000 * wo) / (1006 + 1860 * wo)));
  const dropC = temperatureC - afterC;
  return { beforeC: temperatureC, afterC, dropC, wetBulbC, dryAirKgS,
    coolingKw: dryAirKgS * (1006 + 1860 * w) * dropC / 1000,
    evaporatedLph: evaporatedKgS * 3600, humidityRatioIn: w, humidityRatioOut: wo,
    humidityAfterPct: Math.min(100, 100 * P * wo / (.621945 + wo) / saturationPressure(afterC)) };
}

// Explicit spatial assumption: finite radial quadratic dilution, not CFD.
// Overlaps retain the strongest source, rather than adding cooling repeatedly.
export function mistDropAt(x, y, sites, dropC, radiusM) {
  number(radiusM, 2, 50, '희석 반경');
  let reduction = 0;
  for (const site of sites) {
    const distance = Math.hypot(x - site.x, y - site.y);
    if (distance < radiusM) reduction = Math.max(reduction, dropC * (1 - distance / radiusM) ** 2);
  }
  return reduction;
}

// Read the same field used by the map, including zero cooling outside coverage.
export function mistReading(x, y, sites, model, radiusM) {
  if (!model) return null;
  const dropC = mistDropAt(x, y, sites, model.dropC, radiusM);
  const nearestM = sites.length ? Math.min(...sites.map(site => Math.hypot(x - site.x, y - site.y))) : null;
  return { beforeC: model.beforeC, afterC: model.beforeC - dropC, dropC, nearestM };
}

// Sample only small neighborhoods around equipment, not the entire city grid.
export function mistField(sites, dropC, radiusM, stepM = 2) {
  number(radiusM, 2, 50, '희석 반경'); number(stepM, 1, 10, '표본 간격');
  const cells = new Map();
  for (const site of sites) {
    for (let i = Math.floor((site.x - radiusM) / stepM); i <= Math.ceil((site.x + radiusM) / stepM); i++) {
      for (let j = Math.floor((site.y - radiusM) / stepM); j <= Math.ceil((site.y + radiusM) / stepM); j++) {
        const key = `${i}:${j}`;
        if (cells.has(key)) continue;
        const x = i * stepM, y = j * stepM, delta = mistDropAt(x, y, sites, dropC, radiusM);
        if (delta > .005) cells.set(key, { x, y, dropC: delta });
      }
    }
  }
  return [...cells.values()];
}
