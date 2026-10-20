/**
 * Two palms → pointer, clicks and commands (pure; no DOM, no MediaPipe). Only the palm is read (the
 * wrist and the four knuckles), never a finger: for players who move their hands and arms but can't
 * rely on their fingers.
 *
 *  pointer  the pointing hand's palm centre, mirrored, relative to a neutral pose taken while
 *           calibrating, in palm sizes (so it reads the same near the camera and far from it); mapped
 *           by headPointer.ts (fixed gains or a fit, direct or joystick)
 *  click    the other hand moved from its rest the click way (straight up, or a fitted move) and held
 *           past a threshold for a moment; bound to an action (bindings.ts), as is a key or switch
 *  roles    by side (the player's own right or left hand points), sticky once a hand has been followed
 *           for a while; 'one' points with whichever hand is seen and has no click hand
 */
import { createGestureFrame, type GestureFrame, type HandObservation, type Point3 } from './protocol';
import { imageDistance, INDEX_MCP, MIDDLE_MCP, WRIST } from './handInterpreter';
import { PointerSmoother } from './pointerSmoother';
import { HeadPointer, type FittablePointer, type HeadRange, type PointerStyle } from './headPointer';
import type { OneEuroTuning } from './oneEuro';
import { FrameClock, HoldTrigger } from './triggers';
import type { PalmSettings, TriggerAction } from './bindings';
import { TriggerActions } from './triggerActions';

export const RING_MCP = 13;
export const PINKY_MCP = 17;
/** The landmarks a palm is read from; every other one belongs to a finger. */
export const PALM_POINTS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP] as const;

/** A palm is about this many knuckle widths (index to little-finger knuckle) long. */
const KNUCKLES_TO_SIZE = 1.3;

/** The palm's centre in image coordinates: the mean of the wrist and the four knuckles. */
export function palmCentre(hand: readonly Point3[], out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    x += hand[i].x;
    y += hand[i].y;
  }
  out.x = x / PALM_POINTS.length;
  out.y = y / PALM_POINTS.length;
  return out;
}

/**
 * The palm's size in frame heights: its length (wrist to middle knuckle), or its width scaled to a
 * length when that is longer, since tipping the hand forward shortens one and turning it the other.
 */
export function palmSize(hand: readonly Point3[], aspect: number): number {
  return Math.max(imageDistance(hand[WRIST], hand[MIDDLE_MCP], aspect), KNUCKLES_TO_SIZE * imageDistance(hand[INDEX_MCP], hand[PINKY_MCP], aspect));
}

/** How long a point has stayed within a tolerance of where it settled, and the mean of its place since. */
export class SteadyHold {
  readonly mean = { x: 0, y: 0 };
  private readonly anchor = { x: 0, y: 0 };
  private since: number | null = null;
  private sumX = 0;
  private sumY = 0;
  private samples = 0;

  /** Seconds the point (image coords) has stayed within `tolerance` palm sizes of where this hold began. */
  update(x: number, y: number, t: number, aspect: number, size: number, tolerance: number): number {
    if (this.since === null || Math.hypot((x - this.anchor.x) * aspect, y - this.anchor.y) > tolerance * size) {
      this.since = t;
      this.anchor.x = x;
      this.anchor.y = y;
      this.sumX = 0;
      this.sumY = 0;
      this.samples = 0;
    }
    this.sumX += x;
    this.sumY += y;
    this.samples += 1;
    this.mean.x = this.sumX / this.samples;
    this.mean.y = this.sumY / this.samples;
    return t - this.since;
  }

  reset(): void {
    this.since = null;
  }
}

