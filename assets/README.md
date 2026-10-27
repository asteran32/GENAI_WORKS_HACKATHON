# Mist — Sydney Cooling Fog Simulator

An interactive English (Australian) Three.js application for comparing illustrative cooling-fog installations at Circular Quay, Martin Place and Town Hall. Real OpenFreeMap building footprints, streets, water and green spaces form the city. Weather, pedestrian demand and thermal estimates are sample scenarios.

## Run and verify

From the repository root:

```sh
cd assets
npm start
```

Open **http://127.0.0.1:4173**. The Node server serves `dist/` and forwards only the agent status/run/plan routes to the existing backend at `127.0.0.1:8766`. No frontend dependencies or API keys are needed. Node.js 22+ is required.

Start the combined agent, memory and monitoring backend in a separate terminal from the repository root:

```sh
npm --prefix meterless-demo start
```

Only ports **4173 and 8766** are required. Stop the old 8765 process. The 8766 server calls the existing LangGraph agent directly and uses its own H-MEM routes in process. Keep Zetaris running for live SQL planning. Gemini credentials stay in the backend environment. If port 4173 is still served by `python3 -m http.server`, stop that process and run `npm --prefix assets start` from the repository root; the Python static server cannot forward chat requests. `dist/` contains maintained source, and the build command validates it without generating another bundle.

```sh
cd assets
npm run build
npm test
```

These commands check JavaScript syntax, central UI copy and English-only application files, then run `test-simulation.mjs`, `test-architecture.mjs`, `test-gis.mjs`, `test-opera-house.mjs` `test-time.mjs` and `test-pedestrians.mjs`.

Optional real-browser integration checks require Playwright and Chrome, with the server running:

```sh
cd assets
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
npm run test:browser
```

The QA script has a fallback to this workspace's preinstalled Playwright runtime. Set the two variables for other machines. It writes observed results to [qa/results.json](qa/results.json), actual TileJSON fields to [qa/map-schema.json](qa/map-schema.json), and desktop/mobile screenshots to `qa/`.

## Use

- Select any candidate in the inspector, its map label or nearby mapped area to zoom there. The Opera House label and map area frame the landmark. Drag to orbit, pinch/scroll to zoom and use two fingers or right-drag to pan. Camera input interrupts automatic movement.
- Install or remove the selected unit. Installations persist across selection changes. **Fog output is shared across all installed units**, from 0–100%; zero output has no cooling footprint or mist.
- Compare **Before installation** and **After installation** at the same time, weather and fixed 27–36°C colour scale. The inspector always shows both temperatures.
- The 08:00–18:00 timeline updates sunlight, shadows, sample temperature, pedestrian demand, shade arrival and candidate ranking. Play/Pause animates the day. Recommendations select the current highest-ranked of the three candidates.
- Switch sample clear/cloudy weather and the Temperature, Pedestrians, Trees and Shadows layers. Pedestrians walk at varied speeds along validated mapped path segments, slowing for turns at each end. Their arms and legs follow distance travelled. Hiding the layer pauses their movement; reduced-motion preferences keep them still. **Trees** changes tree presence and natural shade calculations. **Shadows** changes visible shadows only.
- Top-down uses an orthographic camera and retains the focused place; Return to 3D retains it too. Reset view restores the city overview. Location buttons support keyboard activation.
- On mobile, use the inspector's chevron to expand location facts and output controls. Candidate selection, before/after temperatures, installation and recommendation stay available in the compact sheet.
- **Model & data** explains the assumptions and lets you change the scenario date. The initial date is **27 October 2026**, a sample scenario. `en-AU` formatting and `Australia/Sydney` time-zone rules produce AEDT or AEST as appropriate. Solar position changes with the selected date; sample weather is not relabelled as live weather.

## Geography and licences

