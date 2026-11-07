import { geoDistance } from 'd3-geo';
import { compile } from '../projections/compile';
import type { CompiledProjection, ExcludedCap, LonLat, Orientation } from '../projections/types';

const rad = Math.PI / 180;

export type Viewport = { width: number; height: number };
/**
 * Maps a raw projection's output to pixels. The raw point is first turned by
 * (cos, sin), the tilt compensation that keeps geographic north up, then
 * scaled by k about the origin and placed at (tx, ty). Screen y is ty - k * y.
 */
export type ScreenTransform = { k: number; tx: number; ty: number; cos: number; sin: number };

const PADDING = 16;
const FIT_STEP = 3;
const EDGE_STEP = 0.25;
const SEED_STEP = 5;
const SEED_MARGIN = 1; // degrees
const NEWTON_STEPS = 8;
const FD_STEP = 1e-4; // radians
const JACOBIAN_STEP = 1e-5; // radians
const PIXEL_TOLERANCE = 0.5;
const DRAG_STEPS = 6;
const SETTLED_PX = 0.01;
const DRAG_FD_STEP = 0.01; // degrees

/** Wraps a longitude to [-180, 180). */
function wrapLon(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function effectiveTilt(c: CompiledProjection): number {
  return c.def.tiltEnabled ? c.state.orientation.tilt : 0;
}

/** Whether a point in the projection's frame lies outside every excluded cap. */
function frameCovered(caps: ExcludedCap[], frame: LonLat): boolean {
  return !caps.some((cap) => geoDistance(frame, cap.frameCenter) / rad < cap.radius);
}

export function isCovered(c: CompiledProjection, p: LonLat): boolean {
  return frameCovered(c.caps, c.toFrame(p));
}

/** The central longitude (degrees) of the lobe that holds a frame point, or undefined for a projection without lobes. */
export function lobeOf(c: CompiledProjection, framePoint: LonLat): number | undefined {
  const seam = c.def.seam;
  if (seam.kind !== 'lobes') return undefined;
  const [lon, lat] = framePoint;
  const lobe = seam.lobes.find((l) => lon >= l.lonMin && lon <= l.lonMax && lat >= l.latMin && lat <= l.latMax);
  return lobe?.centralLon;
}

/** Raw projection output turned by the tilt compensation, before scaling. Inputs in degrees. */
function rotatedRaw(c: CompiledProjection, cs: number, sn: number, frame: LonLat, lobe: number | undefined): [number, number] {
  const [x, y] = c.raw(frame[0] * rad, frame[1] * rad, lobe === undefined ? undefined : lobe * rad);
  return [cs * x - sn * y, sn * x + cs * y];
}

/**
 * The tilt compensation: a turn of the screen that puts geographic north at the
 * centre straight up. North is at angle `tilt` from the frame's north, so it
 * points along (-sin tilt, cos tilt) in the frame's (longitude, latitude) axes.
 * The raw projection's Jacobian at the frame origin carries that direction to
 * the screen, which matters because it is not a pure turn for projections that
 * are not conformal at the centre.
 */
function compensation(c: CompiledProjection): { cos: number; sin: number } {
  const tilt = effectiveTilt(c) * rad;
  const lobe = lobeOf(c, [0, 0]);
  const raw = (lambda: number, phi: number) => c.raw(lambda, phi, lobe === undefined ? undefined : lobe * rad);
  const h = JACOBIAN_STEP;
  const [ex1, ey1] = raw(h, 0);
  const [ex0, ey0] = raw(-h, 0);
  const [nx1, ny1] = raw(0, h);
  const [nx0, ny0] = raw(0, -h);
  const dx = -Math.sin(tilt);
  const dy = Math.cos(tilt);
  const vx = (dx * (ex1 - ex0) + dy * (nx1 - nx0)) / (2 * h);
  const vy = (dx * (ey1 - ey0) + dy * (ny1 - ny0)) / (2 * h);
  const length = Math.hypot(vx, vy);
  if (!(length > 0)) return { cos: 1, sin: 0 };
  // Turning (vx, vy) to point along +y.
  return { cos: vy / length, sin: vx / length };
}

/** A region of the frame that one raw call covers: the whole sphere, or one lobe. */
type Region = { lonMin: number; lonMax: number; latMin: number; latMax: number; lobe: number | undefined };

function regions(c: CompiledProjection): Region[] {
  const seam = c.def.seam;
  if (seam.kind === 'lobes') return seam.lobes.map((l) => ({ ...l, lobe: l.centralLon }));
  return [{ lonMin: -180, lonMax: 180, latMin: -90, latMax: 90, lobe: undefined }];
}

function* range(min: number, max: number, step: number): Generator<number> {
  const n = Math.max(1, Math.round((max - min) / step));
  for (let i = 0; i <= n; i++) yield min + ((max - min) * i) / n;
}

/** The point at angular distance `distance` and bearing `azimuth` (all degrees) from `from`. Also works at a pole. */
export function destination(from: LonLat, distance: number, azimuth: number): LonLat {
  const lon = from[0] * rad;
  const lat = from[1] * rad;
  const d = distance * rad;
  const a = azimuth * rad;
  const centre = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const v = [0, 1, 2].map(
    (i) => centre[i]! * Math.cos(d) + (east[i]! * Math.sin(a) + north[i]! * Math.cos(a)) * Math.sin(d),
  );
  return [Math.atan2(v[1]!, v[0]!) / rad, Math.asin(Math.max(-1, Math.min(1, v[2]!))) / rad];
}

/** Covered frame points on a 3 degree grid, plus the region edges and the rims of the excluded caps, where a map often reaches its extremes. */
function sampleFrame(c: CompiledProjection): { frame: LonLat; lobe: number | undefined }[] {
  const out: { frame: LonLat; lobe: number | undefined }[] = [];
  const add = (frame: LonLat, lobe: number | undefined) => {
    if (frameCovered(c.caps, frame)) out.push({ frame, lobe });
  };
  for (const r of regions(c)) {
    for (const lat of range(r.latMin, r.latMax, FIT_STEP)) {
      for (const lon of range(r.lonMin, r.lonMax, FIT_STEP)) add([lon, lat], r.lobe);
    }
  }
  // The region edges (the seam and the lobe sides) at a finer step: smooth maps often peak there between grid points.
  for (const r of regions(c)) {
    for (const lat of range(r.latMin, r.latMax, EDGE_STEP)) {
      add([r.lonMin, lat], r.lobe);
      add([r.lonMax, lat], r.lobe);
    }
  }
  for (const cap of c.caps) {
    // Just outside the cap, so the point still counts as covered.
    const radius = cap.radius * (1 + 1e-9) + 1e-9;
    for (let az = 0; az < 360; az += 1) {
      const frame = destination(cap.frameCenter, radius, az);
      add(frame, lobeOf(c, frame));
    }
  }
  return out;
}

/** Fits the covered map into the viewport with 16 px padding, centred, independent of the centre longitude and latitude. */
export function computeScreen(c: CompiledProjection, v: Viewport): ScreenTransform {
  const { cos, sin } = compensation(c);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { frame, lobe } of sampleFrame(c)) {
    const [x, y] = rotatedRaw(c, cos, sin, frame, lobe);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxX >= minX)) return { k: 1, tx: v.width / 2, ty: v.height / 2, cos, sin };
  const k = Math.min(
    (v.width - 2 * PADDING) / Math.max(maxX - minX, 1e-12),
    (v.height - 2 * PADDING) / Math.max(maxY - minY, 1e-12),
  );
  return {
    k,
    tx: v.width / 2 - (k * (minX + maxX)) / 2,
    ty: v.height / 2 + (k * (minY + maxY)) / 2,
    cos,
    sin,
  };
}

