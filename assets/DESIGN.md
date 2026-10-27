# Mist / Sydney

Visual thesis: an animated architectural visualization with a credible CBD skyline: varied footprints and setbacks, blue-grey glazed towers, warm sandstone and brick street walls, fine windows and planted roof terraces. Preserve clean light, restrained color, trees and softly animated mist.

Content plan: full-screen Sydney city as the primary workspace; a cooling-location inspector with candidate priority, footfall, shade arrival, natural temperature trend, and before/after local air temperature. Keep the timeline and an explicit before/after map comparison.

Interaction thesis: select a candidate on the map or inspector; install/remove fog and vary shared nozzle output; animate the changing sun, street temperatures, footfall and priorities through the day.

Scope: real OpenFreeMap vector geometry with illustrative thermal/footfall data and an uncalibrated cooling model. No route planning. Show simulated cooling footprints and emissions while preserving the quiet reference aesthetic.

Architecture pass: use a long-lens perspective for the 3D view and a true orthographic plan view. Model distinct podiums and upper masses, curved/chamfered/L-shaped footprints, finer window rhythms, storefront canopies, parapets and HVAC. Keep procedural colors free of photographic grime. Massing now follows OpenFreeMap vector outlines, courtyard holes and render_height/render_min_height attributes. Keep geographic scale and existing building parts intact. Assign only cosmetic façade and rooftop detail; identify park trees as illustrative. Show vector connection vs snapshot fallback status and persistent map attribution.

Opera House landmark: retain the OpenFreeMap location and scale, replace the simple extrusion with paired rows of overlapping white vaulted shells, radial seams, dark glazed fronts, a warm stone podium and stepped forecourt. Keep all other vector massing. Region selection visibly zooms and centres the district; Quay is viewed from the harbour and Martin Place from a steeper overhead angle to reveal the street.

English implementation: use a single Australian English copy module, preserve the buildless Three.js/GIS baseline and keep sample data explicit. The mobile inspector collapses secondary facts and output into an expandable sheet, while keeping candidates, temperature comparison and installation actions available. Camera movement, fine mist and small instanced limb movements give the scene restrained motion. Focused labels take priority and use leader lines if displaced; secondary mobile landmark labels are hidden to reduce collisions.

Walking motion pass — visual thesis: keep the quiet architectural miniature, with small human movements that make its scale legible. Content plan: retain the existing city workspace, inspector and controls; add movement directly to its pedestrians. Interaction thesis: people travel along validated mapped street segments, pair travel speed with alternating arm/leg swings, and slow down for smooth turns at segment ends. Respect the Pedestrians layer and reduced-motion setting.

Chat pass — visual thesis: a quiet teal assistant entry point and a translucent conversation panel that belongs to the architectural workspace. Content plan: an icon in the slim header opens one panel with a title, current-scenario context, readable conversation, a few starter questions and a composer. Interaction thesis: a short panel entrance, clear local-message feedback and dependable close/focus behaviour; use a full-height sheet on mobile and respect reduced motion. This pass is UI-only: show local user messages, identify the disconnected agent clearly and make no API calls.
