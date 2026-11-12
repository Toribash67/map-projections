/** An element with a class and optionally text. */
/** Whether typing is going into this element, which then owns the keys. A slider, a tick box or a colour takes no letters, and leaves them to the map. */
export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('textarea, select, [contenteditable], input:not([type=range], [type=checkbox], [type=radio], [type=color], [type=button])') !== null;

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
