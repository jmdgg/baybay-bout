import { expect, test } from '@playwright/test';

// The 2D practice page (all 17 letters, teach mode) linked from the title screen still works, incl. in production.
test('practice page loads its dictionary and reads a drawn letter', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('prototype/');
  await expect(page.locator('#dict tr')).toHaveCount(15); // vowel row + 14 consonants
  const box = (await page.locator('#c').boundingBox())!;
  // a closed loop, roughly BA, drawn with the mouse
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await page.mouse.down();
  for (let a = 0; a <= 360; a += 15) {
    const r = (a * Math.PI) / 180;
    await page.mouse.move(box.x + box.width * (0.5 + 0.3 * Math.sin(r)), box.y + box.height * (0.5 - 0.3 * Math.cos(r)));
  }
  await page.mouse.up();
  await page.locator('#cast').click();
  await expect(page.locator('#out')).toContainText(/accuracy|Unclear/);
  expect(errors).toEqual([]);
});
