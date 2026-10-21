import { expect, test, type Browser, type Page } from '@playwright/test';
import { traceSlot } from './helpers';

const SHOTS = `artifacts/${process.env.EVIDENCE_RUN ?? 'versus-1'}`; // phone-size evidence captures

// "Duel a friend" end to end: one big screen plus two phone-sized sigil pads, all driven by real mouse input.

async function openPad(browser: Browser, code: string, name: string, errors: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto('pad.html');
  await page.locator('#code').fill(code);
  await page.locator('#name').fill(name);
  if (name === 'Ana') await page.screenshot({ path: `${SHOTS}/pad-join.png` });
  await page.locator('#join button[type=submit]').click();
  await expect(page.locator('#play')).toBeVisible();
  return page;
}

const screenDiag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

test('two phones join by room code, duel on the big screen, survive a disconnect, and rematch', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`screen: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`screen: ${m.text()}`); });

  await page.goto('/');
  await page.locator('#versus-btn').click();
  await expect(page.locator('#room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await page.locator('#room-code').textContent())!;

  const ana = await openPad(browser, code, 'Ana', errors);
  await expect(ana.locator('#me-name')).toContainText('P1');
  const ben = await openPad(browser, code, 'Ben', errors);
  await expect(ben.locator('#me-name')).toContainText('P2');
  await expect(page.locator('#lobby-players li').first()).toContainText('Ana');

  // countdown, then the duel on the big screen
  await expect.poll(async () => (await screenDiag(page)).screen, { timeout: 8000 }).toBe('battle');
  await expect(page.locator('#player-name')).toContainText('P1 · Ana');
  await expect(page.locator('#enemy-name')).toContainText('P2 · Ben');

  const pads: [Page, number][] = [[ana, 0], [ben, 0]];
  const order = [0, 2, 4, 3, 1]; // BA, SA, KA, LA, TA (plain -a: mostly damage)
  let casts = 0, disconnected = false, rejoinedPhase = '';
  const started = Date.now();
  const frames0 = (await screenDiag(page)).frame;

  while (Date.now() - started < 180_000) {
    const d = await screenDiag(page);
    if (d.versus?.phase === 'over') break;
    for (const entry of pads) {
      const [pad] = entry;
      if ((await screenDiag(page)).versus?.phase !== 'battle') break; // Cast is disabled once the duel ends
      const recharging = await pad.$$eval('.slot .cd', els => els.map(e => !e.hasAttribute('hidden')));
      const next = order.find(i => !recharging[i]);
      if (next === undefined) continue;
      await pad.locator('.slot').nth(next).click();
      await traceSlot(pad, null, 2);
      // the duel can end while this phone is mid-trace; Cast is then (correctly) disabled
      if (!(await pad.locator('#cast').click({ timeout: 2000 }).then(() => true, () => false))) break;
      casts += 1;
      entry[1] += 1;
    }
    // mid-duel: P2's phone drops (tab navigates away), the duel pauses; coming back rejoins the same slot
    if (casts === 4) await ana.screenshot({ path: `${SHOTS}/pad-duel.png` });
    if (!disconnected && casts >= 6) {
      disconnected = true;
      await ben.goto('about:blank');
      await expect.poll(async () => (await screenDiag(page)).versus?.phase, { timeout: 5000 }).toBe('paused');
      await expect(page.locator('#versus-banner')).toContainText('P2');
      await ben.goto(new URL('pad.html', testInfo.project.use.baseURL ?? 'http://127.0.0.1:5188/').href);
      await expect(ben.locator('#me-name')).toContainText('P2', { timeout: 8000 });
      await expect.poll(async () => (rejoinedPhase = (await screenDiag(page)).versus?.phase ?? ''), { timeout: 5000 }).toBe('battle');
    }
    await page.waitForTimeout(600);
  }

  const end = await screenDiag(page);
  await expect.poll(async () => (await screenDiag(page)).screen, { timeout: 15_000 }).toBe('result');
  await expect(page.locator('#result-title')).toContainText('wins');
  const hp = end.versus!.hp as number[];
  const winner = hp[0]! > 0 ? ana : ben, loser = winner === ana ? ben : ana;
  await expect(winner.locator('#banner')).toContainText('You win');
  await expect(loser.locator('#banner')).toContainText('defeated');
  await expect(ana.locator('#rematch')).toBeVisible();
  await testInfo.attach('versus-result', { body: await page.screenshot(), contentType: 'image/png' });
  await testInfo.attach('pad-winner', { body: await winner.screenshot({ path: `${SHOTS}/pad-result.png` }), contentType: 'image/png' });
  await page.screenshot({ path: `${SHOTS}/screen-result.png` });

  // rematch from the big screen: back through the countdown into a fresh duel
  await page.locator('#retry').click();
  await expect.poll(async () => { const x = await screenDiag(page); return x.screen === 'battle' && x.versus?.hp[0] === 200 && x.versus?.hp[1] === 200; }, { timeout: 10_000 }).toBe(true);

  const fps = Math.round(((await screenDiag(page)).frame - frames0) * 1000 / (Date.now() - started));
  const report = { duelSeconds: Math.round((Date.now() - started) / 1000), casts, perPlayer: pads.map(p => p[1]), finalHp: hp.map(h => Math.round(h ?? 0)), rejoinedPhase, screenFps: fps, errors };
  console.log(`versus playtest: ${JSON.stringify(report)}`);
  await testInfo.attach('versus-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(Math.min(...hp.map(h => h ?? 0)), 'someone must have been defeated').toBe(0);
  expect(errors).toEqual([]);
});
