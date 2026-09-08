## Auditor Report

### Condition 1–3 (check-merge-readiness.sh)
- Ran with a 620s tool timeout (script's own CI-wait bound is 420s). Output:
  ```
  FAIL CI failed: e2e
  EXIT:1
  ```
- This is **not** the known 420s-vs-~11min timeout mismatch (that mismatch only ever manifests as a
  pending/timeout report on the `backend` job). This is a genuine, terminal `failure` conclusion on
  the `e2e` job (confirmed independently via `gh api repos/matto00/helio/actions/jobs/101972833165`
  → `status: completed`, `conclusion: failure`).
- Independently confirmed via `gh pr checks 595`:
  - `e2e` — **fail** (4m26s, terminal)
  - `CodeQL`, `security`, `frontend` — pass
  - `backend` — still pending at time of writing (well within the known 420s-bound-vs-~11m-runtime
    mismatch; not itself a finding)
  - `label-update-type` — skipping (normal)
  - `Analyze (actions)`, `Analyze (javascript-typescript)`, `Analyze (python)` — pass
- Mergeability: `gh pr view 595 --json mergeStateStatus,mergeable` → `mergeStateStatus: BLOCKED`,
  `mergeable: MERGEABLE`. `BLOCKED` here is a direct consequence of the required `e2e`/`ci-complete`
  check not being green — not a separate defect, not a `BEHIND` state (base is unchanged since the
  PR branched, no reconciliation was needed).
- The evaluator's PASS (evaluation-2.md) and skeptic's CONFIRM (skeptic-final-2.md) are both present
  and current in the event log/archive — the gates-passed sub-check is satisfied.

**Root-cause read on the e2e failure (for the human, not as a basis to override):** the single
failing test is `e2e/hel510-keyboard-shortcuts.spec.ts:176` — "Cmd/Ctrl+K still opens the palette
while the palette is already open" — asserting `<dialog class="command-palette">` gets an `open`
attribute after a second Ctrl+K press. It is entirely inside HEL-510's own keyboard-shortcut/command-
palette suite. This PR's diff touches only `TableRenderer.tsx/css/test`, `DataGrid.tsx/test`,
`outputConfigTypes.ts/test`, and `PanelContent.tsx` — no file in the command-palette/keyboard-shortcut
surface. `git diff main...HEAD --name-only` confirms no overlap. This reads as a pre-existing flake
or defect in HEL-510 (merged at `db51e936`, the direct base of this branch), not something this PR's
change introduced. That said, per my mandate a real, terminal CI failure is a real, expected
`ESCALATE` regardless of apparent relatedness — I am not the one who gets to judge "unrelated enough
to merge past."

### Condition 4 (acceptance criteria, traced cold)

Traced against `openspec/changes/archive/2026-09-08-in-panel-column-sort/ticket.md` (including both
restated-scope sections) and `git diff main...HEAD`:

- **Click/keyboard-activate sorts every loaded row; second activation reverses (two-state, no clear)**
  — `DataGrid.tsx` renders a `<button>` per sortable `<th>` wired to `onSort`; `TableRenderer.tsx`'s
  `handleSort` calls `toggleSort(key)` from the reused `useSortedRows` hook, whose `SortState` type
  has no "none" variant (matches Ruling 1 — two-state, hook reused as-is, no fork).
- **`aria-sort` + direction indicator** — `DataGrid.tsx`: `ariaSort` computed from `sort?.key ===
  col.key` into `"ascending"/"descending"/"none"`, applied via `aria-sort={ariaSort}` on the `<th>`;
  `FontAwesomeIcon` glyph (`faSortUp`/`faSortDown`/`faSort`) mirrors `SortableTh`'s vocabulary exactly
  per the D4 comment.
- **Persists across modal open/close and reload** — `columnSort?: SortState<string> | null` added as
  a flat sibling of `columnOrder` on `TableOutputConfig` (`outputConfigTypes.ts`), read tolerantly via
  `readColumnSort`, written via `persistColumnSort`/`updateOutput`; `handleSort`'s debounced PATCH is
  flushed (not cancelled) on unmount specifically so closing the detail modal mid-debounce still
  persists (design D6, code comment at the `useEffect` cleanup in `TableRenderer.tsx`).
- **Numeric-aware, blanks last, stable** — `getSortValue` in `TableRenderer.tsx` coerces numeric-
  looking strings to numbers and blank/whitespace-only strings to `null` (routing into the shared
  hook's null-last comparator), leaving true non-numeric strings on the hook's locale-compare path.
  Comparator itself is unchanged/reused, not reimplemented, matching the HEL-1022-reuse ruling.
- **No regression to resize/density/column-order** — `orderedColumns`/`deriveKeys`/column-width state
  in `TableRenderer.tsx` are untouched aside from being lifted into `useMemo`s for identity stability
  feeding `useSortedRows`; the resize `<span>` still exists and still stops propagation (unchanged);
  `DataGrid.test.tsx` and `TableRenderer.test.tsx` diffs add sort-specific cases without touching
  existing resize/density assertions (per skeptic-final-2.md's fix-commit-only-adds-a-guard note).
- **Jest coverage for comparator + sort-then-render ordering** — `DataGrid.test.tsx` (+96 lines) and
  `TableRenderer.test.tsx` (+238 lines) added; both evaluation-1.md and evaluation-2.md independently
  ran mutation-testing against the comparator/adapter (evaluation-2.md: "9/14 red under mutation").
- **Visual cohesion, light/dark, verified live** — both skeptic-final rounds record live, running-app
  screenshots in both themes (skeptic-final-2.md "screenshotted at default grid panel size in both
  themes"); the `sortable-th__*` classes/CSS are imported and reused verbatim from `SortableTh.css`
  rather than reimplemented, per the D4 code comment.
- **Output-scoped, not panel-scoped; never described as per-panel** — confirmed by direct read of
  `outputConfigTypes.ts` (field lives on `TableOutputConfig`, not on any panel/placement type) and by
  the doc comments throughout `TableRenderer.tsx`/`outputConfigTypes.ts`, none of which use "per-panel"
  language for this field.
- **Non-owner degrades silently to session-local** — `canWrite` pre-check in `TableRenderer.tsx`
  (`ownerId === currentUserId`) gates the PATCH; `persistColumnSort` additionally swallows any
  `updateOutput` rejection via `.catch()`, per Ruling 2 and design D7.
- **Leaves room for HEL-451/465/469** — `columnSort` is added as a flat sibling field (not nested),
  with an explicit code comment instructing the three follow-on tickets to do the same, matching
  `OutputService.mergeConfig`'s four-hardcoded-keys deep-merge constraint cited in both the ticket and
  skeptic-final-2.md's blast-radius check.

All acceptance criteria, including both restated-scope sections and the two 2026-09-08 rulings, trace
to specific, real code in the diff. Condition 4 is satisfied.

### Verdict: ESCALATE

### Reason
- **Condition 1 (CI green) fails for real, not for the known 420s-timeout reason.** The `e2e` job
  terminated with `conclusion: failure` on `e2e/hel510-keyboard-shortcuts.spec.ts:176` ("Cmd/Ctrl+K
  still opens the palette while the palette is already open") — a real assertion failure
  (`toHaveAttribute("open")` timed out, attribute never appeared), not a pending/timeout state.
- **This failing test is outside this PR's diff surface** (HEL-510 command-palette/keyboard-shortcut
  suite; this PR touches only `TableRenderer`/`DataGrid`/`outputConfigTypes`/`PanelContent`) and looks
  like a pre-existing flake or latent defect in HEL-510 (base commit `db51e936`), not a regression this
  change introduced — but per my mandate I do not get to merge past a real, terminal CI failure on
  that basis; that judgment belongs to a human.
- **Mergeability is `BLOCKED`** as a direct, expected consequence of the above (`ci-complete` cannot
  be green while `e2e` is red) — not a separate finding.
- `backend` job was still pending at last check; not itself a blocker (well inside the known
  script-bound-vs-runtime mismatch), but worth re-polling once `e2e` is addressed.
- Condition 4 (acceptance criteria) is fully satisfied — no finding there. The only blocker to merge
  is the CI/mergeability state described above.
- Recommended human action: re-run the `e2e` job (if this is HEL-510 flake) or file/triage a HEL-510
  defect if it reproduces, then re-run this auditor (or merge manually) once `ci-complete` is green.
