/** Keyboard focus management for the overview tables' row Delete (HEL-1574). A delete confirm and, after a success,
 *  the row itself unmount, which would drop focus on <body>; these helpers keep it somewhere sensible. */

/** Moves focus to the confirm panel when it appears, so a keyboard user lands on it (and hears its name). A stable
 *  function, so React calls it on mount only. */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
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
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
  return (
    neighbour?.querySelector("button[aria-label^='Delete ']")?.getAttribute("aria-label") ?? null
  );
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
