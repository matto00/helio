/** Focus, pinning and reveal management for the overview tables' row Delete (HEL-1574, HEL-1605). A delete confirm
 *  is a row inserted under the clicked row; these helpers keep the gesture stable (the clicked button does not move
 *  under the pointer), reveal the confirm once the double-click window has passed, and keep focus somewhere sensible
 *  when the confirm or the row unmounts. */

/** Chromium/Windows default double-click time (GTK 400). A pointer activation reveals the confirm this long after
 *  its last click, so the second press of a double-click never lands on a page that scrolled in between. */
export const REVEAL_DELAY_MS = 500;

type ActivationMode = "keyboard" | "pointer";

interface PinRecord {
  button: HTMLElement;
  top: number;
  scrollers: Element[];
}

let mode: ActivationMode = "pointer";
let pin: PinRecord | null = null;
let pinFrame: number | null = null;
let mounted: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Test-only: clears module state between jest tests. */
export function resetRowDeleteFocusForTests(): void {
  clearTimer();
  discardPin();
  mounted = null;
  mode = "pointer";
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  window.removeEventListener("wheel", clearTimer, true);
  window.removeEventListener("touchstart", clearTimer, true);
}

function arm(target: HTMLElement): void {
  clearTimer();
  timer = setTimeout(() => {
    clearTimer();
    if (mounted === target && target.isConnected) target.scrollIntoView?.({ block: "nearest" });
  }, REVEAL_DELAY_MS);
  // A user already scrolling must not be pulled back by the reveal.
  window.addEventListener("wheel", clearTimer, { capture: true, passive: true });
  window.addEventListener("touchstart", clearTimer, { capture: true, passive: true });
}

function discardPin(): void {
  pin = null;
  if (pinFrame !== null) cancelAnimationFrame(pinFrame);
  pinFrame = null;
}

/** Every ancestor that may scroll vertically (overflow auto/scroll), nearest first, ending at the document scroller.
 *  Overflow is deliberately NOT tested here: a table scroller can overflow by a sub-pixel or a single pixel
 *  (measured at 768 on Sources: scrollHeight 998 vs clientHeight 997), so "really scrolls" is only knowable by
 *  trying; `applyPin` hands whatever an element could not absorb to the next one. */
function scrollerChain(from: HTMLElement): Element[] {
  const chain: Element[] = [];
  for (let node = from.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") chain.push(node);
  }
  chain.push(document.scrollingElement ?? document.documentElement);
  return chain;
}

function applyPin(): void {
  const record = pin;
  discardPin();
  if (record === null || !record.button.isConnected) return;
  let remaining = record.button.getBoundingClientRect().top - record.top;
  for (const scroller of record.scrollers) {
    if (Math.abs(remaining) < 0.5) return;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + remaining;
    remaining -= scroller.scrollTop - before;
  }
}

/** Record how Delete was activated; called from the row Delete button's click handler with the click's `detail` and
 *  the button. Every activation overwrites the pin record (a keyboard one clears it). A pointer activation records
 *  where the button is so the commit that opens the confirm can keep it there; a record its own commit did not
 *  consume (the second click of a double-click commits nothing) is discarded on the next animation frame. */
export function noteDeleteActivation(clickDetail: number, button: HTMLElement): void {
  discardPin();
  if (clickDetail === 0) {
    mode = "keyboard";
    clearTimer();
    return;
  }
  mode = "pointer";
  pin = { button, top: button.getBoundingClientRect().top, scrollers: scrollerChain(button) };
  const record = pin;
  pinFrame = requestAnimationFrame(() => {
    pinFrame = null;
    if (pin === record) pin = null;
  });
  // A confirm already mounted gets no new commit from this click: push its reveal to REVEAL_DELAY_MS after it.
  if (mounted !== null) arm(mounted);
}

/** Ref callback for the confirm panel. On attach it takes focus without scrolling (`preventScroll`), applies the
 *  pending pin, then reveals: immediately after a keyboard activation, after REVEAL_DELAY_MS after a pointer one.
 *  On detach (`null`) it cancels any pending reveal but keeps the mode, so a StrictMode re-attach or a switch to
 *  another row's confirm re-arms. A stable function, so React calls it on mount only. */
export function focusOnMount(element: HTMLElement | null): void {
  if (element === null) {
    clearTimer();
    mounted = null;
    return;
  }
  mounted = element;
  element.focus({ preventScroll: true });
  applyPin();
  if (mode === "keyboard") element.scrollIntoView?.({ block: "nearest" });
  else arm(element);
}

function deleteButtonSelector(name: string): string {
  return `button[aria-label="Delete ${name.replace(/["\\]/g, "\\$&")}"]`;
}

/** After the next paint, focus the Delete button of the row named `name` (Cancel, or a refused delete). */
export function focusRowDelete(name: string): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(deleteButtonSelector(name))?.focus();
  });
}

/** The accessible name of the Delete button on the row after `name`'s row, else the one before it; null when the row
 *  is alone. Read BEFORE the delete so the neighbour is known once the row is gone. */
export function neighbourDeleteLabel(name: string): string | null {
  const row = document.querySelector(deleteButtonSelector(name))?.closest("tr");
  if (row == null) return null;
  const labelOf = (candidate: Element | null): string | null =>
    candidate?.querySelector("button[aria-label^='Delete ']")?.getAttribute("aria-label") ?? null;
  // The confirm is an inserted row (no Delete button), so skip rows without one in each direction.
  for (let next = row.nextElementSibling; next !== null; next = next.nextElementSibling) {
    const label = labelOf(next);
    if (label !== null) return label;
  }
  for (let prev = row.previousElementSibling; prev !== null; prev = prev.previousElementSibling) {
    const label = labelOf(prev);
    if (label !== null) return label;
  }
  return null;
}

/** After a successful delete: focus the neighbouring row's Delete button, else the page heading (made focusable). */
export function focusAfterRowDeleted(neighbourLabel: string | null, pageSelector: string): void {
  requestAnimationFrame(() => {
    const neighbour =
      neighbourLabel === null
        ? null
        : document.querySelector<HTMLElement>(
            `button[aria-label="${neighbourLabel.replace(/["\\]/g, "\\$&")}"]`,
          );
    if (neighbour !== null) {
      neighbour.focus();
      return;
    }
    const heading = document.querySelector<HTMLElement>(`${pageSelector} h1`);
    if (heading !== null) {
      heading.tabIndex = -1;
      heading.focus();
    }
  });
}
