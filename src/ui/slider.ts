/** The value of `stops` nearest to `v` if it lies within `tolerance`, else `v`. */
export function snapValue(v: number, stops: number[], tolerance: number): number {
  let best = v;
  let bestDistance = tolerance;
  for (const stop of stops) {
    const distance = Math.abs(v - stop);
    if (distance <= bestDistance) [best, bestDistance] = [stop, distance];
  }
  return best;
}

/** Wraps a longitude to [-180, 180). */
export const normaliseLon = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180;
export const clampLat = (v: number): number => Math.min(90, Math.max(-90, v));
export const clampTilt = (v: number): number => Math.min(90, Math.max(0, v));

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Values the slider snaps to, and shows a tick at. */
  stops?: number[];
  /** How near a stop a dragged value must be to snap to it. */
  snap?: number;
  /** Reads typed text, or null if it is not a value. */
  parse?: (raw: string) => number | null;
  format?: (v: number) => string;
  /** What reset returns to; a function if it depends on something that changes. */
  defaultValue: number | (() => number);
  onInput(v: number): void;
}

export interface Slider {
  el: HTMLElement;
  /** Shows a value without calling `onInput`. */
  set(v: number): void;
  setEnabled(on: boolean): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A labelled range with an editable number and a reset to the default. */
export function createSlider(opts: SliderOptions): Slider {
  const { min, max } = opts;
  const format = opts.format ?? ((v: number) => String(Math.round(v * 100) / 100));
  const parse = opts.parse ?? ((raw: string) => (raw.trim() === '' || Number.isNaN(Number(raw)) ? null : Number(raw)));

  const root = el('div', 'slider');
  const head = el('div', 'slider-head');
  const range = el('input', 'slider-range');
  const number = el('input', 'slider-number');
  const reset = el('button', 'slider-reset', '↺');
  const label = el('label', 'slider-label', opts.label);

  range.type = 'range';
  [range.min, range.max, range.step] = [String(min), String(max), String(opts.step)];
  range.setAttribute('aria-label', opts.label);
  number.type = 'text';
  number.inputMode = 'decimal';
  number.setAttribute('aria-label', `${opts.label}, value`);
  reset.type = 'button';
  reset.title = `Reset ${opts.label.toLowerCase()}`;
  reset.setAttribute('aria-label', reset.title);

  const track = el('div', 'slider-track');
  track.append(range);
  for (const stop of opts.stops ?? []) {
    const tick = el('span', 'slider-tick');
    tick.style.left = `${((stop - min) / (max - min)) * 100}%`;
    track.append(tick);
  }
  head.append(label, number, reset);
  root.append(head, track);

  const set = (v: number) => {
    range.value = String(v);
    // Not under the caret of someone typing.
    if (document.activeElement !== number) number.value = format(v);
  };
  const commit = (v: number) => {
    set(v);
    opts.onInput(v);
  };

  range.addEventListener('input', () => {
    commit(snapValue(Number(range.value), opts.stops ?? [], opts.snap ?? 0));
  });
  number.addEventListener('change', () => {
    const typed = parse(number.value);
    if (typed === null) {
      number.value = format(Number(range.value));
      return;
    }
    commit(Math.min(max, Math.max(min, typed)));
    number.value = format(Number(range.value));
  });
  number.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') number.blur();
  });
  reset.addEventListener('click', () => commit(typeof opts.defaultValue === 'function' ? opts.defaultValue() : opts.defaultValue));

  set(opts.value);
  return {
    el: root,
    set,
    setEnabled(on) {
      root.classList.toggle('disabled', !on);
      range.disabled = number.disabled = reset.disabled = !on;
    },
  };
}
