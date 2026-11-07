import { geoArea, geoCircle, geoDistance } from 'd3-geo';
import type { LonLat } from '../projections/types';
import { isSimple, withoutAntipodalEdges } from './arcs';

/** A shape drawn on the Earth: points in degrees, or a circle's centre and angular radius in degrees. */
export type Shape = { kind: 'line' | 'polygon'; points: LonLat[] } | { kind: 'circle'; center: LonLat; radiusDeg: number };
export type Tool = 'none' | 'line' | 'polygon' | 'circle';

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
  if (shape.kind === 'circle') {
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

/** A shape as GeoJSON, with every edge a great-circle arc. A polygon or circle is a fill and, as a line of its own, an outline. */
export function shapeToGeoJSON(shape: Shape): GeoJSON.Geometry {
  let geometry = geometries.get(shape);
  if (!geometry) {
    geometry = build(shape);
    geometries.set(shape, geometry);
  }
  return geometry;
}

/** The shapes drawn so far and the one being drawn. Clicks add points to the draft, and a finished draft becomes a shape. */
export class DrawingModel {
  /** Replaced when it changes, never changed in place. */
  shapes: Shape[] = [];
  /** Line and polygon: the points placed so far. Circle: its centre, with no radius. */
  draft: Shape | null = null;
  /** Why the last click or finish was refused, until something is accepted. */
  notice: string | null = null;

  private current: Tool = 'none';
  private cursor: LonLat | null = null;
  private readonly listeners: (() => void)[] = [];

  get tool(): Tool {
    return this.current;
  }

  /** The radius, in kilometres, that the cursor gives the circle being drawn, or null when none is. */
  get radiusKm(): number | null {
    const radius = this.draft?.kind === 'circle' && this.cursor ? distanceDeg(this.draft.center, this.cursor) : 0;
    return radius >= MIN_RADIUS ? radiusKm(Math.min(radius, MAX_RADIUS)) : null;
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
    this.draft = null;
    this.cursor = null;
    this.notice = null;
    this.notify();
  }

  /** A click on the map. */
  addPoint(p: LonLat): void {
    const d = this.draft;
    if (this.current === 'none') return;
    if (this.current === 'circle') {
      if (!d) {
        this.draft = { kind: 'circle', center: p, radiusDeg: 0 };
      } else if (d.kind === 'circle') {
        const radiusDeg = distanceDeg(d.center, p);
        if (radiusDeg < MIN_RADIUS) return;
        this.shapes = [...this.shapes, { kind: 'circle', center: d.center, radiusDeg: Math.min(radiusDeg, MAX_RADIUS) }];
        this.draft = null;
        this.cursor = null;
      }
    } else if (!d) {
      this.draft = { kind: this.current, points: [p] };
    } else if (d.kind !== 'circle') {
      if (distanceDeg(d.points.at(-1)!, p) < MERGE) return;
      if (d.kind === 'polygon' && !isSimple([...d.points, p], false)) {
        this.notice = CROSSES;
        return this.notify();
      }
      this.draft = { kind: d.kind, points: [...d.points, p] };
    }
    this.notice = null;
    this.notify();
  }

  /** Where the cursor is on the map, or null when it is not on it. The draft is drawn out to it. */
  preview(p: LonLat | null): void {
    if (this.current === 'none' || (p === null && this.cursor === null)) return;
    this.cursor = p;
    // With no draft there is nothing to draw out to the cursor.
    if (this.draft) this.notify();
  }

  /** Makes the draft a shape, or drops it if it is too short to be one. A polygon whose closing edge would cross stays a draft. */
  finish(): void {
    const d = this.draft;
    if (!d) return;
    if (d.kind === 'polygon' && d.points.length >= 3 && !isSimple(d.points, true)) {
      this.notice = CLOSING_CROSSES;
      return this.notify();
    }
    if (d.kind !== 'circle' && d.points.length >= (d.kind === 'line' ? 2 : 3)) this.shapes = [...this.shapes, d];
    this.leaveDraft();
  }

  cancel(): void {
    this.leaveDraft();
  }

  /** Takes back the last point of the draft, or if there is none the last shape. */
  undo(): void {
    const d = this.draft;
    if (d && d.kind !== 'circle' && d.points.length > 1) this.draft = { kind: d.kind, points: d.points.slice(0, -1) };
    else if (d) this.draft = null;
    else this.shapes = this.shapes.slice(0, -1);
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

  private leaveDraft(): void {
    this.draft = null;
    this.cursor = null;
    this.notice = null;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
