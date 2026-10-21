// Messages between the big screen / phones and the duel server (server/rooms.js).
import type { Effect, Vowel } from '../game/content';

export interface FighterState {
  hp: number; maxHp: number; shield: number; burning: boolean; slowed: boolean; stunned: boolean;
  recharge: number[]; // ms left per slot
  mastery: number[];  // 0..3 per slot
}

export interface RoomState {
  type: 'state';
  code: string;
  padUrl: string;     // '' when the server only listens on this computer (run npm run dev:lan)
  phase: 'lobby' | 'countdown' | 'battle' | 'paused' | 'over';
  countdownMs: number;
  players: { name: string; connected: boolean }[];
  fighters: [FighterState | null, FighterState | null];
  winner: 0 | 1 | null;
  rematch: (number | 'screen')[];
}

/** A battle event from src/battle.js with spells as ids and sides as player indexes (0 = P1, 1 = P2). */
export interface NetEvent {
  type: 'cast' | 'burn' | 'end' | 'interrupt' | 'telegraph' | 'enrage';
  who?: 0 | 1; spell?: string; vowel?: Vowel; effect?: Effect; power?: number; damage?: number; absorbed?: number; winner?: 0 | 1;
}

export interface Attempt {
  who: 0 | 1; spell: string; glyph: string; syllable: string; effect: Effect;
  accuracy: number; power: number; fizzled: boolean; level: number; nextLevel: number;
}

export type ServerMessage =
  | RoomState
  | { type: 'hosted'; code: string; padUrl: string; alternates: string[] }
  | { type: 'joined'; code: string; you: 0 | 1; name: string; token: string }
  | { type: 'events'; events: NetEvent[] }
  | ({ type: 'attempt' } & Attempt)
  | ({ type: 'castResult'; ok: true } & Attempt)
  | { type: 'castResult'; ok: false; reason: string; waitMs?: number; keep?: boolean }
  | { type: 'error'; message: string }
  | { type: 'closed'; message: string };

export type ClientMessage =
  | { type: 'host' }
  | { type: 'join'; code: string; name?: string; token?: string }
  | { type: 'cast'; slot: number; strokes: [number, number][][]; durationMs: number }
  | { type: 'rematch' }
  | { type: 'leave' };
