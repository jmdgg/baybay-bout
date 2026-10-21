// "Duel a friend": room and match logic, authoritative on the host computer.
// No sockets here: connections are plain { send(msg) } objects, so this runs (and is tested) in plain node.
// Phones send only what they drew; the server recognizes, scores and applies it with the same rules as the NPC duel.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { castSpell, createBattle, rechargeLeft, tick } from '../src/battle.js';
import { recognize } from '../src/gesture.js';
import { nextMastery } from '../src/guide.js';
import { finalPower } from '../src/power.js';

const load = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
export const spells = load('../spells.json').spells;
const letters = load('../glyphs.json');
const letterOf = spell => letters.find(l => l.glyph === spell.glyph);

export const VERSUS_HP = 200;         // instant casts on both sides: 100 HP would be over in ~15 s
export const COUNTDOWN_MS = 3000;
const CODE_CHARS = 'ABDEGHKLMNPRSTUWY'; // no I/O/0/1 look-alikes to misread on a phone
const SIDES = ['player', 'enemy'];     // P1 is the battle's "player", P2 its "enemy"
const MAX = { strokes: 20, points: 2000, durationMs: 60000, name: 16 };
const KUDLIT = { a: '', i: 'ᜒ', u: 'ᜓ' };

/** Untrusted input from a phone: returns an error string, or null when the cast message is well-formed. */
export function validateCast(msg) {
  if (!Number.isInteger(msg.slot) || msg.slot < 0 || msg.slot >= spells.length) return 'bad slot';
  if (!Number.isFinite(msg.durationMs) || msg.durationMs < 0 || msg.durationMs > MAX.durationMs) return 'bad duration';
  const s = msg.strokes;
  if (!Array.isArray(s) || s.length < 1 || s.length > MAX.strokes) return 'bad strokes';
  let points = 0;
  for (const stroke of s) {
    if (!Array.isArray(stroke) || stroke.length < 1) return 'bad stroke';
    for (const p of stroke) {
      if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 'bad point';
      if (++points > MAX.points) return 'too many points';
    }
  }
  return null;
}

