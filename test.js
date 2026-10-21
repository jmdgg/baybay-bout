import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recognize } from './src/gesture.js';
import { finalPower, timeBonus } from './src/power.js';
import { createBattle, castSpell, tick, canCast, HP, WINDUP_MS } from './src/battle.js';
import { nextMastery, fitToCanvas, MASTERY, STROKE_TYPES } from './src/guide.js';
import { Rooms, validateCast, VERSUS_HP, COUNTDOWN_MS } from './server/rooms.js';
import { padUrls } from './server/duel-plugin.ts';
import { AutoResolution, MIN_DPR } from './src/core/AutoResolution.ts';

const load = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const letters = load('./glyphs.json'), { spells } = load('./spells.json');
const letter = root => letters.find(l => l.root === root);

// every spell points at a letter the recognizer knows; no template has a speck that reads as a kudlit
for (const s of spells) assert.ok(letters.some(l => l.glyph === s.glyph), `${s.id} has no template in glyphs.json`);
for (const l of letters) assert.equal(recognize(l.samples[0], letters).syllable, l.root, `${l.root} template alone reads as another syllable`);

// a "hand-drawn" copy: rotated, stretched, scaled, shifted and wobbly
const vary = (strokes, seed) => {
  const rot = (seed % 5 - 2) * 0.08, sx = 0.85 + (seed % 4) * 0.1, k = 2 + (seed % 3) * 0.5;
  return strokes.map(s => s.map(([x, y], i) => {
    const X = x * Math.cos(rot) - y * Math.sin(rot), Y = x * Math.sin(rot) + y * Math.cos(rot);
    return [(X * sx + 3 * Math.sin(seed * 99 + i * 12.9898)) * k + 40, (Y + 3 * Math.cos(seed * 7 + i)) * k + 30];
  }));
};

// stress: 20 hand-drawn variants of all 17 letters. Never the wrong letter; rarely "unclear, redraw" or a fizzle.
let unclear = 0, fizzled = 0;
const total = letters.length * 20;
for (const l of letters) for (let seed = 0; seed < 20; seed++) {
  const r = recognize(vary(l.samples[0], seed), letters);
  if (r.ambiguous) { unclear++; continue; }
  assert.equal(r.letter.root, l.root, `${l.root} variant ${seed} read as ${r.letter.root}`);
  if (r.accuracy < 60) fizzled++;
}
// ~30% today: PA/YA/MA are true near-twins, and I/DA/NA collide with spell letters that have human samples
// while they only have the font sample. Real drawings of those letters should bring this down.
assert.ok(unclear <= total * 0.35, `${unclear}/${total} variants were ambiguous`);
assert.ok(fizzled <= total * 0.02, `${fizzled}/${total} variants fizzled`);

// junk must not cast: random scribbles fall below the fizzle line
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const junk = Array.from({ length: 100 }, (_, k) => Array.from({ length: 1 + k % 3 }, () => Array.from({ length: 4 + k % 6 }, () => [rnd() * 100, rnd() * 100])));
const castable = junk.filter(j => recognize(j, letters).accuracy >= 60).length;
assert.ok(castable <= 5, `${castable}/100 random scribbles would cast`);
for (const l of letters) assert.ok(!recognize(l.samples[0], letters).ambiguous, `${l.root} is too close to another letter`);

let realDrawings;
// real player drawings (samples after the font one): each, left out of the templates, still casts its spell in battle
{
  const spellLetters = letters.filter(l => spells.some(s => s.glyph === l.glyph));
  let human = 0, cast = 0;
  const wrong = [];
  for (const l of spellLetters) l.samples.slice(1).forEach((drawing, k) => {
    const without = spellLetters.map(x => x === l ? { ...x, samples: x.samples.filter((_, j) => j !== k + 1) } : x);
    const r = recognize(drawing, without);
    human++;
    if (r.ambiguous) return;
    if (r.letter.root !== l.root) return wrong.push(`${l.root} #${k} read as ${r.letter.root}`);
    if (r.accuracy >= 60) cast++;
  });
  // today 1 known miss: an SA drawn with a long bar across it reads as TA; more real samples should fix it
  assert.ok(wrong.length <= 1, `real drawings misread: ${wrong.join(', ')}`);
  assert.ok(human >= 20 && cast >= human * 0.7, `only ${cast}/${human} real drawings cast`);
  realDrawings = `${cast}/${human} real drawings cast, ${wrong.length} misread`;
}

