## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 6f2351e89d14e2e7ec0dd545476163f4d104a72d (planning artifacts untracked in the change dir).

### What I verified (with evidence)
- **Ticket AC matches the live Linear ticket.** I fetched HEL-1388 from Linear. Its AC matches `ticket.md`: Kind is disabled in edit mode with a short reason, there is a test for edit-disabled and create-unchanged, and the issue should be escalated only if a real kind change is preferred.
- **The server cannot change kind.** `backend/.../OutputProtocol.scala:94`: `UpdateOutputRequest(name: Option[String], config: Option[JsObject])` has no `kind` field. Disabling the control is therefore the AC's default path, and no product escalation is needed.
- **The defect is still live.** `OutputEditorSheet.tsx:524-532`: the Kind `Select` has no `disabled` prop and no mode gating. `:330-332`: `buildEditConfig` contains `if (!output || kind !== output.kind) return built;`. `isCreate = output === null` already exists at `:129`.
- **Select's disabled behaviour (`shared/ui/Select.tsx`).** The trigger is a native `<button role="combobox" disabled={disabled}>`, so the browser removes it from the tab order and React suppresses its click handler. `openPanel()` also returns early with `if (disabled) return;`. Keyboard opening goes through `openPanel` too, so no listbox can open. The design says "handleOpen early-returns", but the guard is actually in `openPanel`. That is a wording nit and changes no behaviour.
- **aria-describedby is applied.** `Select` forwards `ariaDescribedBy` to `aria-describedby` on the trigger. A natively disabled button stays in the accessibility tree, and its accessible description is still computed. The reason is also visible text placed right after the control in reading order. Together that meets "reason exposed to assistive tech". Using native `disabled` meets "no dead focusable control". `aria-disabled` would have left a focusable control that does nothing, which the AC rules out. The trade-off is stated in design D2.
- **DESIGN.md has no disabled-state pattern.** `grep -n -i disab DESIGN.md` returns only line 367, which is a motion note. The precedent the plan cites is real: `FormFieldRow.tsx:147-155` renders a disabled `Toggle` with `hint="Required by the dataset"`.
- **No new CSS or tokens are needed.** `.output-editor-sheet__field-hint` (OutputEditorSheet.css:58-62) uses `--text-xs` and `--app-text-muted`, and the sheet already uses it at `:664` and `:712`. `.ui-select__trigger:disabled` (inputs.css:44-49) has opacity 0.55 and `not-allowed`, with no theme-specific override. `.output-editor-sheet__data-section` is a grid with `--space-2` gap, so the hint `<p>` gets consistent spacing.
- **No existing test switches kind in edit mode.**
  - `OutputEditorSheet.test.tsx:203` is the only switch in that file. It runs under `renderSheet()`, which passes `output={null}` (`:45-60`), so it is create mode.
  - `OutputEditorSheet.configPatch.test.tsx:306/312/318` are inside "create Save -- still sends the full config" and call `renderSheet(null)`.
  - The e2e specs that touch "Output kind" (hel908, hel910, hel912, hel968) all do so after "Add output"/"New output", which is create mode.
  - The plan's "tests asserting edit-mode kind switching" risk therefore has no live instances.
- **The spec delta is correct.** In the baseline `openspec/specs/pipeline-output-sheet/spec.md:36-44`, "Per-kind option sets" has one scenario with "a user changes an Output's kind". The MODIFIED block repeats the requirement body verbatim and limits the scenario to creating a new Output. The ADDED requirement covers each AC point: disabled control, stored kind shown, visible reason, reason as the AT description, not focusable, no listbox, no foreign-kind config sent, and create mode unchanged. Each scenario can be tested.
- **Every task has an acceptance signal.**
  - Tasks 1.1 and 1.2 are checked by typecheck and lint.
  - Tasks 2.1 and 2.2 name assertions.
  - Task 2.3 is a mutation check, which makes the disabled assertion failable.
  - Task 2.5 runs the app in both themes.
  - Both ACs are covered (1.1 with 2.1 and 2.2), and no task goes beyond the ticket. HEL-1430 is excluded explicitly.
- **No contract change is needed.** The change is frontend-only, and no API or schema shape changes.

### Verdict: CONFIRM

### Non-blocking notes
- Design "Context" says `handleOpen` early-returns. The disabled guard is in `Select.openPanel` (`if (disabled) return;`). Wording only.
- Task 2.1 "not in the tab order": prefer `toBeDisabled()` together with a `userEvent.tab()` walk that shows focus skips the trigger. In jsdom, checking `tabIndex` alone proves nothing, because a disabled button still reports `tabIndex` 0.
- Task 2.4 greps only unit tests. The four e2e specs that use "Output kind" were confirmed to be create-mode above, so no change is needed. The executor can cite this instead of re-deriving it.
- D5's dangling `htmlFor="output-kind"` also affects `htmlFor="output-step"` (`:510`). Both belong in the same follow-up and are out of scope here.
- At 0.55 opacity, the disabled trigger next to a muted hint could look faint in dark theme. Task 2.5 must judge this against the running app. The final gate will check it.
