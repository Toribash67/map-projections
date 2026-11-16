import type { City, Peak } from '../data/world';
import type { LonLat } from '../projections/types';
import { isShown, projectPoint } from '../screen/screen';
import type { Member } from '../tissot/indicatrix';
import type { Pair } from './fit';
import { advanceOf, setLevel, type Label, type Mark, type Measure } from './place';

type Rect = { x: number; y: number; width: number; height: number };

/** Which places a picture has marked and named: capitals, other cities and peaks, the smallest lettering a name may have, and by how much the picture is larger than the screen. */
export type PointOptions = { capitals: boolean; cities: boolean; peaks: boolean; smallest: number; scale: number };

// How tall a city's name is lettered, in pixels of the screen, by Natural Earth's rank of it: 0 and 1 are the cities of the world,
// 7 a town of its region. A capital is a little larger than its rank alone would have it.
const CITY_SIZES = [5.4, 5.4, 4.8, 4.3, 3.8, 3.4, 3.4, 3];
const SMALLEST_CITY = 2.6;
const CAPITAL = 1.12;
// A peak's, likewise.
const PEAK_SIZES = [4.4, 4.4, 4, 3.6, 3.2];
const SMALLEST_PEAK = 2.8;
// The radius of a place's mark, and the room between it and its name, in letter heights.
const DOT = 0.24;
const CLEAR = 0.3;
// Earthquakes: the radius of the ring of one of magnitude 7, and how much it grows with each magnitude more; and a volcano's triangle.
const QUAKE = 1.3;
const QUAKE_GROWS = 2.6;
const VOLCANO = 2.1;
// The latitude the hours of the time zones are written at, in the Southern Ocean, where no land is in the way; and how tall.
const HOURS_AT = -58;
const HOURS_SIZE = 8;

/** Where a place on the Earth is in the picture, or null where the map does not show it or it is out of the picture. */
export function placeOf(member: Member, picture: Rect, at: LonLat): Pair | null {
  if (!isShown(member.compiled, at)) return null;
  const [x, y] = projectPoint(member.compiled, member.screen, at);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return x >= picture.x && x <= picture.x + picture.width && y >= picture.y && y <= picture.y + picture.height ? [x, y] : null;
}

/**
 * What has been lettered already, by where it is, so that whether a new name touches any of it is asked of the few names near it
 * and not of them all: there may be thousands. A square of the picture to a cell, each with the circles that reach into it.
 */
export class Taken {
  private readonly cells = new Map<string, [number, number, number][]>();

  constructor(private readonly cell: number, labels: Label[] = []) {
    for (const label of labels) this.add(label);
  }

  private *over([x, y, r]: [number, number, number]): Generator<string> {
    const { cell } = this;
    for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
      for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) yield `${i},${j}`;
    }
  }

  add(label: Label): void {
    for (const disc of label.discs) {
      for (const key of this.over(disc)) {
        const list = this.cells.get(key);
        if (list) list.push(disc);
        else this.cells.set(key, [disc]);
      }
    }
  }

  touches(label: Label): boolean {
    for (const disc of label.discs) {
      const [ax, ay, ar] = disc;
      for (const key of this.over(disc)) {
        for (const [bx, by, br] of this.cells.get(key) ?? []) {
          if ((ax - bx) ** 2 + (ay - by) ** 2 < (ar + br) ** 2) return true;
        }
      }
    }
    return false;
  }
}

/**
 * A place's name beside its mark: to the right of it, or where that touches a name already there, to the left, above or below.
 * Null where there is no room for it on any side, and then the place is not marked either.
 */
function beside(text: string, kind: Label['kind'], mark: Mark, size: number, measure: Measure, taken: Taken, picture: Rect): Label | null {
  const half = (advanceOf(text, kind, measure) * size) / 2;
  const off = mark.r + CLEAR * size;
  const sides: Pair[] = [[off + half, 0], [-off - half, 0], [0, -off - size / 2], [0, off + size / 2]];
  for (const [dx, dy] of sides) {
    const [cx, cy] = [mark.x + dx, mark.y + dy];
    if (cx - half < picture.x || cx + half > picture.x + picture.width || cy - size / 2 < picture.y || cy + size / 2 > picture.y + picture.height) continue;
    const set = setLevel(text, kind, [cx, cy], size, measure);
    // The mark is covered with the name, by a circle of its own, which is the last.
    const label: Label = { ...set, mark, discs: [...set.discs, [mark.x, mark.y, mark.r * 1.4]] };
    if (!taken.touches(label)) return label;
  }
  return null;
}

