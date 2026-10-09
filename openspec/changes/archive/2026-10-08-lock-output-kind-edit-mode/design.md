## Context

`OutputEditorSheet.tsx` renders Kind as the shared `Select` (`frontend/src/shared/ui/Select.tsx`) with no mode gating;
`isCreate = output === null` already exists and gates the Step select (create-only). The server's
`UpdateOutputRequest(name, config)` has no `kind`, so edit-mode kind changes can never succeed. `Select` already
supports `disabled` (native `disabled` on its `role="combobox"` button → removed from tab order, clicks ignored,
`openPanel` early-returns) and `ariaDescribedBy`. `inputs.css` styles `.ui-select__trigger:disabled` (opacity 0.55,
`not-allowed`) with no theme-specific override. The sheet already has `.output-editor-sheet__field-hint`
(`--text-xs`, `--app-text-muted`).

## Goals / Non-Goals

**Goals:** disable Kind in edit mode with a visible, AT-exposed reason; leave create mode byte-for-byte behaviorally
the same.

**Non-Goals:** server-side kind change; edits to shared `Select`/`FormField`; HEL-1430 refactors.

## Decisions

1. **Disabled `Select`, not read-only text.** Keeps the field's position, label and visual rhythm identical between
   create and edit modes (the user still sees the kind), and reuses the shared control's existing disabled styling.
   Alternative (render plain text "Chart") would diverge visually from the create layout and from the in-repo precedent
   `FormFieldRow.tsx` (disabled `Toggle` + "Required by the dataset" hint).
2. **Native `disabled` (via `Select`'s prop), not `aria-disabled`.** The AC forbids a dead focusable control; native
   disabled removes it from the tab order. Trade-off: a keyboard-only sighted user cannot focus it, but the reason is
   visible text directly under it, so nothing is hidden from them.
3. **Reason = visible hint `<p id>` + `ariaDescribedBy`.** Rendered only when `!isCreate`, using a `useId()`-derived id
   and the existing `output-editor-sheet__field-hint` class (no new CSS/tokens). Screen readers reading the combobox in
   browse mode get its accessible description; the text is also adjacent in reading order. Copy: "An Output's kind
   can't be changed after it's created. Create a new Output for a different kind." — user-worded, states the next step.
4. **`setKind` only reachable in create mode.** With the control disabled, `onChange` cannot fire in edit mode; the
   re-seed effect still sets kind from `output.kind`. `buildEditConfig`'s `kind !== output.kind` guard stays as a
   defensive fallback; its comment is updated to say kind is fixed in edit mode (HEL-1388).
5. **Dangling `htmlFor="output-kind"`** on the Kind label points at no element (`Select` takes no `id`). Fixing it needs
   a shared-component change; out of scope here, noted as a follow-up. The combobox's accessible name still comes from
   `ariaLabel="Output kind"`.

## Risks / Trade-offs

- [Disabled contrast at 0.55 opacity in light/dark] → verify against the running app in both themes; disabled controls
  are WCAG-exempt for contrast, and the reason text uses the already-audited muted token.
- [Tests asserting edit-mode kind switching] → grep existing OutputEditorSheet tests; any that change kind on an
  existing Output must move to create mode or be removed with justification.

## Planner Notes

- Self-approved: disabling (vs. supporting) kind change — the AC's default; no product escalation needed.
- Premise: DESIGN.md has no named disabled-state pattern; precedent above is the binding analogue.
