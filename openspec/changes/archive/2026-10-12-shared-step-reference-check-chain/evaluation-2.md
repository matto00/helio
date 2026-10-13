## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed commit:** `a08deb582dccf404600b2e703451aff2eaf55bb6`

**Diff base:** `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`, resolved live by `resolve-review-base.sh`.

**Scope:** the delta since cycle 1 is `567001f48..a08deb582`. The cycle-1 findings on the backend chain still stand (see evaluation-1.md); this report re-checks them through the gates.

### Phase 1: Spec Review — PASS

**CR1 (silent edit loss): resolved.**
- `stepCardOpHandlers.ts` now passes `persist(..., true)` for union, lookup and join.
- The three configs render `saveError` through `SecondaryInputPicker`'s shared `InlineError`.
- `computeDependentIds` was added in `laneLayout.ts`. It follows parent edges and lane edges and excludes the step itself, which mirrors `StepPlacement.dependentStepIds`.
- The picker now disables `ancestors ∪ dependents` with the visible "(would create a cycle)" text.

**Picker spec delta.** `specs/pipeline-lane-rejoin-picker/spec.md` is a MODIFIED delta for both affected requirements. It adds a "dependent is greyed" scenario and a "rejected save shows the backend's message" scenario. It now agrees with the `pipeline-lane-rejoin-input` delta, and `openspec validate --strict` passes. design.md D4's false premise is corrected in place.

**CR2: resolved.** `pipelineAccessF` is now a `def` (`PipelineStepCreate.scala` L92). `StepReferenceCheckDeferralSpec` counts `findByIdShared` calls:
- 0 calls on an ownership failure.
- 0 calls on a lane failure.
- Exactly 1 call on success.

That makes it failable against the old `val`, which started the lookup eagerly, so the count would be 1 on the rejection paths.

**Characterization fixture flip (judged).** `useStepCardState.characterization.fixtures.ts` L519/528/537 change `captures: false` to `true` for union, lookup and join. The "captures exactly" set test was extended to match. This is legitimate:
- The fixture pins which handlers opt into `saveError`, and CR1 changes exactly that, on purpose.
- The `payload` and `local` values are untouched, so the wire shape and local-state assertions still hold.
- C2 governs the behaviour-preserving backend refactor (AC1). It does not forbid re-pinning a characterization of behaviour this ticket intentionally changes.
- For transparency, list it in the PR's OWNER REVIEW section next to the C3 fixture hit.

**C1–C3.** C1 is unchanged; the PR body is still to be checked at delivery. C2 and C3 are unchanged since cycle 1, and no new backend assertion was edited.

**Scope.** No scope creep. Every frontend change is the minimum CR1 required.

### Phase 2: Code Review — PASS

Gates were run fresh by me in WORKTREE_PATH with `nice -n 19`. MemAvailable was about 50 GB. One other lane's `testFull` was running, so I did not start a second full run.

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run check:e2e-types` | exit 0 |
| `npm run check:e2e-user-cleanup` | exit 0 |
| **Full `npm test`** | exit 0. The run output two summaries, both green: **569 suites / 6230 tests** and **48 suites / 454 tests**. |
| `npm --prefix frontend run build` | exit 0 |
| Backend targeted `testOnly` | Same 74-suite set as cycle 1 plus `StepReferenceCheckDeferralSpec`. Result: **75 suites, 1395 tests, 0 failed, 0 aborted**, with `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. |
| `testFull` | The executor reports 7371/0. That is executor evidence and was not re-run by me (see above). |
| `openspec validate --strict` | valid |

**Review.**
- DESIGN.md mechanical rules: PASS. The error uses the shared `InlineError` (default "text" variant, as the other config editors do). No new CSS, tokens or hand-rolled error markup.
- DRY and modularity: `computeDependentIds` sits beside its mirror `computeAncestorIds` and reuses `secondaryInputOf`.
- Typed: no `any`.
- Tests are meaningful:
  - `laneLayout.test.ts` covers a descendant, a lane-transitive dependent plus that dependent's own child, and the property that no step is both an ancestor and a dependent.
  - `SecondaryInputPicker.test.tsx` covers a descendant (disabled), a lane-transitive dependent (disabled), an unrelated sibling (enabled), and message rendering.
  - `useStepCardState.test.ts` has an `it.each` over the three ops that rejects the PATCH and expects the exact backend message in `saveError`.

### Phase 3: UI Review — PASS

