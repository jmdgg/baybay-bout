// Baybayin gesture capture + $P point-cloud recognizer (Vatavu, Anthony & Wobbrock 2012).
// $P ignores stroke order/direction, which suits multi-stroke Baybayin glyphs.
// Points are [x, y] everywhere so a recorded drawing can be used directly as a template sample.

const N = 32;            // points per normalized cloud
const MARK_RATIO = 0.2;  // a stroke smaller than 20% of the drawing is a kudlit, not part of the glyph
// Cloud distance that maps to 0% accuracy. 3.5 puts the 60% fizzle line at distance 1.4: typical neat/normal/sloppy
// drawings land at 0.5/0.7/1.2, random scribbles at ~1.8.
// shortcut: calibrated on synthetic drawings, re-measure with real players' drawings
const MAX_DIST = 3.5;
const AMBIGUITY_MARGIN = 12; // best letter must beat the next-best by this many points (distance 0.4); fewer = more misreads
const INK = '#e8b04a';

/** options.ink: stroke colour (contrast it with any guide drawn underneath). */
export function createRecorder(canvas, { ink = INK } = {}) {
  const ctx = canvas.getContext('2d');
  let strokes = [], current = null, pointerId = null, startedAt = 0, endedAt = 0;
  canvas.style.touchAction = 'none'; // stop touch drawing from scrolling the page

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
  };
  const paint = (stroke, color = ink, width = 6) => {
    Object.assign(ctx, { lineWidth: width, lineCap: 'round', lineJoin: 'round', strokeStyle: color, fillStyle: color });
    ctx.beginPath(); ctx.arc(...stroke[0], width / 2, 0, Math.PI * 2); ctx.fill(); // taps (kudlit dots) stay visible
    ctx.beginPath(); ctx.moveTo(...stroke[0]); stroke.forEach(p => ctx.lineTo(...p)); ctx.stroke();
  };
  const wipe = () => ctx.clearRect(0, 0, canvas.width, canvas.height);

  canvas.addEventListener('pointerdown', e => {
    if (current) return; // ignore a second finger mid-stroke
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointers can't be captured; drawing still works */ }
    pointerId = e.pointerId;
    if (!strokes.length) { startedAt = performance.now(); wipe(); } // a new glyph wipes the last cast's picture
    current = [pos(e)];
    strokes.push(current);
    paint(current);
  });
  canvas.addEventListener('pointermove', e => {
    if (!current || e.pointerId !== pointerId) return;
    const p = pos(e), last = current.at(-1);
    current.push(p);
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
  });
  const end = e => {
    if (!current || e.pointerId !== pointerId) return;
    current = null;
    endedAt = performance.now();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    get strokes() { return strokes; },
    get duration() { return endedAt - startedAt; }, // first touch to last lift, excludes the wait before Cast
    /** keepInk: forget the strokes but leave the picture until the next glyph starts */
    clear(keepInk = false) { strokes = []; if (!keepInk) wipe(); },
    undo() { strokes.pop(); wipe(); strokes.forEach(s => paint(s)); },
    /** Draws a template over the player's glyph, fitted to the same box, so they see where they were off. */
    overlay(template) {
      const drawn = splitKudlit(strokes);
      if (!drawn) return;
      const t = bounds(template.flat()), d = bounds(drawn.glyph.flat());
      const k = Math.max(d.w, d.h) / Math.max(t.w, t.h);
      const fit = ([x, y]) => [d.x + d.w / 2 + (x - t.x - t.w / 2) * k, d.y + d.h / 2 + (y - t.y - t.h / 2) * k];
      template.forEach(s => paint(s.map(fit), 'rgba(110, 220, 140, 0.55)', 10));
    },
  };
}

/**
 * Finds which letter was drawn. Player samples (`letter.mine`) help pick the letter,
 * but accuracy is always scored against the font samples, so teaching a sloppy form can't inflate power.
 * Returns null if nothing glyph-sized was drawn; sets `ambiguous` when two letters score too close to call.
 */
