import { LAND } from '../data/land';
import { loadWater, type Sea } from '../data/water';
import { worldNow } from '../data/world';
import { canvasMeasure, fontReady, loadFont } from '../labels/font';
import { editLabels, type LabelEdits } from '../labels/move';
import type { Label, Mark } from '../labels/place';
import { loadPictureData } from '../layers/mapData';
import { buildLetters, buildOverlayMarks, buildPlateOnly, lettersWanted, overlayOf, overlayWanted, type Overlay, type OverlayInput, type OverlayMeasure, type OverlayWorld } from '../overlay/overlay';
import { paddingFor, type Plate } from '../plate/plate';
import { blobOf, exportScene, placeExport, type Exported, type ExportOptions, type Placed, type Snapshot } from './render';

/**
 * A picture for export, worked out: the map it is of and the choices it was made with, its scene, and what is over that. `keyOf`
 * has the key each label on it is known by, by which it is moved or taken off.
 */
export type Picture = { snap: Snapshot; opts: ExportOptions; exported: Exported; overlay: Overlay | null; keyOf: Map<Label, string> };

/** A picture as a file. */
export const pictureBlob = ({ snap, opts, exported, overlay }: Picture): Promise<Blob> => blobOf(snap, opts, exported, overlay);

/**
 * Makes the picture for export, and makes it again as its settings change, keeping what a change leaves as it was. A picture is
 * made in three steps, each slower than the next: the scene is cut from the coast and the layers, which for a fine coast takes
 * seconds; the names and degrees are fitted to the map; and the frame and title box are set, which takes no time. So a title can be
 * typed, a name moved or a colour changed with nothing cut or fitted again; and when a layer is turned on, only that layer is cut,
 * as the cut keeps what it has cut for a map that stays where it is.
 */
export class PictureMaker {
  private placed: { key: string; placed: Placed } | null = null;
  private scene: { key: string; drawings: GeoJSON.GeometryCollection; exported: Exported } | null = null;
  private letters: { key: string; labels: Label[]; marks: Mark[] } | null = null;
  private plate: Plate | null = null;
  private measure: OverlayMeasure | null = null;
  private last: Picture | null = null;

  /** Everything that says where the map goes in the picture. */
  private placeKey(snap: Snapshot, opts: ExportOptions): string {
    return JSON.stringify([snap.state, opts.extent, opts.width, snap.viewport, opts.extent === 'view' ? snap.view : null, paddingFor(snap.layers)]);
  }

  /** Everything the scene depends on, but the drawings, which are held by what they are. */
  private sceneKey(snap: Snapshot, opts: ExportOptions): string {
    const { on, cover, graticuleStep, graticuleUnder } = snap.layers;
    // But for what is only written and marked over the scene, which is no part of it.
    const { countryNames: _c, seaNames: _s, regionNames: _r, degrees: _d, titleBox: _t, legend: _l, capitals: _a, cities: _i, peaks: _p, volcanoes: _v, quakes: _q, ...cut } = on;
    return this.placeKey(snap, opts) + JSON.stringify([opts.detail, cut, cover, graticuleStep, graticuleUnder]);
  }

  /** Whether the scene of this picture is here already, so that making it takes no time to speak of. */
  has(snap: Snapshot, opts: ExportOptions): boolean {
    return this.scene?.key === this.sceneKey(snap, opts) && this.scene.drawings === snap.drawings;
  }

  /** The picture of a map, with the choices made for it and what has been done to its lettering by hand. */
  async make(snap: Snapshot, opts: ExportOptions, edits: LabelEdits): Promise<Picture> {
    const placeKey = this.placeKey(snap, opts);
    if (this.placed?.key !== placeKey) this.placed = { key: placeKey, placed: placeExport(snap, opts) };
    const { placed } = this.placed;
    if (!this.has(snap, opts)) this.scene = { key: this.sceneKey(snap, opts), drawings: snap.drawings, exported: await exportScene(snap, opts, placed) };
    const { exported } = this.scene!;

    this.plate = null;
    let fitted: { labels: Label[]; marks: Mark[] } = { labels: [], marks: [] };
    if (overlayWanted(snap.layers)) {
      // The typeface first, as the names are fitted by the widths of its letters; the seas, if they are named; and whatever else is
      // named or marked. Any may fail to come: the lettering is then in another typeface, or goes without it, and the picture is
      // made all the same.
      const [seas] = await Promise.all([snap.layers.on.seaNames ? loadWater('seas', '110m').catch(() => null) : null, loadFont(), loadPictureData(snap.layers, opts.detail).catch(() => {})]);
      this.measure ??= canvasMeasure();
      const input: OverlayInput = { member: placed.member, state: snap.state, named: snap.named, layers: snap.layers, picture: { x: 0, y: 0, ...placed.size }, scale: placed.lineScale };
      const now = <K extends keyof OverlayWorld>(kind: K) => worldNow(kind, opts.detail);
      fitted = this.fitted(input, placeKey, seas, { regions: now('regions'), cities: now('cities'), peaks: now('peaks'), volcanoes: now('volcanoes'), quakes: now('quakes') });
      this.plate = buildPlateOnly(input, this.measure).plate;
    }
    this.last = { snap, opts, exported, overlay: null, keyOf: new Map() };
    return this.edited(fitted, edits);
  }

  /** The lettering and the marks of a map, fitted afresh only where what they depend on has changed. */
  private fitted(input: OverlayInput, placeKey: string, seas: Sea[] | null, world: OverlayWorld): { labels: Label[]; marks: Mark[] } {
    if (!lettersWanted(input.layers)) return { labels: [], marks: [] };
    const { on, graticuleStep, smallestName } = input.layers;
    const shown = [on.countryNames, on.seaNames, on.regionNames, on.degrees && on.graticule, on.zones, on.capitals, on.cities, on.peaks, on.volcanoes, on.quakes];
    const here = Object.values(world).map((list) => list !== null);
    const key = placeKey + JSON.stringify([shown, graticuleStep, smallestName, fontReady(), seas !== null, here]);
    if (this.letters?.key !== key) this.letters = { key, labels: buildLetters(input, this.measure!, seas, LAND, world), marks: buildOverlayMarks(input, world) };
    return this.letters;
  }

  /** The picture last made, with its lettering as it is after other moves by hand: nothing is cut or fitted, so it can follow a pointer. */
  withEdits(edits: LabelEdits): Picture | null {
    return this.last && this.edited(this.letters && lettersWanted(this.last.snap.layers) ? this.letters : { labels: [], marks: [] }, edits);
  }

  private edited({ labels, marks }: { labels: Label[]; marks: Mark[] }, edits: LabelEdits): Picture {
    const last = this.last!;
    if (!this.plate) return (this.last = { ...last, overlay: null, keyOf: new Map() });
    const kept = editLabels(labels, edits, last.exported.size.width);
    // A name the title box or the legend would lie over is left out, wherever it has been moved to.
    const overlay = overlayOf(kept.map(({ label }) => label), this.plate, marks);
    return (this.last = { ...last, overlay, keyOf: new Map(kept.map(({ label, key }) => [label, key])) });
  }
}
