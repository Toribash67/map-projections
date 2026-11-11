import type { Stop } from '../projections/types';
import { el } from './dom';
import { tip } from './tooltip';

const FAMILY_NAMES: Record<string, string> = {
  globe: 'Globe',
  azimuthal: 'Azimuthal',
  cylindrical: 'Cylindrical',
  conic: 'Conic',
  compromise: 'Compromise',
  'equal-area': 'Equal-area',
  hemispheres: 'Double hemisphere',
  polyhedral: 'Interrupted and polyhedral',
};

export interface ProjectionList {
  el: HTMLElement;
  /** Marks the stop the map sits on, or none where it is between stops or has become another projection at a slider's limit. */
  setCurrent(stop: Stop | null): void;
  /** Shows only the projections whose name, family or tag has the text in it, and hides a family left with none. */
  filter(text: string): void;
}

/**
 * The projections by family, all in view at once. Each has a tag for what it preserves, in words, and its note as a tip. The one on the
 * map is marked.
 */
export function createProjectionList(stops: Stop[], onSelect: (stop: Stop) => void): ProjectionList {
  const root = el('nav', 'projection-list');
  root.setAttribute('aria-label', 'Projections');
  const families = [...new Set(stops.map((s) => s.family))];
  const sections: { section: HTMLElement; rows: { stop: Stop; item: HTMLElement; button: HTMLButtonElement; words: string }[] }[] = [];

  for (const family of families) {
    const name = FAMILY_NAMES[family] ?? family;
    const section = el('section', 'family');
    section.dataset.family = family;
    const heading = el('h2', 'family-name', name);
    heading.id = `family-${family}`;
    const list = el('ul', 'stops');
    list.setAttribute('aria-labelledby', heading.id);
    const rows = stops
      .filter((s) => s.family === family)
      .map((stop) => {
        const item = el('li', 'stop-item');
        const button = el('button', 'stop');
        button.type = 'button';
        button.dataset.stop = stop.id;
        button.append(el('span', 'stop-name', stop.name));
        if (stop.preserves !== 'none') button.append(el('span', 'tag', stop.preserves));
        tip(button, stop.note);
        button.addEventListener('click', () => onSelect(stop));
        item.append(button);
        list.append(item);
        return { stop, item, button, words: `${stop.name} ${name} ${stop.preserves === 'none' ? '' : stop.preserves}`.toLowerCase() };
      });
    section.append(heading, list);
    sections.push({ section, rows });
    root.append(section);
  }

  return {
    el: root,
    setCurrent(stop) {
      for (const { rows } of sections) {
        for (const row of rows) {
          const on = row.stop.id === stop?.id;
          row.button.classList.toggle('current', on);
          if (on) row.button.setAttribute('aria-current', 'true');
          else row.button.removeAttribute('aria-current');
        }
      }
    },
    filter(text) {
      const wanted = text.trim().toLowerCase();
      for (const { section, rows } of sections) {
        let shown = 0;
        for (const row of rows) {
          row.item.hidden = !row.words.includes(wanted);
          if (!row.item.hidden) shown++;
        }
        section.hidden = shown === 0;
      }
    },
  };
}
