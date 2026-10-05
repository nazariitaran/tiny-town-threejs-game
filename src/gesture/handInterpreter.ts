/**
 * One tracked hand → pointer, click, grab and commands (pure; no DOM, no MediaPipe).
 *
 *  pointer  the pinch point (between thumb and index tips, steadied by the index knuckle), mirrored,
 *           with the comfortable middle of the camera frame stretched to the whole screen
 *  click    pinch thumb and index tips together (distance relative to the hand's size, with hysteresis)
 *  grab     a closed fist drags the map; two fists zoom by moving apart / together
 *  rotate   ✌ held briefly · cancel (Esc) 👎 held briefly
 */
import { createGestureFrame, type GestureFrame, type HandObservation, type Point3 } from './protocol';
import { PointerSmoother } from './pointerSmoother';
import type { OneEuroTuning } from './oneEuro';
import { HoldTrigger, Latch, ThresholdSwitch } from './triggers';

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;

/** The part of the (mirrored) camera frame that maps to the whole screen, as fractions of the frame. */
export interface Region {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface HandTuning {
  region: Region;
  filter: OneEuroTuning;
  /** Pinch ratio (tip gap / wrist-to-knuckle length) at or below which a pinch closes, and above which it opens. */
  pinchClose: number;
  pinchOpen: number;
  /** A pinch must read closed on this many frames in a row before it presses. */
  pinchFrames: number;
  /** The ratio of a relaxed, open hand: the cursor ring starts filling below it. */
  pinchRelaxed: number;
  /** Canned-gesture score needed to count a fist, ✌ or 👎. */
  gestureScore: number;
  grabOnS: number;
  grabOffS: number;
  commandHoldS: number;
  /** A hand missing for this long is gone (a press is released). */
  lostS: number;
  /**
   * Which hand counts when several are seen: 'follow' keeps the one it had (it moves the pointer);
   * 'pinch' takes the most closed one (head + hand mode: any hand may click).
   */
  pick: 'follow' | 'pinch';
}

export const DEFAULT_HAND_TUNING: HandTuning = {
  region: { left: 0.18, right: 0.82, top: 0.12, bottom: 0.72 },
  filter: { minCutoff: 1.0, beta: 6, dCutoff: 1 },
  pinchClose: 0.3,
  pinchOpen: 0.45,
  pinchFrames: 2,
  pinchRelaxed: 0.9,
  gestureScore: 0.55,
  grabOnS: 0.12,
  grabOffS: 0.15,
  commandHoldS: 0.35,
  lostS: 0.2,
  pick: 'follow',
};

/** Distance in the image plane, with x scaled by the frame's aspect so both axes are in frame heights. */
export function imageDistance(a: Point3, b: Point3, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Thumb-to-index tip gap relative to the hand's size: ~1 for an open hand, under 0.3 for a pinch. Distance-from-camera invariant. */
export function pinchRatio(hand: readonly Point3[], aspect: number): number {
  const size = imageDistance(hand[WRIST], hand[MIDDLE_MCP], aspect);
  return size > 1e-6 ? imageDistance(hand[THUMB_TIP], hand[INDEX_TIP], aspect) / size : Infinity;
}

/** The point the cursor follows, in image coordinates. Moves little while the fingers close into a pinch. */
export function pinchPoint(hand: readonly Point3[], out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const tipX = (hand[THUMB_TIP].x + hand[INDEX_TIP].x) / 2;
  const tipY = (hand[THUMB_TIP].y + hand[INDEX_TIP].y) / 2;
  out.x = 0.6 * tipX + 0.4 * hand[INDEX_MCP].x;
  out.y = 0.6 * tipY + 0.4 * hand[INDEX_MCP].y;
  return out;
}

/** Image point → viewport fraction: mirrored (it moves the way you see yourself) and stretched from `region`, clamped to [0, 1]. */
export function imageToScreen(x: number, y: number, region: Region, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const mirrored = 1 - x;
  out.x = Math.min(1, Math.max(0, (mirrored - region.left) / (region.right - region.left)));
  out.y = Math.min(1, Math.max(0, (y - region.top) / (region.bottom - region.top)));
  return out;
}

const GESTURE_LABEL: Record<string, string> = {
  Closed_Fist: 'Fist',
  Open_Palm: 'Open hand',
  Pointing_Up: 'Pointing',
  Thumb_Down: 'Thumb down',
  Thumb_Up: 'Thumb up',
  Victory: 'Victory',
  ILoveYou: 'Rock on',
};

export class HandInterpreter {
  readonly frame: GestureFrame = createGestureFrame();
  readonly pointer: PointerSmoother;
  private readonly pinch: ThresholdSwitch;
  private readonly grab: Latch;
  private readonly rotate: HoldTrigger;
  private readonly cancel: HoldTrigger;
  private lastSeen = -Infinity;
  /** The tracked hand's pinch point last frame (image coords), to follow the same hand when two are seen. */
  private readonly last = { x: 0.5, y: 0.5 };
  private hasLast = false;
  private readonly grabFrom = { x: 0, y: 0 };
  private grabbing = false;
  private zoomFrom = 0;
  private readonly scratch = { x: 0, y: 0 };
  private readonly screen = { x: 0, y: 0 };

  constructor(readonly tuning: HandTuning = DEFAULT_HAND_TUNING) {
    this.pointer = new PointerSmoother(tuning.filter);
    this.pinch = new ThresholdSwitch(tuning.pinchClose, tuning.pinchOpen, tuning.pinchFrames);
    this.grab = new Latch(tuning.grabOnS, tuning.grabOffS);
    this.rotate = new HoldTrigger(tuning.commandHoldS);
    this.cancel = new HoldTrigger(tuning.commandHoldS);
  }

  /** `aspect`: camera frame width / height. */
  update(hands: readonly HandObservation[], aspect: number, t: number): GestureFrame {
    const f = this.frame;
    const tuning = this.tuning;
    f.command = null;
    f.zoom = 1;
    f.grabDx = 0;
    f.grabDy = 0;

    if (hands.length >= 2 && this.isFist(hands[0]) && this.isFist(hands[1])) {
      this.twoHandZoom(hands[0], hands[1], aspect);
    } else {
      this.zoomFrom = 0;
    }

    const hand = this.pickHand(hands, aspect);
    if (!hand) {
      if (t - this.lastSeen >= tuning.lostS) this.lose();
      return f;
    }
    this.lastSeen = t;
    f.present = true;

    const anchor = pinchPoint(hand.landmarks, this.scratch);
    this.last.x = anchor.x;
    this.last.y = anchor.y;
    this.hasLast = true;
    const screen = imageToScreen(anchor.x, anchor.y, tuning.region, this.screen);

    const fist = this.isFist(hand) && this.zoomFrom === 0;
    this.grab.update(fist, t);

    const ratio = pinchRatio(hand.landmarks, aspect);
    // No click while grabbing or zooming, and a fist never starts one (its thumb rests on the index).
    const pressedNow = this.pinch.update(ratio, !this.grab.on && this.zoomFrom === 0 && (this.pinch.on || !fist)) && this.pinch.on;
    f.pressed = this.pinch.on;
    f.pressure = f.pressed ? 1 : clamp01((tuning.pinchRelaxed - ratio) / (tuning.pinchRelaxed - tuning.pinchClose));

    this.pointer.update(screen.x, screen.y, t);
    if (pressedNow) this.pointer.pressAt(t);
    f.x = this.pointer.point.x;
    f.y = this.pointer.point.y;

    // Grab deltas come from the unclamped, unsmoothed hand, so the map keeps moving at the frame's edge.
    f.grab = this.grab.on && this.zoomFrom === 0;
    if (f.grab) {
      const region = tuning.region;
      const gx = (1 - anchor.x) / (region.right - region.left);
      const gy = anchor.y / (region.bottom - region.top);
      if (this.grabbing) {
        f.grabDx = gx - this.grabFrom.x;
        f.grabDy = gy - this.grabFrom.y;
      }
      this.grabFrom.x = gx;
      this.grabFrom.y = gy;
    }
    this.grabbing = f.grab;

    const quiet = !f.pressed && !f.grab;
    const score = hand.gestureScore >= tuning.gestureScore;
    if (this.rotate.update(quiet && score && hand.gesture === 'Victory', t)) f.command = 'rotate';
    if (this.cancel.update(quiet && score && hand.gesture === 'Thumb_Down', t)) f.command = 'cancel';
    f.commandProgress = Math.max(this.rotate.progress, this.cancel.progress);

    f.label = this.zoomFrom !== 0 ? 'Two fists: zoom' : f.grab ? 'Fist: dragging the map' : f.pressed ? 'Pinch' : score ? GESTURE_LABEL[hand.gesture] ?? 'Hand' : 'Hand';
    return f;
  }

  reset(): void {
    this.lose();
    this.lastSeen = -Infinity;
  }

  private lose(): void {
    const f = this.frame;
    f.present = false;
    f.pressed = false;
    f.pressure = 0;
    f.grab = false;
    f.commandProgress = 0;
    f.label = '';
    this.pinch.reset();
    this.grab.reset();
    this.rotate.reset();
    this.cancel.reset();
    this.pointer.reset();
    this.grabbing = false;
    this.zoomFrom = 0;
    this.hasLast = false;
  }

  private isFist(hand: HandObservation): boolean {
    return hand.gesture === 'Closed_Fist' && hand.gestureScore >= this.tuning.gestureScore;
  }

  /** 'follow': the hand nearest the one followed last frame, else the biggest (nearest the camera). 'pinch': the most closed. */
  private pickHand(hands: readonly HandObservation[], aspect: number): HandObservation | null {
    if (hands.length <= 1) return hands[0] ?? null;
    let best: HandObservation | null = null;
    let bestScore = Infinity;
    for (const hand of hands) {
      const point = pinchPoint(hand.landmarks, this.scratch);
      const score = this.tuning.pick === 'pinch'
        ? pinchRatio(hand.landmarks, aspect)
        : this.hasLast
        ? Math.hypot(point.x - this.last.x, point.y - this.last.y)
        : -imageDistance(hand.landmarks[WRIST], hand.landmarks[MIDDLE_MCP], 1);
      if (score < bestScore) {
        bestScore = score;
        best = hand;
      }
    }
    return best;
  }

  private twoHandZoom(a: HandObservation, b: HandObservation, aspect: number): void {
    const gap = imageDistance(a.landmarks[MIDDLE_MCP], b.landmarks[MIDDLE_MCP], aspect);
    if (this.zoomFrom > 0 && gap > 1e-3) this.frame.zoom = gap / this.zoomFrom;
    this.zoomFrom = Math.max(gap, 1e-3);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
