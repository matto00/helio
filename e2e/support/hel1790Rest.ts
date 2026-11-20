import type { Locator, Page } from "@playwright/test";

// HEL-1790: a control's "rest" paint may only be read once the pointer provably is not over it and the browser has
// finished any transition that leaving it started.
//
// Why a plain `noAnimations` is not enough: after a click the mouse stays where it was. A sheet that slides in under
// that stationary pointer can sweep a control beneath it; if the browser refreshes hover while it does, the control is
// `:hover` (and eases to its hover paint) when the slide lands, and the browser's follow-up refresh clears it only a
// little later, longer on a loaded runner. A read in that window returns the hover paint as "rest". The pointer is
// tracked from real mouse events (never from `:hover` alone, which reads false under touch while a fill persists; this
// is for the desktop, mouse-driven describe), and the transition back to rest is waited out, not slept.

/** Installs the pointer tracker; call before the first navigation (it re-installs on every document). */
export const trackPointer = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __helPointer?: { x: number; y: number } };
    const remember = (e: MouseEvent) => {
      w.__helPointer = { x: e.clientX, y: e.clientY };
    };
    for (const type of ["mousemove", "mousedown", "mouseup"]) {
      window.addEventListener(type, remember as EventListener, true);
    }
  });

type Want = "rest" | "hover";

/**
 * Resolves once `control` has reached `want` and the page is quiet: for "rest", not under the tracked pointer and not
 * `:hover`; for "hover", `:hover` and under the pointer (when a pointer is tracked); and in both, no animation or
 * transition running. Rejects after 10 s naming the observed state, so an unreachable precondition fails loudly.
 */
export const settle = (control: Locator, want: Want) =>
  control.evaluate(
    (el, w) =>
      new Promise<string>((resolve, reject) => {
        const observe = () => {
          const p = (window as unknown as { __helPointer?: { x: number; y: number } }).__helPointer;
          const under = p ? document.elementFromPoint(p.x, p.y) : null;
          const inside = !!under && el.contains(under);
          const hovered = el.matches(":hover");
          const live = document.getAnimations().filter((a) => a.playState === "running");
          const running = live.length > 0;
          const placed = w === "rest" ? !hovered && !inside : hovered && (p ? inside : true);
          const name = (a: Animation) => (a as CSSTransition).transitionProperty || a.id || "anim";
          const props = live.map(name);
          // The control's own animations, running or not (a transition that has not started shows as pending/idle).
          const own = el.getAnimations().map((a) => `${name(a)}:${a.playState}`);
          const border = getComputedStyle(el).borderTopColor;
          return {
            ok: placed && !running,
            hovered,
            inside,
            running,
            props,
            own,
            border,
            pointer: p ?? null,
          };
        };
        const started = performance.now();
        const deadline = started + 10_000;
        let first: ReturnType<typeof observe> | undefined;
        const tick = () => {
          const seen = observe();
          first ??= seen;
          if (seen.ok) {
            // First sample = what a read taken at this moment (the pre-fix behaviour) would have seen.
            const { ok: _ok, pointer: _pointer, ...f } = first;
            return resolve(
              `${w} waited=${Math.round(performance.now() - started)}ms first=${JSON.stringify(f)}`,
            );
          }
          if (performance.now() > deadline) {
            return reject(new Error(`control never reached ${w}: ${JSON.stringify(seen)}`));
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    want,
  );

export const settleToRest = (control: Locator) => settle(control, "rest");
export const settleToHover = (control: Locator) => settle(control, "hover");
