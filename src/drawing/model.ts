import { geoArea, geoCircle, geoDistance } from 'd3-geo';
import type { LonLat } from '../projections/types';
import { isSimple, withoutAntipodalEdges } from './arcs';

/**
 * A shape drawn on the Earth, in degrees. One that follows the globe is its corners, joined by great-circle arcs, or a circle's centre
 * and angular radius. One that follows the map it was drawn on is a path: the places under what was drawn, close enough together that
 * joined by arcs they are that drawing, and closed if it goes round an inside.
 */
export type Shape =
  | { kind: 'line' | 'polygon'; points: LonLat[] }
  | { kind: 'circle'; center: LonLat; radiusDeg: number }
  | { kind: 'path'; points: LonLat[]; closed: boolean };
export type Tool = 'none' | 'line' | 'polygon' | 'circle';
/** Whether what is drawn is straight and round on the map it is drawn on, or on the globe. */
export type Mode = 'map' | 'globe';

/**
 * How to trace on the map that is on screen: the path on the Earth under a straight line of the map between two places, and the ring
 * under a circle of the map about one place and through another. Null where the map cannot: the line or circle would leave it.
 */
export interface Tracer {
  line(a: LonLat, b: LonLat): LonLat[] | null;
  circle(centre: LonLat, edge: LonLat): LonLat[] | null;
}

/**
 * A shape half drawn. A line or polygon is its corners; one that follows the map has besides, for each corner after the first, the
 * path traced to it from the one before, on the map as it was then. A circle is its centre.
 */
export type Draft = { kind: 'line' | 'polygon'; points: LonLat[]; traced?: LonLat[][] } | { kind: 'circle'; center: LonLat; radiusDeg: number };

const rad = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;
// Points closer than this (degrees) to the one before are the same point: a double-click is one.
const MERGE = 0.01;
// A circle has to have a radius, and can be nearly all of the sphere but not all of it.
const MIN_RADIUS = 0.01;
const MAX_RADIUS = 180 - MIN_RADIUS;
// Angular step (degrees) round a circle. Its edges are great-circle arcs, so a fine step keeps them on the circle.
const CIRCLE_STEP = 1;
const HEMISPHERE = 2 * Math.PI;

const LEAVES = 'A straight line there would leave the map.';
const CIRCLE_LEAVES = 'A circle that size would leave the map.';
const CROSSES = 'That point would make the polygon cross itself.';
const CLOSING_CROSSES = 'The edge that closes the polygon would cross it. Undo a point, or place the last one elsewhere.';

/** The length of an arc of a great circle, in kilometres on a sphere of the Earth's mean radius. */
export const radiusKm = (deg: number): number => deg * rad * EARTH_RADIUS_KM;

const distanceDeg = (a: LonLat, b: LonLat) => geoDistance(a, b) / rad;

// By shape, which is never changed once made, so that a shape not drawn afresh keeps its geometry
// object, and with it what the cuts have prepared from it.
const geometries = new WeakMap<Shape, GeoJSON.Geometry>();

/** A ring closed, and wound so that it holds the smaller of the two sides it divides the sphere into. */
function smallerSide(points: LonLat[]): LonLat[] {
  const ring = [...points, points[0]!];
  return geoArea({ type: 'Polygon', coordinates: [ring] }) > HEMISPHERE ? ring.reverse() : ring;
}

function build(shape: Shape): GeoJSON.Geometry {
  if (shape.kind === 'line') return { type: 'LineString', coordinates: withoutAntipodalEdges(shape.points) };
  let ring: LonLat[];
  if (shape.kind === 'path') {
    // Its points are as close together as they need to be, and a closed one is already wound round its inside.
    if (!shape.closed) return { type: 'LineString', coordinates: shape.points };
    ring = shape.points;
  } else if (shape.kind === 'circle') {
    if (!(shape.radiusDeg > 0)) return { type: 'GeometryCollection', geometries: [] };
    // d3 winds the ring so that its inside is the cap round the centre, beyond 90° too.
    ring = geoCircle().center(shape.center).radius(shape.radiusDeg).precision(CIRCLE_STEP)().coordinates[0] as LonLat[];
  } else {
    const points = withoutAntipodalEdges(shape.points, true);
    if (points.length < 3) return { type: 'LineString', coordinates: points };
    ring = smallerSide(points);
  }
  // The fill and the outline come apart, so that a seam does not outline the fill where it cuts it.
  return { type: 'GeometryCollection', geometries: [{ type: 'Polygon', coordinates: [ring] }, { type: 'LineString', coordinates: ring }] };
}

/** The traced paths of a draft as one, each joined to the next at the corner they share. */
const joined = (traced: LonLat[][]): LonLat[] => traced.flatMap((path, i) => (i === 0 ? path : path.slice(1)));

