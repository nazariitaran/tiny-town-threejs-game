/**
 * Hands-free controls (experimental, `?gestures`): a camera, MediaPipe in a worker, an interpreter for
 * the chosen mode and a router that acts like a mouse. Owns its own small DOM (a toggle, a panel with
 * the camera preview, the cursor) above the game UI. Loaded lazily: without the flag none of it, and
 * none of MediaPipe, is fetched.
 *
 * The panel works hands-free too: only buttons (dwell or a face click presses them), no selects or sliders.
 *
 * URL: `?gestures` (hand mode), `?gestures=head`, `?gestures=head-hand`; add `,cpu` to skip the GPU delegate.
 */
import type { GameBus, HandsFreeMode } from '../game/events';
import { isEditableTarget } from '../interaction/keyboard';
import {
  ALLOWED_ACTIONS,
  clampTiming,
  effectiveBindings,
  FACE_TRIGGERS,
  isEyeTrigger,
  loadSettings,
  lockedReason,
  nextAction,
  pauseTrigger,
  PRESET_IDS,
  PRESETS,
  presetOf,
  saveSettings,
  SENSITIVITY_LIMITS,
  TIMING_LIMITS,
  type Bindings,
  type FaceTrigger,
  type HandsFreeSettings,
  type PresetId,
  type Timing,
  type TriggerAction,
} from './bindings';
import { EyeTest, isCalibrated, type EyeTestStep } from './eyeTriggers';
import { GestureRouter } from './GestureRouter';
import { DEFAULT_HAND_TUNING, HandInterpreter } from './handInterpreter';
import { HeadInterpreter } from './headInterpreter';
import { isTrackingMode, type Delegate, type GestureFrame, type TrackFrame, type TrackingMode } from './protocol';
import { downloadTrack, TrackRecorder } from './recorder';
import { Tracker, type TrackerStatus } from './Tracker';
import './handsFree.css';

export const HF_IDS = {
  root: 'hf-root',
  toggle: 'hf-toggle',
  panel: 'hf-panel',
  start: 'hf-start',
  status: 'hf-status',
  alert: 'hf-alert',
  cursor: 'hf-cursor',
  recentre: 'hf-recentre',
  dwell: 'hf-dwell',
  close: 'hf-close',
  bindings: 'hf-bindings',
  timing: 'hf-timing',
  eyeTest: 'hf-eye-test',
  eyeTestText: 'hf-eye-test-text',
  eyeTestStart: 'hf-eye-test-start',
  eyeTestCancel: 'hf-eye-test-cancel',
  setKey: 'hf-set-key',
  record: 'hf-record',
  recordStatus: 'hf-record-status',
  mode: (mode: TrackingMode) => `hf-mode-${mode}`,
  preset: (preset: PresetId) => `hf-preset-${preset}`,
  bind: (trigger: FaceTrigger) => `hf-bind-${trigger}`,
  winkTest: (side: 'left' | 'right') => `hf-wink-test-${side}`,
} as const;

const MODE_LABEL: Record<TrackingMode, string> = { hand: 'Hand', head: 'Head', 'head-hand': 'Head + hand' };

const HAND_LEGEND = [
  'Point with your hand: the cursor follows the gap between thumb and index finger',
  'Pinch thumb and index together to click; hold the pinch to drag (roads, fences)',
  'Make a fist and move it to drag the map; two fists apart / together to zoom',
  'Hold ✌ to rotate · hold 👎 for Esc (put back, put away, close)',
];

const PRESET_LABEL: Record<PresetId, string> = { 'low-effort': 'Low effort', classic: 'Classic' };

const TRIGGER_LABEL: Record<FaceTrigger, string> = {
  blink: 'Slow blink',
  'long-blink': 'Long blink',
  'wink-left': 'Wink left',
  'wink-right': 'Wink right',
  mouth: 'Open mouth',
  brows: 'Eyebrows up',
  smile: 'Smile',
  key: 'Key',
};

const ACTION_LABEL: Record<TriggerAction, string> = {
  off: 'Off',
  click: 'Click',
  hold: 'Hold to drag',
  'drag-toggle': 'Drag on / off',
  rotate: 'Rotate',
  cancel: 'Esc',
  pause: 'Pause',
  recentre: 'Re-centre',
};

/** "… to click" for the legend. */
const ACTION_PHRASE: Record<TriggerAction, string> = {
  off: '',
  click: 'to click',
  hold: 'to click; keep it up to drag (roads, fences)',
  'drag-toggle': 'to start a drag (roads, fences); again to end it',
  rotate: 'to rotate',
  cancel: 'for Esc (put back, put away, close)',
  pause: 'to pause hands-free, and again to resume',
  recentre: 'to re-centre the pointer',
};

const HAND_GLYPH =
  '<svg class="hf-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5"/><path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.5-1.7L8 15"/></svg>';

