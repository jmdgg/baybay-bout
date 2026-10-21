// The phone's sigil pad for "Duel a friend": join with the room code, then pick slots, trace and cast.
// It only sends what was drawn; the duel server on the host computer scores and applies it.
import '@fontsource/noto-sans-tagalog';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya/800.css';
import './pad.css';
import { ELEMENT, letterOf, spells, type Spell } from '../game/content';
import { DuelClient } from '../net/DuelClient';
import type { RoomState, ServerMessage } from '../net/protocol';
import { SigilPad } from '../systems/SigilPad';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SESSION = 'baybay-duel';

let me: 0 | 1 | null = null;
let slot: Spell = spells[0];
let state: RoomState | null = null;
let lastHp = Infinity;
let session: { code: string; token?: string; name?: string } | null = null;
try { session = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null'); } catch { session = null; }
const save = () => { try { sessionStorage.setItem(SESSION, JSON.stringify(session)); } catch { /* rejoin needs the code again */ } };

const pad = new SigilPad($('play'));
const levelOf = (s: Spell) => (me !== null && state?.fighters[me]?.mastery[spells.indexOf(s)]) || 0;

// --- slots ----------------------------------------------------------------------------------------------------
const slotButtons = spells.map((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'slot';
  b.setAttribute('aria-label', `Slot ${i + 1}: ${s.root}, ${s.name}`);
  b.style.borderColor = ELEMENT[s.element].color;
  b.innerHTML = `<span class="g" lang="tl-Tglg"></span><span class="r"></span><span class="pips"><i></i><i></i><i></i></span><span class="cd" hidden></span>`;
  b.querySelector('.g')!.textContent = s.glyph;
  b.querySelector('.r')!.textContent = s.root;
  b.addEventListener('click', () => select(s));
  $('slots').append(b);
  return b;
});

function select(s: Spell): void {
  slot = s;
  pad.show(letterOf(s), levelOf(s));
  slotButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(spells[i] === s)));
  feedback(['Trace ', { g: s.glyph }, ` (${s.root}). Tap above for -i, below for -u.`]);
}

function feedback(parts: (string | { g: string })[], target = $('feedback')): void {
  target.replaceChildren(...parts.map(p => typeof p === 'string' ? document.createTextNode(p)
    : Object.assign(document.createElement('span'), { className: 'gl', lang: 'tl-Tglg', textContent: p.g })));
}

// --- network ----------------------------------------------------------------------------------------------------
const client = new DuelClient(onMessage, () => { if (session?.code) client.send({ type: 'join', ...session }); });

$('join').addEventListener('submit', e => {
  e.preventDefault();
  session = { code: ($('code') as HTMLInputElement).value.trim().toUpperCase(), name: ($('name') as HTMLInputElement).value.trim() };
  $('join-error').textContent = '';
  client.send({ type: 'join', ...session });
});
if (session?.code) ($('code') as HTMLInputElement).value = session.code;

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'joined':
      me = msg.you;
      session = { code: msg.code, token: msg.token, name: msg.name };
      save();
      $('join').hidden = true;
      $('play').hidden = false;
      document.body.className = me === 0 ? 'p1' : 'p2';
      select(slot);
      break;
    case 'error':
      $('join-error').textContent = msg.message;
      if (me === null) { session = null; save(); }
      break;
    case 'closed':
      $('banner').textContent = msg.message;
      session = null;
      save();
      break;
    case 'state': render(msg); break;
    case 'attempt':
      if (msg.who !== me) feedback([`${state?.players[msg.who]?.name ?? 'Opponent'} cast `, { g: msg.glyph }, msg.fizzled ? ' (fizzled)' : ` · ${msg.effect}`], $('opponent'));
      break;
    case 'castResult':
      if (!msg.ok) {
        const why: Record<string, string> = { stunned: 'You are stunned! Your glyph is kept.', 'too small': 'Too small to read. Trace the whole outline.', 'not now': 'Wait for the duel to start.' };
        feedback([msg.reason === 'recharging' ? `${slot.root} is recharging (${((msg.waitMs ?? 0) / 1000).toFixed(1)} s). Your glyph is kept.` : why[msg.reason] ?? 'Could not cast that.']);
        if (!msg.keep) pad.clear();
        return;
      }
      feedback([{ g: msg.glyph }, ` ${msg.syllable} · ${msg.effect} · ${msg.accuracy}% · `, msg.fizzled ? 'fizzled, stay inside the outline' : `power ${msg.power}`]);
      pad.overlay(letterOf(slot).samples[0]);
      pad.clear(true);
      if (msg.nextLevel !== msg.level) pad.refreshGuide(letterOf(slot), msg.nextLevel);
      break;
  }
}

