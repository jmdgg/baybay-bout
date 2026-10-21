import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { traceSlot } from './helpers';

// Motion evidence: every element × kudlit variation cast through real mouse input, captured as a frame strip
// (cast → travel → impact → aftermath), plus a telegraph → interrupt sequence. Frames land in artifacts/<run>/motion.
const RUN = process.env.EVIDENCE_RUN ?? 'pass-1';
const OUT = `artifacts/${RUN}/motion`;
const VARIANTS: [string, number, 'i' | 'u' | null][] = [
  ['fire-projectile', 1, null], ['fire-burn', 1, 'i'], ['fire-knockback', 1, 'u'],
  ['water-slow', 2, null], ['water-heal', 2, 'i'], ['water-shield', 2, 'u'],
  ['wind-knockback', 3, null], ['wind-projectile', 3, 'i'], ['wind-slow', 3, 'u'],
  ['earth-shield', 4, null], ['earth-stun', 4, 'i'], ['earth-boulder', 4, 'u'],
  ['lightning-projectile', 5, null], ['lightning-stun', 5, 'i'], ['lightning-slow', 5, 'u'],
];
const FRAMES_MS = [120, 380, 650, 950, 1500];

test('motion strips for every spell variation and an interrupt', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  for (const [name, slot, kudlit] of VARIANTS) {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('active-play'));
    await page.keyboard.press(String(slot));
    await traceSlot(page, kudlit);
    await page.keyboard.press('Enter');
    let t = 0;
    for (const at of FRAMES_MS) {
      await page.waitForTimeout(at - t);
      t = at;
      await page.screenshot({ path: `${OUT}/${name}-${at}ms.png` });
    }
  }
  // the Aswang telegraphs, the player interrupts it with KA + kudlit above (stun)
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('telegraph'));
  await page.screenshot({ path: `${OUT}/interrupt-0-telegraph.png` });
  await page.keyboard.press('5');
  await traceSlot(page, 'i');
  await page.keyboard.press('Enter');
  for (const at of [200, 500, 900]) { await page.waitForTimeout(at === 200 ? 200 : 300); await page.screenshot({ path: `${OUT}/interrupt-${at}ms.png` }); }
});
