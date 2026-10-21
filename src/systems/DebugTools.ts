import GUI from 'lil-gui';

export type DebugTuning = {
  exposure: number;
  maxDpr: number;
};

/** Live tuning panel, only with ?debug in the URL (never shown in normal play or builds without it). */
export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Baybay-Bout tuning' });
    this.gui.add(tuning, 'maxDpr', 0.5, 2, 0.25).onChange(onChange).listen(); // listen: the auto drop changes it too
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
