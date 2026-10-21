import { useEffect, useRef, useState } from "react";

import { pushDragSample, velocityOf, type DragSample } from "./dragVelocity";
import { isInstant, readMotionDuration } from "./motionTokens";
import { settleOffset } from "./sheetMotion";

/** The scroller the gesture listens on and contains overscroll for. */
export const PULL_SCROLLER_SELECTOR = ".app-content";
/** Set on the scroller while the gesture is attached; the stylesheet scopes `overscroll-behavior-y: contain` to it. */
export const PULL_CONTAINMENT_ATTRIBUTE = "data-pull-refresh";
/** Set on the translated element while a settle transition runs; the stylesheet gives it the move transition. */
export const PULL_SETTLING_ATTRIBUTE = "data-pull-settling";
/** Set on the translated element's wrapper while a Full-motion pull is engaged or held, so the stylesheet can clip the indicator. */
export const PULL_ACTIVE_ATTRIBUTE = "data-pull-active";
/** Custom property on the translated element: pull distance over the threshold, 0 to 1 (drives the arrow's rotation). */
export const PULL_PROGRESS_PROPERTY = "--pull-progress";

/** Finger travel before the gesture decides to engage or to leave the touch to the browser. */
export const PULL_SLOP_PX = 6;
/** The finger travels this many px per px the content follows. */
const PULL_DAMPING = 0.5;
/** The most the content ever follows the finger. */
export const PULL_MAX_PX = 112;
/** Damped distance a release must reach to refresh. */
export const PULL_THRESHOLD_PX = 64;
/** Where the content rests while the refresh runs. */
export const PULL_HOLD_PX = 48;
/** A release faster than this many px/ms (downward) counts as past the threshold from this share of it. */
export const PULL_FLICK_VELOCITY = 0.5;
const PULL_FLICK_SHARE = 0.75;

/** A touch that starts on one of these keeps its own behaviour (text selection, caret, picker). */
const FORM_CONTROL = 'input, select, textarea, [contenteditable="true"]';

export type PullPhase = "idle" | "pulling" | "ready" | "done";

export interface PullState {
  /** `pulling` below the threshold, `ready` at or past it, `done` from the release that started a Full-motion refresh
   *  round until the content is back at rest (the held and settling stretches, so the label never falls back to
   *  "pull" while the stack settles), `idle` otherwise. */
  phase: PullPhase;
  /** True from engagement until the content is back at rest (including the held and settling stretches). */
  active: boolean;
  /** True when the content follows the finger (Full motion); false when the visual snaps with no movement. */
  follows: boolean;
}

const IDLE_STATE: PullState = { phase: "idle", active: false, follows: false };

interface UsePullToRefreshOptions {
  /** The element whose descendants may start a pull (the phone stack); `null` until it mounts. */
  root: HTMLElement | null;
  /** The element that follows the finger under Full motion (the stack); `null` until it mounts. */
  target: HTMLElement | null;
  /** The element carrying `data-pull-active` (the stack's wrapper); `null` until it mounts. */
  wrapper: HTMLElement | null;
  /** Called on a release past the threshold. Return `true` when a refresh round started (the content then holds at
   *  `PULL_HOLD_PX` until `busy` turns false), `false` when there is nothing to wait for (the content settles at once). */
  onRefresh: () => boolean;
  /** Whether the gesture may attach (the caller passes the phone-shell boundary, DESIGN.md §4). */
  enabled: boolean;
  /** True while a refresh round runs; the held content settles back to rest when it turns false. */
  busy: boolean;
}

interface Gesture {
  startX: number;
  startY: number;
  originY: number;
  engaged: boolean;
  ignored: boolean;
  samples: DragSample[];
  pull: number;
}

/** Pull-down-to-refresh for a scrolling page (HEL-1656, DESIGN.md §10). Touch events on the page scroller, not pointer
 *  capture: on a scroller the browser claims the touch for panning and cancels the pointer stream, so the gesture
 *  decides after `PULL_SLOP_PX` of travel whether it is a downward, vertical-dominant, single-finger pull that began
 *  with the scroller at its top and outside any nested scroller already scrolled away from its own top. Only then does
 *  it call `preventDefault` on `touchmove` (the touch listener is non-passive for that one purpose); every other touch
 *  is left to scroll normally. Attached only while `enabled`, and while attached it marks the scroller so
 *  its overscroll is contained (the browser's own pull-to-refresh and glow never fire alongside this one).
 *
 *  Under Full motion the target follows the finger damped by `PULL_DAMPING` with an inline `translateY` (no transition
 *  while dragging) and settles over the move token; under Subtle, Off and OS reduced motion (the move token is instant)
 *  nothing translates, and the returned phase is the only visual. At rest the target carries no inline transform. */
