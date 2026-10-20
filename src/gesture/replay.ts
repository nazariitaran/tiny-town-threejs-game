/**
 * Runs recorded tracking frames through an interpreter the way `HandsFree.onFrame` does, for tests and for
 * tuning on real sessions. The caller configures the interpreter (bindings, calibration) first.
 */
import type { HandInterpreter } from './handInterpreter';
import type { HeadInterpreter } from './headInterpreter';
import type { PalmInterpreter } from './palmInterpreter';
import type { RecordedFrame } from './recorder';
import type { GestureFrame } from './protocol';

/** Head frames, as a camera start resets the interpreter. Returns a copy of each result. */
export function replayHead(frames: readonly RecordedFrame[], interpreter: HeadInterpreter): GestureFrame[] {
  interpreter.reset();
  return frames.map((frame) => ({ ...interpreter.update(frame.face, frame.t) }));
}

/** Hand frames, with the tracker's aspect ratio. Returns a copy of each result. */
export function replayHands(frames: readonly RecordedFrame[], interpreter: HandInterpreter, aspect: number): GestureFrame[] {
  interpreter.reset();
  return frames.map((frame) => ({ ...interpreter.update(frame.hands, aspect, frame.t) }));
}

/** Palms frames, with the tracker's aspect ratio. Returns a copy of each result. */
export function replayPalms(frames: readonly RecordedFrame[], interpreter: PalmInterpreter, aspect: number): GestureFrame[] {
  interpreter.reset();
  return frames.map((frame) => ({ ...interpreter.update(frame.hands, aspect, frame.t) }));
}
