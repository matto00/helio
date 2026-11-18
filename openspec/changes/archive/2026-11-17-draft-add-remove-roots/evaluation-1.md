## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d40b8fd3662dff5bcd19f4436c222800a822c07b`. The diff base was resolved live with `resolve-review-base.sh` to
`aeeb6867500663652295876f3970001c2d69ef55`, and covers 87 files.

### Gates (re-run by the evaluator in WORKTREE_PATH; logs in `.concertino/scratch/HEL-1734/eval1/`)

| Gate | Result |
|---|---|
| `npm run lint` | EXIT 0 |
| `npm run format:check` | EXIT 0 |
| `npm --prefix frontend run typecheck` | EXIT 0 |
| `npm test` (jest, 3 workers) | 66/66 suites, 579 tests (root) + 790/790 suites, 9679 tests (frontend), EXIT 0 |
| `npm --prefix frontend run build` | EXIT 0 |
| `sbt -J-Xmx3g testFull` (nice 19) | 708 suites, 9695 succeeded, 0 failed, 0 aborted, hel1468-guard failed=0, EXIT 0 |
| `npm run check:scala-quality` | clean (soft warnings only) |
| `e2e/hel1734-draft-roots.spec.ts` (DEV_PORT 7166, 2 workers, lane DB) | 11/11 passed |

The e2e process exited 1 after all 11 tests passed. The failure is in the global teardown `userCleanup`, which ran
against the shared dev DB rather than `helio_hel1734`: "0 of 11 recorded users match ... nothing deleted". This is an
environment artifact of the lane-private DB (C15), not a test failure, and nothing was deleted anywhere.

### Phase 1: Spec Review — PASS
- Every AC is addressed: add and remove of a root inside a draft are applied atomically by Save & run and thrown away by
  Discard. Kept-draft restore and the stale-base path carry root ops. Desktop and phone, light and dark, have e2e
  coverage.
- No AC was reinterpreted. Two ticket bullets were satisfied by pinning existing behaviour, with tests: the fingerprint
  bullet (`PatchSetTargetFingerprint` already covers roots, and a 409 after a standalone root add is tested) and the
  sample bullet (the owner path already serves the caller's own source; `SourceScopedSampleRoutesSpec` has a HEL-1734
  case). Both are recorded in design D8/premise validation.
- Every task 1.1-3.7 is checked and matches the code.
- No scope creep. Concurrent-lane files (`model.scala` OutputKind, `pipelines.ts`, `outputs.ts`, `pipelineProposal.ts`,
  `types.ts`, assistant/Settings) are untouched; I verified this against the diff's file list.
- Schemas (`draft-save-request|response|cascade-required`) and shared fixtures are updated in the same change, and the
  seam spec is extended.
- Constraints: C1 (no .env read) is honoured. C4/C5 caps are used. C12: every jest and e2e mutation log is real, and the
  union of the three e2e mutations turns all 7 functional e2e tests red: add-source-blocked gives 4 red, omit-roots
  gives 6 red, stale-ignores-roots gives the stale test red. C13: scratch is in `.concertino/scratch/HEL-1734/`. C15:
  `helio_hel1734` exists, there is no migration (max version 99 there; no V143 added).

### Phase 2: Code Review — PASS
Issues: none blocking.
- Backend. `DraftDiff.planRoots` implements D2: empty list 400, both or neither id/clientId 400, new root without
  sourceId 400, survivor carrying sourceId 400, unknown id 400, duplicates 400, survivors reordered 400, new root before
  a survivor 400. Restore mode allows explicit ids and interleaving.
- Lock site (0) `lockAddedSources` is `FOR KEY SHARE` in sorted id order before `lockDefinition`. A missing source maps
  to 404 (Public) or 409 "Undo refused" (Restore). The post-re-plan `addedSourceIds` subset guard is present, and the
  in-transaction cycle check runs under the already-held advisory lock (`needsAdvisory ||= creates.nonEmpty`).
- Apply order matches D5: insert past the stored max, then steps, relinks, `deleteRemoved`, root snapshots and rows,
  then `placeRoots` through negative temporaries. This is proven red by `mutation-insert-at-final-position.log.txt`
  (3 red).
