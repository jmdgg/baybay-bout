// Drops the render resolution in steps when frames run slow (software WebGL, busy browser), so the duel stays playable.
// shortcut: it only steps down, never back up (a vsync-capped fps can't show headroom); a reload resets it.

const WINDOW_MS = 2000;    // judge the average over 2 s, so one hitch doesn't count
const SLOW_MS = 1000 / 45; // below ~45 fps on average
const STEP = 0.25;
export const MIN_DPR = 0.5;

export class AutoResolution {
  private spent = 0;
  private frames = 0;
  private last = -1;

  /** Feed the frame timestamp (ms); returns the new max pixel ratio (same as given while frames are fine). */
  update(nowMs: number, maxDpr: number, deviceDpr: number): number {
    const frameMs = this.last < 0 ? 0 : nowMs - this.last;
    this.last = nowMs;
    if (frameMs <= 0 || frameMs > 250) return maxDpr; // first frame, or the tab was hidden
    this.spent += frameMs;
    this.frames += 1;
    if (this.spent < WINDOW_MS) return maxDpr;
    const slow = this.spent / this.frames > SLOW_MS;
    this.spent = this.frames = 0;
    return slow ? Math.max(MIN_DPR, Math.min(deviceDpr, maxDpr) - STEP) : maxDpr;
  }
}
