import { expect, test } from 'vitest';
import {
  geoAzimuthalEqualAreaRaw,
  geoConicConformalRaw,
  geoConicEqualAreaRaw,
  geoDistance,
  geoEquirectangularRaw,
  geoMercatorRaw,
  geoTransverseMercator,
} from 'd3-geo';
import { geoCylindricalEqualAreaRaw, geoInterruptedHomolosine } from 'd3-geo-projection';
import { getDef, stops } from '../src/projections/catalog';
import { compile, matchStop, stateForStop } from '../src/projections/compile';
import { cylindricalRaw, goodeRaw, perspectiveRaw } from '../src/projections/raws';
import type { Lobe, LonLat, ProjectionState } from '../src/projections/types';

const rad = Math.PI / 180;

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point uniformly distributed on the sphere, in degrees. */
function randomPoint(r: () => number): LonLat {
  return [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
}

function stop(id: string) {
  const s = stops.find((x) => x.id === id);
  if (!s) throw new Error(`no stop ${id}`);
  return s;
}

function lobeFor(lobes: Lobe[], p: LonLat): Lobe {
  const lobe = lobes.find(
    (l) => p[0] >= l.lonMin && p[0] <= l.lonMax && p[1] >= l.latMin && p[1] <= l.latMax,
  );
  if (!lobe) throw new Error(`no lobe for ${p}`);
  return lobe;
}

function expectPair(actual: [number, number], expected: [number, number], eps = 1e-9) {
  expect(actual[0]).toBeCloseTo(expected[0], -Math.log10(eps));
  expect(actual[1]).toBeCloseTo(expected[1], -Math.log10(eps));
}

test('every stop compiles to finite positions at 200 random frame points outside its caps', () => {
  expect(stops.length).toBe(21);
  for (const s of stops) {
    const c = compile(stateForStop(s));
    const r = rng(7);
    let tested = 0;
    while (tested < 200) {
      const p = randomPoint(r);
      const inCap = c.caps.some((cap) => geoDistance(p, cap.frameCenter) / rad < cap.radius);
      if (inCap) continue;
      const lobe = c.def.seam.kind === 'lobes' ? lobeFor(c.def.seam.lobes, p).centralLon * rad : undefined;
      const [x, y] = c.raw(p[0] * rad, p[1] * rad, lobe);
      expect(Number.isFinite(x) && Number.isFinite(y), `${s.id} at ${p}`).toBe(true);
      tested++;
    }
  }
});

test('stop ids and names are unique and every stop refers to a real definition', () => {
  expect(new Set(stops.map((s) => s.id)).size).toBe(stops.length);
  expect(new Set(stops.map((s) => s.name)).size).toBe(stops.length);
  for (const s of stops) {
    expect(() => getDef(s.defId)).not.toThrow();
    expect(s.note.length).toBeGreaterThan(10);
  }
  expect(stop('equal-earth').note).toMatch(/Correct the Map/);
});

test('perspective raw hits the three named azimuthals', () => {
  // A point at angular distance c from the centre, along the central meridian.
  for (const c of [0.2, 0.6, 1.2]) {
    const radial = (P: number) => {
      const [x, y] = perspectiveRaw(P)(0, c);
      return Math.hypot(x, y);
    };
    expect(radial(0)).toBeCloseTo(Math.tan(c), 12);
    expect(radial(1)).toBeCloseTo(2 * Math.tan(c / 2), 12);
    expect(radial(Infinity)).toBeCloseTo(Math.sin(c), 12);
  }
  // Off the central meridian the radial distance depends only on c.
  const lambda = 0.5;
  const phi = 0.4;
  const c = Math.acos(Math.cos(phi) * Math.cos(lambda));
  const [x, y] = perspectiveRaw(1)(lambda, phi);
  expect(Math.hypot(x, y)).toBeCloseTo(2 * Math.tan(c / 2), 12);
});

test('perspective stops use P = x / (1 - x) with x = 1 as orthographic', () => {
  const sample: [number, number][] = [[0.3, 0.2], [-0.5, 0.4], [0.1, -0.7]];
  for (const [id, P] of [['gnomonic', 0], ['stereographic', 1], ['orthographic', Infinity]] as const) {
    const c = compile(stateForStop(stop(id)));
    for (const [l, p] of sample) expectPair(c.raw(l, p), perspectiveRaw(P)(l, p));
  }
  const globe = compile(stateForStop(stop('globe')));
  const ortho = compile(stateForStop(stop('orthographic')));
  for (const [l, p] of sample) expectPair(globe.raw(l, p), ortho.raw(l, p));
});

test('perspective cap grows as the viewpoint moves toward the globe', () => {
  const def = getDef('perspective');
  const radius = (x: number) => def.caps({ x })[0]!.radius;
  expect(radius(0)).toBeCloseTo(180 - 68, 9); // gnomonic reaches 68 degrees
  expect(radius(0.5)).toBeCloseTo(180 - 165, 9); // stereographic reaches 165
  expect(radius(1)).toBeCloseTo(90, 9); // orthographic is a hemisphere
  expect(def.caps({ x: 1 })[0]!.mode).toBe('clip');
  expect(getDef('globe').caps({})[0]).toEqual({ frameCenter: [180, 0], radius: 90, mode: 'behind' });
});

test('cylindrical family stops', () => {
  const sample: [number, number][] = [[0.3, 0.2], [-1.5, 0.9], [2.5, -1.1], [0, 0.5], [-3, -0.3]];
  for (const [phi0, id] of [[0, 'lambert-cylindrical'], [30, 'behrmann'], [45, 'gall-peters']] as const) {
    const c = compile(stateForStop(stop(id)));
    const ref = geoCylindricalEqualAreaRaw(phi0 * rad);
    for (const [l, p] of sample) expectPair(c.raw(l, p), ref(l, p));
  }
  const merc = compile(stateForStop(stop('mercator')));
  const eq = compile(stateForStop(stop('equirectangular')));
  for (const [l, p] of sample) {
    expectPair(merc.raw(l, p), geoMercatorRaw(l, p));
    expectPair(eq.raw(l, p), geoEquirectangularRaw(l, p));
  }
});

test('in-between vertical spacing interpolates linearly between the stops', () => {
  const [l, p] = [0.4, 0.8];
  const a = cylindricalRaw(0, 0)(l, p);
  const b = cylindricalRaw(0, 1)(l, p);
  const mid = cylindricalRaw(0, 0.5)(l, p);
  expect(mid[1]).toBeCloseTo((a[1] + b[1]) / 2, 12);
  const c = cylindricalRaw(0, 2)(l, p);
  expect(cylindricalRaw(0, 1.5)(l, p)[1]).toBeCloseTo((b[1] + c[1]) / 2, 12);
  // The exact stops are finite even at a pole, because zero-weight terms are skipped.
  expect(Number.isFinite(cylindricalRaw(0, 1)(0, -Math.PI / 2)[1])).toBe(true);
});

test('Goode lobes match d3', () => {
  const goode = getDef('goode');
  const seam = goode.seam;
  if (seam.kind !== 'lobes') throw new Error('goode has lobes');
  expect(seam.lobes.length).toBe(6);
  const ref = geoInterruptedHomolosine().scale(1).translate([0, 0]);
  const raw = goode.raw({});
  const r = rng(11);
  for (let i = 0; i < 50; i++) {
    const p = randomPoint(r);
    const lobe = lobeFor(seam.lobes, p);
    const out = raw(p[0] * rad, p[1] * rad, lobe.centralLon * rad);
    const expected = ref(p)!;
    expectPair(out, [expected[0], -expected[1]]);
    expect(goodeRaw(p[0] * rad, p[1] * rad, lobe.centralLon * rad)).toEqual(out);
  }
});

test('matchStop finds every named stop and returns null for spacing 0.5', () => {
  for (const s of stops) {
    expect(matchStop(stateForStop(s))?.id, s.id).toBe(s.id);
  }
  const custom: ProjectionState = {
    defId: 'cylindrical',
    params: { phi0: 0, spacing: 0.5 },
    orientation: { lon: 0, lat: 0, tilt: 0 },
  };
  expect(matchStop(custom)).toBeNull();
  // within 0.01 still matches, beyond does not
  expect(matchStop({ ...custom, params: { phi0: 0.005, spacing: 1.005 } })?.id).toBe('equirectangular');
  expect(matchStop({ ...custom, params: { phi0: 0.05, spacing: 1 } })).toBeNull();
});

test('Mercator stop matches at any phi0; tilt 90 matches Transverse Mercator', () => {
  const base: ProjectionState = {
    defId: 'cylindrical',
    params: { phi0: 33, spacing: 0 },
    orientation: { lon: 0, lat: 0, tilt: 0 },
  };
  expect(matchStop(base)?.id).toBe('mercator');
  expect(matchStop({ ...base, orientation: { ...base.orientation, tilt: 90 } })?.id).toBe('transverse-mercator');
  expect(matchStop({ ...base, orientation: { ...base.orientation, tilt: 45 } })).toBeNull();
  // A tilt of 0.005 is within tolerance.
  expect(matchStop({ ...base, orientation: { ...base.orientation, tilt: 0.005 } })?.id).toBe('mercator');

  // The Transverse Mercator stop gives d3's transverse Mercator turned a quarter turn: d3 builds
  // that turn into its raw projection, ours leaves it to the screen's tilt compensation. The turn
  // is a quarter turn clockwise on a y-up plane, (x, y) -> (y, -x) taking ours to d3's, the same
  // for every point. That pins the sign of the tilt: +90 is d3's own rotate([0, 0, 90]).
  const c = compile(stateForStop(stop('transverse-mercator')));
  const d3tm = geoTransverseMercator().scale(1).translate([0, 0]);
  const r = rng(3);
  let checked = 0;
  while (checked < 30) {
    const p = randomPoint(r);
    if (Math.abs(p[1]) > 80) continue;
    const frame = c.toFrame(p);
    const got = c.raw(frame[0] * rad, frame[1] * rad);
    const screen = d3tm(p)!;
    const want: [number, number] = [screen[0], -screen[1]]; // d3 screen y points down
    expectPair([got[1], -got[0]], want);
    checked++;
  }
});

test('conic parallels at 0/0 match Mercator; ±45 equal-area matches Gall-Peters', () => {
  const sample: [number, number][] = [[0.3, 0.2], [-1.5, 0.9], [2.5, -1.1]];
  const conformal = getDef('conic-conformal').raw({ p1: 0, p2: 0 });
  const equalArea = getDef('conic-equal-area').raw({ p1: -45, p2: 45 });
  const gallPeters = geoCylindricalEqualAreaRaw(45 * rad);
  for (const [l, p] of sample) {
    expectPair(conformal(l, p), geoMercatorRaw(l, p));
    expectPair(equalArea(l, p), gallPeters(l, p));
  }
  // and a real cone agrees with d3's own
  const alb = compile(stateForStop(stop('albers')));
  const ref = geoConicEqualAreaRaw(29.5 * rad, 45.5 * rad);
  for (const [l, p] of sample) expectPair(alb.raw(l, p), ref(l, p));
  const lcc = compile(stateForStop(stop('lambert-conformal')));
  const refC = geoConicConformalRaw(33 * rad, 45 * rad);
  for (const [l, p] of sample) expectPair(lcc.raw(l, p), refC(l, p));
});

test('conic caps follow the apex and cone constant', () => {
  const n = (Math.sin(29.5 * rad) + Math.sin(45.5 * rad)) / 2;
  const caps = getDef('conic-equal-area').caps({ p1: 29.5, p2: 45.5 });
  expect(caps).toEqual([
    { frameCenter: [0, 90], radius: 0.1, mode: 'clip' },
    { frameCenter: [0, -90], radius: 0.1 + 25 * n, mode: 'clip' },
  ]);
  // southern cone flips the apex
  const south = getDef('conic-conformal').caps({ p1: -30, p2: -45 });
  expect(south[0]).toEqual({ frameCenter: [0, -90], radius: 0.1, mode: 'clip' });
  expect(south[1]!.frameCenter).toEqual([0, 90]);
  expect(south[1]!.radius).toBeGreaterThan(5);
});

test('cylindrical caps run from 5 degrees at Mercator to 0.1 from equirectangular onward', () => {
  const caps = (s: number) => getDef('cylindrical').caps({ phi0: 0, spacing: s });
  expect(caps(0).map((c) => c.radius)).toEqual([5, 5]);
  expect(caps(0.5)[0]!.radius).toBeCloseTo(2.55, 12);
  expect(caps(1)[0]!.radius).toBeCloseTo(0.1, 12);
  expect(caps(2)[0]!.radius).toBeCloseTo(0.1, 12);
});

test('azimuthal plain entries are not perspective views', () => {
  const ae = compile(stateForStop(stop('azimuthal-equidistant')));
  const laea = compile(stateForStop(stop('lambert-azimuthal')));
  expectPair(laea.raw(0.4, 0.3), geoAzimuthalEqualAreaRaw(0.4, 0.3));
  const [x, y] = ae.raw(0, 0.7);
  expect(Math.hypot(x, y)).toBeCloseTo(0.7, 12);
});

test('stateForStop applies the carry-over rules', () => {
  const state = (id: string, orientation: { lon: number; lat: number; tilt: number }): ProjectionState => ({
    ...stateForStop(stop(id)),
    orientation,
  });

  // no source: the destination's defaults, with stop.tilt overriding
  expect(stateForStop(stop('robinson')).orientation).toEqual({ lon: 0, lat: 0, tilt: 0 });
  expect(stateForStop(stop('transverse-mercator')).orientation.tilt).toBe(90);
  expect(stateForStop(stop('albers')).orientation).toEqual({ lon: 10, lat: 0, tilt: 0 });

  // centre and hand-set tilt carry over
  const robinson = state('robinson', { lon: 40, lat: 20, tilt: 30 });
  expect(stateForStop(stop('mollweide'), robinson).orientation).toEqual({ lon: 40, lat: 20, tilt: 30 });
  // tilt is dropped where the destination has it disabled, the centre is kept
  expect(stateForStop(stop('stereographic'), robinson).orientation).toEqual({ lon: 40, lat: 20, tilt: 0 });
  expect(stateForStop(stop('globe'), robinson).orientation).toEqual({ lon: 40, lat: 20, tilt: 0 });
  // into a conic: the conic's default centre
  expect(stateForStop(stop('albers'), robinson).orientation).toEqual({ lon: 10, lat: 0, tilt: 0 });
  // out of a conic: the destination's default centre (Task 7's store restores the earlier one)
  const albers = state('albers', { lon: 55, lat: 0, tilt: 0 });
  expect(stateForStop(stop('robinson'), albers).orientation).toEqual({ lon: 0, lat: 0, tilt: 0 });
  // stop.tilt overrides a carried tilt
  expect(stateForStop(stop('transverse-mercator'), robinson).orientation).toEqual({ lon: 40, lat: 20, tilt: 90 });
  // leaving Transverse Mercator resets tilt to 0, and keeps the centre
  const tm = state('transverse-mercator', { lon: 25, lat: 5, tilt: 90 });
  expect(stateForStop(stop('mercator'), tm).orientation).toEqual({ lon: 25, lat: 5, tilt: 0 });
  expect(stateForStop(stop('robinson'), tm).orientation).toEqual({ lon: 25, lat: 5, tilt: 0 });
  // a hand tilt of 30 on Mercator carries to Robinson
  const mercator30 = state('mercator', { lon: 0, lat: 0, tilt: 30 });
  expect(stateForStop(stop('robinson'), mercator30).orientation.tilt).toBe(30);
});

test('compile ignores tilt and latitude where the projection disables them', () => {
  const s = { ...stateForStop(stop('albers')), orientation: { lon: 10, lat: 40, tilt: 25 } };
  const c = compile(s);
  expect(c.state).toBe(s);
  expect(c.toFrame([10, 0])).toEqual([0, 0]);
  const r = compile({ ...stateForStop(stop('robinson')), orientation: { lon: 10, lat: 40, tilt: 25 } });
  const frame = r.toFrame([10, 40]);
  expect(Math.abs(frame[0]) + Math.abs(frame[1])).toBeLessThan(1e-9);
  const back = r.fromFrame(frame);
  expect(back[0]).toBeCloseTo(10, 9);
  expect(back[1]).toBeCloseTo(40, 9);
});