export interface PalmTuning {
  filter: OneEuroTuning;
  /** Multiplies the pointer's movement (the panel's sensitivity). */
  sensitivity: number;
  calibrateS: number;
  /** Time constant of the palm-size smoothing (s). */
  sizeTauS: number;
  /** At least this long without a hand before it counts as lost (longer when results come slowly). */
  lostS: number;
  /** A hand followed this long keeps its role wherever it moves. */
  roleHoldS: number;
  /** Half-width of the band around the frame's middle where a lone hand's side is unsure (frame widths). */
  sideBand: number;
  /** Farthest a hand moves between two results and is still the same hand (palm sizes). */
  matchRadius: number;
  /** The click move's thresholds along the click way without a fit (palm sizes). */
  liftOn: number;
  liftOff: number;
  /** With a fitted click move: shares of its length. */
  fitOn: number;
  fitOff: number;
  /** Past the on-threshold this long before it presses. */
  pressHoldS: number;
  /** A click hand without a rest holds within this (palm sizes) for `restHoldS` to take one. */
  restSteady: number;
  restHoldS: number;
  /** A click hand lost this long takes a new rest when it comes back. */
  rejoinS: number;
  /** The rest follows a still hand's drift within this share of the on-threshold, with this time constant. */
  driftShare: number;
  driftTauS: number;
  /** A press lands where the pointer was this long before the click move crossed the threshold. */
  backdateS: number;
}

export const DEFAULT_PALM_TUNING: PalmTuning = {
  filter: { minCutoff: 0.8, beta: 4, dCutoff: 1 },
  sensitivity: 1,
  calibrateS: 0.6,
  sizeTauS: 0.5,
  lostS: 0.3,
  roleHoldS: 1,
  sideBand: 0.08,
  matchRadius: 4,
  liftOn: 0.75,
  liftOff: 0.45,
  fitOn: 0.5,
  fitOff: 0.3,
  pressHoldS: 0.15,
  restSteady: 0.15,
  restHoldS: 0.5,
  rejoinS: 1,
  driftShare: 0.3,
  driftTauS: 10,
  backdateS: 0.1,
};

/** A hand in its role this frame, in image coordinates; `size` in frame heights (smoothed). */
export interface PalmView {
  /** Followed (it may have been missed on this frame). */
  present: boolean;
  /** Its index in this frame's hands; -1: not seen on this frame. */
  index: number;
  x: number;
  y: number;
  size: number;
}

/** none: no click hand · settling: holding still to take a rest · ready: a click move can press. */
export type RestState = 'none' | 'settling' | 'ready';

/** One followed hand: where it was, its smoothed size, how long it has been followed. */
class TrackedPalm {
  readonly centre = { x: 0.5, y: 0.5 };
  size = 0;
  lastSeen = -Infinity;
  /** Followed without a break since. */
  since = 0;
  index = -1;
  /** Seconds from the result before this one it was seen on (Infinity: never seen). */
  gap = Infinity;

  live(t: number, lostAfter: number): boolean {
    return t - this.lastSeen < lostAfter;
  }

  age(t: number): number {
    return t - this.since;
  }

  observe(index: number, x: number, y: number, size: number, t: number, lostAfter: number, tauS: number): void {
    this.gap = t - this.lastSeen;
    if (!this.live(t, lostAfter)) {
      this.since = t;
      this.size = size;
    } else {
      this.size += (size - this.size) * (1 - Math.exp(-Math.max(0, this.gap) / tauS));
    }
    this.centre.x = x;
    this.centre.y = y;
    this.lastSeen = t;
    this.index = index;
  }

  forget(): void {
    this.lastSeen = -Infinity;
    this.index = -1;
    this.gap = Infinity;
  }
}

interface Seen {
  x: number;
  y: number;
  size: number;
}

