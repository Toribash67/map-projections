import { expect, test, type Page } from '@playwright/test';
import { open } from './support';

/** Puts a button of the test's own on the page, with a tip, and for the popover tests a panel anchored to it. */
const scratch = (page: Page, style: string, withPanel = false) =>
  page.evaluate(
    async ([style, withPanel]) => {
      const [{ tip }, { popover }] = await Promise.all([import('/src/ui/tooltip.ts' as string), import('/src/ui/popover.ts' as string)]);
      const button = document.createElement('button');
      button.id = 'scratch';
      button.textContent = 'Scratch';
      button.style.cssText = `position: fixed; z-index: 50; ${style}`;
      document.body.append(button);
      tip(button, 'Draws a line', 'L');
      if (withPanel) {
        const panel = document.createElement('div');
        panel.id = 'scratch-panel';
        panel.innerHTML = '<button id="inside">Inside</button>';
        popover(button, panel, 'below-left');
      }
    },
    [style, withPanel] as const,
  );

const tooltip = (page: Page) => page.getByRole('tooltip');

test('a tip shows after a moment of hover, with its shortcut, and hides when the pointer leaves', async ({ page }) => {
  await open(page);
  await scratch(page, 'left: 400px; top: 300px;');
  await page.hover('#scratch');
  // Not at once: a pointer passing over shows nothing.
  await expect(tooltip(page)).toBeHidden();
  await expect(tooltip(page)).toBeVisible({ timeout: 2000 });
  await expect(tooltip(page)).toContainText('Draws a line');
  await expect(tooltip(page).locator('kbd')).toHaveText('L');
  await page.mouse.move(10, 590);
  await expect(tooltip(page)).toBeHidden();
});

test('a tip shows at once on keyboard focus, describes the control, and Escape hides it', async ({ page }) => {
  await open(page);
  await scratch(page, 'left: 400px; top: 300px;');
  await expect(page.locator('#scratch')).toHaveAttribute('aria-description', 'Draws a line');
  await page.locator('#scratch').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#scratch')).toBeFocused();
  await expect(tooltip(page)).toBeVisible({ timeout: 200 });
  await page.keyboard.press('Escape');
  await expect(tooltip(page)).toBeHidden();
});

test('a press hides a tip, and one hover later shows it again', async ({ page }) => {
  await open(page);
  await scratch(page, 'left: 400px; top: 300px;');
  await page.hover('#scratch');
  await expect(tooltip(page)).toBeVisible({ timeout: 2000 });
  await page.mouse.down();
  await expect(tooltip(page)).toBeHidden();
  await page.mouse.up();
  await page.mouse.move(10, 590);
  await page.hover('#scratch');
  await expect(tooltip(page)).toBeVisible({ timeout: 2000 });
});

for (const [name, style] of [['top left', 'left: 0; top: 0;'], ['bottom right', 'right: 0; bottom: 0;'], ['right edge', 'right: 0; top: 300px;']] as const) {
  test(`a tip by the ${name} of the window stays inside it`, async ({ page }) => {
    await open(page);
    await scratch(page, style);
    await page.hover('#scratch');
    await expect(tooltip(page)).toBeVisible({ timeout: 2000 });
    const box = (await tooltip(page).boundingBox())!;
    const view = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    // And not over the control it describes.
    const button = (await page.locator('#scratch').boundingBox())!;
    const apart = box.x >= button.x + button.width || box.x + box.width <= button.x || box.y >= button.y + button.height || box.y + box.height <= button.y;
    expect(apart).toBe(true);
  });
}

test('a popover opens from its button, and Escape closes it and returns focus to the button', async ({ page }) => {
  await open(page);
  await scratch(page, 'left: 400px; top: 100px;', true);
  const panel = page.locator('#scratch-panel');
  await expect(panel).toBeHidden();
  await expect(page.locator('#scratch')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#scratch');
  await expect(panel).toBeVisible();
  await expect(page.locator('#scratch')).toHaveAttribute('aria-expanded', 'true');
  // Below the button, its left edge on the button's.
  const [b, p] = [(await page.locator('#scratch').boundingBox())!, (await panel.boundingBox())!];
  expect(p.y).toBeGreaterThanOrEqual(b.y + b.height);
  expect(Math.abs(p.x - b.x)).toBeLessThan(2);
  await page.locator('#inside').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#scratch')).toBeFocused();
});

test('a press outside closes a popover, a press inside does not, and the button toggles it', async ({ page }) => {
  await open(page);
  await scratch(page, 'left: 400px; top: 100px;', true);
  const panel = page.locator('#scratch-panel');
  await page.click('#scratch');
  await page.click('#inside');
  await expect(panel).toBeVisible();
  await page.mouse.click(900, 500);
  await expect(panel).toBeHidden();
  await page.click('#scratch');
  await expect(panel).toBeVisible();
  await page.click('#scratch');
  await expect(panel).toBeHidden();
});

test('every icon is a 16 pixel drawing in the colour of its text', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { icon, ICONS } = await import('/src/ui/icons.ts' as string);
    return (ICONS as string[]).map((name) => {
      const svg = icon(name) as SVGElement;
      return { name, tag: svg.tagName, size: [svg.getAttribute('width'), svg.getAttribute('height')], hidden: svg.getAttribute('aria-hidden'), marks: svg.children.length, colour: svg.outerHTML.includes('currentColor') };
    });
  });
  expect(result.map((r) => r.name).sort()).toEqual(['circle', 'clear', 'collapse', 'export', 'finish', 'fit', 'follow-globe', 'follow-map', 'layers', 'line', 'polygon', 'reset', 'surface', 'undo', 'zoom-in', 'zoom-out']);
  for (const r of result) {
    expect(r, r.name).toMatchObject({ tag: 'svg', size: ['16', '16'], hidden: 'true', colour: true });
    expect(r.marks, r.name).toBeGreaterThan(0);
  }
});
