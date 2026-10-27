const TAU = Math.PI * 2;
const smoothstep = value => value * value * (3 - 2 * value);

// Short, continuous pieces of mapped paths. Sample the body's footprint so a
// valid centre point cannot send walkers through an adjacent wall or water.
export function createWalkingRoutes(positions, { isWalkable = () => true, maxRoutes = 80 } = {}) {
  const routes = [];
  const candidates = [...positions].sort((a, b) => Number(!!b.path) - Number(!!a.path) || b.length - a.length);
  for (const point of candidates) {
    if (![point.x, point.z, point.angle, point.length].every(Number.isFinite)) continue;
    const dx = Math.cos(point.angle), dz = Math.sin(point.angle);
    const lane = Math.min(.12, (point.width || 0) * .16);
    for (const offset of lane ? [-lane, lane] : [0]) {
      const x = point.x - dz * offset, z = point.z + dx * offset;
      const safe = distance => {
        const px = x + dx * distance, pz = z + dz * distance;
        return [[0, 0], [-dz * .08, dx * .08], [dz * .08, -dx * .08]].every(([ox, oz]) => isWalkable([px + ox, pz + oz]));
      };
      if (!safe(0)) continue;
      const extent = Math.max(0, point.length / 2 - .12);
      const reach = sign => {
        let last = 0;
        for (let distance = .12; distance <= extent + 1e-8; distance += .12) {
          if (!safe(sign * distance)) break;
          last = distance;
        }
        return last;
      };
      const back = reach(-1), ahead = reach(1), length = back + ahead;
      if (length < 1.2) continue; // At least six metres at the app's map scale.
      routes.push({ a: [x - dx * back, z - dz * back], b: [x + dx * ahead, z + dz * ahead], length, heading: Math.atan2(dx, dz) });
      if (routes.length >= maxRoutes) return routes;
    }
  }
  return routes;
}

export function createWalker(route, { speedMps = 1.2, metersPerUnit = 5, phase = 0, strideMetres = 1.3 } = {}) {
  const speed = speedMps / metersPerUnit, ramp = .3, turn = .75;
  const travel = route.length / speed + ramp;
  return { route, speedMps, metersPerUnit, strideMetres, speed, ramp, turn, travel, period: 2 * (travel + turn), phase };
}

// Analytic motion keeps pace independent of frame rate. Each end has a short
// deceleration, a turn in place, then acceleration in the opposite direction.
export function sampleWalker(walker, elapsed) {
  const { route, speed, ramp, turn, travel, period } = walker;
  const clock = Math.max(0, elapsed) + walker.phase * period;
  const cycle = Math.floor(clock / period), time = clock % period;
  const distanceAt = time => time < ramp ? speed * time * time / (2 * ramp)
    : time > travel - ramp ? route.length - speed * (travel - time) ** 2 / (2 * ramp)
    : speed * (time - ramp / 2);
  let distance, heading = route.heading, gait = 0, travelled;
  if (time < travel) {
    distance = distanceAt(time); travelled = distance;
    gait = Math.min(1, time / ramp, (travel - time) / ramp);
  } else if (time < travel + turn) {
    distance = route.length; travelled = route.length;
    heading += Math.PI * smoothstep((time - travel) / turn);
  } else if (time < 2 * travel + turn) {
    const returning = time - travel - turn, progress = distanceAt(returning);
    distance = route.length - progress; travelled = route.length + progress; heading += Math.PI;
    gait = Math.min(1, returning / ramp, (travel - returning) / ramp);
  } else {
    distance = 0; travelled = 2 * route.length;
    heading += Math.PI + Math.PI * smoothstep((time - 2 * travel - turn) / turn);
  }
  const fraction = distance / route.length;
  const step = (cycle * 2 * route.length + travelled) * walker.metersPerUnit / walker.strideMetres * TAU;
  return {
    x: route.a[0] + (route.b[0] - route.a[0]) * fraction,
    z: route.a[1] + (route.b[1] - route.a[1]) * fraction,
    heading, gait, step, speedMps: walker.speedMps * gait
  };
}
