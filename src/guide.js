// Tracing guide on its own canvas behind the ink: a hollow outline of the glyph, optionally replaying its stroke
// order in a loop. It lives on a separate canvas so the per-frame animation never erases the player's drawing.

const FILL = 0.7;        // the glyph fills the middle 70% of the canvas
const SPEED = 0.6;       // animation speed in canvas px per ms
const HOLD_MS = 500;     // pause with every stroke lit before the loop restarts
const GOLD = '232, 176, 74';

// Stroke types from the "Baybayin Character Strokes" typology the stroke orders were recorded against
export const STROKE_TYPES = {
  agos: 'flow: a wave drawn left to right',
  ilog: 'river: like a 3, top curve first',
  ulap: 'cloud: rises and falls twice, left to right',
  talon: 'falls: a downward arc',
  alon: 'wave: rises from the lower left, like a check mark',
  tulay: 'bridge: a straight bar, stem or arm',
  talsik: 'splash: a small decorative flourish at a stroke end',
};

// Outline help per mastery level: 0 = full outline + animation ... 3 = hidden, draw from memory
export const MASTERY = [
  { opacity: 1, animate: true },
  { opacity: 0.6, animate: true },
  { opacity: 0.3, animate: false },
  { opacity: 0, animate: false },
];

/** A clean cast (≥85%) fades the outline one step; a fizzle or a poor cast (<70%) brings it back one step. */
export function nextMastery(level, accuracy, power) {
  if (power > 0 && accuracy >= 85) return Math.min(level + 1, MASTERY.length - 1);
  if (!power || accuracy < 70) return Math.max(level - 1, 0);
  return level;
}

/** Maps template coordinates into the middle of the canvas (`to`) and back (`from`). */
export function fitToCanvas(template, canvas) {
  const pts = template.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const k = canvas.width * FILL / Math.max(w, h), cx = canvas.width / 2, cy = canvas.height / 2;
  return {
    to: ([px, py]) => [cx + (px - x - w / 2) * k, cy + (py - y - h / 2) * k],
    from: ([px, py]) => [(px - cx) / k + x + w / 2, (py - cy) / k + y + h / 2],
  };
}

const length = pts => pts.slice(1).reduce((d, p, i) => d + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** The first `len` px of a polyline. */
function partial(pts, len) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length && len > 0; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay);
    const t = Math.min(1, len / d);
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    len -= d;
  }
  return out;
}

export function createGuide(canvas) {
  const ctx = canvas.getContext('2d');
  let frame = 0;
  const line = (pts, color, width) => {
    Object.assign(ctx, { lineWidth: width, lineCap: 'round', lineJoin: 'round', strokeStyle: color });
    ctx.beginPath(); ctx.moveTo(...pts[0]); pts.forEach(p => ctx.lineTo(...p)); ctx.stroke();
  };
  const outline = (lanes, a) => {
    ctx.save();
    lanes.forEach(s => line(s, `rgba(${GOLD}, ${0.5 * a})`, 34));
    ctx.globalCompositeOperation = 'destination-out'; // cut the middle out so only the outline edges remain
    lanes.forEach(s => line(s, '#000', 28));
    ctx.globalCompositeOperation = 'source-over';
    lanes.forEach(s => line(s, `rgba(${GOLD}, ${0.08 * a})`, 28));
    ctx.restore();
  };
  const marker = ([x, y], n, a) => {
    Object.assign(ctx, { fillStyle: `rgba(${GOLD}, ${a})`, font: 'bold 12px system-ui', textAlign: 'center', textBaseline: 'middle' });
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b1410'; ctx.fillText(n, x, y + 0.5);
  };

  return {
    /**
     * order: [{ type, points }] in template coordinates; without it only the outline shows.
     * @param {number[][][]} template
     * @param {{ opacity?: number, order?: { type: string, points: number[][] }[] | null, animate?: boolean }} [options]
     */
    show(template, { opacity = 1, order = null, animate = false } = {}) {
      cancelAnimationFrame(frame);
      const { to } = fitToCanvas(template, canvas);
      const lanes = template.map(s => s.map(to));
      const steps = (animate && order || []).map(o => ({ type: o.type, pts: o.points.map(to) }));
      steps.forEach(s => s.len = length(s.pts));
      const loopMs = steps.reduce((d, s) => d + s.len, 0) / SPEED + HOLD_MS;
      const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const draw = now => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!opacity) return;
        outline(lanes, opacity);
        let progress = still ? Infinity : (now % loopMs) * SPEED; // px drawn so far this loop
        steps.forEach((s, i) => {
          if (progress > 0) {
            const lit = partial(s.pts, Math.min(progress, s.len));
            line(lit, `rgba(255, 224, 150, ${0.9 * opacity})`, 6);
            if (progress < s.len) line([lit.at(-1)], `rgba(255, 255, 255, ${opacity})`, 12); // the moving pen tip
          }
          marker(s.pts[0], i + 1, opacity);
          progress -= s.len;
        });
        if (steps.length && !still) frame = requestAnimationFrame(draw);
      };
      draw(performance.now());
    },
    hide() { cancelAnimationFrame(frame); ctx.clearRect(0, 0, canvas.width, canvas.height); },
  };
}