- The race and deadlock controls are red without the site (`race-and-deadlock-controls.log.txt`), and the
  `g1-writers.md` rows were added.
- Frontend. The op log gains `rootAdd`/`rootRemove`. Replay cascades the removed root's steps and root-bound Outputs.
  Removing a draft-added root prunes every op tied to it. keptDraft v4 refuses a root op inside a v2/v3 blob. The save
  builder sends `roots` only when a root op exists, names draft roots by `rootClientId`, and compares saved roots for
  staleness. `DRAFT_BLOCK_REASON` is removed from add/remove source, and the last-source block now uses the draft root
  count.
- No `any`, no inline FQNs, no TODO/FIXME. DESIGN tokens are unaffected: the drafted card reuses `spine-card__meta`
  with the same "New · not saved" wording drafted Outputs use.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` and `DATABASE_URL` overridden to `helio_hel1734`. `assert-phase.sh
servers` returned PASS, and 6 sessions were connected to the lane DB.

- Happy path. The e2e covers add, remove and confirm, Discard, kept-draft reload, and stale-base Reload, on desktop
  light and phone dark, with screenshots in all four theme x width combinations. My own isolated probe
  (`.concertino/scratch/HEL-1734/eval1/manual.cjs`, its own browser) covered the cross-cutting case the e2e does not:
  replace the ONLY source inside a draft, then add a Limit step on the drafted root.
  - The draft preview counted the drafted source's sample (step reads `9`, from source c's 9-row sample).
  - The confirm dialog listed "Source: probe-src-a" and "Step: Filter rows".
  - The 422 was followed by a 200, and the body carried `roots:[{clientId,sourceId}]` and a step with `rootClientId`.
  - The stored pipeline has exactly the new root, with the Limit step stored under it.
  - Verified at 1440 light, 1100 dark, 768 light (phone shell) and 375 dark.
- Unhappy paths. The cascade 422 is surfaced as the confirm dialog, the stale 409 as the "changed since" notice with
  Reload, and the last source's Remove item is disabled. There are no blank screens.
- Console. The only errors in the tested flows were the expected 404 on `GET /schedule` (no schedule, pre-existing)
  and the expected 422 cascade response. There were no exceptions.
- Accessibility. "Add source" is a named button on desktop and a named menuitem on phone. "Remove source X from this
  pipeline" is a named menuitem, and the dialogs are named.
- Breakpoints. 1440/1100 render the desktop spine and 768/375 the phone shell, with no breakage in the screenshots.

Persisted evidence (CON-160):
- `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/eval1/probe-replaced-light-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/eval1/probe-step-on-draft-root-light-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/eval1/probe-confirm-light-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/eval1/probe-replaced-dark-375.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/eval1/probe-confirm-dark-375.png`

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `backend/.../draft/DraftDiff.scala` (339 → 429 lines) and `frontend/.../state/pipelineDraft.ts` (379 → 431) both
  crossed the ~400-line threshold. Per CONTRIBUTING.md, propose a split in the PR description; the root pass would move
  naturally into `DraftRootPlan.scala`.
- `DraftSaveJournal.rootDefsOf(definition, rows)`: the `rows` parameter is unused. Drop it.
- The spec scenario "adds a step on it" (pipeline-draft-mode-ui) has no e2e. I verified it manually (probe above).
  Consider an e2e case for replace-the-only-root plus a step on the drafted root, since that is the only UI path that
  puts a step on a drafted root (steps are added on `roots[0]`).
- The client undo path with roots (`usePipelineDraftUndo` adopting `summary.roots`) and the `pipelineRootsReplaced`
  reducer have no behavioural test, only an exports check.
- The e2e mutation logs record only pass/fail counts, not test names. Record the failing test titles so the red-first
  mapping is self-evident.
- The e2e global teardown cleans the shared dev DB even when the servers run on the lane DB. That is environmental here,
  but worth a MISTAKES.md note for C15-style lanes.
- Residue: e2e and evaluator probe users (prefixes `hel1734-` and `hel1734-evalprobe-`/`hel1734-evalmanual-`) live in
  `helio_hel1734` only, which is dropped at Delivery. The dev servers are left running on the lane DB for the skeptic;
  stop them with `stop-servers.sh`.