export class PalmInterpreter implements FittablePointer {
  readonly frame: GestureFrame = createGestureFrame();
  readonly pointer: PointerSmoother;
  readonly mapper = new HeadPointer();
  /** The pointing palm's offset from the calibrated centre in palm sizes (x > 0 screen right, y > 0 down). */
  readonly signal = { x: 0, y: 0 };
  hasSignal = false;
  pointerFrozen = false;
  /** The click fit is running: moving the click hand mustn't click. */
  clickSuspended = false;
  readonly clock = new FrameClock();
  readonly pointerHand: PalmView = { present: false, index: -1, x: 0.5, y: 0.5, size: 0 };
  readonly clickHand: PalmView = { present: false, index: -1, x: 0.5, y: 0.5, size: 0 };
  /** The click hand's rest and the point where the click move presses, in image coordinates. */
  readonly clickRest = { x: 0.5, y: 0.5 };
  readonly clickThreshold = { x: 0.5, y: 0.5 };
  restState: RestState = 'none';
  /** 0..1 of the hold that takes a rest. */
  restProgress = 0;
  /** 0..1 of the click move towards its threshold (1 while pressed by it). */
  liftLevel = 0;
  private settings: PalmSettings = { pointing: 'right', lift: 'hold', click: null };
  private keyAction: TriggerAction = 'hold';
  private readonly actions: TriggerActions;
  private pointerSlot = new TrackedPalm();
  private clickSlot = new TrackedPalm();
  private readonly seen: [Seen, Seen] = [{ x: 0, y: 0, size: 0 }, { x: 0, y: 0, size: 0 }];
  private aspect = 1;
  /** The pointing palm's place at calibration (image coords) and the fit's centre in signal units. */
  private readonly imageNeutral = { x: 0.5, y: 0.5 };
  private hasImageNeutral = false;
  private readonly neutral = { x: 0, y: 0 };
  private calibrated = false;
  private calibrationStart: number | null = null;
  private readonly sum = { x: 0, y: 0, clickX: 0, clickY: 0 };
  private samples = 0;
  private clickSamples = 0;
  private restValid = false;
  private readonly steady = new SteadyHold();
  private readonly liftHold: HoldTrigger;
  private liftOn = false;
  /** When a press from the click move lands. */
  private liftFrom = 0;
  private readonly clickDir = { x: 0, y: -1 };
  private clickOn = 0;
  private clickOff = 0;
  private keyDown = false;
  /** Key presses since the last frame (a press and release can both fall between two frames). */
  private keyPresses = 0;

  constructor(readonly tuning: PalmTuning = { ...DEFAULT_PALM_TUNING }) {
    this.pointer = new PointerSmoother(tuning.filter, { backdateS: tuning.backdateS, holdS: 0.15 });
    this.mapper.source = 'palm';
    this.liftHold = new HoldTrigger(tuning.pressHoldS);
    this.actions = new TriggerActions(this.frame, this.pointer, () => this.recalibrate());
    this.applyClick();
  }

  /** The Palms settings and the switch key's action. A new pointing hand starts over. */
  configure(palm: PalmSettings, key: TriggerAction): void {
    const pointingChanged = palm.pointing !== this.settings.pointing;
    this.settings = { pointing: palm.pointing, lift: palm.lift, click: palm.click ? { x: palm.click.x, y: palm.click.y } : null };
    this.keyAction = key;
    this.applyClick();
    this.actions.configure([palm.lift, key]);
    if (pointingChanged) {
      this.pointerSlot.forget();
      this.clickSlot.forget();
      this.restValid = false;
      this.dropLift();
      this.recalibrate();
    }
  }

  get isPaused(): boolean {
    return this.actions.paused;
  }

  /** Esc from anywhere ends a toggled drag. */
  releaseToggle(): void {
    this.actions.toggled = false;
  }

  /** The switch key went down or up (between frames; read on the next one). */
  keyInput(down: boolean): void {
    if (down && !this.keyDown) this.keyPresses += 1;
    this.keyDown = down;
  }

  /** Take the pointing palm's current place as the centre again (a fit's ranges stay); a click hand seen meanwhile rests there. */
  recalibrate(): void {
    this.calibrated = false;
    this.calibrationStart = null;
    this.samples = 0;
    this.clickSamples = 0;
    this.sum.x = 0;
    this.sum.y = 0;
    this.sum.clickX = 0;
    this.sum.clickY = 0;
    this.neutral.x = 0;
    this.neutral.y = 0;
    this.pointer.reset();
    this.mapper.reset();
  }

