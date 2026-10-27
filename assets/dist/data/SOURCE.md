# Sydney CBD vector extract

- Provider: [OpenFreeMap](https://openfreemap.org/)
- TileJSON: https://tiles.openfreemap.org/planet
- Schema: [OpenMapTiles](https://openmaptiles.org/schema/)
- Underlying data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL).
- The GeoJSON file's `metadata` records the tile template, retrieval time, bounding box and zoom.
- Four zoom-14 tiles were decoded, buffered polygon duplicates merged, and polygons clipped to the Sydney CBD extent. Original height attributes and polygon holes are retained. Transportation geometry is clipped when rendered.
- This GeoJSON extract is available for reuse under ODbL; it is included alongside the application and contains no private data. OpenMapTiles schema attribution: © OpenMapTiles (CC-BY).
- Refresh with `node scripts/refresh-map.mjs` from the project root. Requests are serial and identify this application; the extract is approximately 3 MB.

Buildings use `render_height` and `render_min_height` (metres). OpenMapTiles may derive these from OSM heights or storeys; they are not guaranteed surveyed measurements. A missing, invalid or non-positive height is displayed as 3 m, and `hide_3d` outlines are excluded. Cosmetic façade materials are assigned for visual legibility. Trees, weather, temperatures and pedestrian counts are not supplied by this dataset.