function render(s: RoomState): void {
  state = s;
  if (me === null) return;
  const them = me === 0 ? 1 : 0, mine = s.fighters[me], theirs = s.fighters[them];
  $('me-name').textContent = `P${me + 1} · ${s.players[me]?.name ?? ''}`;
  $('them-name').textContent = s.players[them] ? `P${them + 1} · ${s.players[them].name}` : 'Waiting for P' + (them + 1);
  $('me-fill').style.width = `${mine ? (mine.hp / mine.maxHp) * 100 : 100}%`;
  $('them-fill').style.width = `${theirs ? (theirs.hp / theirs.maxHp) * 100 : 100}%`;
  const status = (f: typeof mine) => f ? [f.shield > 0 && `Shield ${Math.round(f.shield)}`, f.burning && 'Burning', f.slowed && 'Slowed', f.stunned && 'Stunned'].filter(Boolean).join(' · ') : '';
  $('me-status').textContent = mine ? `${Math.ceil(mine.hp)} HP ${status(mine)}` : '';
  $('them-status').textContent = theirs ? `${Math.ceil(theirs.hp)} HP ${status(theirs)}` : '';
  if (mine && mine.hp < lastHp && lastHp !== Infinity) navigator.vibrate?.(60); // feel the hit on the phone
  lastHp = mine?.hp ?? Infinity;

  const banner: Record<RoomState['phase'], string> = {
    lobby: s.players.length < 2 ? 'Waiting for the other player to join…' : 'Waiting for both players…',
    countdown: `The duel begins in ${Math.ceil(s.countdownMs / 1000)}…`,
    battle: '',
    paused: 'Paused: a player lost connection.',
    over: s.winner === me ? 'Tagumpay! You win.' : 'You were defeated.',
  };
  $('banner').textContent = banner[s.phase];
  $('rematch').hidden = s.phase !== 'over';
  if (s.phase === 'over') ($('rematch') as HTMLButtonElement).textContent = s.rematch.includes(me) ? 'Waiting for the other player…' : 'Rematch';
  ($('cast') as HTMLButtonElement).disabled = s.phase !== 'battle';
  if (s.phase !== 'battle') lastHp = Infinity;

  slotButtons.forEach((b, i) => {
    const left = mine?.recharge[i] ?? 0, cd = b.querySelector<HTMLElement>('.cd')!;
    cd.hidden = left <= 0;
    cd.textContent = left > 0 ? (left / 1000).toFixed(1) : '';
    cd.style.setProperty('--cd', String(left / spells[i].rechargeMs));
    b.querySelectorAll('.pips i').forEach((pip, k) => pip.classList.toggle('on', k < (mine?.mastery[i] ?? 0)));
  });
}

$('cast').addEventListener('click', () => {
  if (!pad.strokes.length) return feedback(['Trace the glyph on the pad first.']);
  client.send({ type: 'cast', slot: spells.indexOf(slot), strokes: pad.strokes, durationMs: pad.duration });
});
$('undo').addEventListener('click', () => pad.undo());
$('clear').addEventListener('click', () => pad.clear());
$('rematch').addEventListener('click', () => client.send({ type: 'rematch' }));

// read-only helpers for scripted tests: where the outline is on screen
window.__BAYBAY_TEST__ = { tracePath: () => pad.tracePath(), kudlitPoint: v => pad.kudlitPoint(v) };
