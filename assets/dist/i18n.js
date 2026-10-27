// Australian English is the single source of UI copy. HTML provides readable fallbacks.
export const LOCALE = 'en-AU';
export const UI = {
  pageTitle: 'Mist — Sydney Cooling Fog Simulator',
  description: 'Explore Sydney CBD heat, shade and pedestrian demand. Compare illustrative cooling-fog installations.',
  home: 'Mist home', subtitle: 'Sydney Cooling Fog Simulator', about: 'About this simulator',
  scene: 'Sydney 3D map. Drag to rotate, scroll or pinch to zoom. Use the location buttons for keyboard navigation.',
  canvas: 'Sydney city model. Drag to rotate, scroll or pinch to zoom.',
  loading: 'Preparing OpenFreeMap data', loadingDetail: 'Loading buildings, streets and green spaces.',
  loadingTiles: 'Loading OpenFreeMap vector tiles', loadingGeometry: 'Building the Sydney city model',
  loadingSnapshot: 'Loading cached Sydney map data',
  mapError: 'The Sydney map could not load. Check your connection and try again.',
  candidateError: 'No suitable surface path was found near this candidate.',
  webglTitle: 'The 3D view is unavailable', webglHelp: 'Enable hardware acceleration in a WebGL-capable browser, then try again.',
  retry: 'Try again', lab: 'URBAN COOLING LAB', placement: 'Cooling fog placement', illustrative: 'Illustrative model',
  intro: 'Explore heat, shade and pedestrian demand.', candidates: 'Candidate locations', priority: 'Priority score / 100',
  candidateGroup: 'Cooling fog candidate locations', installed: 'Installed', uninstalled: 'Not installed',
  flow: 'Pedestrian flow', flowUnit: 'people/hour', shadeArrival: 'Shade arrival', shadeModel: 'Estimated from scene geometry',
  naturalChange: 'Natural temperature change in 1 hour', streetAir: 'Street air temperature', fogCentre: 'At the fog unit',
  before: 'Before installation', after: 'After installation', fogOutput: 'Fog output', sharedOutput: 'Shared across all installed units',
  radius: 'Cooling radius', units: 'Installed units', install: 'Install here', remove: 'Remove installation',
  recommend: 'Recommended location', recommendTitle: 'Select the highest-ranked candidate at this time',
  modelNote: 'Sample weather and pedestrian data. Illustrative cooling model.', comparison: 'Compare the same time and weather before and after installation',
  sampleWeather: 'Sample weather', sample: 'Sample', clear: 'Clear sky', cloudy: 'Cloudy sky', humidity: 'Humidity',
  showCloudy: 'Cloudy sky', showClear: 'Clear sky', setCloudy: 'Change sample weather to cloudy sky', setClear: 'Change sample weather to clear sky',
  connecting: 'Connecting to OpenFreeMap', liveMap: 'Live vector data', cachedMap: 'Cached map data',
  mapControls: 'Map controls', zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset view', top: 'Top-down view', return3d: 'Return to 3D', north: 'North',
  timeline: 'Time of day, temperature and shade simulation', dailyHeat: 'Daily heat conditions', scenarioDate: 'Scenario date',
  play: 'Play day', pause: 'Pause', time: 'Simulation time', legend: 'Street air temperature: teal at 27 degrees Celsius to red at 36 degrees Celsius',
  fogCooling: 'Fog cooling', sunAltitude: 'Sun altitude', layers: 'Map layers', temperature: 'Temperature', pedestrians: 'Pedestrians', trees: 'Trees', shadows: 'Shadows',
  treeHint: 'Changes tree presence and calculated natural shade', shadowHint: 'Changes visible shadows only; shade calculations stay active',
  dataInfo: 'Model & data', close: 'Close', aboutEyebrow: 'ABOUT THIS SIMULATOR', aboutHeading: 'Plan a cooler street.',
  aboutIntro: 'Compare illustrative cooling-fog placements using mapped Sydney streets, estimated shade and sample pedestrian demand.',
  rankingTitle: 'Candidate priority',
  rankingInfo: 'Scores compare three candidates: heat 50%, pedestrian flow 35% and time until shade 15%. Heat is scaled from 25–35°C, flow from 0–2,400 people/hour and shade wait from 0–120 minutes, each capped at 0–1. Already shaded scores zero for shade wait; no shade by 18:00 scores the maximum. This is an illustrative comparison, not a proven city-wide optimum or an installation assessment.',
  coolingTitle: 'Illustrative cooling',
  coolingInfo: 'Cooling increases with output and falls with distance, humidity and wind. The largest local reduction is used where units overlap. Zero output produces no cooling or mist. Values represent estimated street air temperature, not land-surface temperature or measured performance. Both map comparisons use the same 27–36°C colour scale.',
  shadeTitle: 'Weather, shade and trees',
  shadeInfo: 'Weather and pedestrian counts are sample inputs. Sun position uses the selected date in Australia/Sydney. Shade uses the rendered buildings, courtyard holes and Opera House roofs, plus illustrative tree canopies. Shade arrival requires at least 60% of five nearby points to be shaded and still shaded ten minutes later. Trees changes presence and calculations; Shadows changes appearance only. Natural change ends at 18:00 when less than an hour remains.',
  geographyTitle: 'Map and architecture', geographyInfo: 'OpenFreeMap building, street, water and green-space geometry.',
  expandDetails: 'Expand location details', collapseDetails: 'Collapse location details',
  architectureInfo: 'Facades, roof details and park trees are stylised. The Opera House is an interpretive model at Bennelong Point, not an as-built BIM model. Terrain is flat. Candidates are illustrative public-path locations, not verified installable sites.',
  noChange: 'No change', alreadyShaded: 'Already shaded', noShade: 'No shade within this period',
  shadedAround: 'At least 60% of nearby points shaded', noShadeUntil: 'No lasting shade by 18:00',
  beforeToast: 'Showing the no-fog baseline at the same time and weather.', afterToast: 'Showing cooling from installed fog units.',
  installToast: 'Fog unit installed. Illustrative cooling is now included.', removeToast: 'Fog installation removed from this location.',
  recommendToast: 'Selected the highest-ranked candidate for the current time.',
  treesOn: 'Tree shade is included in natural cooling.', treesOff: 'Comparing natural cooling without trees.',
  shadowsOn: 'Building and tree shadows are visible.', shadowsOff: 'Visual shadows hidden. Shade calculations remain active.',
  clearToast: 'Sample weather changed to clear sky.', cloudyToast: 'Sample weather changed to cloudy sky.', resetToast: 'Returned to the Sydney city overview.',
  focus: name => `Zoom to ${name}`,
  candidate: name => `${name}, cooling fog candidate`,
  candidateSummary: (name, score, flow, temperature) => `${name}, priority score ${score} out of 100, ${flow} people per hour, ${temperature} degrees Celsius. Select and zoom.`,
  selectedMap: name => `${name} map. Drag to rotate; Reset view returns to the city overview.`,
  marker: (name, installed, value) => `${name}, ${installed ? 'fog installed' : 'not installed'}, ${value} degrees Celsius. Select and zoom.`,
  shadeWait: minutes => `In ${minutes} minutes · estimated`,
  powerValue: value => `${value}%, shared output for all installed units`,
  naturalUntil: time => `Natural change to ${time}`,
  sourceSummary: (parts, date) => `${parts} building parts · retrieved ${date} · estimated map heights`,
  sourceDetail: (source, parts, fallback) => `${source}. Footprints and heights for ${parts} building parts, plus streets, water and green-space boundaries. Heights come from OpenMapTiles attributes; ${fallback} parts without positive heights use a 3 m fallback. The custom Opera House roofs also cast calculated shade.`,
};
export const number = value => new Intl.NumberFormat(LOCALE).format(value);
export const decimal = value => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
export function applyStrings(root = document) {
  for (const [attribute, target] of [['data-i18n', 'textContent'], ['data-i18n-label', 'aria-label'], ['data-i18n-title', 'title']]) {
    root.querySelectorAll(`[${attribute}]`).forEach(el => {
      const text = UI[el.getAttribute(attribute)];
      if (typeof text !== 'string') throw new Error(`Missing UI string: ${el.getAttribute(attribute)}`);
      if (target === 'textContent') el.textContent = text;
      else el.setAttribute(target, text);
    });
  }
  document.title = UI.pageTitle;
  document.querySelector('meta[name="description"]').content = UI.description;
}
