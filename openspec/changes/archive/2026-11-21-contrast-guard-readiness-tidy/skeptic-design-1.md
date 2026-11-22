## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `787a283e996288551590a9e9825bd6ff339a2b0a` (branch `task/contrast-guard-readiness-tidy/HEL-1806`; change dir untracked, no code edits yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/contrast-guard-readiness-tidy/HEL-1806`.
- **1440 readiness gap is real (design Context, bullet 1).** `e2e/support/state-surface-contrast-guard.ts:920-921`: the
  `pipeline-detail` branch only waits for `seeded(main, PIPELINE_NAME)`. Then there is a 200 ms sleep (`:931`), the spine
  and editor asserts (`:939-942`), and `stampDocument` (`:947`). `stampDocument` (`:225-240`) skips
  `HTMLButtonElement.disabled`. So whether the refresh button gets stamped is a race, as the design says.
- **Narrow wait exists (bullet 2).** `e2e/support/state-surface-contrast-guard-narrow.ts` `awaitReady` waits for the
  `Refresh sample of ${SOURCE_NAME}` button to be visible and enabled. The narrow cell's refresh assertion checks
  `covered` (visible-in-view), not sampled. Narrow views are separately forced to be fully sampled (`fullySampled`), so
  at narrow widths covered means probed. The design correctly declines to change this.
- **`probeView` `sampledDocIds` (bullet 3).** `:356-375` fills the set from the probed candidates. The 1440 cell already
  builds `mainSampledDocIds` (`:959-969`) and uses it only for `/connectors` (`:979-981`). So D2 is a small addition to
  existing machinery.
- **Cap risk (D2 risk).** HEL-1649 `evidence/07-existing-routes-dense.log.txt:34-35` and
  `05-M1-at-1440-pipeline-detail.log.txt:8-9` show 19 visible and 19 sampled in the `/pipelines/:id` main view at 1440,
  under `MAX_ELEMENTS_PER_VIEW = 24`. The button appears in the main view at doc id `#6` (`05-...:21`). The
  stop-and-report rule is the right fallback.
- **M1 target exists as described.** `frontend/src/features/pipelines/ui/spine/PipelineSpine.css:442-451` contains the two
  `@media (hover: hover)` `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)` blocks (light and dark).
  HEL-1649's M1 removed exactly these and went red at ratio 1.0301 in dark, at both narrow widths and at 1440
  (`mutation-evidence.md:9-19`). The prediction that light stays green matches that record.
- **Stale comment (item 2).** `state-surface-contrast-guard.ts:55` names `state-surface-contrast-guard-narrow.spec.ts`.
  `ls e2e` shows only `-narrow-1100-768.spec.ts` and `-narrow-390.spec.ts`.
- **Positional widths (item 3).** The part files call `registerNarrowCells(NARROW_WIDTHS.slice(0, 2))` and `.slice(2)`.
  The matrix is `[1100, 768, 390]`. D3's lookup by value, which throws on a missing or duplicate width, removes the
  order dependence.
- **The `routes-*` slice non-goal is justified.** `ROUTE_KEYS_HEAVIEST_FIRST` (`:544-553`) is a list of route keys used
  to balance CI shards, not a width matrix, and the ticket names only the narrow parts.
- **AC coverage.**
  - AC1 (red by mutation, green on main): D5.2/task 1.2 (red with M1) plus D5.4/task 3.1 (green). D5.3 adds M3 and M4,
    which show the wait itself is load-bearing. The M1 red alone would not show that, because HEL-1649 already got M1
    red at 1440 without the wait. M4 reproduces the escape. This is the right evidence shape.
  - AC2 (same set of checks): D5.1 baseline, task 2.2 `--list` title parity, D5.5/task 3.2 title diff, and per-cell
    sampled-count comparison with every difference explained. The design expects `/pipelines/:id` baseline counts to
    be noisy from the race, and says so.
- **Constraints.** e2e only. M1 is reverted before commit, with a `git diff -- frontend` check (task 1.2). No new
  exemption, no cap change, no change to cell titles or `shard-weights.tsv`. Neither sibling lane (HEL-1809, HEL-1803)
  touches these files.
- **No placeholders.** There are no TODOs or TBDs. `openspec validate contrast-guard-readiness-tidy --strict` reports the
  change as valid.

### Verdict: CONFIRM

### Non-blocking notes

1. **Spec scenario with no evidence task.** The spec delta's "Reordering the width matrix does not change a part's
   coverage" scenario, and the "fail if a named width is missing" clause, have no task that exercises them. Task 2.2
   only checks title parity on the unmodified order. Two cheap `--list`-only checks would close this; neither needs
   servers. First, temporarily reorder `NARROW_WIDTHS` and confirm both files list identical titles. Second,
   temporarily name a width that is not in the matrix (e.g. `1101`) and confirm `--list` throws naming it. Log both
   and revert.
2. **Placement of the width-selection sentence.** The width-by-value sentence would sit more naturally as a MODIFIED
   clause of the existing requirement "The guard measures the redesign's narrow layouts" (main spec line 91). Here it
   is folded into the ADDED 1440 requirement, whose title does not mention it. Either placement validates.
3. **M3 needs the real sample route.** The executor should intercept the actual request the spine card issues: likely
   `GET /api/data-sources/:id/sample?pipelineId=...` (HEL-1648), but confirm it from the network or the client service
   rather than guessing. M3 also needs to show the button is disabled at stamp time, so the D2 failure is the
   "not stamped" or "not probed" path and not an unrelated timeout.
4. **D2 locator.** As the narrow cell does, assert the refresh locator has count 1 before `getAttribute`, as
   `assertConnectorControlsCovered`'s `docId` helper does. A future duplicate then fails clearly instead of as a
   strict-mode error.