/** MediaPipe's hand skeleton, for the preview. */
const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const STATUS_TEXT: Record<TrackerStatus, string> = {
  off: 'Camera off',
  camera: 'Waiting for the camera…',
  loading: 'Loading the tracking model…',
  tracking: '',
  error: '',
};

/** Panel text, meters and test attributes refresh at this rate, not per tracking frame. */
const STATUS_INTERVAL_MS = 150;

type Stepper = keyof Timing | 'sensitivity';

const STEPPER_LABEL: Record<Stepper, string> = {
  sensitivity: 'Sensitivity',
  blinkMinS: 'Slow blink',
  pauseS: 'Long blink',
  dwellS: 'Rest to press',
};

function parseFlag(value: string | null): { mode: TrackingMode; delegate: Delegate } {
  const tokens = (value ?? '').split(',').map((token) => token.trim());
  const mode = tokens.find(isTrackingMode) ?? 'hand';
  return { mode, delegate: tokens.includes('cpu') ? 'CPU' : 'GPU' };
}

/** `KeyboardEvent.code` → a short name ("KeyJ" → "J"). */
function keyName(code: string): string {
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ').replace(/^Arrow/, '') || code;
}

export class HandsFree {
  private readonly root = document.createElement('div');
  private readonly tracker = new Tracker();
  private readonly hand = new HandInterpreter();
  /** Head + hand: the click comes from whichever hand pinches. */
  private readonly clickHand = new HandInterpreter({ ...DEFAULT_HAND_TUNING, pick: 'pinch' });
  private readonly head = new HeadInterpreter();
  private readonly router: GestureRouter;
  private mode: TrackingMode;
  private readonly delegate: Delegate;
  private readonly preview: HTMLCanvasElement;
  private readonly previewContext: CanvasRenderingContext2D | null;
  private readonly cursor: HTMLElement;
  private readonly settings: HandsFreeSettings = loadSettings();
  private readonly bindings: Bindings = { ...this.settings.bindings };
  private eyeTest: EyeTest | null = null;
  private eyeTestText = '';
  private capturingKey = false;
  /** The mode last announced on `hands-free:changed` (undefined: nothing yet). */
  private announced: HandsFreeMode | null | undefined = undefined;
  /** A mode change is restarting the camera: don't announce the stop in between. */
  private restarting = false;
  private lastStatusMs = 0;
  /** Refreshes the panel while the camera is on, also between results (a stalled or slow worker shows). */
  private statusTimer = 0;
  private lastFrame: GestureFrame | null = null;
  private lastT = 0;
  /** A session being saved to a file (Record / Stop and save). */
  private recorder: TrackRecorder | null = null;

