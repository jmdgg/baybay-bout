/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  screen: string;
  mode: 'npc' | 'versus';
  versus: { code: string; phase: string | null; hp: (number | null)[] } | null;
  resultIn: number;
  battle: {
    clock: number;
    playerHp: number;
    enemyHp: number;
    enemyCasting: string | null;
    winner: string | null;
    slot: string;
    enraged: boolean;
  } | null;
  mastery: Record<string, number>;
  audio: { state: string; muted: boolean };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void | Promise<void>;
  /** Acknowledge after setup/assets are ready; throw for unknown states. */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stop simulation/state transitions immediately; keep rendering. Await optional synchronization. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Stabilize ambient/idle visuals without requiring an unpaused simulation tick. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void | Promise<void>;
}

/** Read-only helpers for scripted (bot) input: where to move the real pointer. */
interface BaybayTestHelpers {
  tracePath(): [number, number][][];
  kudlitPoint(vowel: 'i' | 'u'): [number, number];
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
  __BAYBAY_TEST__?: BaybayTestHelpers;
}
