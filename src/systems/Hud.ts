// Battle HUD: fighter cards, skill slots, incoming telegraph, feedback line, toasts and floating numbers.
import { ELEMENT, type Spell } from '../game/content';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** hp: percent of max (bar width); hpValue: the actual number shown. */
export interface FighterView { hp: number; hpValue: number; shield: number; burning: boolean; slowed: boolean; stunned: boolean; enraged?: boolean }
export interface SlotView { selected: boolean; recharge: number; rechargeLeftMs: number; level: number }

export class Hud {
  private readonly slots: HTMLButtonElement[] = [];
  private readonly chipCache = { player: '', enemy: '' };
  private incomingKey = '';

  constructor(spells: Spell[], onSelect: (spell: Spell) => void) {
    const nav = $('slots');
    spells.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.setAttribute('aria-pressed', 'false');
      b.style.setProperty('--el', ELEMENT[s.element].color);
      b.setAttribute('aria-label', `Slot ${i + 1}: ${s.root}, ${s.name}`);
      b.innerHTML = `<span class="key">${i + 1}</span><span class="el"></span><span class="g" lang="tl-Tglg"></span>
        <span class="nm"></span><span class="fx"></span><span class="pips"><i></i><i></i><i></i></span><span class="cd"></span>`;
      b.querySelector('.g')!.textContent = s.glyph;
      b.querySelector('.nm')!.textContent = `${s.root} · ${ELEMENT[s.element].label}`;
      b.querySelector('.fx')!.textContent = `${s.variations.a.effect} · i ${s.variations.i.effect} · u ${s.variations.u.effect}`;
      b.addEventListener('click', () => onSelect(s));
      nav.append(b);
      this.slots.push(b);
    });
  }

  setSlots(views: SlotView[]): void {
    views.forEach((v, i) => {
      const b = this.slots[i];
      b.setAttribute('aria-pressed', String(v.selected));
      b.classList.toggle('recharging', v.rechargeLeftMs > 0);
      b.style.setProperty('--cd', v.recharge.toFixed(3));
      const cd = b.querySelector('.cd')!;
      const text = v.rechargeLeftMs > 0 ? (v.rechargeLeftMs / 1000).toFixed(1) : '';
      if (cd.textContent !== text) cd.textContent = text;
      b.querySelectorAll('.pips i').forEach((pip, k) => pip.classList.toggle('on', k < v.level));
    });
  }

  fighter(who: 'player' | 'enemy', f: FighterView): void {
    const pct = `${Math.max(0, f.hp)}%`;
    $(`${who}-fill`).style.width = pct;
    $(`${who}-trail`).style.width = pct;
    $(`${who}-hp-num`).textContent = String(Math.ceil(f.hpValue));
    const chips: [string, string][] = [];
    if (f.shield > 0) chips.push(['shield', `Shield ${Math.round(f.shield)}`]);
    if (f.burning) chips.push(['burn', 'Burning']);
    if (f.slowed) chips.push(['slow', 'Slowed']);
    if (f.stunned) chips.push(['stun', 'Stunned']);
    if (f.enraged) chips.push(['enraged', 'Enraged']);
    const key = chips.map(c => c.join(':')).join('|');
    if (key === this.chipCache[who]) return;
    this.chipCache[who] = key;
    $(`${who}-chips`).replaceChildren(...chips.map(([cls, text]) => Object.assign(document.createElement('li'), { className: cls, textContent: text })));
  }

  /** The Aswang's telegraphed spell; null hides it. Only the glyph is shown, so the player has to read it. */
  incoming(info: { glyph: string; syllable: string; color: string; progress: number; seconds: number } | null): void {
    const box = $('incoming');
    box.classList.toggle('on', !!info);
    if (!info) { this.incomingKey = ''; return; }
    if (this.incomingKey !== info.glyph + info.color) { // announce once per spell, not every frame
      this.incomingKey = info.glyph + info.color;
      $('incoming-glyph').textContent = info.glyph;
      $('incoming-sr').textContent = `Aswang casts ${info.syllable}`;
      $('incoming-ring').style.setProperty('--warn', info.color);
    }
    $('incoming-ring').style.setProperty('--p', info.progress.toFixed(3));
    $('incoming-time').textContent = `Incoming ${info.seconds.toFixed(1)} s`;
  }

  /** Feedback line: parts are plain text, `{g:…}` parts render as Baybayin. */
  feedback(parts: (string | { g: string })[]): void {
    $('feedback').replaceChildren(...parts.map(p => typeof p === 'string' ? document.createTextNode(p)
      : Object.assign(document.createElement('span'), { className: 'gl', lang: 'tl-Tglg', textContent: p.g })));
  }

  /** "Duel a friend": each player's last cast under their card (glyph parts render as Baybayin). */
  lastCast(who: 'player' | 'enemy', parts: (string | { g: string })[]): void {
    document.getElementById(`${who}-last`)!.replaceChildren(...parts.map(p => typeof p === 'string' ? document.createTextNode(p)
      : Object.assign(document.createElement('span'), { className: 'gl', lang: 'tl-Tglg', textContent: p.g })));
  }

  toast(text: string, bad = false): void {
    const t = Object.assign(document.createElement('div'), { className: `toast${bad ? ' bad' : ''}`, textContent: text });
    $('toasts').append(t);
    setTimeout(() => t.remove(), 1700);
  }

  number(x: number, y: number, text: string, cls: string): void {
    const n = Object.assign(document.createElement('div'), { className: `num ${cls}`, textContent: text });
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    $('numbers').append(n);
    setTimeout(() => n.remove(), 950);
  }

  clearTransient(): void {
    $('toasts').replaceChildren();
    $('numbers').replaceChildren();
    this.incoming(null);
  }
}