  constructor(
    private readonly bus: GameBus,
    canvas: HTMLCanvasElement,
    flag: string | null,
  ) {
    const { mode, delegate } = parseFlag(flag);
    this.mode = mode;
    this.delegate = delegate;
    this.router = new GestureRouter(bus, canvas);
    this.root.id = HF_IDS.root;
    this.root.className = 'hf-root';
    this.root.innerHTML = this.template();
    document.body.append(this.root);
    this.preview = this.el<HTMLCanvasElement>('hf-preview-canvas');
    this.previewContext = this.preview.getContext('2d');
    this.cursor = this.el(HF_IDS.cursor);
    this.el('hf-preview').prepend(this.tracker.video);
    this.tracker.video.className = 'hf-video';
    this.head.tuning.sensitivity = this.settings.sensitivity;
    this.applyEyeTiming();

    this.tracker.onFrame = (frame) => this.onFrame(frame);
    this.tracker.onStatus = (status) => this.onStatus(status);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('toggle', this.onToggle, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.setPanelOpen(true);
    this.renderMode();
    this.onStatus('off');
  }

  dispose(): void {
    window.clearInterval(this.statusTimer);
    this.tracker.stop();
    this.router.release();
    this.announce(null);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('toggle', this.onToggle, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.root.remove();
  }

  private template(): string {
    const modes = (Object.keys(MODE_LABEL) as TrackingMode[])
      .map((m) => `<button type="button" class="hf-mode" id="${HF_IDS.mode(m)}" data-mode="${m}" aria-pressed="false">${MODE_LABEL[m]}</button>`)
      .join('');
    const presets = PRESET_IDS.map((p) => `<button type="button" class="hf-mode" id="${HF_IDS.preset(p)}" data-preset="${p}" aria-pressed="false">${PRESET_LABEL[p]}</button>`).join('');
    const rows = FACE_TRIGGERS.map(
      (trigger) => `
        <div class="hf-bind" data-trigger="${trigger}">
          <span class="hf-bind-name" id="hf-bind-name-${trigger}">${TRIGGER_LABEL[trigger]}</span>
          <i class="hf-meter" aria-hidden="true"><b data-meter="${trigger}"></b></i>
          <button type="button" class="hf-cycle" id="${HF_IDS.bind(trigger)}" data-bind="${trigger}" aria-describedby="hf-bind-name-${trigger}"></button>
        </div>`,
    ).join('');
    return `
      <button type="button" class="hf-toggle" id="${HF_IDS.toggle}" aria-expanded="true" aria-controls="${HF_IDS.panel}" title="Hands-free controls (experimental)">${HAND_GLYPH}<span>Hands-free</span><i class="hf-live" aria-hidden="true"></i></button>
      <section class="hf-panel" id="${HF_IDS.panel}" aria-label="Hands-free controls">
        <header class="hf-head">
          <h2>Hands-free <span class="hf-badge">Experimental</span></h2>
          <button type="button" class="hf-icon" id="${HF_IDS.close}" aria-label="Hide the panel" title="Hide the panel">×</button>
        </header>
        <div class="hf-modes" role="group" aria-label="Mode">${modes}</div>
        <div class="hf-preview" id="hf-preview"><canvas id="hf-preview-canvas" width="320" height="240" aria-hidden="true"></canvas><p class="hf-status" id="${HF_IDS.status}" aria-live="polite"></p></div>
        <button type="button" class="hf-btn hf-btn-primary" id="${HF_IDS.start}">Start camera</button>
        <p class="hf-alert" id="${HF_IDS.alert}" role="status" aria-live="polite" hidden></p>
        <div class="hf-head-tools">
          <div class="hf-presets" role="group" aria-label="Preset"><span class="hf-label">Preset</span>${presets}</div>
          ${this.stepper('sensitivity')}
          <div class="hf-pair">
            <button type="button" class="hf-btn" id="${HF_IDS.recentre}">Re-centre</button>
            <button type="button" class="hf-btn hf-switch" id="${HF_IDS.dwell}" aria-pressed="true">Rest to press</button>
          </div>
        </div>
        <details class="hf-section hf-legend" open><summary>Gestures</summary><ul id="hf-legend"></ul></details>
        <details class="hf-section hf-head-only" id="${HF_IDS.bindings}"><summary>Bindings</summary>
          <div class="hf-binds">${rows}</div>
          <p class="hf-small" id="hf-bind-note" hidden></p>
          <div class="hf-pair"><span class="hf-small" id="hf-key-name"></span><button type="button" class="hf-btn" id="${HF_IDS.setKey}">Set key</button></div>
        </details>
        <details class="hf-section hf-head-only" id="${HF_IDS.timing}"><summary>Timing</summary>
          ${this.stepper('blinkMinS')}${this.stepper('pauseS')}${this.stepper('dwellS')}
        </details>
        <details class="hf-section hf-head-only" id="${HF_IDS.eyeTest}"><summary>Eye test</summary>
          <p class="hf-small" id="${HF_IDS.eyeTestText}" aria-live="polite"></p>
          <i class="hf-progress" aria-hidden="true"><b id="hf-eye-test-progress"></b></i>
          <div class="hf-pair">
            <button type="button" class="hf-btn" id="${HF_IDS.eyeTestStart}">Start eye test</button>
            <button type="button" class="hf-btn" id="${HF_IDS.eyeTestCancel}" hidden>Cancel</button>
          </div>
          <div class="hf-pair">
            <button type="button" class="hf-btn" id="${HF_IDS.winkTest('left')}" data-wink="left">Left wink</button>
            <button type="button" class="hf-btn" id="${HF_IDS.winkTest('right')}" data-wink="right">Right wink</button>
          </div>
        </details>
        <div class="hf-pair"><button type="button" class="hf-btn" id="${HF_IDS.record}" disabled>Record 30 s</button><span class="hf-small" id="${HF_IDS.recordStatus}" aria-live="polite"></span></div>
        <p class="hf-note">Runs on this device with Google MediaPipe. The camera picture never leaves your browser. A recording holds only tracking numbers, never pictures, and stays on the device unless you share it.</p>
      </section>
      <div class="hf-cursor" id="${HF_IDS.cursor}" hidden><i class="hf-ring"></i><i class="hf-dot"></i></div>
    `;
  }

  private stepper(id: Stepper): string {
    return `<div class="hf-stepper" data-stepper="${id}"><span class="hf-label" id="hf-step-label-${id}">${STEPPER_LABEL[id]}</span>
      <button type="button" class="hf-step" data-step="${id}" data-dir="-1" data-repeat aria-label="Less: ${STEPPER_LABEL[id]}">−</button>
      <output id="hf-step-${id}" aria-labelledby="hf-step-label-${id}"></output>
      <button type="button" class="hf-step" data-step="${id}" data-dir="1" data-repeat aria-label="More: ${STEPPER_LABEL[id]}">+</button></div>`;
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.root.querySelector<T>(`#${id}`)!;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    const data = button.dataset;
    if (button.id === HF_IDS.toggle) this.setPanelOpen(this.root.dataset.panel === 'closed');
    else if (button.id === HF_IDS.close) this.setPanelOpen(false);
    else if (button.id === HF_IDS.start) {
      if (this.tracker.status === 'off' || this.tracker.status === 'error') void this.start();
      else this.stop();
    } else if (button.id === HF_IDS.recentre) this.head.recalibrate();
    else if (button.id === HF_IDS.dwell) this.update(() => (this.settings.dwell = !this.settings.dwell));
    else if (button.id === HF_IDS.setKey) this.setCapturingKey(!this.capturingKey);
    else if (button.id === HF_IDS.record) this.toggleRecording();
    else if (button.id === HF_IDS.eyeTestStart) this.startEyeTest('open');
    else if (button.id === HF_IDS.eyeTestCancel) this.endEyeTest('Eye test cancelled. Nothing was changed.');
    else if (data.wink === 'left' || data.wink === 'right') this.startEyeTest(data.wink === 'left' ? 'wink-left' : 'wink-right');
    else if (data.mode && isTrackingMode(data.mode)) this.setMode(data.mode);
    else if (data.preset && (PRESET_IDS as readonly string[]).includes(data.preset)) this.update(() => Object.assign(this.settings.bindings, PRESETS[data.preset as PresetId]));
    else if (data.bind && (FACE_TRIGGERS as readonly string[]).includes(data.bind)) {
      const trigger = data.bind as FaceTrigger;
      this.update(() => (this.settings.bindings[trigger] = nextAction(trigger, this.settings.bindings[trigger])));
    } else if (data.step) this.step(data.step as Stepper, Number(data.dir));
  };

  /** One section of the panel open at a time, so it stays short enough to reach every button without scrolling. */
  private readonly onToggle = (event: Event): void => {
    const opened = event.target;
    if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
    for (const details of this.root.querySelectorAll<HTMLDetailsElement>('details.hf-section')) {
      if (details !== opened) details.open = false;
    }
    // The panel scrolls on short screens, and a head can't scroll it: bring the opened section into view.
    opened.scrollIntoView({ block: 'nearest' });
  };

  private step(id: Stepper, dir: number): void {
    if (!(dir === 1 || dir === -1)) return;
    this.update(() => {
      const s = this.settings;
      if (id === 'sensitivity') {
        const next = s.sensitivity + dir * SENSITIVITY_LIMITS.step;
        s.sensitivity = Number(Math.min(SENSITIVITY_LIMITS.max, Math.max(SENSITIVITY_LIMITS.min, next)).toFixed(2));
      } else {
        const timing = { ...s.timing, [id]: s.timing[id] + dir * TIMING_LIMITS[id].step };
        // Shortening the long blink below the slow blink's reach lowers the slow blink instead of bouncing back.
        if (id === 'pauseS' && dir < 0) timing.blinkMinS = Math.min(timing.blinkMinS, timing.pauseS - 0.5);
        s.timing = clampTiming(timing);
      }
    });
  }

  /** Change settings, then apply, save and redraw. */
  private update(change: () => void): void {
    change();
    saveSettings(this.settings);
    this.applySettings();
  }

  private applySettings(): void {
    this.head.tuning.sensitivity = this.settings.sensitivity;
    this.applyEyeTiming();
    effectiveBindings(this.settings.bindings, this.settings.calibration, this.bindings);
    this.head.configure(this.bindings, isCalibrated(this.settings.calibration) ? this.settings.calibration : null);
    this.applyDwell();
    this.renderControls();
  }

  private applyEyeTiming(): void {
    const timing = this.head.eyes.timing;
    timing.blinkMinS = this.settings.timing.blinkMinS;
    timing.pauseS = this.settings.timing.pauseS;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.capturingKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.code !== 'Escape' && event.code) this.settings.key = event.code;
      this.setCapturingKey(false);
      this.update(() => {});
      return;
    }
    if (event.code === 'Escape') this.head.releaseToggle();
    if (!this.keyActive(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) this.head.keyInput(true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.keyActive(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.head.keyInput(false);
  };

  private readonly onBlur = (): void => {
    this.head.keyInput(false);
  };

  /** The switch key acts only while a head mode is tracking, and never in a text field. */
  private keyActive(event: KeyboardEvent): boolean {
    return (
      event.code === this.settings.key &&
      this.mode !== 'hand' &&
      this.tracker.status === 'tracking' &&
      this.bindings.key !== 'off' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isEditableTarget(event.target)
    );
  }

  private setCapturingKey(on: boolean): void {
    this.capturingKey = on;
    const button = this.el(HF_IDS.setKey);
    button.textContent = on ? 'Press a key…' : 'Set key';
    button.setAttribute('aria-pressed', String(on));
  }

  /** A hidden page gets no frames: drop any press so nothing stays held. */
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.router.release();
      this.head.keyInput(false);
      this.announce(null);
    } else if (this.tracker.status === 'tracking') {
      this.announce(this.mode);
    }
  };

  private readonly onPageHide = (): void => {
    this.tracker.stop();
  };

  /** `hands-free:changed`: the mode while tracking is live, null when it isn't. */
  private announce(mode: HandsFreeMode | null): void {
    if (mode === this.announced) return;
    this.announced = mode;
    this.root.dataset.announced = mode ?? 'none';
    this.bus.emit('hands-free:changed', { mode });
  }

  private setPanelOpen(open: boolean): void {
    this.root.dataset.panel = open ? 'open' : 'closed';
    this.el(HF_IDS.toggle).setAttribute('aria-expanded', String(open));
  }

  private setMode(mode: TrackingMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.renderMode();
    // Another mode needs other models: restart a running camera with them.
    if (this.tracker.status !== 'off' && this.tracker.status !== 'error') {
      this.restarting = true;
      this.announce(mode);
      void this.start();
    }
  }

  private renderMode(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
    }
    this.root.dataset.mode = this.mode;
    if (this.mode === 'hand') this.endEyeTest(null);
    this.applySettings();
  }

