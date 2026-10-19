/**
 * What each face trigger does in the head modes, the timings, and the player's eye calibration, saved
 * per browser (a per-viewer convenience: never in the town save or the game settings).
 */
import { DEFAULT_EYE_TIMING, isCalibrated, type EyeCalibration } from './eyeTriggers';

export const FACE_TRIGGERS = ['blink', 'long-blink', 'wink-left', 'wink-right', 'mouth', 'brows', 'smile', 'key'] as const;
export type FaceTrigger = (typeof FACE_TRIGGERS)[number];

export const TRIGGER_ACTIONS = ['off', 'click', 'hold', 'drag-toggle', 'rotate', 'cancel', 'pause', 'recentre'] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

export type Bindings = Record<FaceTrigger, TriggerAction>;

const ONE_SHOT: readonly TriggerAction[] = ['off', 'click', 'drag-toggle', 'rotate', 'cancel', 'pause', 'recentre'];

/** Hold needs a signal you can keep up while aiming: not with your eyes shut. A long blink fires while the eyes are still shut, so it can't click. */
export const ALLOWED_ACTIONS: Record<FaceTrigger, readonly TriggerAction[]> = {
  blink: ONE_SHOT,
  'long-blink': ['off', 'pause', 'recentre', 'cancel', 'rotate'],
  'wink-left': ONE_SHOT,
  'wink-right': ONE_SHOT,
  mouth: TRIGGER_ACTIONS,
  brows: ONE_SHOT,
  smile: ONE_SHOT,
  key: TRIGGER_ACTIONS,
};