/**
 * The cities and peaks of a picture: each a mark where it is and its name beside the mark, the most important first, for as long
 * as there is room. A place whose name would be under the smallest lettering is left out, so the smaller the lettering may be, the
 * more places there are; and one whose name would touch a name already there, on every side of its mark, is left out too.
 * `placed` is the lettering the picture has already. The lists are null until they have been fetched.
 */
export function buildPoints(member: Member, picture: Rect, opts: PointOptions, measure: Measure, cities: City[] | null, peaks: Peak[] | null, placed: Label[]): Label[] {
  const { scale } = opts;
  const taken = new Taken(4 * CITY_SIZES[0]! * scale, placed);
  const out: Label[] = [];
  const put = (text: string, kind: 'capital' | 'city' | 'peak', at: LonLat, size: number) => {
    const xy = placeOf(member, picture, at);
    if (!xy) return;
    const label = beside(text, kind, { kind, x: xy[0], y: xy[1], r: DOT * size * (kind === 'city' ? 1 : 1.25) }, size, measure, taken, picture);
    if (!label) return;
    taken.add(label);
    out.push(label);
  };
  if ((opts.capitals || opts.cities) && cities) {
    for (const [name, lon, lat, rank, capital] of cities) {
      if (!(capital ? opts.capitals || opts.cities : opts.cities)) continue;
      const size = (CITY_SIZES[rank] ?? SMALLEST_CITY) * (capital ? CAPITAL : 1);
      if (size < opts.smallest) continue;
      put(name, capital ? 'capital' : 'city', [lon, lat], size * scale);
    }
  }
  if (opts.peaks && peaks) {
    for (const [name, lon, lat, metres, rank] of peaks) {
      const size = PEAK_SIZES[rank] ?? SMALLEST_PEAK;
      if (size < opts.smallest) continue;
      put(`${name} ${metres}`, 'peak', [lon, lat], size * scale);
    }
  }
  return out;
}

/** The volcanoes and earthquakes of a picture, as marks with no name: an earthquake's ring is the larger for its magnitude. The greatest earthquakes are first, and are drawn last, over the rest. */
export function buildMarks(member: Member, picture: Rect, scale: number, volcanoes: [number, number][] | null, quakes: [number, number, number][] | null): Mark[] {
  const marks: Mark[] = [];
  for (const [lon, lat, magnitude] of [...(quakes ?? [])].reverse()) {
    const xy = placeOf(member, picture, [lon, lat]);
    if (xy) marks.push({ kind: 'quake', x: xy[0], y: xy[1], r: (QUAKE + QUAKE_GROWS * (magnitude - 7)) * scale });
  }
  for (const [lon, lat] of volcanoes ?? []) {
    const xy = placeOf(member, picture, [lon, lat]);
    if (xy) marks.push({ kind: 'volcano', x: xy[0], y: xy[1], r: VOLCANO * scale });
  }
  return marks;
}

/** The hours of a time zone as they are written: from Greenwich, which is UTC. */
export const hoursText = (offset: number): string => (offset === 0 ? 'UTC' : Math.abs(offset) === 12 ? '±12' : `${offset > 0 ? '+' : '−'}${Math.abs(offset)}`);

/**
 * The hours of the time zones, each written in the middle of its zone as it is at sea, where the zones are plain bands a twenty-fourth
 * of the way round: along a parallel in the Southern Ocean. One that would touch lettering already there is left out.
 */
export function buildHours(member: Member, picture: Rect, scale: number, measure: Measure, placed: Label[]): Label[] {
  const out: Label[] = [];
  const taken = new Taken(4 * HOURS_SIZE * scale, placed);
  for (let offset = -11; offset <= 12; offset++) {
    const xy = placeOf(member, picture, [offset === 12 ? 180 : 15 * offset, HOURS_AT]);
    if (!xy) continue;
    const label = setLevel(hoursText(offset), 'zone', xy, HOURS_SIZE * scale, measure);
    if (taken.touches(label)) continue;
    taken.add(label);
    out.push(label);
  }
  return out;
}
