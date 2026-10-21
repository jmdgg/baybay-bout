// Baybay-Bout 3D: state machine (title → battle ↔ paused/dictionary → result) and the glue between the pure
// battle rules (src/battle.js) and the 3D view. Rules emit events; this file turns them into animation, VFX,
// audio and HUD, and never re-implements a rule.
import * as THREE from 'three';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Aswang } from '../entities/Aswang';
import { Babaylan, PALETTES } from '../entities/Babaylan';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type FighterView } from '../systems/Hud';
import { SigilPad } from '../systems/SigilPad';
import { Telegraph } from '../systems/Telegraph';
import { Vfx } from '../systems/Vfx';
import { Dictionary } from '../ui/Dictionary';
import { createSeededRandom } from '../utils/random';
import { ENEMY_POS, PLAYER_POS } from '../world/shared';
import { World } from '../world/World';
import { castSpell, createBattle, rechargeLeft, tick, WINDUP_MS } from '../battle.js';
import { recognize } from '../gesture.js';
import { MASTERY, nextMastery } from '../guide.js';
import { finalPower, MASTERY_BONUS } from '../power.js';
import { ELEMENT, glyphWith, letterOf, spells, syllable, type Spell, type Vowel } from './content';
import type { Attempt, NetEvent, RoomState } from '../net/protocol';
import { Versus } from './Versus';

type Screen = 'title' | 'lobby' | 'battle' | 'paused' | 'dictionary' | 'result';
type Who = 'player' | 'enemy';
type Battle = ReturnType<typeof createBattle>;
interface BattleEvent { type: string; who?: Who; spell?: Spell; vowel?: Vowel; effect?: string; power?: number; damage?: number; absorbed?: number; winner?: Who }

