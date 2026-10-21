import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { traceSlot } from './helpers';

async function canvasIsNonblank(page: Page): Promise<{ ok: boolean; variance: number; buckets: number }> {
  const png = PNG.sync.read(await page.locator('#game-canvas').screenshot());
  let min = 255, max = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));
  for (let px = 0; px < png.width * png.height; px += stride) {
    const o = px * 4, r = png.data[o], g = png.data[o + 1], b = png.data[o + 2];
    min = Math.min(min, r, g, b); max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  return { ok: max - min > 40 && buckets.size > 30, variance: max - min, buckets: buckets.size };
}

test('title renders, a traced glyph cast with the mouse damages the Aswang', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 20);
  expect(await canvasIsNonblank(page)).toMatchObject({ ok: true });
  await expect(page.locator('#start')).toBeVisible();

  await page.locator('#start').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(400);
  await traceSlot(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#feedback')).toContainText('power');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.battle!.enemyHp), { timeout: 4000 }).toBeLessThan(210);

  await testInfo.attach('after-first-cast', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