  /** A new style continues from where the pointer is. */
  configurePointer(style: PointerStyle, fit: HeadRange | null): void {
    const mapper = this.mapper;
    mapper.fit = fit;
    if (style !== mapper.style) {
      mapper.style = style;
      mapper.reset(this.pointer.point.x, this.pointer.point.y);
    }
  }

  /** The centre in signal units (0, 0 unless a fit measured another), once calibrated. */
  get neutralPose(): { readonly x: number; readonly y: number } | null {
    return this.calibrated ? this.neutral : null;
  }

  /** Takes a measured centre (the fit wizard's) in signal units instead of calibrating. */
  setNeutral(x: number, y: number): void {
    if (!this.hasImageNeutral) return;
    this.neutral.x = x;
    this.neutral.y = y;
    this.calibrated = true;
    this.calibrationStart = null;
  }

  /** `aspect`: camera frame width / height. */
  update(hands: readonly HandObservation[], aspect: number, t: number): GestureFrame {
    const f = this.frame;
    const tuning = this.tuning;
    f.command = null;
    f.tap = false;
    f.zoom = 1;
    f.grab = false;
    f.grabDx = 0;
    f.grabDy = 0;
    this.clock.tick(t);
    this.aspect = aspect;
    const lostAfter = this.clock.lostAfter(tuning.lostS);
    const n = Math.min(2, hands.length);
    for (let i = 0; i < n; i += 1) {
      const seen = this.seen[i];
      palmCentre(hands[i].landmarks, seen);
      seen.size = palmSize(hands[i].landmarks, aspect);
    }
    this.assign(n, t, lostAfter);
    const pointer = this.pointerSlot;
    const click = this.clickSlot;
    const usesClick = this.settings.pointing !== 'one';
    const pointerLive = pointer.live(t, lostAfter);
    const clickLive = usesClick && click.live(t, lostAfter);
    if (usesClick && click.index >= 0 && click.gap >= tuning.rejoinS) this.restValid = false;
    copyView(this.pointerHand, pointer, pointerLive);
    copyView(this.clickHand, click, clickLive);
    if (!pointerLive && !clickLive) {
      this.lose();
      return f;
    }
    f.present = true;

    if (!this.calibrated && !this.calibrate(t, pointerLive)) return f;
    f.calibrating = false;

    if (pointer.index >= 0) {
      const signal = this.signal;
      signal.x = ((this.imageNeutral.x - pointer.centre.x) * aspect) / pointer.size;
      signal.y = (pointer.centre.y - this.imageNeutral.y) / pointer.size;
      this.hasSignal = true;
      const dx = signal.x - this.neutral.x;
      const dy = signal.y - this.neutral.y;
      if (this.pointerFrozen) {
        this.mapper.measure(dx, dy);
        this.mapper.pause();
      } else {
        const target = this.mapper.update(dx, dy, t, tuning.sensitivity, this.pointer.isHolding(t) ? this.pointer.point : null);
        this.pointer.update(target.x, target.y, t);
      }
    } else {
      this.hasSignal = false;
      this.mapper.pause();
    }

    const liftEdge = this.updateClick(t, clickLive);
    const actions = this.actions;
    const lift = this.settings.lift;
    let levelHeld = false;
    let pressFrom = t - tuning.backdateS;
    if (lift === 'hold') {
      levelHeld = this.liftOn;
      if (liftEdge) pressFrom = this.liftFrom;
    } else if (liftEdge) {
      actions.fire(lift, this.liftFrom, t);
    }
    const keyPresses = this.keyPresses;
    this.keyPresses = 0;
    if (this.keyAction === 'hold') {
      if (keyPresses > 0 && !this.keyDown && !actions.paused) actions.tap(t, t);
      if (this.keyDown && !levelHeld) pressFrom = t;
      levelHeld ||= this.keyDown;
    } else if (keyPresses > 0) {
      actions.fire(this.keyAction, t, t);
    }

    const pressed = !actions.paused && (actions.toggled || levelHeld);
    if (pressed && !actions.wasPressed && !f.tap) this.pointer.pressAt(t, Math.min(pressFrom, t));
    actions.wasPressed = pressed;
    f.pressed = pressed;
    if (pressed) f.tap = false;
    f.paused = actions.paused;
    f.x = this.pointer.point.x;
    f.y = this.pointer.point.y;
    f.pressure = pressed ? 1 : lift !== 'off' ? this.liftLevel : 0;
    f.commandProgress = 0;
    f.label = this.label(pointer.index >= 0, clickLive);
    return f;
  }