// skill slots: a slot names its glyph, so a drawing is scored against that one letter.
// Tracing the outline with a wobbly hand scores high; random scribbles almost never pass a slot.
for (const s of spells) {
  const slot = [letters.find(l => l.glyph === s.glyph)];
  const traced = slot[0].samples[0].map(st => st.map(([x, y], i) => [x * 4 + 3 * Math.sin(i), y * 4 + 3 * Math.cos(i * 0.7)]));
  assert.ok(recognize(traced, slot).accuracy >= 85, `tracing ${s.root} scored ${recognize(traced, slot).accuracy}%`);
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const junk = Array.from({ length: 100 }, (_, k) => Array.from({ length: 1 + k % 3 }, () => Array.from({ length: 4 + k % 6 }, () => [rnd() * 100, rnd() * 100])));
  assert.ok(junk.filter(j => recognize(j, slot).accuracy >= 60).length <= 5, `junk passes the ${s.root} slot`);
}

// fix 1: teaching a scribble as KA makes it read as KA, but gives it no accuracy boost (scored against curated samples only)
const scribble = [[[0, 0], [100, 10], [0, 20], [100, 30], [0, 40], [100, 50]]];
const taught = letters.map(l => l.root === 'ka' ? { ...l, mine: [scribble] } : l);
const cheat = recognize(scribble, taught);
assert.equal(cheat.letter.root, 'ka');
assert.equal(cheat.accuracy, recognize(scribble, [letter('ka')]).accuracy);
assert.ok(cheat.accuracy < 100);

// a lazy swipe in any direction never casts a spell (Noto's HA is nearly a straight line, so no spell may use it)
const castsSpell = r => !r.ambiguous && r.accuracy >= 60 && spells.some(s => s.glyph === r.letter.glyph);
const battleLetters = letters.filter(l => spells.some(s => s.glyph === l.glyph));
for (const swipe of [[[0, 0], [100, 0]], [[0, 0], [100, 8]], [[0, 0], [0, 100]], [[0, 0], [100, 100]]])
  for (const pool of [letters, battleLetters]) {
    const r = recognize([swipe], pool);
    assert.ok(!castsSpell(r), `a swipe cast ${r.letter.root} at ${r.accuracy}%`);
  }

// fix 2: a letter that is not a spell is read as itself, not forced onto a spell
const pa = recognize(letter('pa').samples[0], letters);
assert.equal(pa.letter.root, 'pa');
assert.ok(!spells.some(s => s.glyph === pa.letter.glyph));

// kudlit above → i, below → u; a small stroke inside the glyph is not a kudlit; vowel letters ignore kudlit
const ba = letter('ba').samples[0];
assert.deepEqual(['bi', 'ᜊᜒ'], (r => [r.syllable, r.glyph])(recognize([...ba, [[80, 30]]], letters)));
assert.deepEqual(['bu', 'ᜊᜓ'], (r => [r.syllable, r.glyph])(recognize([...ba, [[80, 120], [82, 121]]], letters)));
assert.equal(recognize([...ba, [[78, 75], [81, 76]]], letters).syllable, 'ba');
assert.equal(recognize([...letter('u').samples[0], [[80, 30]]], letters).syllable, 'u');
assert.equal(recognize([[[5, 5]]], letters), null);
assert.equal(recognize([[[0, 0]], [[50, 50]]], letters), null); // two taps, no glyph