  private applyDwell(): void {
    const on = this.mode !== 'hand' && this.settings.dwell;
    this.router.setDwell(on ? this.settings.timing.dwellS : 0);
  }

  private renderControls(): void {
    const s = this.settings;
    const preset = presetOf(s.bindings);
    for (const id of PRESET_IDS) this.el(HF_IDS.preset(id)).setAttribute('aria-pressed', String(id === preset));
    this.root.dataset.preset = preset ?? 'custom';
    const locked: FaceTrigger[] = [];
    for (const trigger of FACE_TRIGGERS) {
      const button = this.el<HTMLButtonElement>(HF_IDS.bind(trigger));
      const reason = lockedReason(trigger, s.calibration);
      button.disabled = reason !== null;
      button.textContent = reason ? 'Needs eye test' : ACTION_LABEL[s.bindings[trigger]];
      button.title = reason ?? `Choose what it does (${ALLOWED_ACTIONS[trigger].map((a) => ACTION_LABEL[a]).join(', ')})`;
      if (reason) locked.push(trigger);
    }
    const note = this.el('hf-bind-note');
    note.hidden = locked.length === 0;
    note.textContent = locked.length ? 'Winks need the eye test: one-eye winks are hard for many people, so they stay off until the test sees yours.' : '';
    this.el('hf-bind-name-key').textContent = `Key: ${keyName(s.key)}`;
    this.el('hf-key-name').textContent = `Switch or key: ${keyName(s.key)}`;
    this.el('hf-step-sensitivity').textContent = s.sensitivity.toFixed(1);
    this.el('hf-step-blinkMinS').textContent = `${s.timing.blinkMinS.toFixed(2)} s`;
    this.el('hf-step-pauseS').textContent = `${s.timing.pauseS.toFixed(2)} s`;
    this.el('hf-step-dwellS').textContent = `${s.timing.dwellS.toFixed(2)} s`;
    this.el(HF_IDS.dwell).setAttribute('aria-pressed', String(s.dwell));
    this.renderLegend();
    this.renderEyeTest();
  }

