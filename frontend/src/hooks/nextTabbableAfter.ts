// The control a forward Tab should land on when it leaves a portalled popover panel (HEL-1776): the first tabbable control
// after the trigger, as if the panel sat in the DOM right after it. The portal moved the panel to the end of <body> (or of
// the enclosing open <dialog>), so the browser's own "next element" after the panel is unrelated to the trigger.

const TABBABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function")
    return el.checkVisibility({ visibilityProperty: true });
  // No layout engine (jsdom): approximate from computed style up the ancestor chain.
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** Whether `el` is a tabbable control: `tabIndex >= 0`, enabled, not inert/hidden, rendered. */
export function isTabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest("[inert], [hidden]")) return false;
  return isVisible(el);
}

/** Next tabbable control after `trigger` in document order, within its focus scope (the enclosing open dialog, else the
 *  document), ignoring the trigger, anything inside it and the `panel`'s contents. When nothing follows: the scope's first
 *  such control for a dialog (matching the Modal's own wrap-around), else the trigger. Never `<body>`. The app uses no
 *  positive `tabindex`, so tab-index ordering is not modelled. */
export function nextTabbableAfter(trigger: HTMLElement, panel: HTMLElement | null): HTMLElement {
  const dialog = trigger.closest("dialog[open]");
  const scope: ParentNode = dialog ?? document.body;
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !trigger.contains(el) && !panel?.contains(el) && isTabbable(el),
  );
  const following = candidates.find(
    (el) => trigger.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  if (following) return following;
  return (dialog ? candidates[0] : undefined) ?? trigger;
}
