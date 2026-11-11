import type { Page } from '@playwright/test';
import { stops } from '../src/projections/catalog';
import type { ProjectionState } from '../src/projections/types';

export const stop = (id: string) => stops.find((s) => s.id === id)!;

export const open = async (page: Page) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__app !== undefined);
};

/** Opens the app on a clock that only moves when told to, and leaves it paused. */
export const openPaused = async (page: Page) => {
  await page.clock.install({ time: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await page.clock.pauseAt(60_000);
  await page.clock.runFor(32);
};

export const head = (page: Page, family: string) => page.locator(`[data-family="${family}"] > .family-head`);
export const stopButton = (page: Page, id: string) => page.locator(`[data-stop="${id}"]`);
export const slider = (page: Page, name: string) => page.getByRole('slider', { name, exact: true });
export const numberBox = (page: Page, name: string) => page.getByRole('textbox', { name: `${name}, value`, exact: true });
/** Waits for the map to be at rest: no morph and no slide under way. */
export const settle = (page: Page) => page.waitForFunction(() => !(window as any).__app.isMorphing && !(window as any).__app.isSliding);
export const isMorphing = (page: Page): Promise<boolean> => page.evaluate(() => (window as any).__app.isMorphing);
export const isSliding = (page: Page): Promise<boolean> => page.evaluate(() => (window as any).__app.isSliding);
export const state = (page: Page): Promise<ProjectionState> => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__app.state)));
export const isCurrent = (page: Page, selector: string) => page.locator(selector).getAttribute('aria-current').then((v) => v === 'true');

/** Clicks a named projection in its family, opening the family first as a person would. */
export async function pick(page: Page, id: string) {
  const family = stop(id).family;
  if ((await head(page, family).getAttribute('aria-expanded')) !== 'true') await head(page, family).click();
  await stopButton(page, id).click();
}

/** Moves a slider the way the browser does: set a value and fire `input`. */
export const move = (page: Page, name: string, value: number) =>
  slider(page, name).evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

/** Types into a slider's number box and confirms with Enter. */
export async function type(page: Page, name: string, text: string) {
  const box = numberBox(page, name);
  await box.fill(text);
  await box.press('Enter');
  // A typed value moves the map there by a slide. A morph under way ignores it, and is not waited for.
  await page.waitForFunction(() => !(window as any).__app.isSliding);
}
