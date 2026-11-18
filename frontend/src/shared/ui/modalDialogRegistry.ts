// modalDialogRegistry -- HEL-1736: the open modal <dialog>s, in the order they were opened. `Modal` is the only writer
// (it registers after `showModal()` and unregisters on every close path); readers (the toast viewport, via
// `useTopModalDialog`) subscribe instead of watching the document for `open` attribute changes. Any new native dialog
// must go through `Modal` so it lands here; `modalDialogRegistry.guard.test.ts` enforces that.

const open: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
let top: HTMLDialogElement | null = null;

function publish() {
  const next = open.at(-1) ?? null;
  if (next === top) return;
  top = next;
  listeners.forEach((listener) => listener());
}

/** Marks a dialog open (call after `showModal()`). Idempotent: a dialog already registered keeps its place. */
export function registerOpenModal(dialog: HTMLDialogElement): void {
  if (!dialog.open || open.includes(dialog)) return;
  open.push(dialog);
  publish();
}

/** Marks a dialog closed. Unknown dialogs are a no-op. */
export function unregisterOpenModal(dialog: HTMLDialogElement): void {
  const index = open.indexOf(dialog);
  if (index === -1) return;
  open.splice(index, 1);
  publish();
}

export function subscribeOpenModals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The most recently opened modal dialog, or null. A stable reference between changes. */
export function getTopOpenModal(): HTMLDialogElement | null {
  return top;
}

/** Test-only: empties the registry. */
export function resetModalDialogRegistryForTests(): void {
  open.length = 0;
  publish();
}