**Servers.** Started with `start-servers.sh` on 6947/9854. The backend (pid 3860244, cwd = this worktree's backend) started at 01:06, after the commit. `assert-phase.sh servers` passed.

**New e2e.** `e2e/hel1515-lane-picker-dependents.spec.ts` passed **3/3 consecutive runs**.

**Its assertions are failable.** My cycle-1 live probe ran on the pre-fix commit `567001f48` against the same trunk shape (Limit → Union → Limit). There, the dependent was offered as `"Lane node: Limit rows"`: enabled, with no cycle text. After the 400, the page showed no message. That falsifies three of the new e2e's assertions:
- `toHaveAttribute("aria-disabled","true")` (L148)
- `toContainText("would create a cycle")` (L149)
- `getByText("it depends on this step")).toBeVisible()` (L166)

The e2e forces the 400 with `page.route`, because the UI can no longer reach a real one. The real backend 400 is covered by the route specs.

**Other affected e2e.** `hel1345-rootid-step-placement`, `hel1007-multi-root-reorder`, `hel908-step-card-split`, `hel908-trunk-reorder-drag` and `hel908-trunk-reorder-order` passed **5/5**. `hel912-lanes-rejoin` and `hel968-multi-root-editor-flow` are still quarantined (HEL-992, HEL-991).

**Headless UI probe.**
- Identity: throwaway user `hel1515-eval2-1791792430911@example.test`, id `c6550472-64ae-4735-8c68-8ff2c2d1c4b4`, verified via `/api/auth/me`.
- Pipeline `b39c8c57-be6f-4066-a066-446313f3ee41`: trunk Limit A → Union U → Sort C. Side branch Filter S off A, and Join X under S with a lane to C. That makes X a lane-transitive dependent of U.
- Checked in light and dark themes, at 1440, 1100, 768 and 375 px.

| Check | Result |
|---|---|
| Options on U, both themes | Data source (enabled); `Limit rows (would create a cycle)` disabled (ancestor); `Filter rows` enabled (unrelated); `Join tables (would create a cycle)` disabled (lane-transitive dependent); `Sort rows (would create a cycle)` disabled (descendant) |
| Keyboard | ArrowDown cycles only the enabled options (Filter rows ↔ Data source). Disabled options are skipped and cannot be chosen with Enter. The combobox has its accessible name "Other source". |
| Rejected save | With a forced 400, the message "Lane reference 'x' would create a cycle (it depends on this step)." renders under the picker. Light: rgb(175,51,37) on rgb(244,242,237). Dark: rgb(241,123,103) on rgb(18,17,16). Both are legible in screenshots. |
| Layout | No horizontal overflow at any of the 8 theme × width combinations. At 375 px the open listbox fits the viewport and keeps the full disabled labels. |
| Console | No errors apart from a pre-existing `404 GET /api/pipelines/:id/schedule` (a pipeline with no schedule; unrelated to this change) and the deliberately forced 400. |

Screenshots were taken as review aids only. They are not cited as load-bearing; every claim above rests on the recorded DOM text, attributes and computed colours.

### Overall: PASS

### Non-blocking Suggestions

- `StepOpEditor.tsx` L296-337 passes only `saveError` to union, lookup and join. The other configs also receive `saveErrorIsValidation`, which changes how a 422 is styled. Consider passing it through for parity.
- `LookupConfig` shows `saveError` under the secondary-input picker even when the rejection concerns `sourceKey`/`lookupKey`/`columns`. That is acceptable today, because no lookup PATCH rejection other than the lane one is reachable from the UI. If one becomes reachable, move the error to the card level.
- tasks.md has no task entries for the cycle-2 frontend work. `files-modified.md` and design.md D4 do describe it. Consider adding a short "Cycle 2 (evaluation-1 CRs)" task group before archive.
- Carry the cycle-1 follow-ups into the PR:
  - hel908-tail-attach tests 2-4 can be repaired by locator changes only; test 1 needs a rewrite for the multi-branch contract.
  - Patch-set undo of a tail-sibling lane referrer: the journal does not record `attachAsTail` (OWNER REVIEW, under C1).
  - The characterization fixture re-pin noted in Phase 1.
- Dev DB residue from this review: user `c6550472-64ae-4735-8c68-8ff2c2d1c4b4` with pipeline `b39c8c57-...`, and the cycle-1 user `03bdad41-6fea-4591-873a-0e0eaf7eeb9e` with pipeline `eb197ba6-...`.