export function usePullToRefresh({
  root,
  target,
  wrapper,
  onRefresh,
  enabled,
  busy,
}: UsePullToRefreshOptions): PullState {
  const [state, setState] = useState<PullState>(IDLE_STATE);
  const onRefreshRef = useRef(onRefresh);
  const phaseRef = useRef<PullPhase>("idle");
  const holdingRef = useRef(false);
  const busyRef = useRef(busy);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (root === null || target === null || wrapper === null || !enabled) return undefined;
    const scroller = root.closest<HTMLElement>(PULL_SCROLLER_SELECTOR);
    if (scroller === null) return undefined;
    const moving = target;
    const outer = wrapper;
    let gesture: Gesture | null = null;
    scroller.setAttribute(PULL_CONTAINMENT_ATTRIBUTE, "");

    function setPhaseOnce(next: PullPhase) {
      if (phaseRef.current === next) return;
      phaseRef.current = next;
      setState((prev) => ({ ...prev, phase: next }));
    }

    function follows(): boolean {
      return !isInstant(readMotionDuration("--motion-duration-move", moving));
    }

    function clearMotion() {
      moving.style.removeProperty("transform");
      moving.style.removeProperty(PULL_PROGRESS_PROPERTY);
      moving.removeAttribute(PULL_SETTLING_ATTRIBUTE);
      outer.removeAttribute(PULL_ACTIVE_ATTRIBUTE);
      phaseRef.current = "idle";
      setState(IDLE_STATE);
    }

    function settleToRest() {
      holdingRef.current = false;
      setPhaseOnce("idle");
      if (moving.style.transform === "") {
        clearMotion();
        return;
      }
      settleOffset(moving, 0, true, PULL_SETTLING_ATTRIBUTE, clearMotion);
    }

    function insideScrolledNested(start: Element | null): boolean {
      for (let el = start; el !== null && el !== scroller; el = el.parentElement) {
        if (el instanceof HTMLElement && el.scrollTop > 0) return true;
      }
      return false;
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        if (gesture?.engaged) release(false);
        gesture = null;
        return;
      }
      gesture = null;
      const touch = event.touches[0];
      const eventTarget = event.target as Element | null;
      const eligible =
        eventTarget !== null &&
        root !== null &&
        root.contains(eventTarget) &&
        scroller !== null &&
        scroller.scrollTop <= 0 &&
        !busyRef.current &&
        !moving.hasAttribute(PULL_SETTLING_ATTRIBUTE) &&
        eventTarget.closest(FORM_CONTROL) === null &&
        !insideScrolledNested(eventTarget);
      if (!eligible) return;
      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        originY: touch.clientY,
        engaged: false,
        ignored: false,
        samples: [{ t: performance.now(), y: touch.clientY }],
        pull: 0,
      };
    }

    function onTouchMove(event: TouchEvent) {
      const g = gesture;
      if (g === null || g.ignored) return;
      if (event.touches.length !== 1) {
        if (g.engaged) release(false);
        g.ignored = true;
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;
      if (!g.engaged) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < PULL_SLOP_PX) return;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && scroller !== null && scroller.scrollTop <= 0) {
          g.engaged = true;
          g.originY = g.startY + PULL_SLOP_PX;
          // Only the following (Full-motion) indicator needs the clip; the snap pill must never be clipped.
          if (follows()) outer.setAttribute(PULL_ACTIVE_ATTRIBUTE, "");
          phaseRef.current = "pulling";
          setState({ phase: "pulling", active: true, follows: follows() });
        } else {
          g.ignored = true;
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      pushDragSample(g.samples, { t: performance.now(), y: touch.clientY });
      g.pull = Math.min(PULL_MAX_PX, Math.max(0, touch.clientY - g.originY) * PULL_DAMPING);
      if (follows()) {
        moving.style.transform = `translateY(${g.pull}px)`;
        moving.style.setProperty(
          PULL_PROGRESS_PROPERTY,
          String(Math.min(1, g.pull / PULL_THRESHOLD_PX)),
        );
      }
      setPhaseOnce(g.pull >= PULL_THRESHOLD_PX ? "ready" : "pulling");
    }

    function release(allowRefresh: boolean) {
      const g = gesture;
      gesture = null;
      if (g === null || !g.engaged) return;
      const past =
        allowRefresh &&
        (g.pull >= PULL_THRESHOLD_PX ||
          (velocityOf(g.samples) > PULL_FLICK_VELOCITY &&
            g.pull >= PULL_THRESHOLD_PX * PULL_FLICK_SHARE));
      if (past && onRefreshRef.current()) {
        holdingRef.current = true;
        if (follows()) {
          setPhaseOnce("done");
          settleOffset(moving, PULL_HOLD_PX, false, PULL_SETTLING_ATTRIBUTE);
        } else {
          setPhaseOnce("idle");
          clearMotion();
        }
        return;
      }
      settleToRest();
    }

    function onTouchEnd() {
      release(true);
    }
    function onTouchCancel() {
      release(false);
    }

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchCancel);
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchCancel);
      scroller.removeAttribute(PULL_CONTAINMENT_ATTRIBUTE);
      gesture = null;
      holdingRef.current = false;
      clearMotion();
    };
  }, [root, target, wrapper, enabled]);

  // The held content settles back to rest once the refresh round ends.
  useEffect(() => {
    if (busy || !holdingRef.current || target === null || wrapper === null) return;
    holdingRef.current = false;
    const clear = () => {
      target.style.removeProperty("transform");
      target.style.removeProperty(PULL_PROGRESS_PROPERTY);
      target.removeAttribute(PULL_SETTLING_ATTRIBUTE);
      wrapper.removeAttribute(PULL_ACTIVE_ATTRIBUTE);
      phaseRef.current = "idle";
      setState(IDLE_STATE);
    };
    if (target.style.transform === "") {
      clear();
      return;
    }
    settleOffset(target, 0, true, PULL_SETTLING_ATTRIBUTE, clear);
  }, [busy, target, wrapper]);

  return state;
}
