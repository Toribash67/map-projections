import { stops } from '../src/projections/catalog';
import type { Stop } from '../src/projections/types';

/**
 * The orthographic view as a stop. It is no longer in the list, where the globe has taken its place, but the far end of the viewpoint
 * slider still reaches it, and its rim, a quarter turn from the centre, is where many of the cuts once went wrong.
 */
export const ORTHOGRAPHIC: Stop = { id: 'orthographic', name: 'Orthographic', family: 'azimuthal', note: '', preserves: 'none', defId: 'perspective', params: { x: 1 } };

/** A stop by id, the orthographic view among them. */
export function stopOf(id: string): Stop {
  const stop = id === ORTHOGRAPHIC.id ? ORTHOGRAPHIC : stops.find((s) => s.id === id);
  if (!stop) throw new Error(`no stop ${id}`);
  return stop;
}
