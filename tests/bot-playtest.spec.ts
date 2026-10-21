import { expect, test, type Page } from '@playwright/test';
import { traceSlot } from './helpers';

// The bot plays the duel through real mouse and keyboard input: it picks a ready slot, traces the outline,
// taps a kudlit, presses Enter, and answers the Aswang's telegraphs (stun to interrupt, else shield).

type Diag = { clock: number; playerHp: number; enemyHp: number; enemyCasting: string | null; winner: string | null };
// about the pace of a practised player: ~0.9 s to decide, ~1.5 s to trace a glyph
const HUMAN_THINK_MS = 900, HUMAN_STEPS = 2;
const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.battle as Diag | null);
const readySlots = (page: Page) => page.$$eval('.slot', els => els.map(e => !e.classList.contains('recharging')));

async function startDuel(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.seed(12345));
  await page.locator('#start').click();
  await expect(page.locator('#hud')).toBeVisible();
}

test('bot wins a duel with traced casts, interrupts and shields; idle loses; retry restarts', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await startDuel(page);

  // slot index (0-based) → kudlit that makes it a damage spell; KA-i stuns (interrupt), LA-a shields
  const damage: [number, 'i' | 'u' | null][] = [[0, 'i'], [2, 'i'], [4, null], [3, 'u'], [1, null]];
  const stats = { casts: 0, interrupts: 0, shields: 0, heals: 0, fizzles: 0, accuracy: [] as number[] };
  const started = Date.now();
  let frames0 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.frame), t0 = Date.now();
  const fps: number[] = [];

  while (Date.now() - started < 150_000) {
    const d = await diag(page);
    if (!d || d.winner) break;
    const ready = await readySlots(page);
    let choice: [number, 'i' | 'u' | null] | undefined;
    if (d.enemyCasting && ready[4]) { choice = [4, 'i']; stats.interrupts += 1; }
    else if (d.enemyCasting && ready[3]) { choice = [3, null]; stats.shields += 1; }
    else if (d.playerHp < 55 && ready[1]) { choice = [1, 'i']; stats.heals += 1; }
    else choice = damage.find(([i]) => ready[i]);
    if (!choice) { await page.waitForTimeout(250); continue; }
    await page.keyboard.press(String(choice[0] + 1));
    await page.waitForTimeout(HUMAN_THINK_MS); // look at the slot, find the start of the outline
    // the less outline a slot shows (mastery), the more a human hand drifts from the true shape
    const level = await page.evaluate(i => { const g = document.querySelectorAll('.slot .g')[i].textContent!; return window.__THREE_GAME_DIAGNOSTICS__!.mastery[g] ?? 0; }, choice[0]);
    await traceSlot(page, choice[1], HUMAN_STEPS, [0, 2, 6, 14][level]);
    await page.keyboard.press('Enter');
    const text = await page.locator('#feedback').innerText();
    const acc = /accuracy (\d+)%/.exec(text);
    if (acc) { stats.casts += 1; stats.accuracy.push(Number(acc[1])); }
    if (text.includes('fizzled')) stats.fizzles += 1;
    const frames = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.frame);
    fps.push(((frames - frames0) * 1000) / Math.max(1, Date.now() - t0));
    frames0 = frames; t0 = Date.now();
  }
  const end = await diag(page);
  // the result shows RESULT_DELAY of game time after the end; game time slows if frames drop, so wait on the game
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.screen), { timeout: 15_000 }).toBe('result');
  await expect(page.locator('#result')).toBeVisible();
  const win = { winner: end?.winner, duelSeconds: Math.round((end?.clock ?? 0) / 1000), hpLeft: Math.round(end?.playerHp ?? 0), ...stats,
    avgAccuracy: Math.round(stats.accuracy.reduce((a, b) => a + b, 0) / Math.max(1, stats.accuracy.length)), avgFps: Math.round(fps.reduce((a, b) => a + b, 0) / Math.max(1, fps.length)) };
  await testInfo.attach('win-screen', { body: await page.screenshot(), contentType: 'image/png' });

  // idle: the Aswang must be able to win, and Retry must give a fresh duel
  await page.locator('#retry').click();
  const fresh = await diag(page);
  expect(fresh?.playerHp).toBe(100);
  expect(fresh?.enemyHp).toBe(210);
  await expect.poll(async () => (await diag(page))?.winner, { timeout: 120_000, intervals: [1000] }).toBe('enemy');
  const lose = await diag(page);
  await expect(page.locator('#result-title')).toContainText('prevails', { timeout: 5000 });

  const castSeconds = Number((win.duelSeconds / Math.max(1, win.casts)).toFixed(1));
  const report = { win: { ...win, secondsPerCast: castSeconds }, lose: { duelSeconds: Math.round((lose?.clock ?? 0) / 1000) }, errors };
  console.log(`bot playtest: ${JSON.stringify(report)}`);
  await testInfo.attach('bot-playtest-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(win.winner, 'the bot should win by casting').toBe('player');
  expect(win.duelSeconds, 'a duel should last long enough for telegraphs to matter').toBeGreaterThan(25);
  expect(win.fizzles, 'tracing the outline should not fizzle').toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('dictionary and pause freeze the duel; mute toggles', async ({ page }) => {
  await startDuel(page);
  await page.waitForTimeout(600);
  await page.keyboard.press('d');
  await expect(page.locator('#dictionary')).toBeVisible();
  await expect(page.locator('#dict-entries .entry')).toHaveCount(5);
  const a = (await diag(page))!.clock;
  await page.waitForTimeout(800);
  expect((await diag(page))!.clock, 'the duel clock must not run while the dictionary is open').toBe(a);
  await page.keyboard.press('d');
  await expect(page.locator('#dictionary')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  const b = (await diag(page))!.clock;
  await page.waitForTimeout(800);
  expect((await diag(page))!.clock).toBe(b);
  await page.locator('#resume').click();
  await expect(page.locator('#pause')).toBeHidden();
  // audio: locked until a gesture, running after the Start click, and mute is reflected
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.audio.state)).toBe('running');
  await page.keyboard.press('m');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.audio.muted)).toBe(true);
});