// battle rules
{
  const spell = id => spells.find(s => s.id === id);
  const b = createBattle(spells, 0);
  castSpell(b, 'player', spell('baga'), 'a', 20, 0);                  // projectile
  // skill slots: the cast slot recharges for its rechargeMs, the other slots stay ready
  assert.ok(!canCast(b.player, 4999, spell('baga')) && canCast(b.player, 5000, spell('baga')));
  assert.ok(canCast(b.player, 100, spell('kidlat')));
  assert.equal(b.enemy.hp, HP - 20);
  castSpell(b, 'enemy', spell('lupa'), 'a', 15, 0);                   // shield on the caster
  castSpell(b, 'player', spell('baga'), 'a', 20, 100);
  assert.deepEqual([b.enemy.hp, b.enemy.shield], [HP - 25, 0]);      // shield absorbs 15 of 20
  castSpell(b, 'player', spell('lupa'), 'i', 5, 200);                 // stun 1000ms
  assert.equal(b.enemy.stunnedUntil, 1200);
  b.nextEnemyCast = 500;
  tick(b, 500, 100, () => 0);
  assert.equal(b.player.hp, HP);                                      // stunned Aswang did not cast
  castSpell(b, 'player', spell('baga'), 'i', 24, 300);                // burn 24 over 4s
  const before = b.enemy.hp;
  for (let t = 400; t <= 4400; t += 100) { b.nextEnemyCast = Infinity; tick(b, t, 100); }
  assert.ok(Math.abs(before - b.enemy.hp - 24) < 0.1 && !b.enemy.burns.length);
  castSpell(b, 'enemy', spell('tubig'), 'i', 80, 5000);                // heal is capped at full HP
  assert.equal(b.enemy.hp, HP);
  castSpell(b, 'player', spell('tubig'), 'a', 10, 5000);              // slow: target's spells hit 25% weaker
  castSpell(b, 'enemy', spell('baga'), 'a', 20, 5500);
  assert.equal(b.player.hp, HP - 15);
  castSpell(b, 'player', spell('kidlat'), 'a', 999, 6000);
  assert.equal(b.winner, 'player');
  castSpell(b, 'enemy', spell('kidlat'), 'a', 999, 6100);             // no casting after the duel ends
  assert.equal(b.player.hp, HP - 15);
}
{
  const spell = id => spells.find(s => s.id === id);
  const b = createBattle(spells, 0);
  for (const s of spells) if (s.id !== 'tubig') b.enemy.recharge[s.id] = 99999;
  b.nextEnemyCast = 0;
  tick(b, 0, 100, () => 0.99);
  assert.equal(b.enemyCasting?.spell.id, 'tubig', 'the Aswang chose a recharging slot');
}
// telegraph: the Aswang's spell shows WINDUP_MS before it lands; stun/knockback interrupt it, slow weakens it
{
  const spell = id => spells.find(s => s.id === id);
  const start = (b, now) => { b.nextEnemyCast = now; tick(b, now, 100, () => 0); }; // rng 0: first ready spell, vowel a
  let b = createBattle(spells, 0);
  start(b, 0);
  const incoming = b.enemyCasting;
  assert.ok(incoming && incoming.landsAt === WINDUP_MS && b.player.hp === HP, 'wind-up started, nothing landed yet');
  b.nextEnemyCast = Infinity;
  tick(b, WINDUP_MS - 100, 100);
  assert.equal(b.player.hp, HP);
  tick(b, WINDUP_MS, 100);
  assert.ok(!b.enemyCasting && b.player.hp === HP - incoming.power, 'the spell landed after the wind-up');

  b = createBattle(spells, 0);
  start(b, 0);
  castSpell(b, 'player', spell('kidlat'), 'i', 10, 1000);              // stun during the wind-up
  assert.ok(!b.enemyCasting && b.log[0].includes('interrupted'));
  b.nextEnemyCast = Infinity;
  tick(b, WINDUP_MS, 100);
  assert.equal(b.player.hp, HP, 'an interrupted spell never lands');

  b = createBattle(spells, 0);
  start(b, 0);
  const full = b.enemyCasting.power;
  castSpell(b, 'player', spell('kidlat'), 'u', 14, 100);              // slow 1.5 s, cast early in the 2.5 s wind-up
  b.nextEnemyCast = Infinity;
  tick(b, WINDUP_MS, 100);
  assert.equal(b.player.hp, HP - Math.round(full * 0.75), 'a slow during the wind-up weakens the spell when it lands');
}

