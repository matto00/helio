// Sheet motion helpers (HEL-1582, DESIGN.md §10): the two ways a bottom sheet moves after the finger lifts, both timed
// by motion tokens only. `settleSheet` slides the sheet's inline transform to an offset over `--motion-duration-move`;
// `fadeSheet` fades it over `--motion-duration-standard` (the Subtle exit, where the move token is instant). Each
// finishes at once when its token is instant (Subtle's move, Off, or an unresolved token such as in jsdom).

import { isInstant, readMotionDuration } from "./motionTokens";

/** Set on the sheet while a settle transition runs; `BottomSheet.css` gives it the move transition. */
export const SHEET_SETTLING_ATTRIBUTE = "data-sheet-settling";
/** Set on the sheet during a Subtle exit; `BottomSheet.css` fades it out. */
export const SHEET_EXITING_ATTRIBUTE = "data-sheet-exiting";

/** Remove every inline and attribute trace of a drag, settle or exit: at rest the sheet carries no transform. */
export function clearSheetMotion(sheet: HTMLElement): void {
  sheet.style.removeProperty("transform");
  sheet.removeAttribute(SHEET_SETTLING_ATTRIBUTE);
  sheet.removeAttribute(SHEET_EXITING_ATTRIBUTE);
}

/** Run `done` once `property` finishes transitioning on `sheet`; a timer sized from the token covers a transition
 *  that never starts (no change in value, or a hidden element). Returns a cancel function. */
function afterTransition(
  sheet: HTMLElement,
  property: string,
  durationMs: number,
  done: () => void,
): () => void {
  let finished = false;
  let timer = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    sheet.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
    done();
  };
  function onEnd(event: TransitionEvent) {
    if (event.target === sheet && event.propertyName === property) finish();
  }
  sheet.addEventListener("transitionend", onEnd);
  timer = window.setTimeout(finish, durationMs * 2);
  return () => {
    finished = true;
    sheet.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
  };
}

/** Slide the sheet to `offsetPx` below its rest position. `toRest` removes the inline transform afterwards (the
 *  contract: no transform at rest). `done` runs after the slide, or at once when the move token is instant. */
export function settleSheet(
  sheet: HTMLElement,
  offsetPx: number,
  toRest: boolean,
  done?: () => void,
): void {
  const duration = readMotionDuration("--motion-duration-move", sheet);
  const finish = () => {
    sheet.removeAttribute(SHEET_SETTLING_ATTRIBUTE);
    if (toRest) sheet.style.removeProperty("transform");
    done?.();
  };
  if (isInstant(duration)) {
    if (!toRest) sheet.style.transform = `translateY(${offsetPx}px)`;
    finish();
    return;
  }
  sheet.setAttribute(SHEET_SETTLING_ATTRIBUTE, "");
  sheet.style.transform = `translateY(${offsetPx}px)`;
  afterTransition(sheet, "transform", duration, finish);
}

/** Fade the sheet out (the Subtle exit): opacity only, the sheet keeps whatever offset the finger left it at. */
export function fadeSheet(sheet: HTMLElement, done: () => void): void {
  const duration = readMotionDuration("--motion-duration-standard", sheet);
  if (isInstant(duration)) {
    done();
    return;
  }
  sheet.setAttribute(SHEET_EXITING_ATTRIBUTE, "");
  afterTransition(sheet, "opacity", duration, done);
}
