import { el } from './dom';

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

export const clampTilt = (v: number): number => Math.min(90, Math.max(0, v));

export const formatDegrees = (v: number): string => `${Math.round(v * 100) / 100}\u00b0`;
/** Typed text for an angle: a number, with or without the degree sign. */
export function parseDegrees(raw: string): number | null {
  const text = raw.replace('\u00b0', '').trim();
  return text === '' || !Number.isFinite(Number(text)) ? null : Number(text);
}

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
  /** What a screen reader says for a value, if the number alone is not enough. */
  valueText?: (v: number) => string;
  /** What reset returns to; a function if it depends on something that changes. */
  defaultValue: number | (() => number);
  /** A value while the slider is dragged or stepped: the map follows at once. */
  onInput(v: number): void;
  /** A value set outright, by the reset or the number box: the map moves to it. `onInput` where not given. */
  onSet?(v: number): void;
}

export interface Slider {
  el: HTMLElement;
  /** Shows a value without calling `onInput`. */
  set(v: number): void;
  setEnabled(on: boolean): void;
}

let sliderCount = 0;

/** A labelled range with an editable number and a reset to the default. */
export function createSlider(opts: SliderOptions): Slider {
  const { min, max } = opts;
  const format = opts.format ?? ((v: number) => String(Math.round(v * 100) / 100));
  const parse = opts.parse ?? ((raw: string) => (raw.trim() === '' || !Number.isFinite(Number(raw)) ? null : Number(raw)));

  const onSet = opts.onSet ?? opts.onInput;

  const root = el('div', 'slider');
  const head = el('div', 'slider-head');
  const range = el('input', 'slider-range');
  const number = el('input', 'slider-number');
  const reset = el('button', 'slider-reset', '↺');
  const label = el('label', 'slider-label', opts.label);

  range.type = 'range';
  [range.min, range.max, range.step] = [String(min), String(max), String(opts.step)];
  range.id = `slider-${++sliderCount}`;
  label.htmlFor = range.id;
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

  // The value the slider shows, which is what the map has: the range itself only holds multiples of its step.
  let current = opts.value;
  const set = (v: number) => {
    current = v;
    range.value = String(v);
    range.setAttribute('aria-valuetext', opts.valueText?.(v) ?? format(v));
    // Not under the caret of someone typing.
    if (document.activeElement !== number) number.value = format(v);
  };
  const commit = (v: number, notify: (v: number) => void = opts.onInput) => {
    set(v);
    notify(v);
    // As the caret leaves: what the slider shows now, which is not what was typed if the map did not take it.
    number.value = format(current);
  };

  // A key moves by one step, so a stop it started on must not pull it back; a pointer, or a value set
  // outright, lands where it lands and snaps.
  let byKey = false;
  range.addEventListener('keydown', () => (byKey = true));
  range.addEventListener('keyup', () => (byKey = false));
  range.addEventListener('blur', () => (byKey = false));
  range.addEventListener('input', () => {
    const v = Number(range.value);
    commit(byKey ? v : snapValue(v, opts.stops ?? [], opts.snap ?? 0));
  });
  number.addEventListener('change', () => {
    const typed = parse(number.value);
    if (typed === null) number.value = format(current);
    else commit(Math.min(max, Math.max(min, typed)), onSet);
  });
  number.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') number.blur();
  });
  reset.addEventListener('click', () => commit(typeof opts.defaultValue === 'function' ? opts.defaultValue() : opts.defaultValue, onSet));

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