  private renderLegend(): void {
    const lines: string[] = [];
    if (this.mode === 'hand') {
      lines.push(...HAND_LEGEND);
    } else {
      lines.push(this.mode === 'head' ? 'Turn and tilt your head: the cursor follows your nose' : 'Turn and tilt your head to point');
      if (this.mode === 'head-hand') lines.push('Pinch with either hand to click; hold to drag', 'Fist to drag the map · ✌ to rotate · 👎 for Esc');
      for (const trigger of FACE_TRIGGERS) {
        const action = this.bindings[trigger];
        if (action !== 'off') lines.push(`${this.triggerPhrase(trigger)} ${ACTION_PHRASE[action]}`);
      }
      if (this.settings.dwell) lines.push(`Rest on a button for ${this.settings.timing.dwellS} s to press it`);
    }
    const list = this.el('hf-legend');
    list.replaceChildren(...lines.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  }

  private triggerPhrase(trigger: FaceTrigger): string {
    const t = this.settings.timing;
    switch (trigger) {
      case 'blink':
        return `Close your eyes for ${t.blinkMinS} s, then open them,`;
      case 'long-blink':
        return `Keep your eyes closed for ${t.pauseS} s`;
      case 'wink-left':
        return 'Wink your left eye';
      case 'wink-right':
        return 'Wink your right eye';
      case 'mouth':
        return 'Open your mouth';
      case 'brows':
        return 'Raise your eyebrows';
      case 'smile':
        return 'Hold a big smile';
      case 'key':
        return `Press ${keyName(this.settings.key)}`;
      default: {
        const never: never = trigger;
        return never;
      }
    }
  }

  /** How to resume, for the paused note. */
  private resumeHint(): string {
    const trigger = pauseTrigger(this.bindings);
    if (!trigger) return '';
    return trigger === 'long-blink' ? `close your eyes for ${this.settings.timing.pauseS} s` : this.triggerPhrase(trigger).toLowerCase().replace(/,$/, '');
  }

  // --- Eye test -----------------------------------------------------------------------------------

  private startEyeTest(step: EyeTestStep): void {
    if (this.tracker.status !== 'tracking' || this.mode === 'hand') {
      this.eyeTestText = 'Start the camera in a head mode first.';
      this.renderEyeTest();
      return;
    }
    const calibration = step === 'open' ? null : this.settings.calibration;
    if (step !== 'open' && !isCalibrated(calibration)) {
      this.eyeTestText = 'Do the eye test first, then the wink tests.';
      this.renderEyeTest();
      return;
    }
    this.eyeTest = new EyeTest(calibration);
    this.eyeTest.start(step, this.lastT);
    this.head.eyesSuspended = true;
    this.eyeTestText = EYE_TEST_PROMPT[step];
    this.renderEyeTest();
  }

  private endEyeTest(text: string | null): void {
    this.eyeTest?.cancel();
    this.eyeTest = null;
    this.head.eyesSuspended = false;
    if (text !== null) this.eyeTestText = text;
    this.renderEyeTest();
  }

  private feedEyeTest(t: number): void {
    const test = this.eyeTest;
    if (!test?.step) return;
    const step = test.step;
    const raw = this.head.raw;
    const outcome = (this.lastFrame?.present ? test.feed(raw.left, raw.right, raw.smile, t) : null) ?? test.expire(t);
    if (!outcome) return;
    if (!outcome.ok) {
      this.bus.emit('ui:sfx', { event: 'invalid' });
      this.endEyeTest(outcome.reason);
      return;
    }
    if (step === 'open') {
      test.start('closed', t);
      this.eyeTestText = EYE_TEST_PROMPT.closed;
      this.renderEyeTest();
      return;
    }
    this.bus.emit('ui:sfx', { event: 'ui-open' });
    this.settings.calibration = outcome.calibration;
    const text =
      step === 'closed'
        ? 'Done: you can open your eyes. Blinks now use your own levels. Try the wink tests to use winks.'
        : `${step === 'wink-left' ? 'Left' : 'Right'} wink works: you can bind it now.`;
    this.endEyeTest(text);
    this.update(() => {});
  }

  private renderEyeTest(): void {
    const test = this.eyeTest;
    const running = test?.step != null;
    const cal = this.settings.calibration;
    const idle = isCalibrated(cal)
      ? `Eyes measured. Left wink: ${cal.winkLeft ? 'works' : 'not yet'} · right wink: ${cal.winkRight ? 'works' : 'not yet'}.`
      : 'Measures your eyes, about 10 seconds, so blinks and winks work for you. Needs a well-lit face.';
    const text = running
      ? this.lastFrame?.present !== true
        ? `${this.eyeTestText} (I can't see your face yet.)`
        : test!.waiting
        ? this.eyeTestText
        : `${this.eyeTestText} Hold it…`
      : this.eyeTestText || idle;
    const el = this.el(HF_IDS.eyeTestText);
    if (el.textContent !== text) el.textContent = text;
    this.el('hf-eye-test-progress').style.width = `${Math.round((running ? test!.progress : 0) * 100)}%`;
    this.el(HF_IDS.eyeTestStart).hidden = running;
    this.el(HF_IDS.eyeTestStart).textContent = isCalibrated(cal) ? 'Redo eye test' : 'Start eye test';
    this.el(HF_IDS.eyeTestCancel).hidden = !running;
    for (const side of ['left', 'right'] as const) {
      const button = this.el<HTMLButtonElement>(HF_IDS.winkTest(side));
      button.disabled = running || !isCalibrated(cal);
    }
    this.root.dataset.eyeTest = running ? test!.step! : 'idle';
  }

  // --- Camera and frames --------------------------------------------------------------------------

  private async start(): Promise<void> {
    this.router.release();
    this.hand.reset();
    this.clickHand.reset();
    this.head.reset();
    await this.tracker.start(this.mode, this.delegate);
  }

  private stop(): void {
    this.tracker.stop();
    this.router.release();
    this.renderCursor();
  }

  private onStatus(status: TrackerStatus): void {
    this.root.dataset.status = status;
    const live = status !== 'off' && status !== 'error';
    if (live && !this.statusTimer) this.statusTimer = window.setInterval(() => this.renderStatus(true), STATUS_INTERVAL_MS * 2);
    if (!live) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = 0;
    }
    this.el(HF_IDS.start).textContent = status === 'off' || status === 'error' ? 'Start camera' : 'Stop camera';
    this.el<HTMLButtonElement>(HF_IDS.record).disabled = status !== 'tracking';
    if (status === 'tracking') {
      this.restarting = false;
      this.announce(this.mode);
    } else if (status === 'error' || (status === 'off' && !this.restarting)) {
      this.restarting = false;
      this.announce(null);
    }
    if (status !== 'tracking') {
      this.finishRecording();
      this.router.release();
      this.head.keyInput(false);
      if (this.eyeTest) this.endEyeTest('Eye test stopped: the camera is off.');
      this.renderCursor();
    }
    this.renderStatus(true);
  }