export function recognize(strokes, letters) {
  const drawn = splitKudlit(strokes);
  if (!drawn) return null;
  const cloud = normalize(drawn.glyph);
  const score = samples => Math.max(...samples.map(s => toAccuracy(greedyCloudMatch(cloud, normalize(splitKudlit(s).glyph)))));
  const [best, second] = letters
    .map(letter => ({ letter, fit: score([...letter.samples, ...(letter.mine || [])]) }))
    .sort((a, b) => b.fit - a.fit);
  const { letter } = best;
  const vowel = letter.root.length === 1 ? null : drawn.vowel; // vowel letters A, I, U take no kudlit
  return {
    letter,
    vowel,
    syllable: vowel ? letter.root.slice(0, -1) + vowel : letter.root,
    glyph: letter.glyph + ({ i: 'ᜒ', u: 'ᜓ' }[vowel] || ''),
    accuracy: score(letter.samples),
    runnerUp: second?.letter,
    ambiguous: !!second && best.fit - second.fit < AMBIGUITY_MARGIN,
  };
}

/** Separates the glyph strokes from a kudlit. Returns null if there is no glyph-sized drawing. */
export function splitKudlit(strokes) {
  if (!strokes.length) return null;
  const all = bounds(strokes.flat()), size = Math.max(all.w, all.h);
  if (size < 10) return null; // a lone tap or scribble too small to read
  const small = s => { const b = bounds(s); return Math.max(b.w, b.h) < size * MARK_RATIO; };
  const big = strokes.filter(s => !small(s));
  if (!big.length) return null; // only taps, no glyph to match

  // a small stroke is a kudlit only if it sits in the top or bottom quarter of the glyph or beyond it;
  // a small stroke in the middle is part of the glyph (a hook, a short bar)
  const g = bounds(big.flat());
  const band = s => { const b = bounds(s), cy = b.y + b.h / 2; return cy < g.y + g.h / 4 ? 'i' : cy > g.y + g.h * 3 / 4 ? 'u' : null; };
  const marks = strokes.filter(s => small(s) && band(s));
  // a kudlit drawn as a star or cross: medium strokes crossing a kudlit stroke belong to it, not to the glyph
  const overlaps = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  const medium = s => { const b = bounds(s); return Math.max(b.w, b.h) < size * MARK_RATIO * 2; };
  for (const s of strokes) if (!marks.includes(s) && medium(s) && marks.some(m => overlaps(bounds(s), bounds(m)))) marks.push(s);
  return { glyph: strokes.filter(s => !marks.includes(s)), vowel: marks.length ? band(marks[0]) : 'a' };
}

const toAccuracy = d => Math.round(Math.max(0, 1 - d / MAX_DIST) * 100);

export function normalize(strokes) {
  const pts = resample(strokes.flatMap((s, id) => s.map(([x, y]) => [x, y, id])));
  const b = bounds(pts), s = Math.max(b.w, b.h) || 1;
  const cx = pts.reduce((a, p) => a + p[0], 0) / N, cy = pts.reduce((a, p) => a + p[1], 0) / N;
  return pts.map(([x, y, id]) => [(x - cx) / s, (y - cy) / s, id]);
}

function resample(pts) {
  const I = pathLength(pts) / (N - 1);
  const out = [pts[0]];
  let D = 0;
  for (let i = 1; i < pts.length; i++) {
    const [px, py, pid] = pts[i - 1], [x, y, id] = pts[i];
    if (id !== pid) continue; // never interpolate across the gap between strokes
    const d = Math.hypot(x - px, y - py);
    if (D + d >= I) {
      const t = (I - D) / d, q = [px + t * (x - px), py + t * (y - py), id];
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < N) out.push(pts.at(-1)); // float rounding can leave us one short
  return out.slice(0, N);
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++)
    if (pts[i][2] === pts[i - 1][2]) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

function greedyCloudMatch(a, b) {
  const step = Math.floor(Math.sqrt(N));
  let min = Infinity;
  for (let i = 0; i < N; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  return min;
}

function cloudDistance(a, b, start) {
  const matched = new Array(N).fill(false);
  let sum = 0, i = start;
  do {
    let min = Infinity, idx = 0;
    for (let j = 0; j < N; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(a[i][0] - b[j][0], a[i][1] - b[j][1]);
      if (d < min) { min = d; idx = j; }
    }
    matched[idx] = true;
    sum += (1 - ((i - start + N) % N) / N) * min; // earlier matches weigh more
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}

function bounds(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