  reset(): void {
    this.lose();
    this.pointerSlot.forget();
    this.clickSlot.forget();
    this.pointerHand.present = false;
    this.clickHand.present = false;
    this.restValid = false;
    this.hasImageNeutral = false;
    this.recalibrate();
    this.clock.reset();
    this.actions.paused = false;
  }

  /** Samples the neutral pose; true once calibrated (this frame carries on as a normal one). */
  private calibrate(t: number, pointerLive: boolean): boolean {
    const f = this.frame;
    const pointer = this.pointerSlot;
    const click = this.clickSlot;
    f.calibrating = pointerLive;
    f.x = 0.5;
    f.y = 0.5;
    f.pressed = false;
    f.pressure = 0;
    f.commandProgress = 0;
    f.label = pointerLive ? 'Hold still: centring' : 'Show your pointing hand';
    this.keyPresses = 0;
    this.hasSignal = false;
    this.liftLevel = 0;
    this.restState = 'none';
    if (pointer.index < 0) return false;
    if (this.calibrationStart === null) this.calibrationStart = t;
    this.sum.x += pointer.centre.x;
    this.sum.y += pointer.centre.y;
    this.samples += 1;
    // A click move bound to recentre is still up: its rest stays where it was.
    if (click.index >= 0 && this.settings.pointing !== 'one' && !this.liftOn) {
      this.sum.clickX += click.centre.x;
      this.sum.clickY += click.centre.y;
      this.clickSamples += 1;
    }
    if (t - this.calibrationStart < this.tuning.calibrateS) return false;
    this.imageNeutral.x = this.sum.x / this.samples;
    this.imageNeutral.y = this.sum.y / this.samples;
    this.hasImageNeutral = true;
    if (this.clickSamples > 0) {
      this.clickRest.x = this.sum.clickX / this.clickSamples;
      this.clickRest.y = this.sum.clickY / this.clickSamples;
      this.restValid = true;
    }
    this.calibrated = true;
    this.calibrationStart = null;
    return true;
  }

  /** The click hand's rest, its move and the lift switch; true on the frame the move presses. */
  private updateClick(t: number, clickLive: boolean): boolean {
    const tuning = this.tuning;
    const click = this.clickSlot;
    if (!clickLive) {
      this.dropLift();
      this.restState = 'none';
      this.restProgress = 0;
      return false;
    }
    if (click.index < 0) return false;
    const aspect = this.aspect;
    const held = this.steady.update(click.centre.x, click.centre.y, t, aspect, click.size, tuning.restSteady);
    if (!this.restValid) {
      this.restState = 'settling';
      this.restProgress = Math.min(1, held / tuning.restHoldS);
      this.liftLevel = 0;
      if (held < tuning.restHoldS) return false;
      this.clickRest.x = this.steady.mean.x;
      this.clickRest.y = this.steady.mean.y;
      this.restValid = true;
    }
    this.restState = 'ready';
    this.restProgress = 1;
    const rest = this.clickRest;
    const dx = ((rest.x - click.centre.x) * aspect) / click.size;
    const dy = (click.centre.y - rest.y) / click.size;
    const along = dx * this.clickDir.x + dy * this.clickDir.y;
    const on = this.clickOn;
    this.clickThreshold.x = rest.x - (this.clickDir.x * on * click.size) / aspect;
    this.clickThreshold.y = rest.y + this.clickDir.y * on * click.size;

    let edge = false;
    if (this.clickSuspended) {
      this.dropLift();
    } else if (!this.liftOn) {
      if (this.liftHold.update(along >= on, t)) {
        this.liftOn = true;
        this.liftFrom = (this.liftHold.since ?? t) - tuning.backdateS;
        edge = true;
      }
    } else if (along < this.clickOff) {
      this.liftOn = false;
      this.liftHold.reset();
    }
    this.liftLevel = this.liftOn ? 1 : clamp01(along / on);

    // A resting hand sags and shifts: the rest follows it slowly, only near the rest, so a slow click move still crosses.
    if (!this.liftOn && held >= tuning.restHoldS && Math.hypot(dx, dy) < tuning.driftShare * on) {
      const k = 1 - Math.exp(-Math.min(1, click.gap) / tuning.driftTauS);
      rest.x += (click.centre.x - rest.x) * k;
      rest.y += (click.centre.y - rest.y) * k;
    }
    return edge;
  }

