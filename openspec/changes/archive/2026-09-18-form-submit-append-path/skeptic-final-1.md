## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `219f4f8b5162478752e7842122cdc389068da37e` (re-confirmed by `git rev-parse HEAD`
after I finished reading the diff; worktree clean apart from the untracked `evaluation-2.md`).
Diff base resolved LIVE via `scripts/concertino/resolve-review-base.sh` with its exit status
checked → `b1b954e364b1725787e28c0d86540c910c1fc460`. Servers verified to be THIS worktree's before
measuring: `/proc/2295051/cwd` → `<worktree>/frontend` (dev `:6519`), `/proc/2294837/cwd` →
`<worktree>/backend` (backend `:9426`), `/health` → `{"status":"ok"}`.

Everything below is my own fresh measurement. The executor's and evaluator's reports were read only
as claims to refute.

### Measurement-stability note (evidence discipline)

My first `git diff` of `DataSourceRepository.scala` returned EMPTY output despite the file showing
`+104/−9` in `--stat`. I re-ran it rather than concluding anything: the re-run returned the full
hunk set with exit 0 (the first invocation was a quoting artifact of my own command, not a missing
diff). Recorded because a single anomalous reading is a re-run trigger, not a finding.

Two further anomalies were likewise mine, not the app's, and are NOT reported as defects:
(a) my viewport was 430px wide for the first captures, collapsing the panel card to a sliver —
re-measured at 1440×900; (b) my `MutationObserver` recorded no success-path record because the
breakpoint change had remounted the panel, detaching the nodes I was observing — re-installed on
the live nodes before the later probes.

### What I verified (with evidence)

**AC1 — submit appends exactly one row to the panel's bound source.** Live API, my own fixtures:
valid submit → `201` `{"rows":[{"id":"dfaef022…","seq":0,…}]}`, source A `0 → 1`, source B `0 → 0`,
row content `["skeptic-note",7,"open"]`. Through the real UI: A `0 → 1` (`["skeptic-ui-note",11,
"open"]`), B `0`, exactly one `POST /api/panels/<id>/submit` recorded by an XHR counter.

**AC2 — server enforces independently of the client (client validation is convenience).** Six
API-bypass payloads, each with the bound source's row count read BEFORE and AFTER (C8 — never
inferred from the status alone). Every one `400`, every count unchanged at 0:

| bypass payload | response |
|---|---|
| whitespace-only `"note":"   "` (form-required) | `{"fieldErrors":[{"field":"note","reason":"required"}]}` |
| `select` outside options (`"status":"bogus"`) | `{"field":"status","reason":"not one of the configured options"}` |
| string for integer (`"quantity":"abc"`) | `{"field":"quantity","reason":"expected integer, got string"}` |
| declared-required-WITH-default omitted (`status`) | `{"field":"status","reason":"required"}` |
| body carrying `dataSourceId` | `400` `Unrecognized submit attribute(s): dataSourceId` |
| unknown key in `values` (`"bogus"`) | `{"field":"bogus","reason":"not part of this form"}` |

The fourth case genuinely exercises layer 1 in the live system, not just in a fixture: I read the
declaration back via `GET /api/data-sources/<id>/schema` and it shows `{"default":"open","name":
"status","required":true,…}` — a declared default IS present, so layer 2 would have filled it.
A body naming `dataSourceId` is rejected at decode time and no source is modified.

**AC3 — success / field-level error / network-failure states, all exercised live.**
- Success: polite region → "The row was added.", assertive region emptied, form reset, focus on the
  submit button, button re-enabled, `aria-invalid` count 0.
- Field-level error — **driven by the REAL server, not a stub** (see the coverage note below): I
  shrank the persisted `status` options to `["closed"]` server-side while the loaded client still
  offered "open", so the choice passed client validation and was rejected by the server. Result:
  assertive region "Status: not one of the configured options"; the combobox computed
  `aria-invalid="true"` with that exact text as its computed accessible description; it is the
  focused element; `note`/`quantity`/`status` all still hold what I entered; source A unchanged at
  1 row; button re-enabled. Only console output was the expected `400` network log — no React error.
- Network failure: with a `/submit`-scoped transport error, assertive region → "The submit could not
  be completed. Please try again.", input preserved, focus on the submit button, button enabled,
  source A unchanged at 1.
