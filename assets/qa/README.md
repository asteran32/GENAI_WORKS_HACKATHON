# Verification evidence

The completed application passed `npm run build`, `npm test` (five test files), and **50 real Chrome integration checks**. The observed browser run is recorded in [results.json](results.json); no relevant runtime/console errors were recorded in working scenarios. Expected network failures were deliberately introduced for cache/retry tests.

Browser sizes: **1440 × 1000**, **1024 × 768**, **390 × 844** with touch/mobile emulation, and **320 × 740**. Checks covered list/label/map-area navigation for all three candidates, Opera House focus, orthographic/3D transitions, drag/click separation, interrupted camera motion, installation persistence/removal, zero output, relative output effects, consistent comparisons, time/weather/ranking updates, Sydney winter timezone, reduced motion and data-source failure recovery.

Both live and bundled maps produced **2,473 rendered building parts** and **17,574 street-temperature segments** in this run. The bundled extract has 2,508 raw parts; rendering also filters empty-height/degenerate parts. The unit landmark test observed eight raw source parts replaced on the Opera House site. Current live schema fields and the resolved tile template are in [map-schema.json](map-schema.json).

Screenshots were inspected visually during implementation:

- [Desktop overview](desktop.png)
- [Small desktop](desktop-1024.png)
- [Mobile overview](mobile.png)
- [Narrow mobile](mobile-320.png)
- [Mobile location facts](mobile-details.png) and [output controls](mobile-output.png)
- [Opera House](opera-house.png)
- [Orthographic top-down view](top-down.png)
- [Street cooling footprint](street-detail.png)
- [Pedestrian close-up](people-detail.png)

The private visual-reference URL was inaccessible. The supplied specification and source guided the design. Visual geometry and illustrative calculations were tested; this does not validate thermal performance against measurements, installation feasibility or city-wide optimality. Touch emulation does not replace testing on physical mobile hardware.

## Walking motion update

After the walking update, the build check and all **six** test files passed. A focused real Chrome run passed **10** walking checks on desktop/mobile and with reduced motion, with no relevant console/runtime errors: [walking-results.json](walking-results.json). In the 1.4-second movement sample, visible people moved 0.41–2.03 m (mean 1.59 m). The check also sampled every walker throughout the close-up to detect building/water incursions.

[Animated walking preview](walking.gif) · [Desktop](walking-desktop.png) · [Mobile](walking-mobile.png).

## Chat UI preview

The UI-only chat passed **32** focused Chrome checks: open/close and focus, drafts/messages retained on reopen, Enter/Shift+Enter and IME handling, empty-message prevention, safe text rendering, clear/reset, long-message scrolling, 390px/320px layouts, a short keyboard-sized viewport, reduced motion and zero agent/API requests. Existing build and six test files also passed.

[Results](chat-results.json) · [Welcome / desktop](chat-welcome-desktop.png) · [Message / desktop](chat-desktop.png) · [390px mobile](chat-mobile-390.png) · [320px mobile](chat-mobile-320.png).
