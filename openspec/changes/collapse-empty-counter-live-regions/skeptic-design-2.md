## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 79288722ac0e0c73bb0a6dc2984588aead783767. There are no change commits yet; only the untracked planning
artifacts exist.

### Round-1 change requests: are they addressed?

1. **The "drop `:empty`" mutation survived (CR1). Addressed.** The D3 message test now asserts the message is in
   flow: computed `position` is `static` while the region has text, and its top is at or below the bottom of the
   last content with no overlap. Tasks 1.3 and 3.2 now name the expected red test for each mutation (M1: geometry
   assertion; M2: the message test's in-flow assertion). Under M2 the region is `position:absolute` whether or not
   it has text, so the `static` check fails no matter where the browser places it. The mutation is caught.
2. **Two ways to isolate the message test (CR2). Addressed.** D3 now picks one: declared LAST in the file, on the
   existing counter panel. No new panel is added, so the 7-card count and the per-kind JSON keys stay the same.
   I confirmed `playwright.config.ts:191` sets `fullyParallel: false`. The geometry and per-kind tests
   (`hel1791-compact-counter-stack-height.spec.ts:170-262`) run before it, so the rows the message test appends
   cannot affect them.
3. **No regression runs for the desktop grid (CR3). Addressed.** Design D3 (Regression bullet) and task 3.4 now list
   all five spec files, with at most 2 workers, no parallel batch, and base-failing results recorded as
   pre-existing. I confirmed all five files exist in `e2e/`.
4. **Non-blocking notes from round 1. Taken up.** D3 now names the BORDER box (`getBoundingClientRect`) and reads
   the padding at runtime. It also writes down the expected after-state: about 42 px of padding, against about
   74 px today.

### What I verified independently (with evidence)

- **The fix targets the right markup.** `FormPanelView.tsx:369-404`: the compact branch renders `FormFieldControl`
  and then the two always-mounted `<p role="alert|status">` with `{alertText}` / `{statusText}`. Both state values
  start as `useState("")` (66-67). `flushSync` clears both to `""` at 183-186, before every step. An empty string
  renders no text node, so `:empty` matches when the regions are idle. The design still requires a real-browser
  check of this, which is correct.
- **The layout matches.** `CounterControl.css:36-46`: the compact counter is a flex column with
  `gap: var(--space-4)` and no `position` set, so the planned `position: relative` does not conflict.
  `FormPanel.css` sets the regions to `margin:0` and colours them under `:not(:empty)`.
- **The geometry bound can be met after the fix.** `FormField.css`: `.ui-form-field__hint` and
  `.ui-form-field__error` both have `margin:0`. `FormFieldControl.tsx:87-119` puts the caption inside the
  control's `<div>`. So once the phantom gap slots are gone, the last content ends at the content box. Border-box
  gap = padding-bottom (16), and the bound is padding-bottom + 1. It is red today at 48 px.
- **The status and alert paths exist.** On success, `setStatusText("The row was added.")` (line 244). On a definite
  rejection, `setAlertText(message)` (line 268). `classifySubmitFailure.ts:15` defines a definite rejection as
  "any axios error with a response", so a `page.route` 400 lands on the alert path. No timer clears either
  message (there is no `setTimeout` in `FormPanelView.tsx`), so the assertions have no race against the text
  disappearing.
- **Scope and contracts.** Every AC maps to a task: AC1 to 1.2/2.1, AC2 to 1.3, AC3 to 1.1/3.1. The spec delta
  covers all three ACs plus the "always mounted, no display/visibility hiding" constraint. The change is
  frontend CSS only; no API, schema or migration is affected. Nothing is deferred and there are no placeholders.

### Verdict: CONFIRM

### Non-blocking notes (for the executor)

- **There are two `role="alert"` elements after a rejection.** On the alert step, `values.setExternalErrors(...)`
  makes `FormField` mount `<p class="ui-form-field__error" role="alert">` with the same message
  (`FormField.tsx:62-65`, through `FormFieldControl.tsx:91`). That is in addition to the
  `.form-panel-view__alert` live region. Consequences:
  - A lazy `card.getByRole("alert")` locator re-resolved after the step hits a strict-mode violation (2 matches).
    Capture the region with `.form-panel-view__alert`, as `hel1169-...spec.ts:135` does, or with a pre-step
    `elementHandle()`. Then assert its role through the attribute or the accessibility snapshot.
  - In the alert case, the "last content" above the region is that field-error `<p>`, not the counter row or the
    caption. The in-flow assertion ("top at or below the counter row/caption bottom, no overlap") still holds, but
    measuring against the field-error `<p>` is the tighter check.
- **Where the heights files land.** The per-kind recorder writes `e2e-evidence/HEL-1791/heights-<LABEL>.json`
  (`evidencePath("HEL-1791", ...)`), not a HEL-1804 path. Copy `heights-before.json` out before the `after` run if
  you want both under this ticket's evidence. They will not overwrite each other, because the label differs.
- **The message test does not name a principal.** The owner path is the simpler choice: it reconciles from the
  aggregate, and the editor path has the extra caption. Either works.