export class Rooms {
  /** rng/now are injectable so tests are deterministic. */
  constructor({ rng = Math.random, now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.rng = rng;
    this.now = now;
  }

  // --- connections ------------------------------------------------------------------------------------------
  /** padUrls: phone addresses on the LAN, best first ([] when phones can't reach this computer). */
  host(conn, padUrls = []) {
    let code;
    do code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(this.rng() * CODE_CHARS.length)]).join('');
    while (this.rooms.has(code));
    const padUrl = padUrls[0] ?? '';
    const room = { code, padUrl, padUrls, screen: conn, players: [], phase: 'lobby', startAt: 0, clock: 0, battle: null, rematch: new Set() };
    this.rooms.set(code, room);
    Object.assign(conn, { room: code, role: 'screen' });
    conn.send({ type: 'hosted', code, padUrl, alternates: padUrls.slice(1) });
    this.broadcast(room);
    return code;
  }

  join(conn, msg) {
    const code = String(msg.code ?? '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return conn.send({ type: 'error', message: 'No duel with that code. Check the code on the big screen.' });
    let index = room.players.findIndex(p => msg.token && p.token === msg.token);
    if (index >= 0) {
      room.players[index].conn = conn; // rejoin the same slot (phone refreshed or lost Wi-Fi)
      room.players[index].connected = true;
    } else {
      if (room.players.length >= 2) return conn.send({ type: 'error', message: 'This duel already has two players.' });
      const name = String(msg.name ?? '').trim().slice(0, MAX.name) || `Player ${room.players.length + 1}`;
      room.players.push({ name, token: randomUUID(), conn, connected: true, mastery: {} });
      index = room.players.length - 1;
    }
    Object.assign(conn, { room: code, role: 'player', index });
    const p = room.players[index];
    conn.send({ type: 'joined', code, you: index, name: p.name, token: p.token });
    if (room.phase === 'paused' && room.players.every(x => x.connected)) room.phase = 'battle';
    this.maybeCountdown(room);
    this.broadcast(room);
  }

  leave(conn) {
    const room = this.rooms.get(conn.room);
    if (!room) return;
    if (conn.role === 'screen') { // the big screen is the duel: without it the room ends
      for (const p of room.players) p.conn?.send({ type: 'closed', message: 'The big screen left the duel.' });
      this.rooms.delete(room.code);
      return;
    }
    const p = room.players[conn.index];
    if (!p || p.conn !== conn) return;
    p.connected = false;
    if (room.phase === 'battle') room.phase = 'paused';
    if (room.phase === 'countdown') room.phase = 'lobby';
    this.broadcast(room);
  }

  // --- match ----------------------------------------------------------------------------------------------
  maybeCountdown(room) {
    if (room.phase === 'lobby' && room.players.length === 2 && room.players.every(p => p.connected)) {
      room.phase = 'countdown';
      room.startAt = this.now() + COUNTDOWN_MS;
    }
  }

  startBattle(room) {
    room.clock = 0;
    room.battle = createBattle(spells, 0, { ai: false, playerHp: VERSUS_HP, enemyHp: VERSUS_HP, names: room.players.map(p => p.name) });
    for (const p of room.players) p.mastery = {}; // fair: mastery is per match, kept here, not on the phones
    room.rematch.clear();
    room.phase = 'battle';
  }

  rematch(conn) {
    const room = this.rooms.get(conn.room);
    if (!room || room.phase !== 'over') return;
    room.rematch.add(conn.role === 'screen' ? 'screen' : conn.index);
    // the big screen can restart alone; otherwise both players must ask
    if (room.rematch.has('screen') || (room.rematch.has(0) && room.rematch.has(1))) {
      room.phase = 'lobby';
      room.battle = null;
      this.maybeCountdown(room);
    }
    this.broadcast(room);
  }

  cast(conn, msg) {
    const room = this.rooms.get(conn.room);
    if (!room || conn.role !== 'player') return;
    const reply = r => conn.send({ type: 'castResult', ...r });
    const problem = validateCast(msg);
    if (problem) return reply({ ok: false, reason: problem });
    if (room.phase !== 'battle' || room.battle.winner) return reply({ ok: false, reason: 'not now' });
    const b = room.battle, side = SIDES[conn.index], me = b[side], now = room.clock;
    const spell = spells[msg.slot], player = room.players[conn.index];
    if (now < me.stunnedUntil) return reply({ ok: false, reason: 'stunned', keep: true });
    const wait = rechargeLeft(me, spell, now);
    if (wait) return reply({ ok: false, reason: 'recharging', waitMs: wait, keep: true });

    const r = recognize(msg.strokes, [letterOf(spell)]);
    if (!r) return reply({ ok: false, reason: 'too small' });
    const level = player.mastery[spell.glyph] ?? 0;
    const variation = spell.variations[r.vowel];
    const power = finalPower(variation.baseDamage, r.accuracy, msg.durationMs, spell.parTimeMs, level);
    if (power) castSpell(b, side, spell, r.vowel, power, now);
    player.mastery[spell.glyph] = nextMastery(level, r.accuracy, power);
    const attempt = { who: conn.index, spell: spell.id, glyph: spell.glyph + KUDLIT[r.vowel], syllable: r.syllable,
      effect: variation.effect, accuracy: r.accuracy, power, fizzled: !power, level, nextLevel: player.mastery[spell.glyph] };
    this.send(room, { type: 'attempt', ...attempt });
    reply({ ok: true, ...attempt });
  }

  /** Advances every room by dtMs: countdowns, battle time, burns; broadcasts events and state. */
  tick(dtMs) {
    for (const room of this.rooms.values()) {
      if (room.phase === 'countdown' && this.now() >= room.startAt) this.startBattle(room);
      if (room.phase === 'battle') {
        room.clock += dtMs;
        tick(room.battle, room.clock, dtMs, this.rng);
      }
      this.flushEvents(room);
      if (room.phase === 'battle' && room.battle.winner) room.phase = 'over';
      this.broadcast(room);
    }
  }

  flushEvents(room) {
    if (!room.battle?.events.length) return;
    const events = room.battle.events.splice(0).map(e => ({
      type: e.type,
      who: e.who === undefined ? undefined : SIDES.indexOf(e.who),
      spell: e.spell?.id, vowel: e.vowel, effect: e.effect, power: e.power, damage: e.damage, absorbed: e.absorbed,
      winner: e.winner === undefined ? undefined : SIDES.indexOf(e.winner),
    }));
    this.send(room, { type: 'events', events });
  }

  // --- views ----------------------------------------------------------------------------------------------
  snapshot(room) {
    const b = room.battle, now = room.clock;
    const fighter = (side, i) => {
      if (!b) return null;
      const f = b[side], p = room.players[i];
      return {
        hp: f.hp, maxHp: f.maxHp, shield: now < f.shieldUntil ? f.shield : 0,
        burning: f.burns.length > 0, slowed: now < f.slowedUntil, stunned: now < f.stunnedUntil,
        recharge: spells.map(s => Math.round(rechargeLeft(f, s, now))),
        mastery: spells.map(s => p?.mastery[s.glyph] ?? 0),
      };
    };
    return {
      type: 'state', code: room.code, padUrl: room.padUrl, phase: room.phase,
      countdownMs: room.phase === 'countdown' ? Math.max(0, room.startAt - this.now()) : 0,
      players: room.players.map(p => ({ name: p.name, connected: p.connected })),
      fighters: SIDES.map(fighter),
      winner: b?.winner ? SIDES.indexOf(b.winner) : null,
      rematch: [...room.rematch],
    };
  }

  send(room, msg) {
    room.screen?.send(msg);
    for (const p of room.players) if (p.connected) p.conn.send(msg);
  }

  broadcast(room) { this.send(room, this.snapshot(room)); }
}