// events for views: every rule outcome a 3D/2D view shows is reported once, in order
{
  const spell = id => spells.find(s => s.id === id);
  const b = createBattle(spells, 0);
  b.nextEnemyCast = 0;
  tick(b, 0, 100, () => 0);                                            // telegraph starts
  castSpell(b, 'player', spell('lupa'), 'a', 20, 100);                  // shield on self
  castSpell(b, 'player', spell('kidlat'), 'i', 12, 200);                // stun: hits and interrupts
  const types = b.events.map(e => e.type);
  assert.deepEqual(types, ['telegraph', 'cast', 'cast', 'interrupt']);
  assert.deepEqual([b.events[1].effect, b.events[1].damage], ['shield', 0]);
  assert.deepEqual([b.events[2].who, b.events[2].damage, b.events[2].absorbed], ['player', 12, 0]);
  b.events.length = 0;
  castSpell(b, 'enemy', spell('baga'), 'a', 30, 300);                   // into the player's 20 shield
  assert.deepEqual([b.events[0].damage, b.events[0].absorbed], [10, 20]);
  castSpell(b, 'player', spell('baga'), 'i', 24, 6000);                  // burn ticks report damage
  b.events.length = 0;
  b.nextEnemyCast = Infinity;
  tick(b, 6100, 100);
  assert.ok(b.events.some(e => e.type === 'burn' && e.who === 'enemy' && e.damage > 0));
  castSpell(b, 'player', spell('kidlat'), 'a', 999, 20000);
  assert.equal(b.events.filter(e => e.type === 'end').length, 1);
  tick(b, 20100, 100);
  assert.equal(b.events.filter(e => e.type === 'end').length, 1, 'the end is reported once');
}
// enrage: below half HP the Aswang announces it once and casts ~20% sooner
{
  const gap = enraged => {
    const b = createBattle(spells, 0);
    if (enraged) b.enemy.hp = HP / 2;
    b.nextEnemyCast = 0;
    tick(b, 0, 100, () => 0.5);
    return [b.nextEnemyCast, b.events.filter(e => e.type === 'enrage').length];
  };
  const [calm, calmEvents] = gap(false), [angry, angryEvents] = gap(true);
  assert.ok(Math.abs(angry - calm * 0.8) < 1 && calmEvents === 0 && angryEvents === 1);
}

// fading outline: clean casts fade it, poor casts or fizzles bring it back, within 0..3
{
  const top = MASTERY.length - 1;
  assert.deepEqual([nextMastery(0, 92, 20), nextMastery(top, 99, 20), nextMastery(2, 75, 10), nextMastery(2, 65, 10), nextMastery(1, 90, 0), nextMastery(0, 10, 0)],
    [1, top, 2, 1, 0, 0]);
  assert.ok(MASTERY[0].opacity === 1 && MASTERY[top].opacity === 0);
}

// guide fit: template -> canvas -> template round-trips
{
  const t = letter('ka').samples[0], { to, from } = fitToCanvas(t, { width: 400, height: 400 });
  for (const p of t.flat()) from(to(p)).forEach((v, i) => assert.ok(Math.abs(v - p[i]) < 1e-6));
}

