import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { paletteCss, themeColors } from './src/theme/palette.ts';

/** Puts the palette's custom properties in the page's head, and its colours as the browser's theme colour for each scheme: one list, and no flash of the wrong one. */
const palette = (): Plugin => ({
  name: 'palette',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { name: 'color-scheme', content: 'light dark' }, injectTo: 'head' },
    ...themeColors().map(({ scheme, color }) => ({
      tag: 'meta',
      attrs: { name: 'theme-color', content: color, media: `(prefers-color-scheme: ${scheme})` },
      injectTo: 'head' as const,
    })),
    { tag: 'style', children: paletteCss(), injectTo: 'head' },
  ],
});

export default defineConfig({
  base: './',
  plugins: [palette()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