export const PRESET_IDS = ['low-effort', 'classic'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESETS: Record<PresetId, Bindings> = {
  'low-effort': {
    blink: 'click',
    'long-blink': 'pause',
    'wink-left': 'drag-toggle',
    'wink-right': 'cancel',
    mouth: 'off',
    brows: 'cancel',
    smile: 'off',
    key: 'hold',
  },
  classic: {
    blink: 'off',
    'long-blink': 'off',
    'wink-left': 'off',
    'wink-right': 'off',
    mouth: 'hold',
    brows: 'cancel',
    smile: 'rotate',
    key: 'hold',
  },
};

/** The preset these bindings match, or null (customised). */
export function presetOf(bindings: Bindings): PresetId | null {
  return PRESET_IDS.find((id) => FACE_TRIGGERS.every((trigger) => PRESETS[id][trigger] === bindings[trigger])) ?? null;
}

export function isEyeTrigger(trigger: FaceTrigger): boolean {
  return trigger === 'blink' || trigger === 'long-blink' || trigger === 'wink-left' || trigger === 'wink-right';
}

/** Null when the trigger can be used; otherwise why not. */
export function lockedReason(trigger: FaceTrigger, calibration: EyeCalibration | null): string | null {
  if (trigger === 'wink-left' && !calibration?.winkLeft) return 'Needs the eye test: one-eye winks are hard for many people, so this stays off until the test sees yours.';
  if (trigger === 'wink-right' && !calibration?.winkRight) return 'Needs the eye test: one-eye winks are hard for many people, so this stays off until the test sees yours.';
  return null;
}

/** The bindings in force: a wink the eye test hasn't seen is off. */
export function effectiveBindings(bindings: Bindings, calibration: EyeCalibration | null, out: Bindings = { ...bindings }): Bindings {
  for (const trigger of FACE_TRIGGERS) out[trigger] = lockedReason(trigger, calibration) ? 'off' : bindings[trigger];
  return out;
}

/** The trigger bound to pause (it also resumes), if any. */
export function pauseTrigger(bindings: Bindings): FaceTrigger | null {
  return FACE_TRIGGERS.find((trigger) => bindings[trigger] === 'pause') ?? null;
}

export function nextAction(trigger: FaceTrigger, action: TriggerAction): TriggerAction {
  const allowed = ALLOWED_ACTIONS[trigger];
  return allowed[(allowed.indexOf(action) + 1) % allowed.length];
}

export interface Timing {
  /** Shortest eyes-shut time that clicks (shorter is an ordinary blink). */
  blinkMinS: number;
  /** Eyes shut this long pause / resume. */
  pauseS: number;
  /** Resting on a control this long presses it. */
  dwellS: number;
}

export const TIMING_LIMITS: Record<keyof Timing, { min: number; max: number; step: number }> = {
  blinkMinS: { min: 0.2, max: 1, step: 0.05 },
  pauseS: { min: 1, max: 3, step: 0.25 },
  dwellS: { min: 0.5, max: 3, step: 0.25 },
};

/** A pause must take clearly longer than the longest click blink. */
const PAUSE_OVER_BLINK_S = 0.5;

export interface HandsFreeSettings {
  bindings: Bindings;
  timing: Timing;
  calibration: EyeCalibration | null;
  /** `KeyboardEvent.code` of the switch key. */
  key: string;
  dwell: boolean;
  sensitivity: number;
}

export const SENSITIVITY_LIMITS = { min: 0.5, max: 2, step: 0.1 } as const;

export function defaultSettings(): HandsFreeSettings {
  return {
    bindings: { ...PRESETS['low-effort'] },
    timing: { blinkMinS: DEFAULT_EYE_TIMING.blinkMinS, pauseS: DEFAULT_EYE_TIMING.pauseS, dwellS: 1 },
    calibration: null,
    key: 'Enter',
    dwell: true,
    sensitivity: 1,
  };
}

/** Clamps a timing value to its limits and step; also keeps the pause clear of the blink. */
export function clampTiming(timing: Timing): Timing {
  const out = { ...timing };
  for (const key of Object.keys(TIMING_LIMITS) as Array<keyof Timing>) {
    const { min, max, step } = TIMING_LIMITS[key];
    out[key] = roundTo(Math.min(max, Math.max(min, out[key])), step);
  }
  out.pauseS = Math.max(out.pauseS, roundTo(out.blinkMinS + PAUSE_OVER_BLINK_S, TIMING_LIMITS.pauseS.step, Math.ceil));
  return out;
}

function roundTo(value: number, step: number, round: (x: number) => number = Math.round): number {
  return Number((round(value / step - 1e-9) * step).toFixed(4));
}

/** Settings from stored JSON: anything missing, malformed or out of range falls back to the default. */
export function parseSettings(raw: string | null): HandsFreeSettings {
  const settings = defaultSettings();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return settings;
  }
  if (!isRecord(data)) return settings;
  if (isRecord(data.bindings)) {
    for (const trigger of FACE_TRIGGERS) {
      const action = data.bindings[trigger];
      if (typeof action === 'string' && (ALLOWED_ACTIONS[trigger] as readonly string[]).includes(action)) settings.bindings[trigger] = action as TriggerAction;
    }
  }
  if (isRecord(data.timing)) {
    for (const key of Object.keys(TIMING_LIMITS) as Array<keyof Timing>) {
      const value = data.timing[key];
      if (typeof value === 'number' && Number.isFinite(value)) settings.timing[key] = value;
    }
    settings.timing = clampTiming(settings.timing);
  }
  settings.calibration = parseCalibration(data.calibration);
  if (typeof data.key === 'string' && /^[A-Za-z0-9]{1,24}$/.test(data.key)) settings.key = data.key;
  if (typeof data.dwell === 'boolean') settings.dwell = data.dwell;
  if (typeof data.sensitivity === 'number' && Number.isFinite(data.sensitivity)) {
    settings.sensitivity = Math.min(SENSITIVITY_LIMITS.max, Math.max(SENSITIVITY_LIMITS.min, roundTo(data.sensitivity, SENSITIVITY_LIMITS.step)));
  }
  return settings;
}

function parseCalibration(value: unknown): EyeCalibration | null {
  if (!isRecord(value) || !isRecord(value.open) || !isRecord(value.closed)) return null;
  const level = (record: Record<string, unknown>, side: 'left' | 'right'): number | null => {
    const v = record[side];
    return typeof v === 'number' && v >= 0 && v <= 1 ? v : null;
  };
  const open = { left: level(value.open, 'left'), right: level(value.open, 'right') };
  const closed = { left: level(value.closed, 'left'), right: level(value.closed, 'right') };
  if (open.left === null || open.right === null || closed.left === null || closed.right === null) return null;
  const calibration: EyeCalibration = {
    open: { left: open.left, right: open.right },
    closed: { left: closed.left, right: closed.right },
    smile: typeof value.smile === 'number' && value.smile >= 0 && value.smile <= 1 ? value.smile : 0,
    winkLeft: value.winkLeft === true,
    winkRight: value.winkRight === true,
  };
  return isCalibrated(calibration) ? calibration : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const SETTINGS_KEY = 'tiny-town:hands-free';

export function loadSettings(): HandsFreeSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: HandsFreeSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage blocked: the settings last until the page closes.
  }
}
