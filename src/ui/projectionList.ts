import type { Stop } from '../projections/types';
import { el } from './dom';

const FAMILY_NAMES: Record<string, string> = {
  globe: 'Globe',
  azimuthal: 'Azimuthal',
  cylindrical: 'Cylindrical',
  conic: 'Conic',
  compromise: 'Compromise',
  'equal-area': 'Equal-area',
};

/** The projections a conic turns into at the limits of its sliders. */
const CONIC_LIMITS = [
  { id: 'mercator', label: 'Mercator' },
  { id: 'lambert-cylindrical', label: 'Lambert cylindrical equal-area' },
  { id: 'behrmann', label: 'Behrmann' },
  { id: 'gall-peters', label: 'Gall-Peters' },
  { id: 'stereographic', label: 'Polar stereographic' },
  { id: 'lambert-azimuthal', label: 'Polar Lambert azimuthal equal-area' },
];

export interface ListView {
  /** The family of the projection on the map. */
  family: string;
  /** The stop the map sits on, if any. */
  match: Stop | null;
  /** Whether `match` is a limit of the conic sliders rather than the map's own projection. */
  reachedFromConic: boolean;
}

export interface ProjectionList {
  el: HTMLElement;
  /** Where a family's sliders go, inside its section. */
  slotFor(family: string): HTMLElement;
  update(view: ListView): void;
}

const mark = (node: HTMLElement, on: boolean) => {
  node.classList.toggle('current', on);
  if (on) node.setAttribute('aria-current', 'true');
  else node.removeAttribute('aria-current');
};

/** Projections grouped by family: one family open at a time, the one on the map highlighted by name, or "Custom". */
export function createProjectionList(stops: Stop[], onSelect: (stop: Stop) => void): ProjectionList {
  const root = el('div', 'projection-list');
  const families = [...new Set(stops.map((s) => s.family))];
  const sections = new Map<string, { section: HTMLElement; head: HTMLButtonElement; body: HTMLElement; slot: HTMLElement; custom: HTMLElement }>();
  const buttons = new Map<string, HTMLButtonElement>();
  const chips = new Map<string, HTMLElement>();
  let shown = '';

  const open = (family: string | null) => {
    for (const [name, s] of sections) {
      s.body.hidden = name !== family;
      s.head.setAttribute('aria-expanded', String(name === family));
    }
  };

  for (const family of families) {
    const section = el('section', 'family');
    section.dataset.family = family;
    const head = el('button', 'family-head', FAMILY_NAMES[family] ?? family);
    head.type = 'button';
    head.setAttribute('aria-controls', `family-${family}`);
    const body = el('div', 'family-body');
    body.id = `family-${family}`;
    const list = el('ul', 'stops');
    for (const stop of stops.filter((s) => s.family === family)) {
      const item = el('li', 'stop-item');
      const button = el('button', 'stop', stop.name);
      button.type = 'button';
      button.dataset.stop = stop.id;
      button.addEventListener('click', () => onSelect(stop));
      buttons.set(stop.id, button);
      item.append(button);
      list.append(item);
    }
    const custom = el('li', 'stop-item custom', 'Custom');
    custom.dataset.custom = '';
    custom.hidden = true;
    list.append(custom);
    body.append(list);

    if (family === 'conic') {
      const limits = el('div', 'limits');
      limits.append(el('p', 'limits-title', 'At its limits the cone becomes'));
      const limitList = el('ul', 'limit-list');
      for (const { id, label } of CONIC_LIMITS) {
        const chip = el('li', 'limit', label);
        chip.dataset.limit = id;
        chips.set(id, chip);
        limitList.append(chip);
      }
      limits.append(limitList, el('p', 'limits-reached', 'Reached from the conic sliders.'));
      body.append(limits);
    }

    const slot = el('div', 'sliders');
    body.append(slot);
    section.append(head, body);
    head.addEventListener('click', () => open(body.hidden ? family : null));
    sections.set(family, { section, head, body, slot, custom });
    root.append(section);
  }
  open(null);

  return {
    el: root,
    slotFor: (family) => sections.get(family)!.slot,
    update({ family, match, reachedFromConic }) {
      if (family !== shown) {
        shown = family;
        open(family);
      }
      for (const [id, button] of buttons) mark(button, !reachedFromConic && match?.id === id);
      for (const [id, chip] of chips) mark(chip, reachedFromConic && match?.id === id);
      for (const [name, s] of sections) {
        s.head.classList.toggle('current', name === family);
        s.custom.hidden = !(name === family && match === null);
        mark(s.custom, !s.custom.hidden);
      }
      sections.get('conic')?.body.classList.toggle('reached', reachedFromConic);
    },
  };
}