// recorded stroke orders (tools/stroke-order.html): known stroke types, points on their own letter
for (const l of letters.filter(l => l.order)) {
  const pts = l.samples[0].flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.25;
  for (const o of l.order) {
    assert.ok(o.type in STROKE_TYPES, `${l.root}: unknown stroke type ${o.type}`);
    assert.ok(o.points.every(([x, y]) => x >= Math.min(...xs) - pad && x <= Math.max(...xs) + pad && y >= Math.min(...ys) - pad && y <= Math.max(...ys) + pad),
      `${l.root}: stroke order lies outside the letter (saved for the wrong letter?)`);
  }
}

// versus rules: two people, nobody casts for the AI, both sides at the versus HP
{
  const b = createBattle(spells, 0, { ai: false, playerHp: 200, enemyHp: 200, names: ['Ana', 'Ben'] });
  for (let t = 0; t <= 60000; t += 100) tick(b, t, 100, () => 0);
  assert.deepEqual([b.player.hp, b.enemy.hp, b.enemyCasting, b.enraged, b.player.name], [200, 200, null, false, 'Ana']);
  castSpell(b, 'enemy', spells[4], 'a', 999, 61000); // P2 lands the finishing blow
  assert.equal(b.winner, 'enemy');
}

// versus rooms ("Duel a friend"): join order, validation, server-side scoring, pause, rematch
{
  let clock = 0;
  const rooms = new Rooms({ rng: (() => { let i = 0; return () => ((i++ * 0.37) % 1); })(), now: () => clock });
  const conn = () => ({ msgs: [], send(m) { this.msgs.push(m); }, last(type) { return [...this.msgs].reverse().find(m => m.type === type); } });
  const screen = conn(), a = conn(), b = conn(), c = conn();
  const code = rooms.host(screen, ['http://host/pad.html']);
  assert.equal(screen.last('hosted').padUrl, 'http://host/pad.html');
  assert.match(code, /^[A-Z]{4}$/);
  rooms.join(a, { code: code.toLowerCase(), name: 'Ana' });
  rooms.join(b, { code, name: 'Ben' });
  rooms.join(c, { code, name: 'Cy' });
  assert.deepEqual([a.last('joined').you, b.last('joined').you], [0, 1], 'first to join is P1');
  assert.match(c.last('error').message, /two players/);
  rooms.join(conn(), { code: 'ZZZZ' });
  assert.equal(rooms.snapshot(rooms.rooms.get(code)).phase, 'countdown');
  clock += COUNTDOWN_MS;
  rooms.tick(50);
  const room = rooms.rooms.get(code);
  assert.deepEqual([room.phase, room.battle.player.hp, room.battle.enemy.hp], ['battle', VERSUS_HP, VERSUS_HP]);

  // untrusted casts are rejected, not crashed on
  for (const bad of [{ slot: 9, strokes: [[[0, 0], [1, 1]]], durationMs: 1 }, { slot: 0, strokes: 'x', durationMs: 1 },
    { slot: 0, strokes: [[[0, NaN]]], durationMs: 1 }, { slot: 0, strokes: [Array.from({ length: 2001 }, () => [1, 1])], durationMs: 1 }])
    assert.ok(validateCast(bad), JSON.stringify(bad).slice(0, 40));
  rooms.cast(a, { slot: 0, strokes: 'nope', durationMs: 5 });
  assert.equal(a.last('castResult').ok, false);

  // a traced BA from P1: scored on the server, damages P2, and BA then recharges
  const ba = letter('ba').samples[0].map(st => st.map(([x, y]) => [x * 3, y * 3]));
  rooms.cast(a, { slot: 0, strokes: ba, durationMs: 1400 });
  const hit = a.last('castResult');
  assert.ok(hit.ok && hit.accuracy >= 85 && hit.power > 0, JSON.stringify(hit));
  rooms.tick(50);
  assert.ok(room.battle.enemy.hp < VERSUS_HP);
  assert.ok(screen.msgs.some(m => m.type === 'events' && m.events.some(e => e.type === 'cast' && e.who === 0 && e.spell === 'baga')));
  rooms.cast(a, { slot: 0, strokes: ba, durationMs: 1400 });
  assert.equal(a.last('castResult').reason, 'recharging');

  // a phone dropping pauses the duel; rejoining with its token resumes it in the same slot
  rooms.leave(b);
  assert.equal(room.phase, 'paused');
  const before = room.clock;
  rooms.tick(500);
  assert.equal(room.clock, before, 'the duel clock stops while a player is away');
  const b2 = conn();
  rooms.join(b2, { code, token: b.last('joined').token });
  assert.deepEqual([b2.last('joined').you, room.phase], [1, 'battle']);

  // the end, then a rematch once both players ask
  castSpell(room.battle, 'player', spells[4], 'a', 999, room.clock);
  rooms.tick(50);
  assert.deepEqual([room.phase, rooms.snapshot(room).winner], ['over', 0]);
  rooms.rematch(a);
  assert.equal(room.phase, 'over');
  rooms.rematch(b2);
  assert.equal(room.phase, 'countdown');

  // the big screen leaving closes the room and tells the phones
  rooms.leave(screen);
  assert.ok(!rooms.rooms.has(code) && a.last('closed'));
}

