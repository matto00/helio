## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Diff is what it claims to be.** `git log main..HEAD` → single commit `73b43384`.
`git diff main...HEAD --stat` → 2 source files (`DesktopPanelGrid.tsx` +40/-3,
`DesktopPanelGrid.test.tsx` new 213 lines) plus OpenSpec artifacts. No scope creep.

**Implementation matches the design-gate-confirmed design (read both directly, not the
narrative).** design.md's Decision block prescribes: `const detailPanel = detailPanelId !== null
? panels.find(...) : undefined`; a `useEffect` on `[detailPanelId, detailPanel, panelsStatus]`
clearing `detailPanelId` only when `panelsStatus === "succeeded"`; an *unconditional* render
guard `{detailPanel ? <PanelDetailModal .../> : null}`; the `!` removed entirely.
`DesktopPanelGrid.tsx:120-146, 336-343` implements exactly that, line for line, including the
round-2 correction's narrower claim (comments state the gate does NOT preserve unsaved edit-mode
state). `spec.md`'s scenarios also match the corrected, narrower claim rather than the walked-back
overclaim.

**RED-before / GREEN-after is real, independently reproduced by me.** I replaced
`DesktopPanelGrid.tsx` with `git show main:...` (pre-fix) and ran the committed test:
`Tests: 3 failed, 3 total`, failing with `TypeError: Cannot read properties of undefined
(reading 'id')` at the mocked `panel` access — the ticket's exact crash signature and exact
mechanism (`.find()!` returning `undefined`). Restored post-fix: `3 passed`. Worktree restored
clean (`git status --porcelain` shows only the untracked `evaluation-1.md`).

**The test is not evidence-shaped non-evidence — I mutation-tested the load-state gate.**
The `panelsStatus === "succeeded"` clause is the one subtle, 4-rounds-of-design-gate part of the
fix, so I deleted just that clause (`sed` on line 135) and re-ran: `Tests: 1 failed, 2 passed`
— test 3 ("does not crash during a transient loading/failed window, and reopens once the panel
is confirmed present again") fails at line 211. The gate is genuinely bound to an assertion; it
is not decorative. Restored via `git checkout`.

**Gates re-run fresh by me in the worktree, output read:**
- `npm run lint` → clean, `--max-warnings=0`.
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npm run format:check` → "All matched files use Prettier code style!".
- `npx jest --config jest.config.cjs --testPathPatterns=DesktopPanelGrid` → 6/6 passed.

**UI / design judgment — N/A, established from the diff, not assumed.** The diff introduces zero
markup, zero styling, zero new class names or tokens (`git diff main...HEAD --
DesktopPanelGrid.tsx` is entirely a hook, a derived value, and a boolean render guard swapped in
for a truthiness check on an id). There is no visual surface to judge against DESIGN.md's token /
shared-component / light-dark-parity rules, and no light/dark divergence is reachable from a
change that renders strictly fewer components than before. The evaluator's live in-browser
confirmation (modal auto-closes, 0 console errors at error+warning level) covers the objective
behavioral side; I did not re-run the browser because the refuting finding below is documentary
and would not be resolved by another screenshot.

**Shared-dev-DB side effect — assessed, not a blocker.** The evaluator confirmed by direct SQL
that "Demo proposed dashboard" (`e9052413-…`) now has 0 panels and the pre-existing "Edited"
metric panel was not recreated. This is real, accurately self-reported data loss on a *dev*
resource, unrelated to the shipped code, and consistent with the known shared-dev-DB hazard. It
does not affect HEL-651's correctness. My assessment: **acceptable to leave**, with a
non-blocking recommendation below — recreating a demo panel is housekeeping, and blocking a
correct fix on it would be the wrong trade. Worth noting only that it was caused by an unscoped
Playwright test selector, which is the reusable lesson.

### Verdict: REFUTE

One AC is not traceable to any evidence that exists. Everything else above is solid and I would
have confirmed on it.

**AC 4 ("Adjacent trigger paths are probed and reported") has no report anywhere.** This AC's
deliverable is not code — it is a *record of outcomes*. I searched for it and it does not exist:
- There is no `execution-*.md` in the change dir at all (`ls
  openspec/changes/panel-delete-modal-crash-guard/` → proposal/design/tasks/ticket/spec,
  4 × skeptic-design, evaluation-1, files-modified, workflow-state — nothing from the executor
  but `files-modified.md`).
- `.concertino/runs/HEL-651/evidence/` contains only `premise-validation.md` and a copy of the
  OpenSpec artifacts — no probe log, no Playwright capture.
