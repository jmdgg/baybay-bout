// Mock 1v1 duel: the player against a scripted Aswang. Pure state and rules; the page renders it.
// Every change a view may want to show is also pushed to b.events ({ type, ... }); views drain it each frame:
//   telegraph { spell, vowel, landsAt } · cast { who, spell, vowel, effect, power, damage, absorbed }
//   interrupt { spell } · burn { who, damage } · enrage {} · end { winner }
import { finalPower } from './power.js';

export const HP = 100;
const KNOCKBACK_MS = 500;  // knockback interrupts the target's casting briefly
const SLOW_FACTOR = 0.75;  // a slowed fighter's spells hit 25% weaker
// a beginner needs ~4-6 s per glyph (draw, check, cast); faster than that and they lose before landing a spell.
// shortcut: Aswang casts on a random timer, replace with a real opponent later
const ENEMY_EVERY_MS = [4500, 6000];
// the Aswang telegraphs each spell: its glyph shows this long before it lands, so you can read it and react
// (shield, or stun / knockback to interrupt). Long enough to trace a 2-stroke glyph in response.
export const WINDUP_MS = 2500;
const INTERRUPT_RECOVERY_MS = 1000;
// below half HP the Aswang enrages and casts faster, so the fight escalates instead of staying flat
const ENRAGE_PACE = 0.8;

const fighter = (name, maxHp = HP) => ({ name, hp: maxHp, maxHp, shield: 0, shieldUntil: 0, stunnedUntil: 0, slowedUntil: 0, recharge: {}, burns: [] });

/**
 * options.enemyHp: a tougher Aswang for longer duels (the 3D game uses more than the 2D prototype).
 * options.ai = false: a duel between two people (versus); both sides only cast through castSpell, nobody enrages.
 */
export function createBattle(spells, now, { enemyHp = HP, playerHp = HP, ai = true, names = ['You', 'Aswang'] } = {}) {
  return { spells, ai, player: fighter(names[0], playerHp), enemy: fighter(names[1], enemyHp), nextEnemyCast: now + ENEMY_EVERY_MS[1],
    enemyCasting: /** @type {null | { spell: any, vowel: 'a' | 'i' | 'u', power: number, landsAt: number }} */ (null), enraged: false, log: [], events: [], winner: null };
}

// each spell is a skill slot: after a successful cast it recharges (spell.rechargeMs), so one glyph can't be spammed
export const rechargeLeft = (f, spell, now) => Math.max(0, (f.recharge[spell.id] || 0) - now);
export const canCast = (f, now, spell) => now >= f.stunnedUntil && !rechargeLeft(f, spell, now);

/** Returns { damage, absorbed }: hp actually lost and the part a shield took. */
function hit(f, dmg, now) {
  let absorbed = 0;
  if (now < f.shieldUntil) {
    absorbed = Math.min(f.shield, dmg);
    f.shield -= absorbed;
    dmg -= absorbed;
  }
  const damage = Math.min(f.hp, dmg);
  f.hp -= damage;
  return { damage, absorbed };
}

