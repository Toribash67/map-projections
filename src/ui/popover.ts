// Space (CSS pixels) between a button and its panel.
const GAP = 6;

export interface Popover {
  close(): void;
  isOpen(): boolean;
}

/**
 * A panel that a button opens and closes, placed below the button with their left edges in line, or their right. Escape closes it and
 * hands focus back to the button; so does a press anywhere outside the two. The panel is put in the button's own parent, which has to
 * be a positioned element, so that it keeps its place when the window is resized.
 */
export function popover(button: HTMLButtonElement, panel: HTMLElement, side: 'below-left' | 'below-right'): Popover {
  panel.classList.add('popover');
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'dialog');
  panel.setAttribute('role', 'dialog');
  button.after(panel);

  const place = () => {
    const [b, parent] = [button.getBoundingClientRect(), (panel.offsetParent ?? document.body).getBoundingClientRect()];
    panel.style.top = `${b.bottom - parent.top + GAP}px`;
    if (side === 'below-left') panel.style.left = `${b.left - parent.left}px`;
    else panel.style.right = `${parent.right - b.right}px`;
  };
  const isOpen = () => !panel.hidden;
  const set = (open: boolean) => {
    if (open === isOpen()) return;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) place();
  };
  const close = () => {
    const hadFocus = panel.contains(document.activeElement);
    set(false);
    if (hadFocus) button.focus();
  };

  button.addEventListener('click', () => set(!isOpen()));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    const within = panel.contains(document.activeElement) || document.activeElement === button;
    set(false);
    if (within) button.focus();
    e.preventDefault();
  });
  window.addEventListener('pointerdown', (e) => {
    if (isOpen() && e.target instanceof Node && !panel.contains(e.target) && !button.contains(e.target)) set(false);
  });
  return { close, isOpen };
}
