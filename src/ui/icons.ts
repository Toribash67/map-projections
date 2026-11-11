const NS = 'http://www.w3.org/2000/svg';

// Each icon as the inside of a 16 by 16 drawing: lines 1.5 wide in the colour of the text around it, with round ends.
const DRAWINGS = {
  line: '<path d="M3 13 13 3"/><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="13" cy="3" r="1.5" fill="currentColor"/>',
  polygon: '<path d="M8 2 14 6.5 11.5 13.5h-7L2 6.5Z"/>',
  circle: '<circle cx="8" cy="8" r="5.75"/>',
  'follow-map': '<rect x="2" y="3.5" width="12" height="9" rx="1"/><path d="M4.5 10 11.5 6"/>',
  'follow-globe': '<circle cx="8" cy="8" r="6"/><path d="M3.5 10.5C6 6 10 5 12.5 5.5"/>',
  finish: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  undo: '<path d="M6 3.5 3 6.5l3 3"/><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7"/>',
  clear: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v3.5M9 7v3.5"/>',
  layers: '<path d="M8 2 14 5.5 8 9 2 5.5Z"/><path d="M2 8.5 8 12l6-3.5M2 11.5 8 15l6-3.5" opacity="0.6"/>',
  export: '<path d="M8 2v8.5M4.5 7 8 10.5 11.5 7"/><path d="M2.5 11v2.5h11V11"/>',
  'zoom-in': '<path d="M8 3v10M3 8h10"/>',
  'zoom-out': '<path d="M3 8h10"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  surface: '<ellipse cx="8" cy="4" rx="5" ry="1.75"/><path d="M3 4v8c0 1 2.2 1.75 5 1.75s5-.75 5-1.75V4"/>',
  collapse: '<path d="M4 6l4 4 4-4"/>',
  reset: '<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/>',
} as const;

export type IconName = keyof typeof DRAWINGS;
export const ICONS = Object.keys(DRAWINGS) as IconName[];

/** An icon, 16 pixels on a side, in the colour of the text it sits in. It says nothing to a screen reader: the control it is on has a name. */
export function icon(name: IconName): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  for (const [key, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(key, value);
  }
  svg.classList.add('icon');
  svg.innerHTML = DRAWINGS[name];
  return svg;
}