/** Screen position of a geographic point. `lobe` (central longitude, degrees) defaults to the lobe that holds the point. */
export function projectPoint(c: CompiledProjection, s: ScreenTransform, p: LonLat, lobe?: number): [number, number] {
  const frame = c.toFrame(p);
  return projectFrame(c, s, frame, lobe ?? lobeOf(c, frame));
}

/** Screen position of a point already in the projection's frame, on the lobe with this central longitude (degrees). */
export function projectFrame(c: CompiledProjection, s: ScreenTransform, frame: LonLat, lobe: number | undefined): [number, number] {
  const [x, y] = rotatedRaw(c, s.cos, s.sin, frame, lobe);
  return [s.tx + s.k * x, s.ty - s.k * y];
}

type Seed = { lon: number; lat: number; x: number; y: number };
type SeedGroup = { region: Region; seeds: Seed[] };

// Seeds depend only on the projection and the tilt compensation, not on the viewport.
const seedCache = new WeakMap<CompiledProjection, SeedGroup[]>();

function seedsFor(c: CompiledProjection): SeedGroup[] {
  const cached = seedCache.get(c);
  if (cached) return cached;
  const { cos, sin } = compensation(c);
  // Close to a cap edge a projection can fold back on itself, and a seed there has no usable slope.
  const clear = c.caps.map((cap) => ({ ...cap, radius: cap.radius + SEED_MARGIN }));
  const groups = regions(c).map((region): SeedGroup => {
    const seeds: Seed[] = [];
    for (const lat of range(region.latMin, region.latMax, SEED_STEP)) {
      // Longitude means nothing at a pole, so a seed there has no slope to follow.
      if (Math.abs(lat) >= 90) continue;
      for (const lon of range(region.lonMin, region.lonMax, SEED_STEP)) {
        if (!frameCovered(clear, [lon, lat])) continue;
        const [x, y] = rotatedRaw(c, cos, sin, [lon, lat], region.lobe);
        if (Number.isFinite(x) && Number.isFinite(y)) seeds.push({ lon, lat, x, y });
      }
    }
    return { region, seeds };
  });
  seedCache.set(c, groups);
  return groups;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

type Pair = [number, number];

/**
 * Newton's method for f(a, b) = target, with central-difference slopes. A step
 * that does not lower the miss is retried with more damping (Levenberg-Marquardt),
 * which keeps it steady where the slopes are nearly singular. Where `bFree` is
 * false, b stays put and the fit is least squares in a. `settle` keeps a
 * candidate legal and may use the previous point. Returns the best point reached
 * and its miss in the units of f.
 */
function newton(
  f: (a: number, b: number) => Pair,
  target: Pair,
  start: Pair,
  opts: { h: number; steps: number; bFree: boolean; settle: (prev: Pair, next: Pair) => Pair },
): { at: Pair; miss: number } {
  const miss = (p: Pair): number => {
    const [x, y] = f(p[0], p[1]);
    return Math.hypot(x - target[0], y - target[1]);
  };
  const { h } = opts;
  let at = start;
  let current = miss(at);
  for (let i = 0; i < opts.steps && Number.isFinite(current) && current > SETTLED_PX; i++) {
    const [x, y] = f(at[0], at[1]);
    const rx = x - target[0];
    const ry = y - target[1];
    const [ax, ay] = f(at[0] + h, at[1]);
    const [bx, by] = f(at[0] - h, at[1]);
    const ja: Pair = [(ax - bx) / (2 * h), (ay - by) / (2 * h)];
    let jb: Pair = [0, 0];
    if (opts.bFree) {
      const [cx, cy] = f(at[0], at[1] + h);
      const [dx, dy] = f(at[0], at[1] - h);
      jb = [(cx - dx) / (2 * h), (cy - dy) / (2 * h)];
    }
    // Normal equations (JtJ + mu I) d = -Jt r.
    const m11 = ja[0] * ja[0] + ja[1] * ja[1];
    const m12 = ja[0] * jb[0] + ja[1] * jb[1];
    const m22 = jb[0] * jb[0] + jb[1] * jb[1];
    const g1 = ja[0] * rx + ja[1] * ry;
    const g2 = jb[0] * rx + jb[1] * ry;
    const scale = (m11 + m22) / 2;
    if (!(scale > 1e-12)) break;
    let improved = false;
    for (const damping of [0, 1e-3, 1e-2, 1e-1, 1, 10]) {
      const mu = damping * scale;
      const a11 = m11 + mu;
      // Without b the second unknown is pinned: its equation reads mu' d = 0.
      const a22 = opts.bFree ? m22 + mu : 1;
      const det = a11 * a22 - m12 * m12;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-18 * scale * scale) continue;
      const da = (-g1 * a22 + g2 * m12) / det;
      const db = opts.bFree ? (g1 * m12 - g2 * a11) / det : 0;
      if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
      const candidate = opts.settle(at, [at[0] + da, at[1] + db]);
      const next = miss(candidate);
      if (next < current) {
        at = candidate;
        current = next;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return { at, miss: current };
}

/** Newton's method on the frame point (degrees) that lands on `target` within one region; null if it does not converge. */
function solveInRegion(
  c: CompiledProjection,
  s: ScreenTransform,
  target: Pair,
  region: Region,
  seed: Seed,
): { frame: LonLat; residual: number } | null {
  const screen = (lon: number, lat: number): Pair => {
    const [x, y] = rotatedRaw(c, s.cos, s.sin, [lon, lat], region.lobe);
    return [s.tx + s.k * x, s.ty - s.k * y];
  };
  const { at, miss } = newton(screen, target, [seed.lon, seed.lat], {
    h: FD_STEP / rad,
    steps: NEWTON_STEPS,
    bFree: true,
    settle: (_, [lon, lat]) => [clamp(lon, region.lonMin, region.lonMax), clamp(lat, region.latMin, region.latMax)],
  });
  return Number.isFinite(miss) ? { frame: at, residual: miss } : null;
}

/** The geographic point under a screen position, or null where the map shows nothing. */
export function screenToLonLat(c: CompiledProjection, s: ScreenTransform, xy: Pair): LonLat | null {
  const ux = (xy[0] - s.tx) / s.k;
  const uy = (s.ty - xy[1]) / s.k;
  let best: { p: LonLat; residual: number } | null = null;
  for (const { region, seeds } of seedsFor(c)) {
    let seed: Seed | undefined;
    let bestDistance = Infinity;
    for (const candidate of seeds) {
      const d = (candidate.x - ux) ** 2 + (candidate.y - uy) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        seed = candidate;
      }
    }
    if (!seed) continue;
    const solved = solveInRegion(c, s, xy, region, seed);
    if (!solved || solved.residual >= PIXEL_TOLERANCE) continue;
    const p = c.fromFrame(solved.frame);
    if (!isCovered(c, p)) continue;
    if (!best || solved.residual < best.residual) best = { p, residual: solved.residual };
  }
  return best ? best.p : null;
}

/**
 * The centre that puts `grabbed` under `cursor`, with tilt held. Newton on
 * the centre longitude and latitude (longitude only where latitude is
 * disabled, in which case the fit is least squares).
 */
export function dragTo(c: CompiledProjection, s: ScreenTransform, grabbed: LonLat, cursor: Pair): Orientation {
  const { tilt } = c.state.orientation;
  const at = (lon: number, lat: number): Pair =>
    projectPoint(compile({ ...c.state, orientation: { lon, lat, tilt } }), s, grabbed);
  const { lon, lat } = c.state.orientation;
  const result = newton(at, cursor, [lon, lat], {
    h: DRAG_FD_STEP,
    steps: DRAG_STEPS,
    bFree: c.def.latEnabled,
    settle: (prev, next) => {
      const nextLat = clamp(next[1], -90, 90);
      // At a pole the longitude only spins the map, so it stays where it was.
      return [Math.abs(nextLat) >= 90 ? prev[0] : wrapLon(next[0]), nextLat];
    },
  });
  return { lon: result.at[0], lat: result.at[1], tilt };
}
