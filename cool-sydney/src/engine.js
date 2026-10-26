/* Shared deterministic calculation engine, used in the browser and Node worker. */
(function (root) {
  'use strict';
  const VERSION = 'shade-access-0.1.0', DEG = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round = (v, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
  function localInstant(date, hour, zone = 'Australia/Sydney') {
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
  // NOAA General Solar Position Calculations; no atmospheric refraction correction.
  function sunPosition(instant, latitude, longitude) {
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
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const v of p) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), v) <= 0) lower.pop(); lower.push(v); }
    for (const v of p.slice().reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), v) <= 0) upper.pop(); upper.push(v); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  function contains(polygon, x, y) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function footprint(b) { return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.d], [b.x, b.y + b.d]]; }
  function shadowPolygons(data, sun) {
    if (!sun.daytime) return [];
    const scale = 1 / Math.tan(sun.altitude * DEG), dx = -Math.sin(sun.azimuth * DEG) * scale, dy = -Math.cos(sun.azimuth * DEG) * scale;
    const shapes = data.buildings.map(b => {
      const pts = footprint(b);
      return { id: b.id, kind: 'building', transmission: 0, polygon: hull(pts.concat(pts.map(p => [p[0] + dx * b.height, p[1] + dy * b.height]))) };
    });
    for (const t of data.trees) {
      const pts = [];
      for (const height of [t.height * .6, t.height]) for (let k = 0; k < 12; k++) pts.push([t.x + dx * height + t.radius * Math.cos(k * Math.PI / 6), t.y + dy * height + t.radius * Math.sin(k * Math.PI / 6)]);
      shapes.push({ id: t.id, kind: 'tree', transmission: t.transmission, polygon: hull(pts) });
    }
    for (const s of shapes) s.bounds = [Math.min(...s.polygon.map(p => p[0])), Math.min(...s.polygon.map(p => p[1])), Math.max(...s.polygon.map(p => p[0])), Math.max(...s.polygon.map(p => p[1]))];
    return shapes;
  }
  function transmissionAt(shapes, x, y, daytime = true) {
    if (!daytime) return 0;
    let value = 1;
    for (const s of shapes) {
      const b = s.bounds;
      if (x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3] && contains(s.polygon, x, y)) {
        value = Math.min(value, s.transmission); // Overlapping tree silhouettes are not independently multiplied.
        if (!value) break;
      }
    }
    return value;
  }
  function shadeSnapshot(data, input) {
    const instant = localInstant(input.date, input.hour, data.timezone), sun = sunPosition(instant, data.latitude, data.longitude);
    const shadows = shadowPolygons(data, sun);
    let outdoor = 0, shaded = 0;
    for (let y = 10; y < data.height; y += 20) for (let x = 10; x < data.width; x += 20) {
      if (data.buildings.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.d)) continue;
      outdoor++;
      if (transmissionAt(shadows, x, y, sun.daytime) < .5) shaded++;
    }
    return { sun, shadows, shadePercent: sun.daytime ? round(shaded / outdoor * 100) : null, outdoorSamples: outdoor, resolutionM: 20 };
  }
  function validateInput(data, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('시나리오 입력이 필요합니다.');
    const defaults = { date: '2027-01-15', hour: 14, budget: 60000, maxFacilities: 3, walkMinutes: 15, speed: 1, accessibleOnly: true, extendHours: false, candidateIds: data.facilities.filter(f => !f.existing).map(f => f.id) };
    const s = { ...defaults, ...raw };
    if (typeof s.date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(s.date) || Number.isNaN(Date.parse(`${s.date}T12:00:00Z`)) || new Date(`${s.date}T12:00:00Z`).toISOString().slice(0, 10) !== s.date || s.date < '2020-01-01' || s.date > '2035-12-31') throw new Error('2020–2035년의 유효한 날짜를 선택하세요.');
    for (const [key, min, max] of [['hour', 8, 18], ['budget', 0, 100000], ['maxFacilities', 0, 5], ['walkMinutes', 5, 20], ['speed', .5, 1.5]]) {
      if (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw new Error(`${key}: ${min}–${max} 범위의 숫자가 필요합니다.`);
    }
    if (!Number.isInteger(s.maxFacilities) || !Number.isInteger(s.budget)) throw new Error('시설 수와 예산은 정수여야 합니다.');
    for (const key of ['accessibleOnly', 'extendHours']) if (typeof s[key] !== 'boolean') throw new Error(`${key}: boolean 값이 필요합니다.`);
    if (!Array.isArray(s.candidateIds) || s.candidateIds.length > 5 || new Set(s.candidateIds).size !== s.candidateIds.length || s.candidateIds.some(id => !data.facilities.some(f => f.id === id && !f.existing))) throw new Error('시설 후보 목록이 올바르지 않습니다.');
    if (s.extendHours && s.budget < 8000) throw new Error('운영 연장에는 최소 A$8,000의 시나리오 예산이 필요합니다.');
    return Object.fromEntries(Object.keys(defaults).map(k => [k, k === 'candidateIds' ? s[k].slice().sort() : s[k]]));
  }
  function shortestPaths(data, start, accessibleOnly) {
    const n = data.nodes.length, distance = Array(n).fill(Infinity), previous = Array(n).fill(-1), visited = Array(n).fill(false);
    const adjacency = Array.from({ length: n }, () => []);
    for (const e of data.edges) if (!accessibleOnly || e.accessible) { adjacency[e.a].push([e.b, e.length]); adjacency[e.b].push([e.a, e.length]); }
    distance[start] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!visited[i] && (u < 0 || distance[i] < distance[u])) u = i;
      if (u < 0 || distance[u] === Infinity) break;
      visited[u] = true;
      for (const [v, length] of adjacency[u]) if (distance[u] + length < distance[v]) { distance[v] = distance[u] + length; previous[v] = u; }
    }
    return { distance, path(target) { if (!Number.isFinite(distance[target])) return []; const p = [target]; while (p[0] !== start) p.unshift(previous[p[0]]); return p; } };
  }
  function buildRoutes(data, input) {
    const cache = new Map(), start = localInstant(input.date, input.hour, data.timezone).getTime();
    const at = minutes => {
      const key = Math.floor(minutes);
      if (!cache.has(key)) { const sun = sunPosition(new Date(start + key * 60000), data.latitude, data.longitude); cache.set(key, { daytime: sun.daytime, shapes: shadowPolygons(data, sun) }); }
      return cache.get(key);
    };
    const routes = {};
    for (const d of data.demand) {
      const graph = shortestPaths(data, d.node, input.accessibleOnly);
      routes[d.id] = {};
      for (const f of data.facilities) {
        const distance = graph.distance[f.node], minutes = distance / input.speed / 60;
        if (minutes > input.walkMinutes || (input.accessibleOnly && !f.accessible)) continue;
        const path = graph.path(f.node);
        let elapsed = 0, sunMinutes = 0;
        for (let i = 1; i < path.length; i++) {
          const a = data.nodes[path[i - 1]], b = data.nodes[path[i]], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(length / 20), dt = length / steps / input.speed / 60;
          for (let j = 0; j < steps; j++) {
            const t = (j + .5) / steps, sample = at(elapsed + dt / 2);
            sunMinutes += dt * transmissionAt(sample.shapes, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, sample.daytime);
            elapsed += dt;
          }
        }
        routes[d.id][f.id] = { distance, minutes, sunMinutes, path };
      }
    }
    return routes;
  }
  // Capacitated bipartite maximum flow: maximize priority coverage, then total
  // coverage while allowing previous assignments to move through residual edges.
  function allocate(data, input, activeIds, routes, extended = false) {
    const facilities = data.facilities.filter(f => activeIds.includes(f.id) && (!input.accessibleOnly || f.accessible));
    const graph = [], addNode = () => (graph.push([]), graph.length - 1);
    const source = addNode(), priorityGroup = addNode(), generalGroup = addNode(), sink = addNode();
    const addEdge = (u, v, cap) => { const e = { to: v, cap, initial: cap, reverse: graph[v].length }; graph[u].push(e); graph[v].push({ to: u, cap: 0, initial: 0, reverse: graph[u].length - 1 }); return e; };
    addEdge(source, priorityGroup, 1e7);
    const generalSource = addEdge(source, generalGroup, 0);
    const fnodes = new Map(), assignmentEdges = [];
    for (const f of facilities) { const node = addNode(); fnodes.set(f.id, node); addEdge(node, sink, f.capacity); }
    for (const d of data.demand) for (const [group, population] of [['priority', d.priority], ['general', d.population - d.priority]]) {
      const node = addNode(); addEdge(group === 'priority' ? priorityGroup : generalGroup, node, population);
      for (const f of facilities.slice().sort((a, b) => (routes[d.id][a.id]?.minutes ?? Infinity) - (routes[d.id][b.id]?.minutes ?? Infinity))) {
        const route = routes[d.id][f.id], close = extended && f.existing ? 20 : f.close;
        // One arrival cohort, 30-minute dwell; no turnover/throughput claim.
        if (!route || input.hour < f.open || input.hour + route.minutes / 60 + .5 > close) continue;
        assignmentEdges.push({ demandId: d.id, facilityId: f.id, group, route, edge: addEdge(node, fnodes.get(f.id), population) });
      }
    }
    const augment = () => {
      while (true) {
        const parents = Array(graph.length).fill(null), queue = [source]; parents[source] = [-1, -1];
        for (let qi = 0; qi < queue.length && !parents[sink]; qi++) {
          const u = queue[qi];
          for (let ei = 0; ei < graph[u].length; ei++) { const e = graph[u][ei]; if (e.cap > 0 && !parents[e.to]) { parents[e.to] = [u, ei]; queue.push(e.to); } }
        }
        if (!parents[sink]) break;
        let amount = Infinity;
        for (let v = sink; v !== source;) { const [u, i] = parents[v]; amount = Math.min(amount, graph[u][i].cap); v = u; }
        for (let v = sink; v !== source;) { const [u, i] = parents[v], e = graph[u][i]; e.cap -= amount; graph[v][e.reverse].cap += amount; v = u; }
      }
    };
    augment(); generalSource.cap = 1e7; generalSource.initial = 1e7; augment();
    const assignments = assignmentEdges.map(a => ({ demandId: a.demandId, facilityId: a.facilityId, group: a.group, count: a.edge.initial - a.edge.cap, ...a.route })).filter(a => a.count > 0);
    const served = assignments.reduce((sum, a) => sum + a.count, 0), priorityServed = assignments.filter(a => a.group === 'priority').reduce((sum, a) => sum + a.count, 0);
    const population = data.demand.reduce((s, d) => s + d.population, 0), priorityPopulation = data.demand.reduce((s, d) => s + d.priority, 0);
    const clusters = data.demand.map(d => ({ ...d, served: assignments.filter(a => a.demandId === d.id).reduce((s, a) => s + a.count, 0) }));
    const usage = facilities.map(f => ({ id: f.id, capacity: f.capacity, served: assignments.filter(a => a.facilityId === f.id).reduce((s, a) => s + a.count, 0) }));
    return { served, priorityServed, population, priorityPopulation, unmet: population - served, priorityUnmet: priorityPopulation - priorityServed, coverage: round(served / population * 100), priorityCoverage: round(priorityServed / priorityPopulation * 100), meanWalkMinutes: served ? round(assignments.reduce((s, a) => s + a.minutes * a.count, 0) / served, 2) : null, meanSunMinutes: served ? round(assignments.reduce((s, a) => s + a.sunMinutes * a.count, 0) / served, 2) : null, assignments, clusters, usage, activeIds };
  }
  function solve(data, raw) {
    const input = validateInput(data, raw), routes = buildRoutes(data, input);
    const baselineIds = data.facilities.filter(f => f.existing).map(f => f.id);
    const baseline = { ...allocate(data, input, baselineIds, routes), cost: 0, selectedIds: [] };
    const candidates = data.facilities.filter(f => input.candidateIds.includes(f.id) && (!input.accessibleOnly || f.accessible));
    const alternatives = [];
    for (let mask = 0; mask < 2 ** candidates.length; mask++) {
      const selected = candidates.filter((f, i) => mask & (1 << i));
      const cost = selected.reduce((s, f) => s + f.cost, input.extendHours ? 8000 : 0);
      if (selected.length > input.maxFacilities || cost > input.budget) continue;
      const a = allocate(data, input, baselineIds.concat(selected.map(f => f.id)), routes, input.extendHours);
      const additional = a.served - baseline.served;
      alternatives.push({ ...a, cost, selectedIds: selected.map(f => f.id), additional, costPerAdditional: additional > 0 ? round(cost / additional, 2) : null });
    }
    alternatives.sort((a, b) => b.priorityServed - a.priorityServed || b.served - a.served || a.cost - b.cost || (a.meanSunMinutes ?? Infinity) - (b.meanSunMinutes ?? Infinity) || a.selectedIds.join().localeCompare(b.selectedIds.join()));
    if (!alternatives.length) throw new Error('예산과 제약을 만족하는 시나리오가 없습니다.');
    const best = alternatives[0], snapshot = shadeSnapshot(data, input);
    const result = { solverVersion: VERSION, datasetVersion: data.version, dataKind: data.kind, input, baseline, best, alternatives: alternatives.slice(0, 3), evaluated: alternatives.length, sun: snapshot.sun, shadePercent: snapshot.shadePercent, shadeResolutionM: 20, sources: data.provenance, assumptions: data.provenance.assumptions, objective: '우선 지원 집단 수용 인원 → 전체 수용 인원 → 낮은 비용 → 낮은 노출 평균', modelUsage: { calls: 0, mode: 'deterministic' } };
    const errors = validateResult(data, result);
    if (errors.length) throw new Error('계산 결과 검증 실패: ' + errors.join(', '));
    result.validationStatus = 'passed';
    return result;
  }
  function validateResult(data, r) {
    const errors = [], tolerance = 1e-6;
    for (const [label, a] of [['baseline', r.baseline], ...r.alternatives.map((a, i) => [`alternative-${i}`, a])]) {
      if (a.served < 0 || a.served > a.population || a.priorityServed > a.priorityPopulation || a.priorityServed > a.served) errors.push(label + ': population');
      if (a.cost > r.input.budget || a.selectedIds.length > r.input.maxFacilities) errors.push(label + ': budget/count');
      if (a.assignments.reduce((s, x) => s + x.count, 0) !== a.served) errors.push(label + ': total');
      for (const u of a.usage) if (u.served > u.capacity) errors.push(label + ': capacity');
      for (const d of data.demand) for (const group of ['priority', 'general']) {
        const count = a.assignments.filter(x => x.demandId === d.id && x.group === group).reduce((s, x) => s + x.count, 0);
        if (count > (group === 'priority' ? d.priority : d.population - d.priority)) errors.push(label + ': duplicate');
      }
      for (const x of a.assignments) {
        const f = data.facilities.find(f => f.id === x.facilityId), close = label !== 'baseline' && r.input.extendHours && f.existing ? 20 : f.close;
        if (x.minutes > r.input.walkMinutes + tolerance || x.sunMinutes < 0 || x.sunMinutes > x.minutes + tolerance) errors.push(label + ': travel');
        if (r.input.hour < f.open || r.input.hour + x.minutes / 60 + .5 > close + tolerance) errors.push(label + ': hours');
        if (r.input.accessibleOnly && !f.accessible) errors.push(label + ': accessibility');
      }
    }
    return errors;
  }
  const api = { VERSION, localInstant, sunPosition, hull, contains, footprint, shadowPolygons, transmissionAt, shadeSnapshot, validateInput, shortestPaths, buildRoutes, allocate, solve, validateResult, round };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CoolEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
