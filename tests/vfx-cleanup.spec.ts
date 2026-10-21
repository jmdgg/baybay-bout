import { expect, test } from '@playwright/test';
import { traceSlot } from './helpers';

// Regression: effects spawned by effects (an orb's impact burst and ring) used to be dropped from the update list
// and stayed in the scene forever as a bright halo around the Aswang.
test('spell effects finish and leave nothing behind', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?debug');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  const describe = () => page.evaluate(() => {
    const S = (window as unknown as { __BAYBAY_SCENE__: import('three').Scene }).__BAYBAY_SCENE__;
    const out: string[] = [];
    S.traverse(o => {
      const m = (o as unknown as { material?: { opacity?: number; blending?: number; visible?: boolean } }).material;
      if (!o.visible || !m || m.blending !== 2) return; // additive things only
      const e = o.matrixWorld.elements, p = { z: e[14], toArray: () => [e[12], e[13], e[14]] };
      if (Math.abs(p.z + 4.5) < 3 && (m.opacity ?? 1) > 0.02) out.push(`${o.type}${o.name ? ':' + o.name : ''} op=${(m.opacity ?? 1).toFixed(2)} @${p.toArray().map(v => v.toFixed(1)).join(',')} parent=${o.parent?.type}`);
    });
    return out;
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('active-play'));
  expect(await describe()).toEqual([]);
  await page.keyboard.press('1');
  await traceSlot(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  expect(await describe(), 'impact effects must fade out').toEqual([]);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('active-play'));
  await page.waitForTimeout(300);
  expect(await describe()).toEqual([]);
});
