## Context

`usePortalPopover` (frontend/src/hooks/usePortalPopover.ts) gives consumers that attach `panelRef` a document `focusout`
listener: when focus leaves trigger+panel the popover closes, and since HEL-1759, when the move was a keyboard Tab
(`tabbingRef`, set by a capture-phase keydown tracker) starting inside the panel, focus is sent back to the trigger in a
microtask. The handler does not know the Tab's direction. See proposal.md for the owner ruling.

Consumers that attach `panelRef` (grep `panelRef.current = el` / `hookPanelRef`): `ActionsMenu` (`:148`), `Select` (`:208`),
`DashboardAppearanceEditor`, `OutputSchemaDisclosure` (`:47,70`), `ProvenancePopover` (via `useProvenancePopoverHost`). The panels are portalled to the end of
`<body>`, or into the enclosing `dialog[open]` (ActionsMenu/Select inside the phone step sheet, ProvenancePopover). So the
browser's own "next element" after the panel is unrelated to the trigger - or, when the panel is the document's last
tabbable, is outside the document (`relatedTarget === null`, which the current handler ignores, leaving the menu open).

HEL-1736 (Modal-written `modalDialogRegistry`) and HEL-1762 (`panelFit` bottom inset) do not touch this path: the registry
decides which dialog is top for Escape/back handling; panelFit only positions. The Modal's own HEL-716 Tab trap
(`Modal.tsx`, keydown on the `<dialog>`, wraps first/last of `FOCUSABLE_SELECTORS`) is relevant only to the in-dialog case
below.

## Goals / Non-Goals

**Goals:** forward Tab out of a panel lands on the next tabbable after the trigger (never the trigger, never `<body>`);
Shift+Tab unchanged; one rule in the hook, no per-consumer option.

**Non-Goals:** changing ProvenancePopover's own Tab wrap, Select's virtual focus, Escape handling, pointer behaviour,
consumers without `panelRef`, or what a closed appearance editor does with an unsaved pick (it is discarded on any close,
before and after this change).

## Decisions

### D1. Direction-aware Tab tracking
The existing capture-phase keydown tracker records the direction (`"forward" | "backward" | null`) instead of a boolean;
every other clearing rule (other key, pointerdown, each focusout, the one-timer-tick expiry, close) is unchanged.

### D2. Forward Tab is intercepted on the panel element itself
Revised after design-gate round 1. A `document`-level listener is pre-empted by any trap on an ancestor of the panel:
the phone step sheet is `BottomSheet` -> `Modal`, `ActionsMenu` portals its panel into that `dialog[open]`, and Modal's
HEL-716 trap (native keydown on the `<dialog>`, `FOCUSABLE_SELECTORS` starting `button:not([disabled])`, so the
`tabIndex=-1` menu items match) would `preventDefault()` and wrap to the dialog's first focusable - most likely the
trigger itself, the overruled behaviour - before a document listener ever ran. So the hook attaches a native `keydown`
listener to the panel element (the same depth trick `ProvenancePopover.tsx:103-106` documents). On a forward Tab
(`key === "Tab" && !shiftKey`) whose `event.target` is inside the panel and which has no tabbable element after it inside
the panel (for ActionsMenu, whose items are `tabIndex=-1`, every item; for the appearance editor, Save), the listener calls
`preventDefault()`, closes the popover and focuses the D3 target SYNCHRONOUSLY inside the listener (a microtask is also
acceptable; never `setTimeout`). The Modal trap cannot then act: it is gated on `document.activeElement === last` (`Modal.tsx:225-236`), and the
synchronous move (plus `stopPropagation`) leaves it inert. The no-`setTimeout` rule is enforced by this prohibition and
code review; mutation 2.4(v) is expected to stay green (design gate round 3) and that is not a failed gate.
The listener also calls `stopPropagation()`, labelled DEFENSIVE: it hides an already-handled
Tab from bubble-phase ancestors; no ancestor acts on it.
- "Last" is decided from `event.target` (the element the Tab was dispatched to, which is the focused element inside the
  panel), not re-read from `activeElement`, so a same-element listener that ran first and moved focus does not change the
  hook's decision; the `defaultPrevented` guard is what makes the hook stand down in that case.
