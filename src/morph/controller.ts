import type { Member } from '../tissot/indicatrix';

export const DURATION = 1400; // ms
const MIN_WEIGHT = 0.01;
const MAX_SOURCES = 4;

export const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Whether two members draw the same map. Angles a projection does not use do not count. */
function sameMap(a: Member, b: Member): boolean {
  const [pa, pb] = [a.compiled, b.compiled];
  const def = pa.def;
  if (def !== pb.def) return false;
  // With the parameters a map makes for itself where they are not given, which are not among the defaults.
  const params = Object.keys({ ...def.defaultParams, ...pa.state.params, ...pb.state.params });
  const param = (state: typeof pa.state, key: string) => state.params[key] ?? def.defaultParams[key];
  if (params.some((key) => param(pa.state, key) !== param(pb.state, key))) return false;
  const [oa, ob] = [pa.state.orientation, pb.state.orientation];
  if (oa.lon !== ob.lon) return false;
  if (def.latEnabled && oa.lat !== ob.lat) return false;
  if (def.tiltEnabled && oa.tilt !== ob.tilt) return false;
  const [sa, sb] = [a.screen, b.screen];
  return sa.k === sb.k && sa.tx === sb.tx && sa.ty === sb.ty && sa.cos === sb.cos && sa.sin === sb.sin;
}

/** The map on screen as a weighted mix of members, and the morph under way, if any. */
export class MorphController {
  private sources: Member[] = [];
  private destination: Member | null = null;
  private startedAt = 0;

  constructor(private readonly now: () => number) {}

  get isMorphing(): boolean {
    return this.destination !== null;
  }

  source(): Member[] {
    return this.sources;
  }

  target(): Member | null {
    return this.destination;
  }

  /** The eased progress of the morph. At rest it is 1, so a scene not yet rebuilt shows where the morph ended. */
  t(): number {
    return this.destination ? easeInOutCubic(this.progress()) : 1;
  }

  /** Shows `m` at once, ending any morph. */
  jumpTo(m: Member): void {
    this.sources = [{ ...m, weight: 1 }];
    this.destination = null;
  }

  /**
   * Starts a morph to `m`, or redirects the one under way from wherever things are:
   * what is on screen is `(1-t) sources + t target`, so that becomes the new source.
   */
  morphTo(m: Member): void {
    if (this.sources.length === 0) return this.jumpTo(m);
    this.tick();
    if (this.destination) {
      if (sameMap(this.destination, m)) return;
      this.sources = this.currentMix();
      this.destination = null;
    }
    const [only] = this.sources;
    if (this.sources.length === 1 && sameMap(only!, m)) return;
    this.destination = { ...m, weight: 1 };
    this.startedAt = this.now();
  }

  /** Settles the morph once its time is up. True while a frame is needed. */
  tick(): boolean {
    if (!this.destination) return false;
    if (this.progress() < 1) return true;
    this.sources = [this.destination];
    this.destination = null;
    return false;
  }

  /** Refits every member, for instance to a new viewport. The morph runs on and the weights stay. */
  resize(fn: (m: Member) => Member): void {
    const refit = (m: Member): Member => ({ ...fn(m), weight: m.weight });
    this.sources = this.sources.map(refit);
    if (this.destination) this.destination = refit(this.destination);
  }

  private progress(): number {
    return Math.min(1, (this.now() - this.startedAt) / DURATION);
  }

  private currentMix(): Member[] {
    const t = this.t();
    const mix: Member[] = [];
    const add = (m: Member, weight: number) => {
      const same = mix.find((x) => sameMap(x, m));
      if (same) same.weight += weight;
      else mix.push({ ...m, weight });
    };
    for (const m of this.sources) add(m, (1 - t) * m.weight);
    add(this.destination!, t);
    const kept = mix.filter((m) => m.weight >= MIN_WEIGHT);
    const largest = [...kept].sort((a, b) => b.weight - a.weight).slice(0, MAX_SOURCES);
    const total = largest.reduce((sum, m) => sum + m.weight, 0);
    return kept.filter((m) => largest.includes(m)).map((m) => ({ ...m, weight: m.weight / total }));
  }
}
