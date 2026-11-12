import { geoArea } from 'd3-geo';
import { COUNTRY_SHAPES } from '../data/countryShapes';
import type { Sea } from '../data/water';
import { buildScene } from '../morph/scene';
import type { Member } from '../tissot/indicatrix';
import { clipToRect, contains, COUNTRY_FIT, fitLabel, polygonArea, SEA_FIT, shrink, type Fit, type FitOptions, type Pair } from './fit';
import { advanceOf, setAlong, touches, type Label, type Measure } from './place';

/**
 * Which names a map has: the countries', the seas', the smallest lettering a name may have (pixels of the screen), and by how much
 * the picture is larger than the screen, so that an export has the names the screen has, as much larger as the rest.
 */
export type NameOptions = { countries: boolean; seas: boolean; smallest: number; scale: number };

// A name that touches another is made this much smaller, this many times, before it is given up.
const SMALLER = 0.8;
const TRIES = 2;
// How many places along a sea's name are looked at for land under them.
const SOUNDINGS = 7;

/** A sea's name in ordinary letters: Natural Earth has some of them all in capitals. */
export function seaName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** A shape as the map at rest shows it: each piece it is cut into as rings on screen, the outer ring first. Nothing of it that the map cannot show, as on the far side of a globe. */
export function piecesOf(member: Member, geometry: GeoJSON.GeoJsonObject): Pair[][][] {
  const pieces = buildScene({ shape: geometry }, [member], null, false).layers.shape ?? [];
  return pieces
    .filter((piece) => piece.closed && !piece.behind)
    .map((piece) => {
      const count = piece.src.length / 2;
      return [...piece.ringStarts].map((start, r) => {
        const ring: Pair[] = [];
        for (let i = start; i < (piece.ringStarts[r + 1] ?? count); i++) ring.push([piece.src[2 * i]!, piece.src[2 * i + 1]!]);
        return ring;
      });
    });
}

/** The part of the screen that names are fitted within: the picture. */
type Window = { x: number; y: number; width: number; height: number };

type Candidate = { text: string; kind: Label['kind']; fit: Fit; rank: number };

const areas = new WeakMap<object, number>();
/** The area of a shape on the globe, in steradians, worked out once. */
function areaOf(geometry: GeoJSON.GeoJsonObject): number {
  let area = areas.get(geometry);
  if (area === undefined) {
    area = geoArea(geometry as GeoJSON.Geometry);
    areas.set(geometry, area);
  }
  return area;
}
// A shape whose area on screen, were the map true to scale everywhere, is under this many squares of the smallest letter is not
// looked at: it has no room for a name. Well under what a name needs, as a map may show a place several times its true size.
const ROOM = 4;
// The most points of a ring that a name is fitted to.
const MOST_POINTS = 240;

/** A name fitted to the largest piece of its shape that is in the window, or null where it has none or no room. `least` is the smallest a letter may be. */
function candidate(member: Member, window: Window, geometry: GeoJSON.GeoJsonObject, text: string, kind: Label['kind'], opts: FitOptions, measure: Measure, rank: number, least: number): Candidate | null {
  if (areaOf(geometry) * member.screen.k ** 2 < ROOM * least * least) return null;
  let [largest, area]: [Pair[][] | null, number] = [null, 0];
  for (const piece of piecesOf(member, geometry)) {
    const clipped = clipToRect(piece, window);
    const size = polygonArea(clipped);
    if (size > area) [largest, area] = [clipped, size];
  }
  if (!largest) return null;
  // A name follows the lie of its shape and not every turn of its coast: a ring of very many points is fitted by some of them.
  const coarse = largest.map((ring) => (ring.length <= MOST_POINTS ? ring : ring.filter((_, i) => i % Math.ceil(ring.length / MOST_POINTS) === 0)));
  const fit = fitLabel(coarse, advanceOf(text, kind, measure), [...text].length, opts);
  return fit && { text, kind, fit, rank };
}

/**
 * The names of a map at rest: each country's along the middle of its largest piece on screen, and each sea's likewise. They are
 * placed largest first. One that would touch a name already placed is made smaller, and left out if it still does; one whose letters
 * would be under the smallest size is left out; and a sea's name with land under it is left out. So how many countries are named
 * follows from the map's size and the smallest lettering allowed.
 *
 * `window` is the picture: a country is named within what the picture shows of it. `seas` is null until they have been fetched, and there are no sea names until then. `land` is what counts as land under a sea's name.
 */
export function buildNames(member: Member, window: Window, opts: NameOptions, measure: Measure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject): Label[] {
  const { scale } = opts;
  const least = opts.smallest * scale;
  const candidates: Candidate[] = [];
  if (opts.countries) {
    const fitting = { ...COUNTRY_FIT, maxSize: COUNTRY_FIT.maxSize * scale };
    for (const { name, geometry } of COUNTRY_SHAPES) {
      const found = candidate(member, window, geometry, name.toUpperCase(), 'country', fitting, measure, 0, least);
      if (found) candidates.push(found);
    }
  }
  if (opts.seas && seas) {
    const fitting = { ...SEA_FIT, maxSize: SEA_FIT.maxSize * scale };
    for (const sea of seas) {
      const found = candidate(member, window, sea.geometry, seaName(sea.name), 'sea', fitting, measure, sea.ocean ? -1 : sea.rank, least);
      if (found) candidates.push(found);
    }
  }
  // The largest first, and of two the same size the more important.
  candidates.sort((a, b) => b.fit.size - a.fit.size || a.rank - b.rank);

  // The land as the map shows it, to see whether a sea's name lies on any of it.
  const shore = candidates.some((one) => one.kind === 'sea') ? piecesOf(member, land) : [];
  const placed: Label[] = [];
  for (const { text, kind, fit } of candidates) {
    let [trial, tries] = [fit, 0];
    let label: Label | null = null;
    while (trial.size >= least) {
      const set = setAlong(text, kind, trial, measure);
      if (!touches(set, placed)) {
        label = set;
        break;
      }
      if (++tries > TRIES) break;
      trial = shrink(trial, SMALLER);
    }
    if (!label || (kind === 'sea' && onLand(label, shore))) continue;
    placed.push(label);
  }
  return placed;
}

/** Whether any of a few places along a name is over land: within a piece of the land as the map shows it. */
function onLand(label: Label, land: Pair[][][]): boolean {
  const { discs } = label;
  for (let i = 0; i < SOUNDINGS; i++) {
    const [x, y] = discs[Math.round((i / (SOUNDINGS - 1)) * (discs.length - 1))]!;
    if (land.some((piece) => contains(piece, [x, y]))) return true;
  }
  return false;
}
