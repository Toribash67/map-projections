// How long (ms) the pointer rests on a control before its tip shows. Keyboard focus shows it at once.
const HOVER_DELAY = 350;
// Space (CSS pixels) between a control and its tip, and between a tip and the window's edge.
const GAP = 6;
const MARGIN = 4;

type Tip = { text: string; shortcut?: string };

let bubble: HTMLElement | null = null;
let shownFor: HTMLElement | null = null;
let timer = 0;
// Whether the last thing the user did was press a key: focus that follows a key came by the keyboard, and shows the tip.
let byKeyboard = false;

/** The one tip element of the page, made when first needed. */
function theBubble(): HTMLElement {
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'tooltip';
    bubble.setAttribute('role', 'tooltip');
    bubble.hidden = true;
    document.body.append(bubble);
    // Escape hides a tip wherever the focus is, and a press anywhere does too: the tip has said its piece.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
  }
  return bubble;
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (byKeyboard = true), true);
  window.addEventListener('pointerdown', () => (byKeyboard = false), true);
}

function hide(): void {
  window.clearTimeout(timer);
  timer = 0;
  shownFor = null;
  if (bubble) bubble.hidden = true;
}

/** Puts the tip below its control, or above where there is no room below, and within the window from side to side. */
function place(el: HTMLElement, target: HTMLElement): void {
  const box = target.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = el;
  const [viewWidth, viewHeight] = [document.documentElement.clientWidth, document.documentElement.clientHeight];
  const below = box.bottom + GAP;
  const top = below + height + MARGIN <= viewHeight ? below : box.top - GAP - height;
  const left = Math.min(viewWidth - MARGIN - width, Math.max(MARGIN, box.left + box.width / 2 - width / 2));
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(MARGIN, top)}px`;
}

function show(target: HTMLElement, { text, shortcut }: Tip): void {
  const el = theBubble();
  el.replaceChildren(document.createTextNode(text));
  if (shortcut) {
    const key = document.createElement('kbd');
    key.textContent = shortcut;
    el.append(key);
  }
  el.hidden = false;
  place(el, target);
  shownFor = target;
}

/**
 * Describes a control: what it does, and its shortcut if it has one. The tip shows after the pointer has rested on the control for a
 * moment, or at once when the keyboard brings focus to it, and hides when the pointer leaves, focus leaves, anything is pressed, or on
 * Escape. A screen reader reads the text as the control's description. Unlike the browser's own `title` it shows on keyboard focus too.
 */
export function tip(target: HTMLElement, text: string, shortcut?: string): void {
  const content: Tip = { text, shortcut };
  target.setAttribute('aria-description', text);
  if (shortcut) target.setAttribute('aria-keyshortcuts', shortcut);
  target.addEventListener('pointerenter', (e) => {
    // A touch has no hover: its press is the action, and a tip would only be in the way.
    if (e.pointerType === 'touch') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(target, content), HOVER_DELAY);
  });
  target.addEventListener('pointerleave', () => {
    if (shownFor === target || timer) hide();
  });
  target.addEventListener('focus', () => {
    if (byKeyboard) show(target, content);
  });
  target.addEventListener('blur', () => {
    if (shownFor === target) hide();
  });
}