  private onFrame(track: TrackFrame): void {
    const t = track.t;
    this.lastT = t;
    if (this.recorder) {
      this.recorder.push(track);
      if (!this.recorder.recording) this.finishRecording();
    }
    let frame: GestureFrame;
    if (this.mode === 'hand') {
      frame = this.hand.update(track.hands, this.tracker.aspect, t);
    } else if (this.mode === 'head') {
      frame = this.head.update(track.face, t);
    } else {
      const hand = this.clickHand.update(track.hands, this.tracker.aspect, t);
      frame = this.head.update(track.face, t, hand.present && hand.pressed);
      frame.command ??= hand.command;
      frame.commandProgress = Math.max(frame.commandProgress, hand.commandProgress);
      frame.grab = hand.grab;
      frame.grabDx = hand.grabDx;
      frame.grabDy = hand.grabDy;
      if (hand.grab) frame.label = hand.label;
    }
    this.lastFrame = frame;
    if (this.mode !== 'hand') this.feedEyeTest(t);
    this.router.apply(frame, t);
    this.renderCursor();
    this.drawPreview(track);
    this.renderStatus(false);
  }

  // --- Recording ----------------------------------------------------------------------------------

  private toggleRecording(): void {
    if (this.recorder?.recording) {
      this.finishRecording();
      return;
    }
    if (this.tracker.status !== 'tracking') return;
    this.recorder = new TrackRecorder(this.mode);
    this.recorder.start();
    this.renderRecord();
  }