  private dropLift(): void {
    this.liftOn = false;
    this.liftHold.reset();
    this.liftLevel = 0;
    this.steady.reset();
  }

  private applyClick(): void {
    const tuning = this.tuning;
    const click = this.settings.click;
    const length = click ? Math.hypot(click.x, click.y) : 0;
    if (click && length > 1e-6) {
      this.clickDir.x = click.x / length;
      this.clickDir.y = click.y / length;
      this.clickOn = tuning.fitOn * length;
      this.clickOff = tuning.fitOff * length;
    } else {
      this.clickDir.x = 0;
      this.clickDir.y = -1;
      this.clickOn = tuning.liftOn;
      this.clickOff = tuning.liftOff;
    }
  }

  /** Gives this frame's hands their roles: by continuity first, then by side. */
  private assign(n: number, t: number, lostAfter: number): void {
    const tuning = this.tuning;
    const p = this.pointerSlot;
    const c = this.clickSlot;
    p.index = -1;
    c.index = -1;
    if (n === 0) return;
    const one = this.settings.pointing === 'one';
    const pLive = p.live(t, lostAfter);
    const cLive = !one && c.live(t, lostAfter);
    let pi = -1;
    let ci = -1;
    if (one) {
      if (n === 1) pi = 0;
      else if (pLive) pi = this.distance(p, 0) <= this.distance(p, 1) ? 0 : 1;
      else pi = this.seen[0].size >= this.seen[1].size ? 0 : 1;
    } else if (n === 2) {
      if (pLive || cLive) {
        const keep = this.cost(p, pLive, 0) + this.cost(c, cLive, 1);
        const swap = this.cost(p, pLive, 1) + this.cost(c, cLive, 0);
        pi = keep <= swap ? 0 : 1;
      } else {
        pi = this.pointerFirst(0, 1) ? 0 : 1;
      }
      ci = 1 - pi;
    } else if (pLive && cLive) {
      if (this.distance(p, 0) <= this.distance(c, 0)) pi = 0;
      else ci = 0;
    } else if (pLive) {
      // Far from the pointing hand: another hand, while the pointing one is only missed.
      if (this.distance(p, 0) <= tuning.matchRadius) pi = 0;
      else ci = 0;
    } else if (cLive) {
      if (this.distance(c, 0) <= tuning.matchRadius) ci = 0;
      else if (this.surelyPointer(0)) pi = 0;
    } else {
      const pNear = t - p.lastSeen < tuning.roleHoldS && this.distance(p, 0) <= tuning.matchRadius;
      const cNear = t - c.lastSeen < tuning.roleHoldS && this.distance(c, 0) <= tuning.matchRadius;
      if (pNear && (!cNear || this.distance(p, 0) <= this.distance(c, 0))) pi = 0;
      else if (cNear || !this.surelyPointer(0)) ci = 0;
      else pi = 0;
    }
    if (pi >= 0) this.observe(p, pi, t, lostAfter);
    if (ci >= 0) this.observe(c, ci, t, lostAfter);
    if (!one && !this.locked()) this.correctSides(t, lostAfter);
  }

