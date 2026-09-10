# Files modified — HEL-520 (post-archive correction, recorded as `cycle8-ci-correction.md` per check-openspec-hygiene.mjs disallowing `files-modified.md` in archive/)

This change was archived (`d8de77a0`) and squashed to two commits (`aa9dda3f`, `d8de77a0`) before PR #617's
CI `e2e` job surfaced a real coverage defect in `e2e/focus-presence-guard.spec.ts`. This file was created
after archival specifically to record that correction, since no `files-modified.md` existed in the archived
change directory.

## Cycle 8 — CI failure on a clean database, and correcting the "196 elements" figure

### What CI found

PR #617's `e2e` job (run `34416621152`, job "Run e2e suite (glob)") failed:

```
[HEL-520 focus-presence guard] view "/(dark)": 19 focusable element(s) measured (uncapped)
[HEL-520 focus-presence guard] view "/sources(dark)": 0 focusable element(s) measured (uncapped)
✘ e2e/focus-presence-guard.spec.ts:146:7
Error: HEL-520 focus-presence guard: "/sources(dark)" rendered ZERO focusable elements — a route
that should have real content measured nothing. This is a coverage failure, not a legitimate empty view.
```

This is **CR-B (evaluation-2.md) doing its job** — the non-emptiness floor added in Cycle 5 caught a route
rendering nothing, exactly the failure mode it was added to catch. It was not weakened to make this pass.

### Root cause: a race, not (as first suspected) purely ambient database inflation

The orchestrator's initial hypothesis was that the whole "196 elements across 4 routes x 2 themes" figure was
an artefact of the shared local dev database's accumulated test residue (MISTAKES.md documents this hazard).
Investigated rather than assumed the correction:

- The spec already creates its own dashboard, data source, and pipeline via API before sweeping (Cycle 3's
  seed shape, matching the sibling HEL-866 guard's precedent) — every route swept is scoped to a freshly
  registered, isolated account, not shared/ambient data. Dashboards, sources, and pipelines are per-owner in
  this app; another worktree's leftover data cannot appear on a brand-new account's `/sources` page.
- What the route loop did NOT do was wait for that seeded content to actually finish rendering before
  stamping/measuring — it used a flat `page.waitForTimeout(200)` after `page.goto(route)`. On this machine's
  shared dev database (already warmed by other worktrees' traffic, so backend responses were fast regardless
  of which account queried), 200ms was consistently enough. On CI's freshly-provisioned, cold database, it
  evidently was not for `/sources` specifically — the page's own data fetch had not resolved by the time the
  sweep stamped the document, so it measured the route's loading/empty frame instead of the seeded row.
- **Evidence against pure ambient-inflation, recorded plainly rather than glossed over:** this spec has been
  re-run locally dozens of times across cycles 3–8, each run registering a brand-new, isolated account, and
  the local per-view counts have been byte-identical every single time (19 / 21 / 24 / 34, dark and light).
  If the count were being inflated by OTHER accounts' ambient data leaking into a fresh account's own-data
  views, re-running with a different fresh account should have produced different counts as other worktrees'
  concurrent test residue changed — it never did. This is evidence the local count is a deterministic property
  of THIS test's own seed on a per-account basis, not of shared database pollution, though it does not fully
  rule out some other constant contribution and this worktree's local database was never reset to verify a
  true "clean DB" baseline for direct comparison.

**What is fixed:** each route in the sweep loop now waits for a route-specific marker proving its own seeded
content actually rendered (e.g. the seeded source's name visible on `/sources`) before stamping/measuring,
replacing the flat settle-only timeout. This removes the race regardless of which theory of the original "196"
figure is correct — the fix does not depend on resolving that question, only on making the wait deterministic.

### The corrected figure, honestly reported

**Local re-run after the fix: still 196 elements, 8 views (19/21/24/34 per view, both themes), 0 residuals —
unchanged from every prior cycle's number.** This worktree's Postgres instance was not reset to a clean state
before this measurement (multiple other worktrees share it live; resetting it was outside this fix's blast
radius and risked breaking concurrent work), so this run cannot independently confirm what a clean-database
run measures.

**Per the orchestrator's instruction, CI is treated as the measurement of record for the clean-database case.**
This file does not invent a "true" clean-DB total — the fix's job was to make the count deterministic and
race-free, not to compute and hardcode a specific number here that could drift the moment the seeded fixtures
change. The next CI run of this PR, once re-pushed, is the actual clean-database measurement; whatever total
and per-view breakdown it reports for this fixed spec is authoritative.

**What this file affirmatively withdraws:** any implication in this ticket's history that "196 elements across
4 routes x 2 themes" was a validated, reproducible property of the running application, independent of which
machine or database state measured it. It was reproducible on this machine's ambient shared database across
every prior cycle, which was not the same claim, and prior cycles' write-ups (evaluator/skeptic reports in
this same archived directory) did not distinguish the two. Those reports are historical transcripts of what
was actually observed at the time and are left unedited; this file is the correction layered on top, not a
rewrite of them.

### Verification (fresh, Cycle 8)

- `npm run lint`, `npm run typecheck`, `npm run check:e2e-types`, `npm run format:check`: all clean.
- `npm test`: 299 frontend/helio-mcp suites / 3143 tests passed; 25 helio-mcp suites / 248 tests passed.
- `e2e/focus-presence-guard.spec.ts` fresh local run (shared dev DB, cwd-verified server): **1 passed**, 196
  elements, 8 views, 0 residuals, ~100s — confirms the fix is not a regression on this machine, not a
  clean-DB measurement (see above).
- CI (clean database) is the outstanding, authoritative measurement — to be captured from the next run of
  this PR after this commit is squashed and re-pushed.