- `grep -rn "DataType\|pipeline"` across the change dir returns exactly two hits: the ticket's
  own AC text, and design.md:132's *planning-time* statement that such a probe **must be
  reported** ("anything found to crash outside this guard's coverage is reported, not silently
  absorbed"). No hit records an actual outcome.
- `files-modified.md` describes the code and the 3 Jest tests, and says nothing about probe
  outcomes.

`tasks.md` 1.2 is checked `[x]` with the text "probe and record the outcome (crash / no crash)
for each" — the recording half was not done, or was done and lost with the executor's context.
Either way the shipped artifacts cannot distinguish "probed, all clean" from "not probed", which
is precisely the state AC 4 exists to prevent.

The evaluator waved this through with "tasks.md 1.2/3.3 are addressed via 3 Jest scenarios"
(evaluation-1.md, Phase 1). That reasoning does not hold for two of the four named paths, and I
checked why rather than asserting it:

- **Bound DataType/pipeline deleted while the modal is open.** All three Jest scenarios simulate
  the *same* mechanism — the panel vanishing from the `panels` array. A DataType deletion does
  not do that. `grep` over `backend/src/main/resources/db/migration/*.sql` shows
  `ON DELETE CASCADE` from `data_types` to `pipelines` (V22), `alert_rules` (V60) and `metrics`
  (V75) — **there is no FK from `panels` to `data_types` at all**. So the panel survives with a
  dangling `typeId`, the modal stays mounted with a defined `detailPanel`, and execution
  continues into `usePanelData`'s fetch path (`usePanelData.ts:37+`, `getDataTypeId(panel)` →
  rows fetch). That is a materially different code path which this guard by construction does
  not cover, and it is exactly the case design.md:132 named as the one to report. Its outcome is
  unknown.
- **Parent dashboard deleted with the modal open.** V2 cascades `panels` on `dashboards` delete,
  so the server side is clear — but whether the client navigates away, empties `panels` under a
  `succeeded` status, or lands in a `failed` refetch is exactly what determines whether this
  guard fires. Unrecorded.

The other two paths (different deletion surface; cross-actor removal) *are* genuinely covered —
by the Jest tests plus design.md's honest, well-argued accepted-risk note that a literal two-tab
script is unreachable because `panelsSlice.items` is only replaced by `fetchPanels.fulfilled`.
That part of the widened probe was neither fabricated nor silently absorbed. The gap is narrow
and specific, and so is the fix for it.

### Change Requests

1. **Record the widened trigger-path probe outcomes as a durable artifact** (e.g.
   `openspec/changes/panel-delete-modal-crash-guard/trigger-path-probe.md`, referenced from
   `files-modified.md`), with an explicit crash / no-crash outcome and the evidence for each of
   the four paths named in the ticket AC and `tasks.md` 1.2. Two of them (different deletion
   surface, cross-actor removal) can be recorded by pointing at the existing Jest tests and
   design.md's unreachability note — no new work needed there. The remaining two need an actual
   probe:
2. **Probe "bound DataType/pipeline deleted while the modal is open" and report the outcome.**
   There is no `panels → data_types` FK (no cascade), so the panel and the modal both survive
   the deletion — the guard in this diff cannot fire. Determine what actually happens when
   `usePanelData` fetches rows for a deleted `typeId` with the modal open (graceful error state
   vs. a second crash). If it crashes and shares this diff's root cause, fix it here per
   `tasks.md` 2.2; if it is a distinct root cause, report it explicitly as an out-of-scope
   follow-up (file a spinoff) — `tasks.md` 2.2 already authorizes exactly this branch.
3. **Probe "parent dashboard deleted with the modal open" and report the outcome** — specifically
   whether the client reaches `panelsStatus === "succeeded"` with the panel absent (guard fires,
   modal auto-closes) or a navigation/`failed`-refetch path (guard deliberately does not fire).
   State which, with the observed evidence.
4. **Uncheck or annotate `tasks.md` 1.2 until 1–3 land**, so the task list stops asserting a
   record that does not exist. (Same for 3.2's Playwright pre-fix capture: the artifact is not on
   disk. I am *not* requiring that capture be redone — my own independent pre-fix Jest run above
   reproduces the crash's exact `TypeError` mechanically, which satisfies AC 3's substance more
   strongly than a static log would. Just make the artifact list honest about what exists.)

### Non-blocking notes

- Jest tests 1 and 2 in `DesktopPanelGrid.test.tsx` are near-identical (same store status, same
  `panels: []` re-render, same assertions); only their comments differ about what they
  "simulate". Worth collapsing, or differentiating test 2 so it actually exercises a distinct
  mechanism.
- `DesktopPanelGrid.tsx` is now 350 lines, over CONTRIBUTING.md's ~250-line soft budget
  (pre-existing, not introduced here). Worth a decomposition pass before it nears ~400.
- Shared dev DB: recreating the "Edited" metric panel on "Demo proposed dashboard" is optional
  housekeeping. The reusable lesson is the cause — an unscoped Playwright selector reaching a
  pre-existing shared-DB row. Scope evidence-gathering selectors to fixtures the run created.
- This worktree's `scripts/concertino/` predates `next-report-number.sh`,
  `persist-evidence.sh` and `emit-event.sh`; I invoked the main repo's copies (as the evaluator
  did). Worktree-provisioning drift, unrelated to this ticket.