- `resetOnSuccess` default (absent) → form reset (measured above). `resetOnSuccess: false` → after a
  `201` the values REMAIN (`"noreset-note"`, `"33"`, `"open"`), success announced, source A `1 → 2`
  with both rows correct, source B still 0.

**AC4 — a rejected submit preserves input (C7 mutation judgment).** Input preservation was measured
directly on all three rejection paths above. Judging `mutation-evidence.md` on whether each recorded
mutation exercises the exact guard: it does, and each is recorded ALONE.
- Preserved-input mutation (`values.reset()` added to BOTH `catch` sub-branches) → exactly the two
  preserved-input tests red, the other 10 green. Correctly scoped.
- Layer-1 `required` mutation (dropping only the per-field `if (required) Left(...)`) → red ALONE,
  3 failures, including both new distinguishing tests. I confirmed the fixture that carries this
  claim really isolates layer 1: `FormSubmitRoutesSpec.scala` seeds `status` as
  `{"required":true,"default":"open"}` and configures it WITHOUT a form-level `required`, so it
  never enters `formRequiredNames`/`effectiveDeclaration`'s required-copy. The cycle-1
  "load-bearing at either layer" claim was withdrawn and replaced with a correct account, including
  the honest admission that layer 2 is what catches an unconfigured declared-required field.
- Both mutated route cases assert `rowCount(src) shouldBe 0`, satisfying C8 by count.

**AC5 — errors announced to assistive technology (C1/C8, computed state only).**
- Before any submit: both regions EXIST and are empty (`textContent === ""`), with computed roles
  `alert` and `status` present in the accessibility tree — not merely `role=` attributes.
- Client-blocked submit: assertive text "Note is required Quantity is required Status is required";
  all three controls computed `[invalid]` in the a11y tree with matching computed descriptions;
  focus on the first invalid control; ZERO requests sent.
- **Cycle 1's defect is genuinely fixed.** A SECOND identical failing submit produced NEW
  MutationObserver records — `removed:["Note is required …"]` then `added:["Note is required …"]` at
  frame 2817, versus the first attempt's frame 464. Independently reproduces the evaluator's result.
- Server rejection and transport failure each emptied the region and refilled it in DISTINCT frames
  (10130 → 10131), measured on the live nodes.

**Write-path caution — composes, does not re-implement.** `appendBuiltRowAction` takes `lockSource`,
reads the declaration FRESH inside the lock, runs `build` there (no pre-lock mapping), and on
`Right` delegates persistence to `insertAppendedRowsAction` — the same helper `appendRowsAction` now
calls, extracted with identical seq numbering, `inferred_schema` recompute and final re-read. On
`Left` nothing is inserted and neither schema nor `updatedAt` is touched. `applyWriteBacks` is
untouched by the diff and still composes `appendRowsAction`; `DatasetRowValidator.validateRow` now
renders through the new `validateRowStructured`, preserving its pinned message format. Ownership/kind
checks mirror `appendRows`'s `findByIdOwned`, and the audit entry adds only `{"panelId"}`.

