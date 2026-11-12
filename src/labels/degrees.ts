import type { GraticuleStep } from '../layers/layers';
import type { LonLat } from '../projections/types';
import { isCovered, projectPoint, screenToLonLat } from '../screen/screen';
import type { Member } from '../tissot/indicatrix';
import type { Pair } from './fit';
import { advanceOf, setLevel, touches, type Label, type Measure } from './place';

type Rect = { x: number; y: number; width: number; height: number };

// How tall the degrees are lettered, and how far from the end of their line they stand, in pixels of the screen.
const SIZE = 9;
const CLEAR = 5;
// How far apart (degrees) a line is walked.
const WALK = 0.5;
// Two neighbours on a line that are this much farther apart on screen than its usual step, and then some, have a seam between them.
const SEAM_STEPS = 6;
const SEAM_EXTRA = 12;

/** The degrees of a parallel or a meridian as they are written: with the side of the Earth, but for the equator, Greenwich and the date line. */
export function degreeText(value: number, axis: 'lat' | 'lon'): string {
  const size = Math.abs(value);
  if (size === 0 || (axis === 'lon' && size === 180)) return `${size}°`;
  return `${size}°${axis === 'lat' ? (value > 0 ? 'N' : 'S') : value > 0 ? 'E' : 'W'}`;
}

/** How round a number of degrees is: the rounder are kept where there is not room for all. */
const roundness = (value: number): number => (value === 0 ? 0 : value % 90 === 0 ? 1 : value % 30 === 0 ? 2 : value % 15 === 0 ? 3 : 4);

/** The end of a line on the picture: where, which way the line was running as it left, and whether the line itself stops there, as at a pole. */
type End = { at: Pair; away: Pair; own: boolean };

/** The ends of one line, walked point by point: where it leaves the map or the picture, and either side of a seam. `closed` if it comes back to its start, as a parallel does. */
function endsOf(member: Member, picture: Rect, line: LonLat[], closed: boolean, scale: number): End[] {
  const { compiled, screen } = member;
  const places = line.map((p): Pair | null => {
    if (!isCovered(compiled, p)) return null;
    const [x, y] = projectPoint(compiled, screen, p);
    return Number.isFinite(x) && Number.isFinite(y) && x >= picture.x && x <= picture.x + picture.width && y >= picture.y && y <= picture.y + picture.height ? [x, y] : null;
  });
  const n = places.length;
  const next = (i: number) => (closed ? (i + 1) % n : i + 1 < n ? i + 1 : -1);
  const before = (i: number) => (closed ? (i - 1 + n) % n : i - 1);
  const steps: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [places[i], places[next(i)] ?? null];
    if (a && b) steps.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  if (steps.length === 0) return [];
  const usual = steps.sort((a, b) => a - b)[steps.length >> 1]!;
  const seam = SEAM_EXTRA * scale + SEAM_STEPS * usual;

  const ends: End[] = [];
  /** The line ends at `i`, having come from `from`. */
  const end = (i: number, from: number, own = false) => {
    const [at, back] = [places[i]!, places[from]];
    if (!back) return;
    const length = Math.hypot(at[0] - back[0], at[1] - back[1]);
    if (length > 0 && length <= seam) ends.push({ at, away: [(at[0] - back[0]) / length, (at[1] - back[1]) / length], own });
  };
  for (let i = 0; i < n; i++) {
    const j = next(i);
    const here = places[i];
    if (j < 0) {
      // The last point of a line that does not come round: the line's own end.
      if (here) end(i, before(i), true);
      continue;
    }
    const there = places[j];
    if (i === 0 && !closed && here) end(0, 1, true);
    if (here && !there) end(i, before(i));
    else if (!here && there) end(j, next(j));
    else if (here && there && Math.hypot(there[0] - here[0], there[1] - here[1]) > seam) {
      end(i, before(i));
      end(j, next(j));
    }
  }
  return ends;
}

/**
 * The degrees of the graticule's lines, written where each line leaves the picture: `30°N`, `60°E`. On a whole map that is at the
 * map's outline, and the degrees stand just outside it where the picture has room, and just inside where it has not. On a map
 * zoomed in, it is at the edge of the picture, and they stand just inside. Where they would crowd, as meridians do at a pole, the
 * rounder numbers are kept. None is put on or against a label in `taken`, the names already on the map.
 *
 * Every meridian is walked to the poles, though only each ninetieth is drawn that far: on a map with a straight top the others
 * still have their degrees along it. `scale` is by how much the picture is larger than the screen.
 */
export function buildDegrees(member: Member, picture: Rect, step: GraticuleStep, scale: number, measure: Measure, taken: Label[]): Label[] {
  const size = SIZE * scale;
  const { compiled, screen } = member;
  const onMap = (p: Pair): boolean => {
    const place = screenToLonLat(compiled, screen, p);
    return place !== null && isCovered(compiled, place);
  };
  const candidates: { label: Label; round: number }[] = [];
  const add = (value: number, axis: 'lat' | 'lon', line: LonLat[]) => {
    const text = degreeText(value, axis);
    const [halfWidth, halfHeight] = [(advanceOf(text, 'degree', measure) * size) / 2, size / 2];
    const fits = ([x, y]: Pair) => x - halfWidth >= picture.x && x + halfWidth <= picture.x + picture.width && y - halfHeight >= picture.y && y + halfHeight <= picture.y + picture.height;
    for (const { at, away, own } of endsOf(member, picture, line, axis === 'lat', scale)) {
      // Far enough along the line that the lettering, which is level, clears its end.
      const reach = CLEAR * scale + Math.abs(away[0]) * halfWidth + Math.abs(away[1]) * halfHeight;
      const outside: Pair = [at[0] + away[0] * reach, at[1] + away[1] * reach];
      const inside: Pair = [at[0] - away[0] * reach, at[1] - away[1] * reach];
      const centre = fits(outside) && !onMap(outside) ? outside : own ? null : fits(inside) ? inside : null;
      if (centre) candidates.push({ label: setLevel(text, 'degree', centre, size, measure), round: roundness(Math.abs(value)) });
    }
  };
  for (let lat = -90 + step; lat < 90; lat += step) {
    const line: LonLat[] = [];
    for (let lon = -180; lon < 180; lon += WALK) line.push([lon, lat]);
    add(lat, 'lat', line);
  }
  for (let lon = -180 + step; lon <= 180; lon += step) {
    const line: LonLat[] = [];
    for (let lat = -90; lat <= 90; lat += WALK) line.push([lon, lat]);
    add(lon, 'lon', line);
  }
  const kept: Label[] = [];
  for (const { label } of candidates.sort((a, b) => a.round - b.round)) {
    if (!touches(label, kept) && !touches(label, taken)) kept.push(label);
  }
  return kept;
}
