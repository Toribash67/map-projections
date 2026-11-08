import type { Scheme } from './palette';

const dark = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** The system's scheme now; light where there is no way to ask. */
export const currentScheme = (): Scheme => (dark()?.matches ? 'dark' : 'light');

/** Calls `fn` with the new scheme whenever the system's setting changes, with no reload. */
export function watchScheme(fn: (scheme: Scheme) => void): void {
  dark()?.addEventListener('change', (e) => fn(e.matches ? 'dark' : 'light'));
}
