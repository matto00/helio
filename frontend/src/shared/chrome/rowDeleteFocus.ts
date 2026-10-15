/** Keyboard focus management for the overview tables' row Delete (HEL-1574). A delete confirm and, after a success,
 *  the row itself unmount, which would drop focus on <body>; these helpers keep it somewhere sensible. */

/** Whether the confirm should be scrolled into view. Only a keyboard activation (`click` with `detail === 0`) does:
 *  that user cannot scroll to it by pointing, and nothing else is about to click. A pointer activation may be the
 *  first half of a double-click, and moving the page under the pointer between its two clicks sends the second one
 *  to whatever slid under it (HEL-1604); the confirm is inserted directly below the row just clicked, so a pointer
 *  user finds it where they are. Deterministic: no timers. */
let revealImmediately = false;

/** Record how Delete was activated; called from the row Delete button's click handler. */
export function noteDeleteActivation(clickDetail: number): void {
  revealImmediately = clickDetail === 0;
}

/** Moves focus to the confirm panel when it appears, so a keyboard user lands on it (and hears its name). Focus never
 *  scrolls the page by itself (`preventScroll`); a keyboard activation then reveals the confirm explicitly. A stable
 *  function, so React calls it on mount only. */
export function focusOnMount(element: HTMLElement | null): void {
  if (element === null) return;
  element.focus({ preventScroll: true });
  if (revealImmediately) element.scrollIntoView?.({ block: "nearest" });
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