**Gates — my own fresh runs on `219f4f8b`** (I did not rely on the evaluator's summary table):

| gate | my result |
|---|---|
| `npm run lint` | PASS — `eslint . --max-warnings=0`, exit 0 |
| `npm run typecheck` | PASS — `tsc --noEmit`, exit 0 |
| form-area Jest (`FormPanelView\|formSubmission\|useFormPanelValues`) | PASS — 3 suites, 44/44 |
| `sbt "testOnly …FormSubmissionSpec …FormSubmitRoutesSpec"` | PASS — 36/36, "All tests passed", exit 0 |

**DESIGN.md (C6), both themes, against the running app.** The submit button matches §5's Primary
recipe as computed values, identical in both themes: `background rgb(234,179,8)` (`--app-accent`),
`color rgb(24,21,17)` (`--app-accent-ink`), `height 28px` (`--control-sm`), `border-radius 6px`
(`--app-radius-sm`), `font-weight 500`, `font-size 14px`. Error text resolves per theme —
`rgb(175,51,37)` light, `rgb(241,123,103)` dark — both the real `--app-error`, which is defined
per-theme in `frontend/src/theme/theme.css`. `FormPanel.css` uses tokens throughout; no hardcoded
colour, radius or type value where a token exists. Visually the card reads as a sibling of other
panels: consistent label/control rhythm, shared `FormField`/`TextField`/`Select`/`Toggle`
primitives rather than one-offs, even `--space-3` stack, muted success line, no new button style.

**Hygiene.** Every live fixture I created was deleted in a `finally`: sources `204`/`204`, all three
dashboards `204`, and a re-list confirms 0 of my sources and 0 of my dashboards remain in the shared
dev DB. Playwright wrote two captures to the MAIN checkout root; I rescued both into the run's
evidence and the main root now holds 0 PNGs. The worktree is clean (only the untracked
`evaluation-2.md`). No code, `scripts/concertino/**`, `.husky/**` or `check-schema-drift.mjs` was
modified by me — this report is the only file I wrote.

Persisted evidence:
- `/home/matt/Development/helio/.concertino/runs/HEL-1087/evidence/openspec/changes/form-submit-append-path/hel1087-skeptic-dark-servererror.png`
  (dark-theme real-server rejection; load-bearing for the duplication note below)
- `…/hel1087-skeptic-light-desktop.png` (light-theme idle at 1440×900)
- `…/hel1087-skeptic-light-error.png` (430px client-blocked state)
- `…/hel1087-skeptic-form-light-idle.png` — **not load-bearing**: a clipped element capture from my
  430px viewport that shows almost nothing. Recorded so no later reader mistakes it for evidence.

### Verdict: CONFIRM

Every acceptance criterion traces to evidence I gathered myself, the server independently rejects
each payload the browser would block while writing nothing, input survives all three rejection
paths, announcements are proven by computed roles/state and observed DOM mutation (including the
repeated-failure case that failed in cycle 1), and the write path composes the existing locked
append rather than re-implementing it. Nothing I found rises to a blocker.

### Non-blocking notes

1. **Identical error text renders twice for a single-field rejection.** In the dark capture above,
   "Status: not one of the configured options" appears as the field-level error under the control
   AND verbatim as the form-level summary immediately beneath it — two identical red lines. This is
   faithful to the approved design (D8 mandates both the associated field error and an announced
   summary), so it is not a REFUTE; but a summary that omitted errors already associated with a
   rendered control — keeping it for unrendered/non-editable/non-field failures, which is its real
   purpose — would read better and lose nothing.
2. **The primary action sits below the fold at the default panel size.** With three fields the body
   scrolls (`clientHeight 229` vs `scrollHeight 277`) and the submit button rendered 36px BELOW the
   visible area. It is not unreachable: the body is `overflow-y:auto` with HEL-1085's scroll
   affordance, and focusing the button scrolls it into view (`scrollTop` moved 0 → 51, button then
   fully inside). Worth considering a pinned/sticky submit row for form panels, since the one
   affordance that completes the task is the one initially off-screen.
3. **Residual AT risk on the repeated-failure fix, confirmed and bounded.** I reproduce the
   evaluator's finding that the clear and the refill land in the SAME frame on the client-blocked
   path (both records at frame 2817), so no paint separates empty from identical-text. The spec's
   "regions SHALL be emptied when the next attempt starts" is observably satisfied and the cycle-1
   defect is gone; whether a real screen reader re-announces identical text after a same-task
   remove/add cannot be measured in this harness. Notably the SERVER-rejection and transport paths
   do separate the clear and the set across frames (10130 → 10131) — only the synchronous
   client-blocked path coalesces. Varying the text (e.g. an attempt counter) would make it robust.
4. **A coverage gap I closed myself, worth knowing.** `e2e/hel1087-form-submit-path.spec.ts`'s
   server-rejection leg uses `page.route(...).fulfill()` with a synthetic `400` body, so the suite
   proves the UI handles a `400` SHAPE, not that the real server's rejection maps end-to-end. The
   e2e suite did run and pass (`test-results/.last-run.json` → `{"status":"passed","failedTests":[]}`,
   and both `form-submit-path-{dark,light}.png` exist in the worktree's evidence dir). My
   stale-options probe above supplies the missing real-server-through-real-UI leg; a future ticket
   could fold that technique into the e2e so the chain is covered by one automated test.
5. e2e is not a configured gate in `concertino.config.json`, so the spec file is not enforced by any
   gate run — fine for this ticket, but the file can silently rot.
