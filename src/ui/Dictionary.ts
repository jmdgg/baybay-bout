// The togglable dictionary: the 5 castable glyphs with their kudlit forms, effects, lore and a looping stroke order.
import { createGuide } from '../guide.js';
import { ELEMENT, glyphWith, letterOf, syllable, type Spell, type Vowel } from '../game/content';

const VOWEL_LABEL: Record<Vowel, string> = { a: 'no kudlit', i: 'kudlit above', u: 'kudlit below' };

export class Dictionary {
  private readonly root = document.getElementById('dictionary')!;
  private readonly guides: { guide: ReturnType<typeof createGuide>; spell: Spell }[] = [];

  constructor(spells: Spell[], private readonly onClose: () => void) {
    const list = document.getElementById('dict-entries')!;
    for (const s of spells) {
      const entry = document.createElement('article');
      entry.className = 'entry';
      entry.style.setProperty('--el', ELEMENT[s.element].color);
      const canvas = Object.assign(document.createElement('canvas'), { width: 220, height: 220, className: 'anim' });
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Stroke order of ${s.root}`);
      const rows = (['a', 'i', 'u'] as Vowel[]).map(v => {
        const variation = s.variations[v];
        return `<tr><td class="g" lang="tl-Tglg">${glyphWith(s, v)}</td><td class="r">${syllable(s, v)}</td>
          <td>${variation.effect}${variation.baseDamage ? ` ${variation.baseDamage}` : ''}<br><small>${VOWEL_LABEL[v]}</small></td></tr>`;
      }).join('');
      entry.innerHTML = `<div class="elname"></div><h3></h3><table>${rows}</table><p class="lore"></p>`;
      entry.prepend(canvas);
      entry.querySelector('.elname')!.textContent = `${ELEMENT[s.element].label} · ${s.root}`;
      entry.querySelector('h3')!.textContent = s.name;
      entry.querySelector('.lore')!.textContent = s.lore;
      list.append(entry);
      this.guides.push({ guide: createGuide(canvas), spell: s });
    }
    this.root.querySelector('.close')!.addEventListener('click', () => this.onClose());
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(): void {
    this.root.hidden = false;
    for (const { guide, spell } of this.guides) {
      const letter = letterOf(spell);
      guide.show(letter.samples[0], { opacity: 1, order: letter.order, animate: true });
    }
    (this.root.querySelector('.close') as HTMLButtonElement).focus();
  }

  close(): void {
    this.root.hidden = true;
    for (const { guide } of this.guides) guide.hide(); // stop the animation loops while hidden
  }
}
