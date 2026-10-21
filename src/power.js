// Final Power = Base Damage × (Accuracy% / 100) × Time Bonus Factor × Mastery Factor
//
// Time Bonus Factor is linear around the spell's par time, clamped to [0.8, 1.25]:
//   cast instantly → 1.25, cast at par → 1.0, cast at 1.8× par or slower → 0.8
// Balance rule: the fastest sloppy cast (60% × 1.25 = 0.75) never beats the slowest
// perfect cast (100% × 0.8 = 0.8), so accuracy always matters more than speed.
//
// Mastery Factor = 1 + 0.15 per mastery level (0-3, see src/guide.js): the less outline help, the more power.
// Balance rule: at level 3 (no outline) even 70%, the lowest score that keeps level 3, gives 0.70 × 1.45 = 1.02,
// which beats tracing at level 0 (~92% × 1.0), so drawing from memory always pays more than tracing.

export const MIN_ACCURACY = 60; // below this the spell fizzles
export const MASTERY_BONUS = 0.15;

export function timeBonus(castMs, parMs) {
  return Math.min(1.25, Math.max(0.8, 1 + 0.25 * (parMs - castMs) / parMs));
}

export function finalPower(baseDamage, accuracy, castMs, parMs, mastery = 0) {
  if (accuracy < MIN_ACCURACY) return 0;
  return Math.round(baseDamage * (accuracy / 100) * timeBonus(castMs, parMs) * (1 + MASTERY_BONUS * mastery));
}