const MASTERY_KEY = 'baybay-bout-mastery';
const RESULT_DELAY = 1.8;
// tuned with the human-paced bot: ~a minute of duel, enough telegraphs that defending matters
const ENEMY_HP = 210;
const ENEMY_CHEST = new THREE.Vector3(ENEMY_POS.x, 1.6, ENEMY_POS.z);
const PLAYER_CHEST = new THREE.Vector3(PLAYER_POS.x, 1.25, PLAYER_POS.z);

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 900);
  private readonly world: World;
  private readonly babaylan = new Babaylan();
  private readonly aswang = new Aswang();
  // "Duel a friend": player 2 is a second Babaylan (indigo and silver) where the Aswang stands
  private readonly rival = new Babaylan({ position: ENEMY_POS, facing: 1, palette: PALETTES.p2 });
  private mode: 'npc' | 'versus' = 'npc';
  private versus: Versus | null = null;
  private versusStats: { casts: number; accuracy: number; fizzles: number }[] = [];
  private testSockets: WebSocket[] = [];
  private readonly vfx: Vfx;
  private readonly telegraph = new Telegraph();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly audio = new AudioSystem();
  private readonly hud: Hud;
  private readonly pad: SigilPad;
  private readonly dictionary: Dictionary;
  private readonly debugTools: DebugTools;
  private readonly loop = new Loop((dt, t) => this.update(dt, t), () => this.render());
  private readonly tuning: DebugTuning = { exposure: 1.0, maxDpr: 2 };
  // Route ALL gameplay randomness through this.rng so the seed() test hook keeps captures and bot runs reproducible.
  private rng = createSeededRandom(1);

  private screen: Screen = 'title';
  private battle: Battle | null = null;
  private clock = 0;             // battle time in ms; only advances while the duel runs
  private slot: Spell = spells[0];
  private mastery: Record<string, number> = {};
  private resultTimer = -1;
  private circleGlow = 0;
  private circleColor = '#ffd27a';
  private burnAcc = { player: 0, enemy: 0 };
  private burnTimer = 0;
  private stats = { casts: 0, accuracy: 0, fizzles: 0, interrupts: 0, damageTaken: 0, started: 0 };
  private frame = 0;
  private time = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private readonly v = new THREE.Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.world = new World(this.renderer, this.scene);
    this.vfx = new Vfx(this.scene, () => this.rng());
    this.scene.add(this.world.group, this.babaylan.group, this.aswang.group, this.rival.group, this.telegraph.group);
    this.rival.group.visible = false;
    this.hud = new Hud(spells, s => this.selectSlot(s));
    this.pad = new SigilPad(document.getElementById('pad')!);
    this.dictionary = new Dictionary(spells, () => this.toggleDictionary(false));
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });
    try { this.mastery = JSON.parse(localStorage.getItem(MASTERY_KEY) ?? '{}') || {}; } catch { this.mastery = {}; }
    this.wireUi();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.installTestHooks();
    this.publishDiagnostics();
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __BAYBAY_SCENE__: THREE.Scene }).__BAYBAY_SCENE__ = this.scene;
  }

  start(): void { this.loop.start(); }

  dispose(): void {
    this.loop.stop();
    this.audio.dispose();
    this.debugTools.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // --- UI wiring ------------------------------------------------------------------------------------------------
  private wireUi(): void {
    const on = (id: string, fn: () => void) => document.getElementById(id)!.addEventListener('click', () => { this.audio.click(); fn(); });
    on('start', () => this.startBattle());
    on('howto-btn', () => this.showScreen('howto', true));
    document.querySelector('#howto .close')!.addEventListener('click', () => this.showScreen('howto', false));
    on('title-dict', () => this.toggleDictionary(true));
    on('open-dict', () => this.toggleDictionary(true));
    on('cast', () => this.cast());
    on('undo', () => this.pad.undo());
    on('clear', () => this.pad.clear());
    on('mute', () => this.toggleMute());
    on('pause-btn', () => this.setPaused(true));
    on('resume', () => this.setPaused(false));
    on('restart', () => this.startBattle());
    on('quit', () => this.toTitle());
    on('retry', () => (this.mode === 'versus' ? this.versus?.rematch() : this.startBattle()));
    on('result-title-btn', () => (this.mode === 'versus' ? this.leaveVersus() : this.toTitle()));
    on('versus-btn', () => this.openVersus());
    on('lobby-back', () => this.leaveVersus());
    on('leave-btn', () => this.leaveVersus());

    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        if (this.dictionary.isOpen) this.toggleDictionary(false);
        else if (!document.getElementById('howto')!.hidden) this.showScreen('howto', false);
        else if (this.screen === 'battle') this.setPaused(true);
        else if (this.screen === 'paused') this.setPaused(false);
        return;
      }
      if (this.mode === 'versus') { if (key === 'm') this.toggleMute(); return; } // the phones do the casting
      if (key === 'd') { this.toggleDictionary(!this.dictionary.isOpen); return; }
      if (key === 'm') { this.toggleMute(); return; }
      if (this.screen !== 'battle') return;
      if (key >= '1' && key <= String(spells.length)) this.selectSlot(spells[Number(key) - 1]);
      else if (key === 'enter') { e.preventDefault(); this.cast(); }
      else if (key === 'backspace') { e.preventDefault(); this.pad.undo(); }
    });
  }

  private showScreen(id: string, show: boolean): void {
    document.getElementById(id)!.hidden = !show;
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.isMuted);
    document.getElementById('mute')!.setAttribute('aria-pressed', String(this.audio.isMuted));
  }

  private toggleDictionary(open: boolean): void {
    if (open === this.dictionary.isOpen) return;
    if (open) {
      this.dictionary.open();
      if (this.screen === 'battle') this.screen = 'dictionary'; // the duel waits while you read
    } else {
      this.dictionary.close();
      if (this.screen === 'dictionary') this.screen = 'battle';
    }
  }

  private setPaused(paused: boolean): void {
    if (paused && this.screen === 'battle') this.screen = 'paused';
    else if (!paused && this.screen === 'paused') this.screen = 'battle';
    this.showScreen('pause', this.screen === 'paused');
    if (this.screen === 'paused') (document.getElementById('resume') as HTMLButtonElement).focus();
  }

  // --- flow ----------------------------------------------------------------------------------------------------
  private toTitle(): void {
    this.screen = 'title';
    this.battle = null;
    for (const id of ['pause', 'result']) this.showScreen(id, false);
    this.showScreen('hud', false);
    this.showScreen('title-screen', true);
    this.pad.hide();
    this.resetActors();
    this.cameraRig.setMode('title');
    this.audio.setAmbience(false);
  }

  private resetActors(): void {
    this.babaylan.reset();
    this.aswang.reset();
    this.rival.reset();
    this.aswang.group.visible = this.mode === 'npc';
    this.rival.group.visible = this.mode === 'versus';
    this.vfx.clear();
    this.telegraph.hide();
    this.hud.clearTransient();
    this.resultTimer = -1;
    this.circleGlow = 0;
  }

  private startBattle(): void {
    this.resetActors();
    this.clock = 0;
    this.battle = createBattle(spells, this.clock, { enemyHp: ENEMY_HP });
    this.stats = { casts: 0, accuracy: 0, fizzles: 0, interrupts: 0, damageTaken: 0, started: this.clock };
    this.burnAcc = { player: 0, enemy: 0 };
    for (const id of ['title-screen', 'pause', 'result', 'howto']) this.showScreen(id, false);
    this.showScreen('hud', true);
    this.screen = 'battle';
    this.cameraRig.setMode('duel');
    this.audio.setAmbience(true);
    this.selectSlot(spells[0]);
    this.hud.feedback(['Trace ', { g: spells[0].glyph }, ' inside the outline, then Cast. Watch the Aswang for its glyph.']);
  }

  private levelOf(s: Spell): number { return this.mastery[s.glyph] ?? 0; }
  /** Player 2's fighter: the Aswang in the NPC duel, the indigo Babaylan in "Duel a friend". */
  private get p2(): Aswang | Babaylan { return this.mode === 'versus' ? this.rival : this.aswang; }

  private selectSlot(s: Spell): void {
    if (this.screen !== 'battle') return;
    this.slot = s;
    this.pad.show(letterOf(s), this.levelOf(s));
    (document.activeElement as HTMLElement | null)?.blur?.(); // Enter must cast, not re-click the slot
    const fromMemory = this.levelOf(s) === MASTERY.length - 1;
    this.hud.feedback([fromMemory ? 'Draw ' : 'Trace ', { g: s.glyph }, ` (${s.root}) ${fromMemory ? 'from memory' : 'inside the outline'}. Tap above for -i, below for -u.`]);
  }

  /** The player presses Cast: score the drawing against the slot's glyph, then let the rules apply it. */
  private cast(): void {
    const b = this.battle;
    if (this.screen !== 'battle' || !b || b.winner) return;
    const slot = this.slot, me = b.player, now = this.clock;
    if (!this.pad.strokes.length) { this.hud.feedback(['Trace the glyph on the sigil pad first.']); return; }
    // blocked casts keep the drawing, so it can be cast once ready
    if (now < me.stunnedUntil) { this.hud.feedback(['You are stunned! Your glyph is kept; cast it in a moment.']); return; }
    const wait = rechargeLeft(me, slot, now);
    if (wait) { this.hud.feedback([{ g: slot.glyph }, ` is recharging (${(Math.ceil(wait / 100) / 10).toFixed(1)} s). Your glyph is kept.`]); return; }

    const letter = letterOf(slot);
    const r = recognize(this.pad.strokes, [letter]); // the slot says which glyph: just score how close it is
    if (!r) { this.hud.feedback(['Too small to read. Trace the whole outline.']); return; }
    const vowel = r.vowel as Vowel;
    const level = this.levelOf(slot);
    const v = slot.variations[vowel];
    const power = finalPower(v.baseDamage, r.accuracy, this.pad.duration, slot.parTimeMs, level);
    this.stats.casts += 1;
    this.stats.accuracy += r.accuracy;
    const parts: (string | { g: string })[] = [{ g: r.glyph }, ` ${r.syllable} · ${slot.name} (${v.effect}) · accuracy ${r.accuracy}% · `];
    if (power) {
      this.pendingSigil = this.pad.snapshot();
      castSpell(b, 'player', slot, vowel, power, now);
      parts.push(`power ${power}${level ? ` (mastery ×${(1 + MASTERY_BONUS * level).toFixed(2)})` : ''}`);
    } else {
      this.stats.fizzles += 1;
      parts.push('fizzled, stay inside the outline');
      this.vfx.fizzle(this.babaylan.staffTip.getWorldPosition(this.v).clone());
      this.audio.fizzle();
    }
    this.mastery[slot.glyph] = nextMastery(level, r.accuracy, power);
    try { localStorage.setItem(MASTERY_KEY, JSON.stringify(this.mastery)); } catch { /* per-browser convenience only */ }
    if (this.mastery[slot.glyph] !== level) {
      parts.push(this.mastery[slot.glyph] > level ? ' · the outline fades' : ' · the outline returns');
      this.pad.refreshGuide(letter, this.mastery[slot.glyph]);
    }
    this.hud.feedback(parts);
    this.pad.overlay(letter.samples[0]); // green = the letter as the font writes it
    this.pad.clear(true);
  }
  private pendingSigil: HTMLCanvasElement | null = null;

  // --- rule events → view ---------------------------------------------------------------------------------------
  private drainEvents(): void {
    const b = this.battle;
    if (!b) return;
    for (const e of b.events.splice(0) as BattleEvent[]) this.onEvent(e);
  }

  private onEvent(e: BattleEvent): void {
    switch (e.type) {
      case 'telegraph': {
        const color = ELEMENT[e.spell!.element].color;
        this.aswang.beginWindup(color);
        this.telegraph.show(glyphWith(e.spell!, e.vowel!), color);
        this.audio.telegraph();
        break;
      }
      case 'cast': {
        const color = ELEMENT[e.spell!.element].color;
        if (e.who === 'player') {
          const sigil = this.pendingSigil;
          this.pendingSigil = null;
          this.circleColor = color;
          this.circleGlow = 1;
          if (sigil) this.vfx.sigil(sigil, new THREE.Vector3(PLAYER_POS.x, 2.5, PLAYER_POS.z - 1.3), ELEMENT[e.spell!.element].glow);
          this.babaylan.cast(color, () => {
            this.audio.cast(e.spell!.element, e.effect as never);
            this.spawnSpell(e, this.babaylan.staffTip.getWorldPosition(new THREE.Vector3()));
          });
        } else {
          this.telegraph.hide();
          const caster = this.p2;
          caster.castFrom(color, () => {
            this.audio.cast(e.spell!.element, e.effect as never);
            this.spawnSpell(e, caster.castOrigin());
          });
        }
        break;
      }
      case 'interrupt': {
        this.aswang.interrupted();
        this.telegraph.hide();
        this.vfx.shatter(new THREE.Vector3(ENEMY_POS.x, 3.4, ENEMY_POS.z), ELEMENT[e.spell!.element].color);
        this.audio.interrupt();
        this.hud.toast('Interrupted!');
        this.stats.interrupts += 1;
        break;
      }
      case 'burn': this.burnAcc[e.who!] += e.damage!; break;
      case 'enrage': this.hud.toast('The Aswang is enraged!', true); this.audio.enrage(); break;
      case 'end': {
        this.telegraph.hide();
        const won = e.winner === 'player';
        this.babaylan.end(won ? 'win' : 'lose');
        this.p2.end(won ? 'lose' : 'win');
        if (won || this.mode === 'versus') this.audio.win(); else this.audio.lose();
        if (this.mode === 'versus') this.hud.toast(`${this.versusName(won ? 0 : 1)} wins!`);
        else this.hud.toast(won ? 'The Aswang is banished!' : 'The Babaylan falls…', !won);
        this.resultTimer = RESULT_DELAY;
        break;
      }
    }
  }

  /** The element × effect choreography; the target reacts when the spell arrives. */
  private spawnSpell(e: BattleEvent, from: THREE.Vector3): void {
    const fromPlayer = e.who === 'player';
    const casterPos = fromPlayer ? PLAYER_POS : ENEMY_POS, targetPos = fromPlayer ? ENEMY_POS : PLAYER_POS;
    const to = (fromPlayer ? ENEMY_CHEST : PLAYER_CHEST).clone();
    const el = e.spell!.element, effect = e.effect!, variation = e.spell!.variations[e.vowel!];
    const seconds = (variation.durationMs ?? 0) / 1000;
    const impact = (heavy = false) => {
      if (fromPlayer) { if (effect === 'knockback') this.p2.knockback(); else this.p2.hit(); }
      else { this.babaylan.hit(); this.stats.damageTaken += e.damage ?? 0; }
      if (e.damage) this.number(to, `−${Math.round(e.damage)}`, fromPlayer && this.mode === 'npc' ? '' : 'player');
      if (e.absorbed) { this.number(to.clone().add(new THREE.Vector3(0.6, 0.4, 0)), `${Math.round(e.absorbed)} blocked`, 'absorb'); this.audio.absorbed(); }
      this.audio.impact(heavy);
      this.cameraRig.shake(heavy ? 0.45 : fromPlayer ? 0.15 : 0.3);
    };
    const side = fromPlayer ? 0 : 1;
    switch (effect) {
      case 'shield':
        this.vfx.shield(el === 'tubig' ? 'water' : 'stone', casterPos, fromPlayer ? 1 : -1, () => this.shieldUp(side));
        break;
      case 'heal':
        this.vfx.heal(casterPos);
        this.number(new THREE.Vector3(casterPos.x, 2.4, casterPos.z), `+${e.power}`, 'heal');
        break;
      case 'stun':
        if (el === 'lupa') { this.vfx.roots(targetPos, seconds); impact(); }
        else { this.vfx.skyStrike(new THREE.Vector3(targetPos.x, 0, targetPos.z)); impact(true); }
        break;
      case 'knockback':
        if (el === 'hangin') {
          this.vfx.gustStreaks(from, to);
          this.world.gust(1);
          this.vfx.delay(0.35, () => impact(true));
        } else this.vfx.fireball(from, to, () => { this.vfx.ring(to, '#ffd36a', 4.5); impact(true); });
        break;
      case 'slow':
        if (el === 'tubig') this.vfx.waterOrb(from, to, () => impact());
        else if (el === 'hangin') { this.vfx.gustStreaks(from, to); this.world.gust(0.5); this.vfx.delay(0.4, () => impact()); }
        else this.vfx.bolt(from, to, () => impact());
        break;
      case 'burn':
        this.vfx.fireball(from, to, () => impact());
        break;
      default: // projectile
        if (el === 'apoy') this.vfx.fireball(from, to, () => impact());
        else if (el === 'hangin') this.vfx.crescent(from, to, () => impact());
        else if (el === 'lupa') this.vfx.boulder(from, to, () => impact(true));
        else if (el === 'kidlat') this.vfx.bolt(from, to, () => impact(true));
        else this.vfx.waterOrb(from, to, () => impact());
    }
  }

  /** Whether a fighter's shield still holds (the rules decide: local battle or the duel server). */
  private shieldUp(side: 0 | 1): boolean {
    if (this.mode === 'versus') return (this.versus?.state?.fighters[side]?.shield ?? 0) > 0;
    const f = this.battle && (side === 0 ? this.battle.player : this.battle.enemy);
    return !!f && this.clock < f.shieldUntil && f.shield > 0;
  }

  private number(at: THREE.Vector3, text: string, cls: string): void {
    const p = this.v.copy(at).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    this.hud.number(r.left + (p.x * 0.5 + 0.5) * r.width, r.top + (-p.y * 0.5 + 0.5) * r.height, text, cls);
  }

  // --- frame ----------------------------------------------------------------------------------------------------
  private update(dt: number, elapsed: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    if (this.pausedForScreenshot) { this.publishDiagnostics(); return; }
    this.time = this.reducedMotion ? 0 : elapsed;
    const running = this.screen === 'battle' || this.screen === 'title' || this.screen === 'result';
    const animDt = running ? dt : 0; // pause and dictionary freeze the duel and its effects

    if (this.screen === 'battle' && this.battle) {
      this.clock += dt * 1000;
      tick(this.battle, this.clock, dt * 1000, this.rng);
      this.drainEvents();
    }
    if (this.mode === 'versus') { if (this.versus?.state?.fighters[0]) this.updateVersusView(animDt); }
    else if (this.battle) this.updateBattleView(animDt);
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.showResult();
    }

    this.world.update(animDt, this.time);
    this.babaylan.update(this.reducedMotion ? 0 : animDt);
    this.aswang.update(this.reducedMotion ? 0 : animDt);
    this.rival.update(this.reducedMotion ? 0 : animDt);
    this.vfx.update(animDt);
    this.cameraRig.update(dt);
    this.audio.update(dt);
    this.circleGlow = Math.max(0, this.circleGlow - animDt * 1.2);
    this.world.setCircleGlow(this.circleColor, this.circleGlow * 0.9);
    this.publishDiagnostics();
  }

  private updateBattleView(dt: number): void {
    const b = this.battle!, now = this.clock;
    const view = (who: Who): FighterView => {
      const f = b[who];
      return { hp: (f.hp / f.maxHp) * 100, hpValue: f.hp, shield: now < f.shieldUntil ? f.shield : 0, burning: f.burns.length > 0, slowed: now < f.slowedUntil, stunned: now < f.stunnedUntil, enraged: who === 'enemy' && b.enraged && !b.winner };
    };
    const p = view('player'), en = view('enemy');
    this.hud.fighter('player', p);
    this.hud.fighter('enemy', en);
    this.babaylan.setStatus(p.stunned, p.slowed);
    this.aswang.setStatus(en.stunned, en.slowed);
    if (!b.winner) {
      this.vfx.aura(PLAYER_POS, p.burning, p.slowed, p.stunned, 2.1, dt);
      this.vfx.aura(ENEMY_POS, en.burning, en.slowed, en.stunned, 2.6, dt);
    }
    this.hud.setSlots(spells.map(s => {
      const left = rechargeLeft(b.player, s, now);
      return { selected: s === this.slot, recharge: s.rechargeMs ? left / s.rechargeMs : 0, rechargeLeftMs: left, level: this.levelOf(s) };
    }));
    const c = b.enemyCasting;
    const progress = c ? Math.max(0, (c.landsAt - now) / WINDUP_MS) : 0;
    this.hud.incoming(c ? { glyph: glyphWith(c.spell, c.vowel), syllable: syllable(c.spell, c.vowel), color: ELEMENT[c.spell.element as keyof typeof ELEMENT].color, progress, seconds: Math.max(0, c.landsAt - now) / 1000 } : null);
    this.telegraph.update(dt, this.time, this.aswang.group.position, this.camera, progress);
    this.showBurns(dt);
  }

  /** Burns show as small numbers every half second instead of every frame. */
  private showBurns(dt: number): void {
    this.burnTimer += dt;
    if (this.burnTimer > 0.5) {
      this.burnTimer = 0;
      for (const who of ['player', 'enemy'] as Who[]) {
        if (this.burnAcc[who] >= 1) {
          this.number(who === 'enemy' ? ENEMY_CHEST : PLAYER_CHEST, `−${Math.round(this.burnAcc[who])}`, 'burn');
          if (who === 'player') this.stats.damageTaken += this.burnAcc[who];
          this.burnAcc[who] = 0;
        }
      }
    }
  }

  // --- "Duel a friend" -------------------------------------------------------------------------------------------
  private openVersus(): Versus {
    this.mode = 'versus';
    document.body.classList.add('versus');
    this.battle = null;
    this.resetActors();
    for (const id of ['title-screen', 'result', 'hud', 'howto']) this.showScreen(id, false);
    this.showScreen('lobby', true);
    this.screen = 'lobby';
    this.cameraRig.setMode('title');
    this.versus = new Versus({
      onState: st => this.onVersusState(st),
      onEvents: events => events.forEach(e => this.onEvent(this.fromNet(e))),
      onAttempt: a => this.onVersusAttempt(a),
      onClosed: message => {
        if (this.screen !== 'lobby') this.hud.toast(message, true);
        document.getElementById('lobby-status')!.textContent = message;
      },
    });
    return this.versus;
  }

  private leaveVersus(): void {
    this.versus?.close();
    this.versus = null;
    this.mode = 'npc';
    document.body.classList.remove('versus');
    document.getElementById('player-name')!.textContent = 'Babaylan';
    document.getElementById('enemy-name')!.textContent = 'Aswang';
    document.getElementById('enemy-emblem')!.textContent = 'ᜀᜐ᜔ᜏᜅ᜔';
    document.getElementById('player-last')!.textContent = '';
    document.getElementById('enemy-last')!.textContent = '';
    document.getElementById('versus-banner')!.textContent = '';
    (document.getElementById('retry') as HTMLButtonElement).textContent = 'Duel again';
    this.showScreen('lobby', false);
    this.toTitle();
  }

  private versusName(i: 0 | 1): string { return 'P' + (i + 1) + ' · ' + (this.versus?.state?.players[i]?.name ?? ''); }

  /** Server events use player indexes and spell ids; the view speaks 'player'/'enemy' and spell objects. */
  private fromNet(e: NetEvent): BattleEvent {
    const side = (i?: number): Who | undefined => (i === undefined ? undefined : i === 0 ? 'player' : 'enemy');
    return { type: e.type, who: side(e.who), spell: spells.find(s => s.id === e.spell), vowel: e.vowel, effect: e.effect,
      power: e.power, damage: e.damage, absorbed: e.absorbed, winner: side(e.winner) };
  }

  private onVersusState(st: RoomState): void {
    const banner = document.getElementById('versus-banner')!;
    if (st.phase === 'lobby' || st.phase === 'countdown') {
      if (this.screen !== 'lobby') { // a rematch: back to the lobby for the countdown
        this.resetActors();
        this.showScreen('result', false);
        this.showScreen('hud', false);
        this.showScreen('lobby', true);
        this.screen = 'lobby';
        this.cameraRig.setMode('title');
      }
      return;
    }
    if (this.screen === 'lobby' && (st.phase === 'battle' || st.phase === 'paused')) {
      this.resetActors();
      this.versusStats = [0, 1].map(() => ({ casts: 0, accuracy: 0, fizzles: 0 }));
      this.showScreen('lobby', false);
      this.showScreen('hud', true);
      this.screen = 'battle';
      this.cameraRig.setMode('versus');
      this.audio.setAmbience(true);
      document.getElementById('player-name')!.textContent = this.versusName(0);
      document.getElementById('enemy-name')!.textContent = this.versusName(1);
      document.getElementById('enemy-emblem')!.textContent = 'ᜊᜊᜌ᜔ᜎᜈ᜔';
      (document.getElementById('retry') as HTMLButtonElement).textContent = 'Rematch';
      this.hud.toast('Begin!');
    }
    const away = st.players.findIndex(p => !p.connected);
    banner.textContent = st.phase === 'paused' ? 'Paused: waiting for P' + (away + 1) + ' to reconnect…' : '';
    if (st.phase === 'over' && this.screen === 'result') {
      const ready = st.rematch.filter(x => x !== 'screen').length;
      document.getElementById('result-text')!.textContent = ready
        ? ready + ' of 2 players want a rematch.' : 'Press Rematch here, or both players on their phones.';
    }
  }

  private onVersusAttempt(a: Attempt): void {
    const st = this.versusStats[a.who];
    if (st) { st.casts += 1; st.accuracy += a.accuracy; if (a.fizzled) st.fizzles += 1; }
    const outcome = a.fizzled ? 'fizzled' : a.effect + ' ' + a.power;
    this.hud.lastCast(a.who === 0 ? 'player' : 'enemy', [{ g: a.glyph }, ' ' + a.syllable + ' · ' + a.accuracy + '% · ' + outcome]);
    if (a.fizzled) {
      const caster = a.who === 0 ? this.babaylan : this.rival;
      this.vfx.fizzle(caster.castOrigin());
      this.audio.fizzle();
    }
  }

  private updateVersusView(dt: number): void {
    const st = this.versus!.state!;
    const view = (i: 0 | 1): FighterView => {
      const f = st.fighters[i]!;
      return { hp: (f.hp / f.maxHp) * 100, hpValue: f.hp, shield: f.shield, burning: f.burning, slowed: f.slowed, stunned: f.stunned };
    };
    const p = view(0), en = view(1);
    this.hud.fighter('player', p);
    this.hud.fighter('enemy', en);
    this.babaylan.setStatus(p.stunned, p.slowed);
    this.rival.setStatus(en.stunned, en.slowed);
    if (st.phase === 'battle') {
      this.vfx.aura(PLAYER_POS, p.burning, p.slowed, p.stunned, 2.1, dt);
      this.vfx.aura(ENEMY_POS, en.burning, en.slowed, en.stunned, 2.1, dt);
    }
    this.showBurns(dt);
  }

  private showResult(): void {
    if (this.mode === 'versus') { this.showVersusResult(); return; }
    const b = this.battle;
    if (!b) return;
    this.screen = 'result';
    const won = b.winner === 'player';
    document.getElementById('result-glyph')!.textContent = won ? 'ᜆᜄᜓᜋ᜔ᜉᜌ᜔' : 'ᜊᜓᜋᜄ᜔ᜐᜃ᜔';
    document.getElementById('result-title')!.textContent = won ? 'Tagumpay! The Aswang is banished.' : 'The Aswang prevails.';
    document.getElementById('result-text')!.textContent = won
      ? 'The palayan is safe for another night.'
      : 'Read its glyph next time: shield the big hits, stun to interrupt.';
    const avg = this.stats.casts ? Math.round(this.stats.accuracy / this.stats.casts) : 0;
    const rows: [string, string][] = [
      ['Duel time', `${(this.clock / 1000).toFixed(1)} s`], ['Casts', String(this.stats.casts)], ['Average accuracy', `${avg}%`],
      ['Fizzles', String(this.stats.fizzles)], ['Interrupts', String(this.stats.interrupts)], ['Damage taken', String(Math.round(b.player.maxHp - b.player.hp))],
    ];
    document.getElementById('result-stats')!.replaceChildren(...rows.flatMap(([k, val]) => [
      Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: val })]));
    this.showScreen('result', true);
    (document.getElementById('retry') as HTMLButtonElement).focus();
  }

  private showVersusResult(): void {
    const st = this.versus?.state;
    if (!st || st.winner === null) return;
    this.screen = 'result';
    document.getElementById('result-glyph')!.textContent = 'ᜆᜄᜓᜋ᜔ᜉᜌ᜔';
    document.getElementById('result-title')!.textContent = this.versusName(st.winner) + ' wins!';
    document.getElementById('result-text')!.textContent = 'Press Rematch here, or both players on their phones.';
    const avg = (i: number) => { const x = this.versusStats[i]; return x?.casts ? Math.round(x.accuracy / x.casts) + '%' : '–'; };
    const rows: [string, string][] = [];
    for (const i of [0, 1]) {
      rows.push(['P' + (i + 1) + ' casts', String(this.versusStats[i]?.casts ?? 0)]);
      rows.push(['P' + (i + 1) + ' accuracy', avg(i)]);
      rows.push(['P' + (i + 1) + ' HP left', String(Math.ceil(st.fighters[i]?.hp ?? 0))]);
    }
    document.getElementById('result-stats')!.replaceChildren(...rows.flatMap(([k, val]) => [
      Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: val })]));
    this.showScreen('result', true);
    (document.getElementById('retry') as HTMLButtonElement).focus();
  }

  private render(): void { this.renderer.render(this.scene, this.camera); }

  // --- test hooks + diagnostics ---------------------------------------------------------------------------------
  private installTestHooks(): void {
    const settle = (seconds: number) => { // advance animation only (no rules), so poses reach their target
      for (let i = 0; i < seconds * 30; i++) {
        this.babaylan.update(1 / 30); this.aswang.update(1 / 30); this.rival.update(1 / 30); this.vfx.update(1 / 30); this.cameraRig.update(1 / 30);
        if (this.battle) this.updateBattleView(1 / 30);
      }
    };
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => { this.rng = createSeededRandom(value); },
      setState: async (name: string) => {
        const states = ['title', 'howto', 'active-play', 'telegraph', 'casting', 'dictionary', 'paused', 'win', 'lose', 'versus-lobby', 'versus-play'];
        if (!states.includes(name)) throw new Error(`Unknown test state: ${name}`);
        this.testSockets.splice(0).forEach(ws => ws.close());
        if (this.mode === 'versus') this.leaveVersus();
        if (name.startsWith('versus')) {
          const versus = this.openVersus();
          await versus.hosted();
          if (name === 'versus-play') await this.joinTestPlayers(versus);
          settle(0.5);
          this.render();
          this.publishDiagnostics();
          return { state: name };
        }
        this.toggleDictionary(false);
        this.showScreen('howto', false);
        if (name === 'title' || name === 'howto') {
          this.toTitle();
          this.cameraRig.setMode('title', true);
          if (name === 'howto') this.showScreen('howto', true);
        }
        else {
          this.startBattle();
          this.cameraRig.setMode('duel', true);
          const b = this.battle!;
          this.clock = 1500;
          if (name === 'telegraph') {
            b.nextEnemyCast = this.clock;
            tick(b, this.clock, 0, this.rng);
            this.drainEvents();
            this.clock += WINDUP_MS * 0.45;
            settle(1);
          }
          if (name === 'casting') this.traceForTest('i');
          if (name === 'dictionary') this.toggleDictionary(true);
          if (name === 'paused') this.setPaused(true);
          if (name === 'win' || name === 'lose') {
            castSpell(b, name === 'win' ? 'player' : 'enemy', spells[4], 'a', 999, this.clock);
            this.drainEvents();
            settle(2.2);
            this.resultTimer = -1;
            this.showResult();
          }
        }
        this.updateBattleViewSafe();
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => { this.pausedForScreenshot = paused; },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        if (enabled) { this.babaylan.stabilize(); this.aswang.stabilize(); this.rival.stabilize(); }
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => this.debugTools.setHidden(hidden),
    };
    // bot playtests drive real pointer input; these only report where the outline is on screen
    window.__BAYBAY_TEST__ = {
      tracePath: () => this.pad.tracePath(),
      kudlitPoint: (vowel: 'i' | 'u') => this.pad.kudlitPoint(vowel),
    };
  }

  private updateBattleViewSafe(): void { if (this.battle) this.updateBattleView(0); }

  /** For the 'versus-play' capture: two real phone connections join the room, then the countdown runs out. */
  private async joinTestPlayers(versus: Versus): Promise<void> {
    for (const name of ['Ana', 'Ben']) {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/duel');
      this.testSockets.push(ws);
      await new Promise(resolve => { ws.onopen = resolve; });
      ws.send(JSON.stringify({ type: 'join', code: versus.code, name }));
    }
    const start = performance.now();
    while (this.screen !== 'battle' && performance.now() - start < 6000) await new Promise(r => setTimeout(r, 50));
    if (this.screen !== 'battle') throw new Error('versus-play: the duel did not start');
    this.cameraRig.setMode('versus', true); // capture the settled shot, not the move from the title
  }

  /** For the 'casting' capture: draws the selected slot's outline on the pad with synthetic pointer events. */
  private traceForTest(kudlit: 'i' | 'u' | null): void {
    const target = this.pad.ink;
    const fire = (type: string, [x, y]: [number, number]) => target.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: x, clientY: y }));
    for (const stroke of this.pad.tracePath()) {
      fire('pointerdown', stroke[0]);
      for (const p of stroke.slice(1)) fire('pointermove', p);
      fire('pointerup', stroke[stroke.length - 1]);
    }
    if (kudlit) { const p = this.pad.kudlitPoint(kudlit); fire('pointerdown', p); fire('pointerup', p); }
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info, b = this.battle;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      screen: this.screen,
      mode: this.mode,
      versus: this.versus ? { code: this.versus.code, phase: this.versus.state?.phase ?? null, hp: this.versus.state?.fighters.map(f => f?.hp ?? null) ?? [] } : null,
      resultIn: this.resultTimer,
      battle: b ? { clock: Math.round(this.clock), playerHp: b.player.hp, enemyHp: b.enemy.hp, enemyCasting: b.enemyCasting?.spell.id ?? null, winner: b.winner, slot: this.slot.id, enraged: b.enraged } : null,
      mastery: { ...this.mastery },
      audio: { state: this.audio.state, muted: this.audio.isMuted },
      renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures },
      canvas: {
        clientWidth: this.canvas.clientWidth, clientHeight: this.canvas.clientHeight, width: this.canvas.width, height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }
}
