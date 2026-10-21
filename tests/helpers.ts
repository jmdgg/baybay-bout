import type { Page } from '@playwright/test';

/** Traces the selected slot's outline on the sigil pad with the real mouse. */
/** wobble (px): how far a hand drifts from the shape, e.g. when drawing from memory without the outline. */
export async function traceSlot(page: Page, kudlit: 'i' | 'u' | null = null, steps = 1, wobble = 0): Promise<void> {
  const path = await page.evaluate(() => window.__BAYBAY_TEST__!.tracePath());
  for (const stroke of path) {
    await page.mouse.move(stroke[0][0], stroke[0][1]);
    await page.mouse.down();
    let i = 0;
    for (const [x, y] of stroke.slice(1)) {
      i += 1; // a smooth, deterministic drift (a hand, not noise)
      await page.mouse.move(x + 1.5 + wobble * Math.sin(i * 0.45), y - 1.5 + wobble * Math.cos(i * 0.31 + 1), { steps });
    }
    await page.mouse.up();
  }
  if (kudlit) {
    const [x, y] = await page.evaluate(v => window.__BAYBAY_TEST__!.kudlitPoint(v), kudlit);
    await page.mouse.click(x, y);
  }
}