The app resolves the current tile template from [OpenFreeMap TileJSON](https://tiles.openfreemap.org/planet), downloads four zoom-14 tiles and decodes them directly into Three.js geometry. The finite extent is longitude **151.200–151.220**, latitude **−33.8785–−33.8525**. It uses `building`, `transportation`, `water`, `park`, `landcover` and available `landuse` features.

The inspected building schema exposes `render_height`, `render_min_height`, `hide_3d` and `colour`. Heights are metres; missing or non-positive heights fall back to **3 m**. `hide_3d` outlines are excluded. Buffered duplicates are unioned and clipped while retaining multipart outlines and courtyard holes. Minimum heights and existing building parts remain intact. All geographic calculations use latitude-corrected local Mercator coordinates at **5 metres per world unit**, including picking, fog radii, pedestrians and shade.

Candidates snap to nearby mapped surface streets or pedestrian paths and reject building/water intersections. They are illustrative locations, not verified installable sites. Road widths and flat terrain are display assumptions; no elevation model is included.

Live loading is bounded to **10 seconds**; on failure, an attributed bundled [Sydney vector snapshot](dist/data/sydney-openfreemap.geojson) is tried with a **5-second** deadline. The map status identifies **Live vector data** or **Cached map data**. If both fail, an English error and working retry action replace the loader. A cached map still works without external network access.

Keep the visible **OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors** attribution. The extract is available under ODbL; OpenMapTiles schema attribution is CC-BY. Exact snapshot retrieval time and tile template are retained in its metadata. See [data/SOURCE.md](dist/data/SOURCE.md) and bundled vendor licences. Refresh the extract, when intentionally needed, from `assets/` with `node scripts/refresh-map.mjs`.

Facades, windows, roof equipment and park trees are stylised rather than surveyed. At Bennelong Point, only the Opera House's generic extrusions are replaced with the interpretive paired shell roofs, glazing, podium and steps. Frozen triangles from its rendered roof/podium geometry participate in calculated shade. It is not an as-built BIM model. Landmark background: [Sydney Opera House — The spherical solution](https://www.sydneyoperahouse.com/our-story/the-spherical-solution).

## Simulation assumptions

Thermal functions are separate from rendering in `simulation.js`. Inputs are illustrative, not measured weather or a calibrated performance forecast.

- Ambient sample air temperature: `26 + 5.5 * exp(-((hour - 14.5) / 4.2)^2)`, minus 3°C in the cloudy scenario. Humidity is 42% clear / 68% cloudy; wind is 12 km/h. The weather panel displays ambient sample air temperature, while the inspector and street layer display estimated local street air temperature.
- Local air temperature adds a site heat offset and shade adjustment. Candidate shade blends current, 18-minute-old and 36-minute-old shade fractions (50/30/20%). The street overlay uses instantaneous shade as a lighter spatial approximation; it therefore need not exactly match a candidate's local estimate. It is drawn along mapped streets and paths, never over the whole city. Air temperature is distinct from land-surface temperature.
- Shade rays use the same sun and building geometry as rendering, including footprint holes, minimum heights and Opera House shells. A BVH narrows building intersections. Tree canopies use illustrative spheres. Five nearby samples determine candidate shade. Arrival is the first five-minute sample with at least 60% shaded, still meeting that threshold ten minutes later within the scenario period. Already shaded has zero wait; no qualifying shade by 18:00 uses the maximum wait contribution.
- Natural temperature change compares the no-fog scenario now and one hour later, capped at 18:00. The label changes to “Natural change to 18:00” when less than an hour remains; at 18:00 the difference is zero.
- Centre cooling: `7.5 * outputFraction * (1 - humidityFraction) / (1 + windKmh / 30) * clamp((temperatureC - 23) / 8, 0, 1)` °C.
- Radius is zero at zero output, otherwise `20 + 0.24 * outputPercent` metres. Inside the radius, cooling is multiplied by `(1 - (distance / radius)^2)^2`; outside it, cooling is zero. Removed units have no influence. Overlapping influences use the **largest local reduction**, not their sum.
- Priority score: `100 * (0.50 * heat + 0.35 * flow + 0.15 * shadeWait)`, rounded. Heat normalises 25–35°C; flow 0–2,400 people/hour; wait 0–120 minutes. Each term is clamped to 0–1. This compares three candidates, not every city location or a proven optimum.

Water use, costs, mains connections, permits, device specifications, measured pedestrian counts, live meteorology and validated evaporative-cooling/CFD performance are outside the model. Live and cached map versions can have different geometry, hence different calculated shade and rankings.

## Modules and evidence

| File | Responsibility |
| --- | --- |
| `dist/index.html`, `style.css`, `cooling.css` | Accessible English UI, desktop workspace and mobile sheet |
| `dist/i18n.js` | Central Australian English static/dynamic copy and number formatting |
| `dist/scenario-time.js` | Sydney dates, DST offsets, solar approximation and time bounds |
| `dist/gis-data.js` | Live/snapshot loading, decoding, polygon union/clipping and metric projection |
| `dist/gis-city.js` | GIS buildings, roads, water, park trees and candidate validation |
| `dist/architecture.js` | Procedural facade materials and accelerated footprint occlusion |
| `dist/opera-house.js` | Curved landmark shells, podium and retained triangle occlusion |
| `dist/pedestrians.js` | Instanced walkers with synchronised body, arm and leg movement |
| `dist/pedestrian-motion.js` | Validated street segments, metric walking speeds, smooth turns and continuous travel |
| `dist/simulation.js` | Illustrative thermal, output, radius, footfall and ranking functions |
| `dist/chat.js`, `chat.css` | Header chat icon, responsive conversation panel and backend chat, scenario context and saved responses |
| `dist/camera.js` | Interruptible eased camera transitions with reduced-motion support |
| `dist/app.js` | State, scene integration, fog, heat, labels, picking and UI events |
| `qa/browser-qa.mjs` | Real Chrome interactions, loading failures, responsive layout and screenshots |

Static geometry is batched by material, people are instanced with movement updates capped at 30 Hz, pixel ratio is capped and shade is recalculated on scenario changes rather than every frame. Motion respects reduced-motion preferences; rendering pauses in background tabs. Displaced clickable labels have leader lines; mobile hides secondary landmark labels to preserve map space.

Finished views: [Desktop](qa/desktop.png), [Mobile](qa/mobile.png), [Opera House](qa/opera-house.png), [Street detail](qa/street-detail.png), [Top-down](qa/top-down.png). See [qa/results.json](qa/results.json) for checks that actually ran.

The private visual-reference URL was unavailable during implementation; the supplied source, DESIGN.md and written specification guided the result.

Walking-motion verification: `node test-pedestrians.mjs` covers route safety, turns, loops and whole-body instance movement. With the server running, `node qa/walking-qa.mjs` checks actual travel, layer pause/resume, crowd changes, mobile and reduced motion in Chrome. It also uses ffmpeg to generate [walking.gif](qa/walking.gif); override `FFMPEG_PATH` if needed. The latest targeted results are in [qa/walking-results.json](qa/walking-results.json). These are illustrative short back-and-forth walks on mapped segments, not destination or crowd-avoidance modelling.

## Connected planning chat

Select **Ask Mist** to send questions through the existing LangGraph agent. The backend still performs its catalog lookup, Zetaris SQL, Meterless recall/save, allocation and validated JSON export. The registered backend analysis date is used; the sample map date is not sent as a replacement.

- The first question starts a fresh scenario (`fresh_start: true`). Follow-ups send the last completed `previous_run_id`, and conditions are remembered within that conversation.
- The refresh icon is labelled **Start new scenario**. It clears this tab's conversation and displayed plan, then starts the next request without earlier conditions. Existing execution logs and Meterless memories remain stored. It is disabled while a request is pending.
- Responses and the pending run ID survive page reload in session storage. Resuming a response polls its ID; it does not resubmit the question. Polling is bounded and **Check response** reconnects after an interruption.
- Only a completed response with a validated `cool-sydney.fog-plan.v1` plan updates **Candidate locations**. The right column is **Fog units**, sorted by unit count descending. A failed request keeps the previous valid plan.
- Each segment shows its name, site ID and unit count. Selecting it shows its schedule, water use and reference coordinates, and focuses the map when coordinates exist. Missing coordinates are labelled rather than invented.
- Map markers represent survey reference locations and unit counts, not exact individual installations. The earlier illustrative installed fog is turned off while an agent plan is displayed; quantities are not multiplied into the sample cooling model.
- The 8766 monitoring page shows these same backend runs and their complete prompts, SQL, memory use and JSON. Internal execution traces are not shown in the user chat.

`npm test` checks the proxy and replays the five recorded English responses through the chat client and candidate panel without making paid model calls. Optional `node qa/chat-qa.mjs` uses Playwright and recorded API fixtures to check the connected UI and responsive layout. It writes `qa/connected-chat-results.json` and `qa/connected-chat-*.png` when actually run. Earlier `chat-*.png` and `chat-results.json` document the former UI preview, not the connected implementation.