/** A shape as GeoJSON, with every edge a great-circle arc. A polygon or circle is a fill and, as a line of its own, an outline. */
export function shapeToGeoJSON(shape: Shape): GeoJSON.Geometry {
  let geometry = geometries.get(shape);
  if (!geometry) {
    geometry = build(shape);
    geometries.set(shape, geometry);
  }
  return geometry;
}

/**
 * The shapes drawn so far and the one being drawn. Clicks add points to the draft, and a finished draft becomes a shape. While it
 * follows the map, each click and each move of the cursor comes with a tracer for the map on screen; while it follows the globe, as
 * it does to begin with, none is asked for.
 */
export class DrawingModel {
  /** Replaced when it changes, never changed in place. */
  shapes: Shape[] = [];
  /** Line and polygon: the points placed so far. Circle: its centre, with no radius. */
  draft: Draft | null = null;
  /** Why the last click or finish was refused, until something is accepted. */
  notice: string | null = null;

  private current: Tool = 'none';
  private following: Mode = 'globe';
  private cursor: LonLat | null = null;
  // Following the map: what the map traces from the draft out to the cursor, and for a polygon back from the cursor to its first corner.
  private band: { out: LonLat[] | null; back: LonLat[] | null } | null = null;
  private readonly listeners: (() => void)[] = [];

  get tool(): Tool {
    return this.current;
  }

  get mode(): Mode {
    return this.following;
  }

  /** The radius, in kilometres, that the cursor gives the circle being drawn, or null when none is. A circle of the map has none: it is not one on the Earth. */
  get radiusKm(): number | null {
    if (this.following === 'map') return null;
    const radius = this.draft?.kind === 'circle' && this.cursor ? distanceDeg(this.draft.center, this.cursor) : 0;
    return radius >= MIN_RADIUS ? radiusKm(Math.min(radius, MAX_RADIUS)) : null;
  }

