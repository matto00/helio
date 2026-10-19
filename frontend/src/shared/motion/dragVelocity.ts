// Drag velocity shared by the gestures in this folder (bottom-sheet swipe, pull-to-refresh): a short window of
// recent pointer samples, and the mean vertical speed across it. A gesture measures flick speed, not whole-drag speed.

/** Velocity is measured over the last this-many milliseconds of the drag. */
export const VELOCITY_WINDOW = 100;

export interface DragSample {
  t: number;
  y: number;
}

/** Append `sample` and drop the ones that fell out of the window (always keeping at least two). */
export function pushDragSample(samples: DragSample[], sample: DragSample): void {
  samples.push(sample);
  while (samples.length > 2 && sample.t - samples[0].t > VELOCITY_WINDOW) {
    samples.shift();
  }
}

/** Mean vertical speed over the retained samples, in px per millisecond (positive = downward); 0 with no elapsed time. */
export function velocityOf(samples: readonly DragSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