  /** Saves what was recorded, whether stopped by the player, at the cap, or by the camera stopping. */
  private finishRecording(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    recorder.stop();
    downloadTrack(recorder);
    this.renderRecord();
  }

  private renderRecord(): void {
    const recorder = this.recorder;
    const label = recorder?.recording ? 'Stop and save' : 'Record 30 s';
    const button = this.el<HTMLButtonElement>(HF_IDS.record);
    if (button.textContent !== label) button.textContent = label;
    const text = recorder?.recording ? `● Recording ${Math.floor(recorder.elapsed)} s` : '';
    const status = this.el(HF_IDS.recordStatus);
    if (status.textContent !== text) status.textContent = text;
  }

  private renderCursor(): void {
    const cursor = this.cursor;
    const state = this.router.state;
    const visible = this.tracker.status === 'tracking' && state.present;
    cursor.hidden = !visible;
    if (!visible) return;
    cursor.style.transform = `translate3d(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px, 0)`;
    const frame = this.lastFrame;
    cursor.style.setProperty('--hf-pressure', (frame?.pressure ?? 0).toFixed(2));
    cursor.style.setProperty('--hf-progress', state.progress.toFixed(2));
    cursor.classList.toggle('is-pressed', state.pressed);
    cursor.classList.toggle('is-grab', state.grab);
    cursor.classList.toggle('is-ui', !state.overCanvas);
    cursor.classList.toggle('is-calibrating', frame?.calibrating === true);
    cursor.classList.toggle('is-paused', state.paused);
  }

  /** The panel's note: paused, or eye triggers off because tracking is too slow to time a blink. */
  private alertText(): string {
    if (this.mode === 'hand' || this.tracker.status !== 'tracking') return '';
    if (this.head.isPaused) {
      const hint = this.resumeHint();
      return hint ? `Paused: ${hint} to resume.` : 'Paused.';
    }
    const usesEyes = FACE_TRIGGERS.some((trigger) => isEyeTrigger(trigger) && this.bindings[trigger] !== 'off');
    const rate = this.tracker.stats.fps;
    if (usesEyes && !this.head.eyesLive && rate > 0) {
      return `Blinks and winks are off: tracking runs at ${rate.toFixed(0)} results a second and they need ${this.head.tuning.eyeRateOn}. Other triggers still work.`;
    }
    return '';
  }

