// Game content shared by the 3D systems: the 5 spells and their glyph templates (same data as the 2D prototype).
import glyphsJson from '../../glyphs.json';
import spellsJson from '../../spells.json';

export type Point = [number, number];
export type Strokes = Point[][];
export type Vowel = 'a' | 'i' | 'u';
export type Effect = 'projectile' | 'burn' | 'knockback' | 'slow' | 'stun' | 'shield' | 'heal';
export type Element = 'apoy' | 'tubig' | 'hangin' | 'lupa' | 'kidlat';

export interface Variation { effect: Effect; baseDamage: number; durationMs?: number; note?: string }
export interface Spell {
  id: string; name: string; element: Element; lore: string; root: string; glyph: string;
  parTimeMs: number; rechargeMs: number; variations: Record<Vowel, Variation>;
}
export interface Letter {
  glyph: string; root: string; samples: Strokes[];
  order?: { type: string; points: Point[] }[];
  mine?: Strokes[];
}

export const spells = spellsJson.spells as Spell[];
export const letters = glyphsJson as unknown as Letter[];
export const letterOf = (spell: Spell): Letter => letters.find(l => l.glyph === spell.glyph)!;

export const KUDLIT: Record<Vowel, string> = { a: '', i: 'ᜒ', u: 'ᜓ' };
export const syllable = (spell: Spell, vowel: Vowel) => spell.root.slice(0, -1) + vowel;
export const glyphWith = (spell: Spell, vowel: Vowel) => spell.glyph + KUDLIT[vowel];

export const ELEMENT: Record<Element, { label: string; color: string; glow: string }> = {
  apoy: { label: 'Fire', color: '#ff7a2e', glow: '#ffb35a' },
  tubig: { label: 'Water', color: '#36b4e8', glow: '#9fe6ff' },
  hangin: { label: 'Wind', color: '#9fe8c4', glow: '#e6fff2' },
  lupa: { label: 'Earth', color: '#b9874a', glow: '#e7c48a' },
  kidlat: { label: 'Lightning', color: '#ffe45c', glow: '#fff7c2' },
};