/** Applies one cast. `power` comes from finalPower(); shield and heal act on the caster, the rest on the target. */
export function castSpell(b, who, spell, vowel, power, now) {
  if (b.winner) return;
  const caster = b[who], target = who === 'player' ? b.enemy : b.player;
  const v = spell.variations[vowel];
  const p = Math.round(power * (now < caster.slowedUntil ? SLOW_FACTOR : 1));
  const until = now + (v.durationMs || 0);
  let dealt = { damage: 0, absorbed: 0 };
  switch (v.effect) {
    case 'shield': caster.shield = p; caster.shieldUntil = until; break;
    case 'heal': caster.hp = Math.min(caster.maxHp, caster.hp + p); break;
    case 'burn': target.burns.push({ left: p, perMs: p / v.durationMs }); break;
    case 'stun': dealt = hit(target, p, now); target.stunnedUntil = Math.max(target.stunnedUntil, until); break;
    case 'knockback': dealt = hit(target, p, now); target.stunnedUntil = Math.max(target.stunnedUntil, now + KNOCKBACK_MS); break;
    case 'slow': // a slow during the Aswang's wind-up lasts until that spell lands, so it always weakens it
      dealt = hit(target, p, now);
      target.slowedUntil = Math.max(until, target === b.enemy && b.enemyCasting ? b.enemyCasting.landsAt + 1 : 0);
      break;
    default: dealt = hit(target, p, now); // projectile
  }
  caster.recharge[spell.id] = now + spell.rechargeMs;
  b.log.unshift(`${caster.name}: ${spell.glyph} ${spell.name}, ${v.effect} ${p}`);
  b.events.push({ type: 'cast', who, spell, vowel, effect: v.effect, power: p, ...dealt });
  // a stun or knockback landing during the Aswang's wind-up cancels its spell (the slot is not spent)
  if (target === b.enemy && b.enemyCasting && (v.effect === 'stun' || v.effect === 'knockback')) {
    b.log.unshift(`You interrupted the Aswang's ${b.enemyCasting.spell.glyph}!`);
    b.events.push({ type: 'interrupt', spell: b.enemyCasting.spell });
    b.enemyCasting = null;
    b.nextEnemyCast = Math.max(b.nextEnemyCast, target.stunnedUntil + INTERRUPT_RECOVERY_MS);
  }
  checkWinner(b);
}

/** Advances time by dtMs: burns tick; the Aswang starts a telegraphed spell when its timer is up, and it lands WINDUP_MS later. */
export function tick(b, now, dtMs, rng = Math.random) {
  if (b.winner) return;
  for (const who of ['player', 'enemy']) {
    const f = b[who];
    for (const burn of f.burns) {
      const d = Math.min(burn.left, burn.perMs * dtMs);
      burn.left -= d;
      const { damage } = hit(f, d, now);
      if (damage) b.events.push({ type: 'burn', who, damage });
    }
    f.burns = f.burns.filter(burn => burn.left > 0.01);
  }
  if (!b.ai) { checkWinner(b); return; } // versus: burns tick, the people do the casting
  if (!b.enraged && b.enemy.hp <= b.enemy.maxHp / 2) {
    b.enraged = true;
    b.events.push({ type: 'enrage' });
  }
  const c = b.enemyCasting;
  if (c && now >= c.landsAt) {
    b.enemyCasting = null;
    castSpell(b, 'enemy', c.spell, c.vowel, c.power, now);
  }
  if (!b.enemyCasting && now >= b.nextEnemyCast) {
    const ready = b.spells.filter(s => canCast(b.enemy, now, s)); // the Aswang obeys the same slot recharges
    if (ready.length) {
      const spell = ready[Math.floor(rng() * ready.length)], vowel = 'aiu'[Math.floor(rng() * 3)];
      const accuracy = 60 + rng() * 30; // the Aswang draws like an average player
      const power = finalPower(spell.variations[vowel].baseDamage, accuracy, spell.parTimeMs, spell.parTimeMs);
      b.enemyCasting = { spell, vowel, power, landsAt: now + WINDUP_MS };
      b.events.push({ type: 'telegraph', spell, vowel, landsAt: b.enemyCasting.landsAt });
    }
    const interval = ENEMY_EVERY_MS[0] + rng() * (ENEMY_EVERY_MS[1] - ENEMY_EVERY_MS[0]);
    b.nextEnemyCast = Math.max(now, b.enemy.stunnedUntil) + interval * (b.enraged ? ENRAGE_PACE : 1);
  }
  checkWinner(b);
}

function checkWinner(b) {
  if (b.winner) return;
  if (b.enemy.hp <= 0) b.winner = 'player';
  else if (b.player.hp <= 0) b.winner = 'enemy';
  if (b.winner) b.events.push({ type: 'end', winner: b.winner });
}