  /** Young roles follow the side: two hands by their order, a lone hand once it is clearly on the other side. */
  private correctSides(t: number, lostAfter: number): void {
    const hold = this.tuning.roleHoldS;
    const p = this.pointerSlot;
    const c = this.clickSlot;
    if (p.index >= 0 && c.index >= 0) {
      if (p.age(t) < hold && c.age(t) < hold && !this.pointerFirst(p.index, c.index)) this.swapRoles();
    } else if (c.index >= 0) {
      if (c.age(t) < hold && !p.live(t, lostAfter) && this.surelyPointer(c.index)) this.swapRoles();
    } else if (p.index >= 0) {
      if (p.age(t) < hold && !c.live(t, lostAfter) && this.surelyClick(p.index)) this.swapRoles();
    }
  }

  private swapRoles(): void {
    const pointer = this.pointerSlot;
    this.pointerSlot = this.clickSlot;
    this.clickSlot = pointer;
    this.restValid = false;
    this.dropLift();
    if (!this.calibrated) this.recalibrate();
  }

  /** A press (or toggled drag) is under way: no hand changes role. */
  private locked(): boolean {
    return this.liftOn || this.actions.toggled || this.actions.wasPressed;
  }

  private observe(slot: TrackedPalm, index: number, t: number, lostAfter: number): void {
    const seen = this.seen[index];
    slot.observe(index, seen.x, seen.y, seen.size, t, lostAfter, this.tuning.sizeTauS);
  }

  /** From a followed hand's last place to a seen one, in that hand's palm sizes. */
  private distance(slot: TrackedPalm, index: number): number {
    const seen = this.seen[index];
    return Math.hypot((seen.x - slot.centre.x) * this.aspect, seen.y - slot.centre.y) / Math.max(slot.size, 1e-6);
  }

  private cost(slot: TrackedPalm, live: boolean, index: number): number {
    return live ? this.distance(slot, index) : 0;
  }

  /**
   * Seen hand `a` is on the pointing side of `b`. The camera sees the player's right hand on image-left
   * (smaller x), on screen-right in the mirrored picture.
   */
  private pointerFirst(a: number, b: number): boolean {
    return this.settings.pointing === 'left' ? this.seen[a].x >= this.seen[b].x : this.seen[a].x <= this.seen[b].x;
  }

  /** A lone hand clearly on the pointing hand's side of the frame. */
  private surelyPointer(index: number): boolean {
    const x = this.seen[index].x;
    return this.settings.pointing === 'left' ? x > 0.5 + this.tuning.sideBand : x < 0.5 - this.tuning.sideBand;
  }

  private surelyClick(index: number): boolean {
    const x = this.seen[index].x;
    return this.settings.pointing === 'left' ? x < 0.5 - this.tuning.sideBand : x > 0.5 + this.tuning.sideBand;
  }

  private label(pointing: boolean, clickLive: boolean): string {
    const actions = this.actions;
    if (actions.paused) return 'Paused';
    if (actions.toggled) return 'Dragging';
    if (this.frame.pressed && this.liftOn && this.settings.lift === 'hold') return 'Other hand: click';
    if (this.frame.pressed && this.keyDown) return 'Key held: click';
    if (clickLive && this.restState === 'settling') return 'Other hand: hold still';
    if (!pointing) return 'Show your pointing hand';
    return 'Hand';
  }

  private lose(): void {
    const f = this.frame;
    f.present = false;
    f.pressed = false;
    f.tap = false;
    f.pressure = 0;
    f.commandProgress = 0;
    f.label = '';
    this.dropLift();
    this.restState = 'none';
    this.restProgress = 0;
    this.mapper.pause();
    this.hasSignal = false;
    this.actions.toggled = false;
    this.actions.wasPressed = false;
    this.keyPresses = 0;
  }
}

function copyView(view: PalmView, slot: TrackedPalm, present: boolean): void {
  view.present = present;
  view.index = present ? slot.index : -1;
  view.x = slot.centre.x;
  view.y = slot.centre.y;
  view.size = slot.size;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
