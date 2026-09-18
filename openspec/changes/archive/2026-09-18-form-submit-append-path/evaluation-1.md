## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `fe5c2b43a71a04065595f8e5c65a618098f14b44` (worktree clean).
Diff base resolved LIVE via `resolve-review-base.sh` → `b1b954e364b1725787e28c0d86540c910c1fc460`
(exit status checked; non-empty SHA confirmed before `git diff`).

Servers were REUSED by `start-servers.sh`; I verified their identity before trusting any
measurement — `readlink /proc/<pid>/cwd`:

- dev `:6519` → pid 2295051, cwd `…/worktrees/feature/form-submit-append-path/HEL-1087/frontend`
- backend `:9426` → pid 2294837, cwd `…/worktrees/feature/form-submit-append-path/HEL-1087/backend`

Both resolve inside THIS worktree, so the measurements below are of this branch's code.

### Phase 1: Spec Review — FAIL

Passing:

- Submit is wired to the row-append path; a successful submit appends exactly one row to the
  panel's bound source (measured, not inferred — below).
- The write target is the panel's persisted `dataSourceId` only; `{"values":…, "dataSourceId":…}`
  is rejected `400` by the strict hand-rolled reader ("Unrecognized submit attribute(s):
  dataSourceId") and nothing is written.
- Server-side enforcement is independent of the client (the substance of the ticket) — verified
  with client-bypassing `curl` against the running backend, with row counts before/after:

  | payload (client would block) | status | body | A rows | B rows |
  |---|---|---|---|---|
  | `note: "   "` (form-required, whitespace) | 400 | `fieldErrors:[{note, required}]` | 0 → 0 | 0 → 0 |
  | `status: "nope"` (outside `options`) | 400 | `fieldErrors:[{status, not one of the configured options}]` | 0 → 0 | 0 → 0 |
  | `quantity: "5"` (string for integer) | 400 | `fieldErrors:[{quantity, expected integer, got string}]` | 0 → 0 | 0 → 0 |
  | `bogus: "x"` (unknown key) | 400 | `fieldErrors:[{bogus, not part of this form}]` | 0 → 0 | 0 → 0 |
  | `dataSourceId` in body | 400 | malformed-content rejection | 0 → 0 | 0 → 0 |
  | valid `{note, quantity, status}` | 201 | `rows:[{id, seq:0, updatedAt}]` | 0 → **1** | 0 → **0** |

  The appended row was `["hello",7,"open"]`. C8 satisfied by count, never by the 400 alone.
- Success / field-error / network-failure states all handled; preserved input on rejection
  verified in-browser and mutation-proven.
- Tasks are all `[x]` and match what is implemented; spec deltas are written, and the removed
  `form-panel-rendering` requirement carries a correct Reason/Migration.
- No scope creep: the `CLAUDE.md` / `openspec/config.yaml` endpoint lines are task 1.7; the
  `ApiRoutes` change is a construction-ORDER move only.

Failing:

1. **The spec's "Regions SHALL be emptied when the next attempt starts" is not met on the
   client-blocked path, so a repeat failure is announced to nobody.** See CR1 — this also defeats
   the ticket AC "errors are announced to assistive technology, not only shown visually" for the
   second and every subsequent identical attempt.

Constraints C1–C8: C2/C4/C5 n/a-or-honored, C3/C6/C8 honored, C1 honored as a method (the tests
do assert computed ARIA, not node presence) but the underlying behavior it guards fails per CR1;
C7 is only partially satisfied per CR2.

### Phase 2: Code Review — FAIL

Gates — **my own fresh runs in this worktree** (the executor's report was not trusted):

| gate | result |
|---|---|
| `npm run lint` | PASS (`eslint . --max-warnings=0`, clean) |
| `npm run format:check` | PASS ("All matched files use Prettier code style") |
| `npm test` | PASS — frontend 332 suites / 3597 tests; helio-mcp 28 suites / 271 tests |
| `npm --prefix frontend run build` | PASS (built; only the pre-existing chunk-size advisory) |
| `cd backend && sbt test` | PASS — **4665 tests, 0 failed**, "All tests passed" |

Quality is high overall: `insertAppendedRowsAction` is extracted verbatim so `applyWriteBacks`
composes what it always did; `validateRowStructured` becomes the single implementation that the
private `validateRow` renders through (no message-test edits); the build runs INSIDE
`appendBuiltRow`'s locked transaction against a freshly-read declaration, closing the reorder
race; `FormRowBuildFailure` is a sealed trait rather than a re-parsed string; the closed-key
reader is what makes the write target unforgeable. Errors are structured at the boundary and
`message` is retained so `extractErrorMessage` keeps working. No dead code, no stray TODO, no
untyped escape hatches. DESIGN.md compliance is genuine, not nominal — see Phase 3.

Findings: CR1 (root cause below) and CR2 (C7 gap).

### Phase 3: UI Review — FAIL

Measured against the RUNNING app on this run's ports, as computed state rather than node
presence (C1). Fixtures were created through the live API and deleted afterwards (dashboard 204,
source 204, rows endpoint then 404) — shared dev DB left clean.

Pre-submit (the C1 "regions exist BEFORE the async outcome" requirement) — computed a11y tree of
the form subtree shows `alert` and `status` nodes already present, both with `""` text, alongside
the `Submit` button:

```
- form "HEL-1087 Order Form"
  - textbox "Note" / spinbutton "Quantity" / combobox "Status"
  - alert
  - status
  - button "Submit"
```

Client-blocked submit (required `Note` empty): **0 submit requests issued** (fetch/XHR both
instrumented), `aria-invalid="true"`, computed accessible description "Note is required", and the
focused element is identity-equal to the first invalid control (`activeElement === note` and
`=== firstInvalid`, both `true`) — not merely "an alert exists".

Asynchronous success: alert region mutated to `""` at attempt start, status region mutated to
"The row was added.", form reset, `focusIsSubmitButton: true`, zero invalid controls, and the
bound source gained exactly one row (`["eval-note",42,null]`, total 1 — the unset optional
`select` correctly landing as null).

DESIGN.md (C6) — computed, in BOTH themes:

- submit button: 28px height (`--control-sm`), 6px radius (`--app-radius-sm`), weight 500
  (`--weight-medium`), 14px (`--text-sm`), solid accent `rgb(234,179,8)` with
  `rgb(24,21,17)` ink, transparent border — an exact match to §5's Primary recipe metrics.
- populated alert in light theme computes to `rgb(175,51,37)` = `--app-error`'s light value
  `#af3325`, at 12px = `--text-xs`; every token the new CSS uses is defined in BOTH the
  `[data-theme="dark"]` and `[data-theme="light"]` blocks of `theme.css`, so light/dark parity
  holds mechanically. Hand-rolling the `<button>` is sanctioned here: DESIGN.md §5 opens "Until a
  shared `Button` component exists…", only `IconButton` exists, and design.md's Non-Goals
  explicitly exclude a new shared primitive.
- Breakpoints 1440 / 1100 / 768 / 430: no document, form, or card horizontal overflow at any
  width; the button stays within the form and visible (80×28 at every width).
- Console: 0 errors during every tested flow (the only errors in the session were two
  `401 /api/auth/me` from my own deliberate logout, unrelated to this diff).

Failing: CR1 below, measured here.

Evidence (persisted, durable):

- `/home/matt/Development/helio/.concertino/runs/HEL-1087/evidence/.concertino/runs/HEL-1087/evidence/hel1087-eval-clientblock-dark-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1087/evidence/.concertino/runs/HEL-1087/evidence/hel1087-eval-clientblock-light-430.png`

The load-bearing Phase-3 claims above rest on the computed-state readouts quoted inline (ARIA
state, accessible descriptions, `activeElement` identity comparisons, MutationObserver logs,
computed colors, row counts), which are self-authenticating; the screenshots are supplementary
and no claim depends on their mtimes or ordering.

### Overall: FAIL

### Change Requests

1. **`FormPanelView.tsx` `handleSubmit` — a repeated identical client-side failure is announced
   to nobody; empty the live region in a committed render, not in the same batch.**

   Root cause (probe-confirmed, not guessed): on the client-blocked path `setAlertText("")` (line
   ~“setAlertText("")” at the top of `handleSubmit`) and `setAlertText(summary)` occur in the SAME
   synchronous React event handler, so React batches them into ONE commit whose final value is
   `summary`. When `summary` equals the text already displayed, the region's DOM text never
   changes, and a screen reader announces nothing. The asynchronous branches are unaffected
   because their `setAlertText("")` commits before the `await`.

   Measurement (`MutationObserver` on `.form-panel-view__alert`, two identical failing submits on
   the required-empty `Note` field, running app):

   ```
   mutationsAfterFirst: 1      mutationsTotal: 2 attempts → 1
   mutationLog: ["Note is required"]     // NOTHING recorded for the 2nd attempt
   after 1st: alertText "Note is required"   after 2nd: alertText "Note is required"
   ```

   This contradicts the change's own spec text in
   `specs/form-panel-submit/spec.md`: "Regions SHALL be emptied when the next attempt starts",
   and defeats the ticket AC for the common case of a user pressing Submit again without fixing
   the field. Note the existing tests cannot catch it: they assert the region's text/`toHaveTextContent`
   after a SINGLE attempt, which is identical whether or not the region was emptied in between.

   Required: make the reset of `alertText`/`statusText` reach the DOM as its own commit before the
   new summary is written (e.g. clear the regions in a committed render / flush before setting the
   new text, or make the announcement text carry an attempt discriminator so consecutive identical
   failures still produce a text mutation). Add a test that performs TWO consecutive identical
   failing submits and asserts the assertive region produced a text change on the second — it must
   fail before the fix.

2. **C7: the `required` guard's first layer is NOT independently pinned — add the one test that
   distinguishes the two layers.**

   `mutation-evidence.md` honestly records that mutation 1 (dropping
   `FormSubmission.buildRow`'s per-field `if (required) Left(...)`) stayed GREEN 15/15, then
   concludes that applying both mutations "confirm[s] the guard is load-bearing … at either
   layer". That conclusion does not follow from the green run: mutation 1 staying green means no
   test observes layer 1 at all, which is precisely what C7 forbids ("a guard must be failable by
   mutation and the recorded proof must be the mutation that exercises that guard").

   The two layers are NOT redundant, and I confirmed the distinguishing case against the running
   backend. A CONFIGURED field the dataset declares `required: true` **with a declared default**,
   omitted from `values`:

   ```
   columns: [{"name":"status","type":"string","required":true,"default":"open"}]
   POST /api/panels/<id>/submit  {"values":{"note":"hi"}}
   → HTTP 400  {"fieldErrors":[{"field":"status","reason":"required"}]}   rows: total 0
   ```

   Only layer 1 rejects this (it ORs in `declared.required`); layer 2's `effectiveDeclaration`
   leaves such a field untouched — it is not in `formRequiredNames` — so
   `DatasetRowValidator` would fill `"open"` and return `201`. `grep` confirms no spec anywhere
   combines a configured field with declared `required = true` AND a default: `FormSubmissionSpec`
   only uses `required = false, default = Some(...)` (lines 59, 66, 80) and the
   unconfigured-with-default case (128–131); `FormSubmitRoutesSpec`'s `extra` column is
   `"required":false` (line 94).

   Required: add that case to `FormSubmissionSpec` (and/or `FormSubmitRoutesSpec` with a row-count
   assertion) expecting `400` + `reason: "required"` and NO default fill, then re-run mutation 1
   ALONE and record it going RED in `mutation-evidence.md`, replacing the "load-bearing at either
   layer" claim with what the evidence actually shows.

### Non-blocking Suggestions

- `FormPanelView.tsx` success path calls `values.reset()` but never `setExternalErrors({})`, so a
  server-reported error on a field the user never re-edits could in principle survive a later
  successful submit onto a freshly reset form. Not reachable in my measurements (post-success
  `invalidCount` was 0) — cheap to make explicit.
- `FormPanel.css` `.form-panel-view__submit:disabled { opacity: 0.7 }` differs from the house
  values (`Modal.css` 0.55, `IconButton.css` 0.4). DESIGN.md does not tokenize disabled opacity,
  so this is consistency, not a rule violation.
- The in-flight disabled/"Submitting…" state could not be observed in-browser (the local request
  completed in under 60 ms); it is covered by the jest double-activation test, which asserts one
  request. No action needed, recorded so the next reviewer does not re-derive it.
- `e2e/hel1087-form-submit-path.spec.ts`'s UI-rejection leg fulfils a `400` via `page.route`
  rather than provoking a real server rejection. Defensible (the API-bypass leg covers real
  enforcement) and the file documents the choice; worth noting it means that leg does not exercise
  the server.