  /** Whether `finish` would make the draft a shape, as far as its points go: a line of two or more, a polygon of three or more. */
  get canFinish(): boolean {
    const d = this.draft;
    return d !== null && d.kind !== 'circle' && d.points.length >= (d.kind === 'line' ? 2 : 3);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Chooses what clicks draw. A draft in progress is dropped. */
  setTool(tool: Tool): void {
    if (tool === this.current) return;
    this.current = tool;
    this.leaveDraft();
  }

  /** Chooses whether shapes follow the map or the globe. A draft in progress, which was begun the other way, is dropped. */
  setMode(mode: Mode): void {
    if (mode === this.following) return;
    this.following = mode;
    this.leaveDraft();
  }

  /** A click on the map. Following the map it comes with the map's tracer; without one the point is placed as on the globe. */
  addPoint(p: LonLat, tracer?: Tracer): void {
    const d = this.draft;
    if (this.current === 'none') return;
    const onMap = this.following === 'map' && tracer !== undefined;
    if (this.current === 'circle') {
      if (!d) {
        this.draft = { kind: 'circle', center: p, radiusDeg: 0 };
      } else if (d.kind === 'circle') {
        const radiusDeg = distanceDeg(d.center, p);
        if (radiusDeg < MIN_RADIUS) return;
        if (onMap) {
          const ring = tracer.circle(d.center, p);
          if (!ring) return this.refuse(CIRCLE_LEAVES);
          this.shapes = [...this.shapes, { kind: 'path', points: ring, closed: true }];
        } else {
          this.shapes = [...this.shapes, { kind: 'circle', center: d.center, radiusDeg: Math.min(radiusDeg, MAX_RADIUS) }];
        }
        this.draft = null;
        this.cursor = null;
        this.band = null;
      }
    } else if (!d) {
      this.draft = onMap ? { kind: this.current, points: [p], traced: [] } : { kind: this.current, points: [p] };
    } else if (d.kind !== 'circle') {
      if (distanceDeg(d.points.at(-1)!, p) < MERGE) return;
      if (d.traced && onMap) {
        const path = tracer.line(d.points.at(-1)!, p);
        if (!path) return this.refuse(LEAVES);
        const traced = [...d.traced, path];
        if (d.kind === 'polygon' && !isSimple(joined(traced), false)) return this.refuse(CROSSES);
        this.draft = { kind: d.kind, points: [...d.points, p], traced };
      } else {
        if (d.kind === 'polygon' && !isSimple([...d.points, p], false)) return this.refuse(CROSSES);
        this.draft = { kind: d.kind, points: [...d.points, p] };
      }
      this.band = null;
    }
    this.notice = null;
    this.notify();
  }

  /** Where the cursor is on the map, or null when it is not on it. The draft is drawn out to it, by the map's tracer where it follows the map. */
  preview(p: LonLat | null, tracer?: Tracer): void {
    if (this.current === 'none' || (p === null && this.cursor === null)) return;
    this.cursor = p;
    const d = this.draft;
    this.band = null;
    if (p && d && tracer && this.following === 'map') {
      if (d.kind === 'circle') this.band = { out: tracer.circle(d.center, p), back: null };
      else if (d.traced && distanceDeg(d.points.at(-1)!, p) >= MERGE) {
        const out = tracer.line(d.points.at(-1)!, p);
        // A polygon is shown closed once it has two corners and the cursor for a third.
        this.band = { out, back: out && d.kind === 'polygon' && d.points.length >= 2 ? tracer.line(p, d.points[0]!) : null };
      }
    }
    // With no draft there is nothing to draw out to the cursor.
    if (d) this.notify();
  }

  /**
   * Makes the draft a shape, or drops it if it is too short to be one. A polygon whose closing edge would cross, or following the map
   * would leave the map, stays a draft.
   */
  finish(tracer?: Tracer): void {
    const d = this.draft;
    if (!d) return;
    if (d.kind !== 'circle' && d.traced) return this.finishTraced(d.kind, d.points, d.traced, tracer);
    if (d.kind === 'polygon' && d.points.length >= 3 && !isSimple(d.points, true)) return this.refuse(CLOSING_CROSSES);
    if (d.kind !== 'circle' && d.points.length >= (d.kind === 'line' ? 2 : 3)) this.shapes = [...this.shapes, { kind: d.kind, points: d.points }];
    this.leaveDraft();
  }

  /** Finishes a draft that follows the map: a line is its traced paths joined; a polygon is closed by one more, traced on the map as it is now. */
  private finishTraced(kind: 'line' | 'polygon', points: LonLat[], traced: LonLat[][], tracer?: Tracer): void {
    if (kind === 'line') {
      if (points.length >= 2) this.shapes = [...this.shapes, { kind: 'path', points: joined(traced), closed: false }];
      return this.leaveDraft();
    }
    if (points.length < 3) return this.leaveDraft();
    const closing = tracer?.line(points.at(-1)!, points[0]!);
    if (!closing) return this.refuse(LEAVES);
    // The ring without its first point repeated at the end, which is how a closed path is checked.
    const open = joined([...traced, closing]).slice(0, -1);
    if (!isSimple(open, true)) return this.refuse(CLOSING_CROSSES);
    this.shapes = [...this.shapes, { kind: 'path', points: smallerSide(open), closed: true }];
    this.leaveDraft();
  }

  cancel(): void {
    this.leaveDraft();
  }

  /** Takes back the last point of the draft, with the path traced to it, or if there is none the last shape. */
  undo(): void {
    const d = this.draft;
    if (d && d.kind !== 'circle' && d.points.length > 1) {
      this.draft = d.traced ? { kind: d.kind, points: d.points.slice(0, -1), traced: d.traced.slice(0, -1) } : { kind: d.kind, points: d.points.slice(0, -1) };
    } else if (d) this.draft = null;
    else this.shapes = this.shapes.slice(0, -1);
    this.band = null;
    this.notice = null;
    this.notify();
  }

  clear(): void {
    this.shapes = [];
    this.leaveDraft();
  }

  /** What is on the map: the shapes, and the draft run out to the cursor, as a line until it can be a polygon. */
  drawn(): Shape[] {
    const d = this.draft;
    if (!d) return this.shapes;
    if (this.following === 'map' && (d.kind === 'circle' || d.traced)) return this.drawnOnMap(d);
    if (d.kind === 'circle') {
      const radiusDeg = this.cursor ? Math.min(distanceDeg(d.center, this.cursor), MAX_RADIUS) : 0;
      return radiusDeg >= MIN_RADIUS ? [...this.shapes, { kind: 'circle', center: d.center, radiusDeg }] : this.shapes;
    }
    const last = d.points.at(-1)!;
    const points = this.cursor && distanceDeg(last, this.cursor) >= MERGE ? [...d.points, this.cursor] : d.points;
    if (points.length < 2) return this.shapes;
    const ring = d.kind === 'polygon' && points.length >= 3 && isSimple(points, true);
    return [...this.shapes, { kind: ring ? 'polygon' : 'line', points }];
  }

  /** The draft as the map traces it, out to the cursor where the map can trace that far. */
  private drawnOnMap(d: Draft): Shape[] {
    if (d.kind === 'circle') return this.band?.out ? [...this.shapes, { kind: 'path', points: this.band.out, closed: true }] : this.shapes;
    const traced = this.band?.out ? [...d.traced!, this.band.out] : d.traced!;
    if (traced.length === 0) return this.shapes;
    if (this.band?.back) return [...this.shapes, { kind: 'path', points: smallerSide(joined([...traced, this.band.back]).slice(0, -1)), closed: true }];
    return [...this.shapes, { kind: 'path', points: joined(traced), closed: false }];
  }

  /** Leaves everything as it was and says why. */
  private refuse(why: string): void {
    this.notice = why;
    this.notify();
  }

  private leaveDraft(): void {
    this.draft = null;
    this.cursor = null;
    this.band = null;
    this.notice = null;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
