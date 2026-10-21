// Synthesized Web Audio: spell, impact, UI and stinger sounds plus a field ambience (breeze, cicadas, birds).
// No external service: everything is generated from oscillators and filtered noise at runtime.
import type { Element, Effect } from '../game/content';

type Ctx = AudioContext;

export class AudioSystem {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private birdTimer = 3;
  private ambienceOn = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get isMuted(): boolean { return this.muted; }
  /** 'locked' until the first click/key, then the AudioContext state ('running' when sound plays). */
  get state(): string { return this.ctx?.state ?? 'locked'; }

  async unlock(): Promise<void> {
    if (this.ctx) return;
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.ambience = ctx.createGain(); this.ambience.gain.value = 0; this.ambience.connect(this.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.startAmbienceBed();
    await ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Fades the field ambience in during play and out otherwise. */
  setAmbience(on: boolean): void {
    this.ambienceOn = on;
    if (this.ambience && this.ctx) this.ambience.gain.setTargetAtTime(on ? 0.5 : 0.15, this.ctx.currentTime, 0.6);
  }

  dispose(): void { void this.ctx?.close(); this.ctx = null; }

  /** Call every frame: schedules the occasional bird call. */
  update(dt: number): void {
    if (!this.ctx || !this.ambienceOn) return;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 7;
      this.bird();
    }
  }

  // --- building blocks ------------------------------------------------------------------------------------------
  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; to?: number; delay?: number; out?: AudioNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime + (opts.delay ?? 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.out ?? this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; gain?: number; attack?: number; delay?: number; out?: AudioNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise) return;
    const t = ctx.currentTime + (opts.delay ?? 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    src.loop = true;
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 0.8;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + (opts.attack ?? 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(opts.out ?? this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  private startAmbienceBed(): void {
    const ctx = this.ctx!, out = this.ambience!;
    // breeze: slow-swelling filtered noise
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    src.buffer = this.noise; src.loop = true;
    f.type = 'lowpass'; f.frequency.value = 420;
    g.gain.value = 0.18;
    lfo.frequency.value = 0.08; lfoGain.gain.value = 0.1;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(out);
    src.start(); lfo.start();
    // cicadas: a high buzz pulsed at ~40 Hz, swelling slowly
    const buzz = ctx.createOscillator(), bf = ctx.createBiquadFilter(), bg = ctx.createGain(), pulse = ctx.createOscillator(), pg = ctx.createGain(), swell = ctx.createOscillator(), sg = ctx.createGain();
    buzz.type = 'sawtooth'; buzz.frequency.value = 4600;
    bf.type = 'bandpass'; bf.frequency.value = 5200; bf.Q.value = 6;
    bg.gain.value = 0;
    pulse.frequency.value = 41; pg.gain.value = 0.012;
    swell.frequency.value = 0.05; sg.gain.value = 0.01;
    pulse.connect(pg).connect(bg.gain);
    swell.connect(sg).connect(bg.gain);
    buzz.connect(bf).connect(bg).connect(out);
    buzz.start(); pulse.start(); swell.start();
  }

  private bird(): void {
    const out = this.ambience!;
    const base = 2200 + Math.random() * 1400;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(base, 0.09, { to: base * 1.4, gain: 0.05, delay: i * 0.14, out });
  }

  // --- game events ----------------------------------------------------------------------------------------------
  click(): void { this.tone(880, 0.06, { type: 'triangle', gain: 0.08, to: 1200 }); }

  /** The staff releases a spell: a whoosh coloured by its element. */
  cast(element: Element, effect: Effect): void {
    this.hiss(0.35, { type: 'bandpass', freq: 500, to: 2400, q: 1.2, gain: 0.18, attack: 0.08 });
    switch (element) {
      case 'apoy': this.hiss(0.6, { freq: 900, to: 300, gain: 0.3 }); this.tone(110, 0.4, { type: 'sawtooth', gain: 0.07, to: 70 }); break;
      case 'tubig': for (let i = 0; i < 5; i++) this.tone(420 + Math.random() * 500, 0.12, { gain: 0.07, to: 900, delay: i * 0.05 }); break;
      case 'hangin': this.hiss(0.9, { type: 'bandpass', freq: 300, to: 1800, q: 3, gain: 0.25, attack: 0.25 }); break;
      case 'lupa': this.tone(70, 0.5, { type: 'triangle', gain: 0.35, to: 40 }); this.hiss(0.5, { freq: 300, gain: 0.25 }); break;
      case 'kidlat': this.hiss(0.25, { type: 'highpass', freq: 2500, gain: 0.35, attack: 0.002 }); this.tone(55, 0.9, { type: 'sawtooth', gain: 0.12, to: 35, delay: 0.05 }); break;
    }
    if (effect === 'heal') [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', gain: 0.08, delay: i * 0.08 }));
    if (effect === 'shield') [392, 587, 784].forEach(f => this.tone(f, 0.9, { type: 'sine', gain: 0.07 }));
  }

  impact(heavy: boolean): void {
    this.tone(heavy ? 90 : 140, 0.25, { type: 'triangle', gain: heavy ? 0.4 : 0.25, to: 45 });
    this.hiss(0.18, { freq: 1600, to: 300, gain: heavy ? 0.3 : 0.18, attack: 0.003 });
  }

  absorbed(): void { this.tone(980, 0.35, { gain: 0.1, to: 620 }); this.tone(1470, 0.25, { gain: 0.05 }); }

  telegraph(): void {
    this.tone(98, 1.4, { type: 'sawtooth', gain: 0.07, to: 147 });
    this.tone(104, 1.4, { type: 'sawtooth', gain: 0.05, to: 156 });
  }

  interrupt(): void {
    for (let i = 0; i < 6; i++) this.tone(1800 + Math.random() * 1800, 0.15, { type: 'triangle', gain: 0.06, delay: i * 0.025 });
    this.hiss(0.3, { type: 'highpass', freq: 3000, gain: 0.2, attack: 0.002 });
  }

  fizzle(): void { this.hiss(0.4, { freq: 700, to: 200, gain: 0.15 }); this.tone(180, 0.3, { type: 'triangle', gain: 0.06, to: 90 }); }

  enrage(): void { this.tone(62, 1.2, { type: 'sawtooth', gain: 0.18, to: 48 }); this.hiss(1.0, { freq: 260, gain: 0.2, attack: 0.2 }); }

  win(): void { [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, 0.7, { type: 'triangle', gain: 0.1, delay: i * 0.12 })); }

  lose(): void { [392, 349, 311, 233].forEach((f, i) => this.tone(f, 0.8, { type: 'sine', gain: 0.1, delay: i * 0.22 })); }
}