- It skips when `event.defaultPrevented` is already true. Live consumer of this guard: `ProvenancePopover` registers its own
  wrap-around listener on the same panel element; it is a child component, so its mount effect runs before the host
  hook's and its listener fires first on the same element (`stopPropagation` does not stop same-element listeners). Its
  wrap at the last element `preventDefault`s, and the hook must then do nothing. The executor MUST verify this ordering
  with tests rendering the real ProvenancePopover host: (1) LOADING state, Tab off its only focusable ("Close
  provenance"): Provenance preventDefaults and refocuses it (nothing after it in the panel) - assert the popover stays
  open and focus stays on that button; removing the guard makes the hook close it (the observable mutation); (2) READY
  state, Tab off its last focusable wraps to its first and the popover stays open.
- The listener is attached in a passive effect keyed on `isOpen` (reading `panelRef.current` then), like the existing
  focusout effect. That is enough for every current consumer (ActionsMenu's inline callback ref re-runs but keeps the same
  `ul` node while open) and it keeps registration AFTER ProvenancePopover's own mount effect, which the guard ordering
  above relies on. No node-identity mechanism is added.
- Coupling note for the hook doc comment: the hook's "tabbable after" test (D3) differs from ProvenancePopover's own
  `FOCUSABLE`; today the guard makes this unreachable, and the comment records it.
- Stopping propagation of that one Tab at the panel hides it from bubble-phase ancestors only; the hook's own
  capture-phase Tab tracker still sees it. Grep confirms no other `document`/`window` bubble-phase Tab handler in
  `frontend/src` that this would starve (Modal, MobileNavSheet, ProvenancePopover and DatasetRowGrid handle Tab on their own
  elements).
The Shift+Tab path stays exactly the HEL-1759 focusout path (direction `"backward"`). The focusout handler no longer
refocuses the trigger for direction `"forward"`: a forward Tab that reaches focusout from inside the panel (one the
panel listener did not intercept, e.g. a non-last element whose next element was removed) only closes, which is the
pre-HEL-1759 close-only behaviour.
Alternative considered: redirect in the focusout path after the browser (or the Modal trap) moved focus. Rejected: when
the panel is the document's last tabbable, focus leaves the document (`relatedTarget === null`, nothing to redirect from);
after a Modal wrap the redirect would have to undo a focus move whose focus/blur handlers already ran.

### D3. "Next tabbable after the trigger"
Scope = `trigger.closest("dialog[open]") ?? document.body`. Candidates = tabbable elements in scope in document order
(focusable selector; not `disabled`; `tabIndex >= 0`; not inside `inert`/`[hidden]`; rendered and visible - in a browser
`checkVisibility({ visibilityProperty: true })` where available, else non-empty `getClientRects()`), excluding anything
inside the panel and the trigger itself. Target = first candidate that follows the trigger
(`trigger.compareDocumentPosition(el) & DOCUMENT_POSITION_FOLLOWING`, and not contained by the trigger). If none: the scope's
first candidate when scope is a dialog (mirrors the Modal wrap), else the trigger (never `<body>`). Put the helper in its
own small module next to the hook (e.g. `frontend/src/hooks/nextTabbableAfter.ts`) with unit tests; do not change
`Modal.tsx`'s or `ProvenancePopover.tsx`'s own selectors.
The positive tab-index ordering rule is not modelled (the app uses no positive `tabIndex`; executor confirms by grep).

### D4. Which consumers change (AC 3)
ActionsMenu, DashboardAppearanceEditor and OutputSchemaDisclosure change (all let keyboard focus Tab out of the panel; the disclosure's panel holds a filter input and "Show all N" buttons, `OutputSchemaDisclosure.tsx:70`). The appearance editor
follows the same rule because the ruling's principle - behave as if the portalled panel sat right after its trigger,
which is the menu-button and disclosure pattern alike - applies identically, and one hook rule is less surprising than a
per-consumer split. Select (virtual focus, options `tabIndex={-1}` at `Select.tsx:203,241`) and ProvenancePopover (own Tab wrap, `ProvenancePopover.tsx:103-125`) cannot reach the path (UserMenu uses its own local `panelRef`, `UserMenu.tsx:79-80`); they are covered by
existing tests that must stay green. This is a delivery decision the ticket delegated ("say which ones change"), not a
new product fork; it is stated in the PR body.

## Risks / Trade-offs

- [Another e2e or unit test asserts the old forward-Tab-to-trigger behaviour] -> grep `e2e/` and `frontend/src` for
  forward `Tab` presses near menus/the appearance editor before changing code; update only assertions that encode the
  overruled behaviour, and list them.
- [The computed target is not what a user sees as "next"] -> e2e asserts focus on a concrete, independently located
  control (not the same algorithm re-run in the test).
- [Hidden-but-rendered controls (phone-hidden appearance trigger) counted as tabbable] -> visibility check in D3, unit
  tested.
