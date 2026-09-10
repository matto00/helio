## 1. Frontend: diagnose reach blockers

- [x] 1.1 Log in as matt@helio.dev in the running dev app and attempt to reach each of the three
      preview call sites cold (SQL Tab connection test, Source Detail preview, Pipeline Step
      preview); verify by recording, for each, whether it renders a `DataGrid` or errors (network
      tab / console).
- [x] 1.2 For any 403/blocked path, inspect the network response body and (if needed) backend logs
      or a direct authenticated API probe to confirm the real cause (do not assume HEL-904 without
      confirming it) and verify by citing the specific response/log evidence.
- [x] 1.3 If a data gap (e.g. zero Outputs) is confirmed as the blocker, seed the minimum fixture
      data scoped to the dev user needed to make all three call sites reachable, and verify by
      re-attempting 1.1 and confirming every call site now renders `DataGrid` or its skeleton.

## 2. Frontend: live measurement (current branch = HEAD)

- [x] 2.1 At each of the three call sites, in light theme, at a fixed 1280x800 viewport, measure
      via Playwright `browser_evaluate`: the distance from the bottom of the nearest preceding
      consumer-owned element (named per call site in design.md's "Comparison method, datum") to the
      top border-box of `.ui-data-grid--preview`, plus the computed `margin-top` as a secondary
      diagnostic, and verify by recording the numeric values.
- [x] 2.2 Repeat 2.1 in dark theme and verify by recording the numeric values (confirm no
      theme-dependent difference beyond expected token values).
- [x] 2.3 Capture the resolved DOM class list/structure for `SourcePreviewSkeleton` and for a real
      `DataGrid variant="preview"` render, in both themes, and verify by diffing them directly (not
      just reading source); render an explicit ship/no-ship judgement on the pre-known
      skeleton-has-no-`__frame`-wrapper divergence (design.md), not a bare pass/fail.
- [x] 2.4 Measure the zero-row/empty preview state at one call site alongside 2.1's populated-state
      measurement, and verify by recording whether a frame renders and the same datum distance.

## 3. Frontend: comparison against pre-reframe (isolating pair + HEAD attribution)

- [x] 3.1 Set up a throwaway `git worktree add` at `a6bde0d3^` (pre-reframe) and a second at
      `a6bde0d3` (post-reframe, pre-later-commits) — never `git stash` in the delivery worktree —
      each on its own scratch dev/backend port pair, and verify by confirming both boot and serve
      the same call sites' code for their respective commit.
- [x] 3.2 Repeat the 2.1/2.2 measurement method against both `a6bde0d3^` and `a6bde0d3`, same call
      sites, same viewport, same themes, and verify by recording the numeric values for each.
- [x] 3.3 Diff `a6bde0d3` against `a6bde0d3^` (the isolating pair) for all three call sites and both
      themes, and verify by stating explicitly, per call site: unchanged, or changed by N px — this
      is the number that answers the ticket's margin-collapse question, attributed to the reframe
      specifically.
- [x] 3.4 Diff HEAD's 2.1/2.2 measurements against `a6bde0d3`'s, and verify by stating explicitly
      whether they differ; if they do, note that the cause is one of the later `DataGrid` commits
      (HEL-465/HEL-458/HEL-1065), not the reframe, and is out of this ticket's scope to fix.
- [x] 3.5 Tear down both throwaway worktrees and verify their removal with `git worktree list`
      output (not an assertion) showing neither remains.

## 4. Frontend: resolve and record

- [x] 4.1 If 3.3 found a genuine geometry regression attributable to the reframe, implement the
      minimal CSS/markup fix and add a guard (Jest DOM assertion and/or a documented Playwright
      measurement note) and verify by re-running 2.1-2.2 and 3.2's `a6bde0d3` comparison against the
      fix and confirming the regression is gone.
- [x] 4.2 If no regression was found (3.3 unchanged), write that conclusion — with the measured
      numbers from 3.3, and 3.4's HEAD-vs-`a6bde0d3` note if they differ — directly into this
      change's evidence so it is not re-litigated, and verify by confirming the numbers are present
      in the persisted evaluation/skeptic report.
- [x] 4.3 Record, either way, whether/why the five prior attempts failed to reach these call sites
      (the confirmed root cause from step 1, or the confirmed absence of any blocker) and verify by
      confirming this is stated plainly in the final report.

## 5. Tests

- [x] 5.1 Confirm existing Jest coverage for the preview-frame class exclusion still passes and
      verify by running the relevant `DataGrid` test file.
- [x] 5.2 If 4.1 added a fix, add/extend a Jest test asserting the corrected geometry-relevant
      property (e.g. margin/class) and verify by running it green.
