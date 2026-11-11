import { geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import type { Piece } from '../src/geo/cut';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { LonLat, Orientation, ProjectionState } from '../src/projections/types';
import { computeScreen } from '../src/screen/screen';
import type { Member } from '../src/tissot/indicatrix';
import { stopOf } from './stopOf';

export const rad = Math.PI / 180;
export const VIEW = { width: 1000, height: 600 };
export const STREAK = 0.25 * Math.hypot(VIEW.width, VIEW.height);

export const topology = landTopology as any;
export const land = feature(topology, topology.objects.land) as unknown as GeoJSON.GeoJsonObject;
export const graticule = geoGraticule10() as GeoJSON.GeoJsonObject;
export const ocean = { type: 'Sphere' } as unknown as GeoJSON.GeoJsonObject;
export const world = { land, ocean, graticule };

export function memberOf(state: ProjectionState, weight = 1): Member {
  const compiled = compile(state);
  return { compiled, screen: computeScreen(compiled, VIEW), weight };
}

export function member(id: string, orientation?: Partial<Orientation>, weight = 1): Member {
  const state = stateForStop(stopOf(id));
  return memberOf({ ...state, orientation: { ...state.orientation, ...orientation } }, weight);
}

export const line = (...coordinates: LonLat[]): GeoJSON.LineString => ({ type: 'LineString', coordinates });

/** Deterministic pseudo-random numbers in [0, 1). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomOrientation = (r: () => number): Orientation => ({ lon: r() * 360 - 180, lat: r() * 170 - 85, tilt: r() * 180 - 90 });

/** Each ring of a piece as [start, end) point indices. */
export function ringsOf(piece: ScenePiece): [number, number][] {
  const count = piece.src.length / 2;
  return [...piece.ringStarts].map((start, i) => [start, piece.ringStarts[i + 1] ?? count]);
}

export const pointAt = (a: Float32Array, i: number): [number, number] => [a[2 * i]!, a[2 * i + 1]!];

/** Longest segment of a position array, in pixels. */
export function longestSegment(piece: ScenePiece, positions: Float32Array): number {
  let longest = 0;
  for (const [start, end] of ringsOf(piece)) {
    for (let i = start + 1; i < end; i++) {
      const [ax, ay] = pointAt(positions, i - 1);
      const [bx, by] = pointAt(positions, i);
      longest = Math.max(longest, Math.hypot(bx - ax, by - ay));
    }
  }
  return longest;
}

export const isShown = (piece: Piece) => piece.inside.some((inside, i) => inside || piece.behind[i]);

/** The frame point `distance` degrees from the frame origin, at compass bearing `bearing` radians. */
export function frameAt(distance: number, bearing: number): LonLat {
  const d = distance * rad;
  return [Math.atan2(Math.sin(d) * Math.sin(bearing), Math.cos(d)) / rad, Math.asin(Math.sin(d) * Math.cos(bearing)) / rad];
}

export type Filled = { piece: ScenePiece; positions: Float32Array };

/** The cells of a coarse grid whose centres any of `fills` covers, by the non-zero rule as a canvas fills them, as a string of 0s and 1s. */
export function raster(fills: Filled[], step = 10): string {
  const [columns, rows] = [VIEW.width / step, VIEW.height / step];
  const cells = new Uint8Array(columns * rows);
  for (const { piece, positions } of fills) {
    // Per row, where the piece's edges cross it and which way.
    const crossings: [number, number][][] = Array.from({ length: rows }, () => []);
    for (const [start, end] of ringsOf(piece)) {
      for (let i = start + 1; i < end; i++) {
        const [ax, ay] = pointAt(positions, i - 1);
        const [bx, by] = pointAt(positions, i);
        const [low, high] = [Math.min(ay, by), Math.max(ay, by)];
        const first = Math.max(0, Math.ceil(low / step - 0.5));
        const last = Math.min(rows - 1, Math.ceil(high / step - 0.5) - 1);
        for (let row = first; row <= last; row++) {
          const y = (row + 0.5) * step;
          crossings[row]!.push([ax + ((bx - ax) * (y - ay)) / (by - ay), by > ay ? 1 : -1]);
        }
      }
    }
    crossings.forEach((list, row) => {
      list.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      list.forEach(([x, direction], k) => {
        winding += direction;
        if (winding === 0) return;
        const until = list[k + 1]?.[0] ?? x;
        const from = Math.max(0, Math.ceil(x / step - 0.5));
        const to = Math.min(columns - 1, Math.ceil(until / step - 0.5) - 1);
        for (let c = from; c <= to; c++) cells[row * columns + c] = 1;
      });
    });
  }
  return cells.join('');
}

export function difference(a: string, b: string): number {
  let different = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
  return different;
}

/** Raster of what `m` shows by itself, as a full cut has it. The same map at both ends has one set of seams to cut. */
export function aloneRaster(m: Member, geometry: GeoJSON.GeoJsonObject): string {
  const pieces = buildScene({ geometry }, [m], m, false).layers.geometry!;
  return raster(pieces.filter((p) => p.alphaDst > 0 && !p.behind).map((piece) => ({ piece, positions: piece.dst })));
}

/** Whether pieces fill a point, by the non-zero rule, as a canvas fills them. */
export function filledAt(pieces: ScenePiece[], positions: (p: ScenePiece) => Float32Array, x: number, y: number): boolean {
  return pieces.some((piece) => {
    const at = positions(piece);
    let winding = 0;
    for (const [start, end] of ringsOf(piece)) {
      for (let i = start + 1; i < end; i++) {
        const [ax, ay] = pointAt(at, i - 1);
        const [bx, by] = pointAt(at, i);
        const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
        if (ay <= y) {
          if (by > y && side > 0) winding++;
        } else if (by <= y && side < 0) winding--;
      }
    }
    return winding !== 0;
  });
}

export const cellsOf = (r: string) => [...r].filter((c) => c === '1').length;

/** Total signed area of a set of pieces in pixels. Unlike a raster, this counts anything filled twice. */
export function filledArea(pieces: ScenePiece[], positions: (p: ScenePiece) => Float32Array): number {
  let total = 0;
  for (const piece of pieces) {
    const at = positions(piece);
    for (const [start, end] of ringsOf(piece)) {
      for (let i = start + 1; i < end; i++) {
        const [ax, ay] = pointAt(at, i - 1);
        const [bx, by] = pointAt(at, i);
        total += (ax * by - bx * ay) / 2;
      }
    }
  }
  return total;
}

export function aloneArea(m: Member, geometry: GeoJSON.GeoJsonObject): number {
  const pieces = buildScene({ geometry }, [m], m, false).layers.geometry!;
  return filledArea(pieces.filter((p) => p.alphaDst > 0 && !p.behind), (p) => p.dst);
}

export function pieceLength(pieces: ScenePiece[]): number {
  let total = 0;
  for (const piece of pieces) {
    for (const [start, end] of ringsOf(piece)) {
      for (let i = start + 1; i < end; i++) {
        const [ax, ay] = pointAt(piece.src, i - 1);
        const [bx, by] = pointAt(piece.src, i);
        total += Math.hypot(bx - ax, by - ay);
      }
    }
  }
  return total;
}

/** The cells a set of lines passes through, as a set of grid keys. */
export function lineCells(pieces: ScenePiece[], positions: (p: ScenePiece) => Float32Array, step = 6): Set<string> {
  const cells = new Set<string>();
  for (const piece of pieces) {
    const at = positions(piece);
    for (const [start, end] of ringsOf(piece)) {
      for (let i = start + 1; i < end; i++) {
        const [ax, ay] = pointAt(at, i - 1);
        const [bx, by] = pointAt(at, i);
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 2) + 1;
        for (let k = 0; k <= n; k++) {
          cells.add(`${Math.floor((ax + ((bx - ax) * k) / n) / step)},${Math.floor((ay + ((by - ay) * k) / n) / step)}`);
        }
      }
    }
  }
  return cells;
}

/** How many of `a`'s cells have no cell of `b` touching them. */
export function strayCells(a: Set<string>, b: Set<string>): string[] {
  const stray: string[] = [];
  for (const key of a) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      for (let dy = -1; dy <= 1 && !found; dy++) found = b.has(`${x + dx},${y + dy}`);
    }
    if (!found) stray.push(key);
  }
  return stray;
}
