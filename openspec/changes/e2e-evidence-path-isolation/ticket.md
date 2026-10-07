# HEL-1363: Lane screenshots land in another lane's worktree and break its openspec hook

## Description

During HEL-1330, the directory `openspec/changes/chart-output-compare-picker/screenshots/` appeared in the HEL-1330
worktree at 2026-10-07 11:00:53–59. It held 4 gitignored PNGs whose change name matches HEL-1350. HEL-1330 did not
create them. Because the directory existed, pre-commit `check:openspec` failed with "change has no tasks", and the
lane was blocked until the owner authorised moving the folder.

This is the known parallel-lane screenshot hazard: lanes share a browser or resolve paths outside their own worktree.

## Do

* Find the path-resolution bug: which tool or script wrote HEL-1350's evidence screenshots into another worktree.
  Likely suspects are a Playwright `path` that is relative to a shared cwd, or the shared MCP browser's download dir.
* Make evidence writes resolve against the owning lane's worktree.
* Decide whether `check:openspec` should ignore a change directory that holds only gitignored files.

The fix may belong upstream in concertino rather than in this repo.

## Premise validation (orchestrator, 2026-10-07)

Full record: `.concertino/runs/HEL-1363/evidence/premise-validation.md` (verdict: minor-staleness).

* The writer is the committed e2e spec `e2e/hel1350-chart-compare-picker.spec.ts` (line 16,
  `resolve(__dirname, "../openspec/changes/chart-output-compare-picker/screenshots")`), merged in 469f4ea93. It
  resolves inside whichever worktree runs it; HEL-1330's own cycle-1/2 e2e runs recreated the archived change's
  directory. HEL-1350's run had ended ~12.5h earlier. No shared browser and no cross-worktree path was involved.
* Same shape in three more committed specs: `hel1275` and `hel1277` (into archived change dirs) and `hel1351`
  (into `openspec/changes/dashboard-chart-overlay-coverage/`). Six more (`hel588`, `hel1085`, `hel1087`, `hel1088`,
  `hel1095`, `hel1169`) use cwd-relative `.concertino/runs/HEL-n/evidence/...` paths.
* Everything involved is helio-owned (`e2e/**`, `scripts/check-openspec-hygiene.mjs`); nothing upstream.

## Acceptance Criteria (restated against the validated premise)

1. No committed e2e source references a path under `openspec/` (not only `openspec/changes/**`), and no spec writes
   evidence screenshots to a cwd-relative path; every
   e2e evidence write resolves, independent of process cwd, to one gitignored per-worktree location outside
   `openspec/`.
2. A pre-commit and CI guard fails, with a selftest proving it red, if an e2e file reintroduces either shape
   (any non-comment reference to the `openspec/` tree, or a screenshot `path` not produced by the helper).
3. `check:openspec` decision implemented: a change directory containing only gitignored files (and so never
   committable) does not fail the hook; it is reported as a stderr notice naming the directory. A change directory
   with any tracked or committable file is checked exactly as before.
4. Running the four formerly-offending specs' screenshot writes (or an equivalent probe of the helper) leaves
   `git status` clean and creates nothing under `openspec/changes/`.

## Restated ticket (Linear, rewritten by the driver 2026-10-07, after this plan was drafted)

The owner/driver rewrote HEL-1363 to the actual cause this plan's premise validation had already found: hel1350:16,
hel1277:22 and hel1275:26 hard-code screenshot dirs under `openspec/changes/`. Its Do-list:

* Send e2e screenshot output to a gitignored, non-openspec location for all such specs; grep for any other spec
  doing the same thing rather than relying on the list (grep found hel1351 plus six cwd-relative writers; all in
  scope above).
* Add a guard that stops a spec from writing under `openspec/` again, and prove it with a red run.
* Decide whether `check:openspec` should also ignore a change directory that holds only gitignored files.

The acceptance criteria above (AC1/AC2 widened to the whole `openspec/` tree in cycle 2) cover this restated scope; trace against both.