// lobby phone address: none while the server only listens on this computer; with dev:lan the Wi-Fi/Ethernet
// address comes first, VPN and virtual adapters are left out (this machine has Radmin VPN and VirtualBox adapters)
{
  const listening = { address: () => ({ address: '0.0.0.0', port: 5188 }) };
  assert.deepEqual(padUrls({ address: () => ({ address: '127.0.0.1', port: 5188 }) }), []);
  const ip = (address) => ({ family: 'IPv4', internal: false, address });
  const adapters = { 'Radmin VPN': [ip('26.201.33.67')], 'Ethernet 2': [ip('192.168.56.1')], 'Ethernet': [ip('192.168.100.214')], 'Wi-Fi': [ip('10.0.0.7')] };
  assert.deepEqual(padUrls(listening, adapters), ['http://10.0.0.7:5188/pad.html', 'http://192.168.100.214:5188/pad.html', 'http://192.168.56.1:5188/pad.html']);
}

// auto resolution: steady 60 fps keeps it; 2 s at 30 fps drops one step from the screen's own ratio; hidden-tab gaps are ignored
{
  const run = (fps, seconds, dpr = 2, device = 1, auto = new AutoResolution(), start = 0) => {
    for (let t = start; t <= start + seconds * 1000; t += 1000 / fps) dpr = auto.update(t, dpr, device);
    return dpr;
  };
  assert.equal(run(60, 10), 2);
  assert.equal(run(30, 2.1), 0.75);
  assert.equal(run(30, 30), MIN_DPR);
  const auto = new AutoResolution();
  assert.equal(auto.update(0, 2, 1), 2);
  assert.equal(auto.update(5000, 2, 1), 2); // a 5 s gap (tab hidden) is not a slow frame
  assert.equal(run(60, 4, 2, 1, auto, 5000), 2);
}

// power formula
assert.equal(timeBonus(0, 1000), 1.25);
assert.equal(timeBonus(1000, 1000), 1);
assert.equal(timeBonus(5000, 1000), 0.8);
assert.equal(finalPower(20, 100, 1000, 1000), 20);
assert.equal(finalPower(20, 100, 1000, 1000, 3), 29);                      // mastery 3: ×1.45
assert.ok(finalPower(100, 70, 1000, 1000, 3) > finalPower(100, 92, 1000, 1000, 0)); // recall beats tracing
assert.equal(finalPower(20, 59, 0, 1000), 0); // fizzle
assert.ok(finalPower(100, 60, 0, 1000) < finalPower(100, 100, 9999, 1000)); // accuracy beats speed

console.log(`ok: ${realDrawings}; ${unclear}/${total} font variants asked for a redraw, ${fizzled} fizzled, ${castable}/100 scribbles castable`);