  private renderStatus(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastStatusMs < STATUS_INTERVAL_MS) return;
    this.lastStatusMs = now;
    const tracker = this.tracker;
    const stats = tracker.stats;
    const frame = this.lastFrame;
    this.renderRecord();
    const status = this.el(HF_IDS.status);
    if (tracker.status === 'error') {
      status.textContent = `Couldn't start: ${tracker.error ?? 'unknown error'}`;
    } else if (tracker.status === 'tracking') {
      const what = frame?.present ? frame.label : this.mode === 'hand' ? 'Show your hand to the camera' : 'Face the camera';
      status.textContent = `${what} · ${stats.inferMs.toFixed(0)} ms · ${stats.fps.toFixed(0)} fps · ${stats.delegate ?? ''}`;
    } else {
      status.textContent = STATUS_TEXT[tracker.status];
    }
    this.root.classList.toggle('is-live', tracker.status === 'tracking' || tracker.status === 'loading' || tracker.status === 'camera');
    const alert = this.el(HF_IDS.alert);
    const alertText = this.alertText();
    if (alert.textContent !== alertText) alert.textContent = alertText;
    alert.hidden = alertText === '';
    if (this.mode !== 'hand') {
      const signals = this.head.signals;
      for (const meter of this.root.querySelectorAll<HTMLElement>('[data-meter]')) {
        meter.style.width = `${Math.round((signals[meter.dataset.meter as FaceTrigger] ?? 0) * 100)}%`;
      }
      if (this.eyeTest) this.renderEyeTest();
    }
    // For tests and the smoke script.
    const data = this.root.dataset;
    const state = this.router.state;
    data.present = String(frame?.present === true);
    data.pressed = String(state.pressed);
    data.paused = String(state.paused);
    data.grab = String(state.grab);
    data.x = state.x.toFixed(0);
    data.y = state.y.toFixed(0);
    data.label = frame?.label ?? '';
    data.frames = String(stats.frames);
    data.inferMs = stats.inferMs.toFixed(1);
    data.loadMs = String(stats.loadMs ?? '');
    data.delegate = stats.delegate ?? '';
    data.fps = stats.fps.toFixed(1);
    data.dropped = String(stats.dropped);
    data.domClicks = String(this.router.counts.domClicks);
    data.canvasPresses = String(this.router.counts.canvasPresses);
    data.taps = String(this.router.counts.taps);
    data.commands = String(this.router.counts.commands);
    data.eyes = this.head.eyesLive ? 'live' : 'off';
    data.eyeLevels = `${this.head.raw.left.toFixed(2)} ${this.head.raw.right.toFixed(2)}`;
    data.models = stats.modelUrls.join(' ');
  }

  /** The camera picture (mirrored by CSS), the active region in hand mode, and what is tracked. */
  private drawPreview(track: TrackFrame): void {
    const ctx = this.previewContext;
    if (!ctx) return;
    const { width, height } = this.preview;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (this.mode === 'hand') {
      // The region is defined mirrored; the canvas is mirrored by CSS, so draw it unmirrored.
      const r = DEFAULT_HAND_TUNING.region;
      ctx.strokeStyle = 'rgba(255, 249, 239, 0.7)';
      ctx.setLineDash([6, 6]);
      ctx.strokeRect((1 - r.right) * width, r.top * height, (r.right - r.left) * width, (r.bottom - r.top) * height);
      ctx.setLineDash([]);
    }
    const frame = this.lastFrame;
    for (const hand of track.hands) {
      const lm = hand.landmarks;
      ctx.strokeStyle = frame?.grab ? '#f4c44e' : frame?.pressed ? '#4a9be8' : '#5db36a';
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(lm[a].x * width, lm[a].y * height);
        ctx.lineTo(lm[b].x * width, lm[b].y * height);
      }
      ctx.stroke();
    }
    const face = track.face;
    if (face) {
      ctx.fillStyle = frame?.pressed ? '#4a9be8' : '#5db36a';
      for (const point of [face.forehead, face.chin, face.cheekLeft, face.cheekRight]) {
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e0674f';
      ctx.beginPath();
      ctx.arc(face.nose.x * width, face.nose.y * height, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const EYE_TEST_PROMPT: Record<EyeTestStep, string> = {
  open: 'Look at the screen with your eyes open and relaxed.',
  closed: 'Now close both eyes until you hear a soft sound.',
  'wink-left': 'Close only your left eye (on the left in the picture) until you hear a sound.',
  'wink-right': 'Close only your right eye (on the right in the picture) until you hear a sound.',
};

/** Mounts the hands-free controls; returns a disposer. `flag` is the `gestures` URL parameter's value. */
export function installHandsFree(bus: GameBus, canvas: HTMLCanvasElement, flag: string | null): () => void {
  const handsFree = new HandsFree(bus, canvas, flag);
  return () => handsFree.dispose();
}
