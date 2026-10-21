// The casting pad: the existing 2D recorder (ink) over the existing tracing guide (outline + stroke order).
import { createRecorder } from '../gesture.js';
import { createGuide, fitToCanvas, MASTERY } from '../guide.js';
import type { Letter, Strokes } from '../game/content';

type Recorder = ReturnType<typeof createRecorder>;

export class SigilPad {
  readonly ink: HTMLCanvasElement;
  private readonly guideCanvas: HTMLCanvasElement;
  private readonly recorder: Recorder;
  private readonly guide: ReturnType<typeof createGuide>;
  private template: Strokes | null = null;

  constructor(root: HTMLElement) {
    this.ink = root.querySelector<HTMLCanvasElement>('#pad-ink')!;
    this.guideCanvas = root.querySelector<HTMLCanvasElement>('#pad-guide')!;
    this.recorder = createRecorder(this.ink, { ink: '#e3f3ff' }); // cool white: stands out from the gold outline and the cream stroke-order pen
    this.guide = createGuide(this.guideCanvas);
  }

  get strokes(): Strokes { return this.recorder.strokes as Strokes; }
  get duration(): number { return this.recorder.duration; }

  /** Shows the slot's glyph outline at the help level its mastery allows. */
  show(letter: Letter, level: number): void {
    this.template = letter.samples[0];
    this.recorder.clear();
    this.guide.show(letter.samples[0], { ...MASTERY[level], order: letter.order });
  }

  /** Updates only the outline (e.g. mastery changed) and keeps the player's ink. */
  refreshGuide(letter: Letter, level: number): void {
    this.guide.show(letter.samples[0], { ...MASTERY[level], order: letter.order });
  }

  hide(): void { this.template = null; this.guide.hide(); this.recorder.clear(); }
  clear(keepInk = false): void { this.recorder.clear(keepInk); }
  undo(): void { this.recorder.undo(); }
  overlay(template: Strokes): void { this.recorder.overlay(template); }

  /** The traced strokes redrawn bold and white for the world sigil (the pad's thin ink would vanish at distance). */
  snapshot(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = out.height = 256;
    const ctx = out.getContext('2d')!, k = 256 / this.ink.width;
    Object.assign(ctx, { strokeStyle: '#ffffff', fillStyle: '#ffffff', lineWidth: 16, lineCap: 'round', lineJoin: 'round', shadowColor: '#ffffff', shadowBlur: 18 });
    for (const stroke of this.strokes) {
      ctx.beginPath();
      ctx.moveTo(stroke[0][0] * k, stroke[0][1] * k);
      for (const [x, y] of stroke) ctx.lineTo(x * k, y * k);
      if (stroke.length === 1) { ctx.arc(stroke[0][0] * k, stroke[0][1] * k, 9, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    }
    return out;
  }

  /** Test hook: the outline's strokes in client (screen) coordinates, for scripted pointer tracing. */
  tracePath(): [number, number][][] {
    if (!this.template) return [];
    const { to } = fitToCanvas(this.template, this.ink);
    const r = this.ink.getBoundingClientRect();
    return this.template.map(s => s.map(p => {
      const [x, y] = to(p);
      return [r.left + x * r.width / this.ink.width, r.top + y * r.height / this.ink.height] as [number, number];
    }));
  }

  /** Test hook: where to tap for a kudlit above (-i) or below (-u) the glyph, in client coordinates. */
  kudlitPoint(vowel: 'i' | 'u'): [number, number] {
    const r = this.ink.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height * (vowel === 'i' ? 0.06 : 0.94)];
  }
}
