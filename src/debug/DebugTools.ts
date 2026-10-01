/** lil-gui tuning panel, shown only when the URL has ?debug. */
import GUI from 'lil-gui';

export interface DebugTuning {
  exposure: number;
  maxDpr: number;
  /** Share of the screen's pixel density rendered before the maxDpr cap. */
  renderScale: number;
  showStats: boolean;
}

export class DebugTools {
  readonly enabled = new URLSearchParams(window.location.search).has('debug');
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    if (!this.enabled) return;
    this.gui = new GUI({ title: 'Tiny Town tuning' });
    this.gui.add(tuning, 'exposure', 0.4, 2, 0.01).onChange(onChange);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'renderScale', 0.5, 1, 0.05).onChange(onChange);
  }

  /** A sub-folder for a system's own tunables, or null when debug is off. */
  folder(name: string): GUI | null {
    return this.gui ? this.gui.addFolder(name) : null;
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
