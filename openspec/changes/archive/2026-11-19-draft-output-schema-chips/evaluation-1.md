## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 99ff5a179a33a076adce2b82b38ca577e3a377ae (base cfb6041bf2443e6796dd28a677b89bf19a5135c1, resolved live via resolve-review-base.sh).
Commits: 126e4eece (red tests, `-n` bypass disclosed), 99ff5a179 (implementation).

### Phase 1: Spec Review — PASS
- AC1 (test red on main: a draft rename shows the new name in the chips): independently verified. I checked out the base
  commit in a throwaway detached worktree, added only 126e4eece's test file, and ran the full StepPreviewTable files:
  3 failed / 8 passed (rename, large schema, descendant red; disabled-step and not-previewed green on main, as intended).
- AC2 (chips use the grid's column order and types): `StepPreviewTable.tsx` derives one `draftFields` list
  (`draftSchemaFields`) that feeds both `draftColumns` (grid headers + `headerType`) and `chipFields` (inline chips and
  `OutputSchemaDisclosure`), gated by one `showsDraftGrid` boolean, which the grid branch also reads. Matches D1-D3.
- AC3 (no new request): the helper is pure; no hook, effect or service was added. Verified live (Phase 3) and by the
  e2e guards (`hel1631-draft-mode` 10/10, `hel1632-live-output` 15/15, my own run).
- Tasks 1.1-3.2 are all marked done and match the diff. No scope creep: rowOps gains `renameOrigins` built on the
  existing `foldRenames`, and draftColumnOrder only exports the existing `renamesOf`.
- The spec delta (`specs/pipeline-draft-mode-ui/spec.md`) matches the behavior: all four scenarios were observed live or in tests.
- `workflow-state.md` CONSTRAINTS is `[]`, so there is nothing further to honor.
- The grid's render condition is unchanged in practice: inside the `draftActive` body branch, `step.enabled`,
  `!isCreating` and `!isDraft` already hold, so `showsDraftGrid` reduces there to the old
  `draftFrame !== null && view?.status !== "notPreviewed"`.

### Phase 2: Code Review — PASS
Gates (my own fresh runs in WORKTREE_PATH at 99ff5a179):
- `npm run lint`: clean (zero warnings)
- `npm run format:check`: all files formatted
- `npm run typecheck`: clean
- `npm test`: root jest 70 suites / 617 tests passed; frontend jest 872 suites / 10266 tests passed (3 workers, nice 19)
- `npm --prefix frontend run build`: ok

Mutations (my own, run in a throwaway detached worktree at 99ff5a179; removed afterwards):
- M1 `chipFields = analyzeOutputSchema`: 3 red (rename, large, descendant)
- M2 rule 1 removed (`origin` forced undefined): 3 red (2 unit, 1 component rename)
- M3 `showsDraftGrid` ignoring `step.enabled`: 1 red (disabled-step test)
- M4 `showsDraftGrid` dropping `draftActive`: survives. This is an equivalent mutant: `draftFrame` is non-null only when
  `draft.active`, because `view` is undefined otherwise.
- These match the executor's recorded M1-M3. Red-first and mutation claims are confirmed.

Code: the helper is small and pure. Typing is clean (no `any`), and `draftFields` is memoized separately from
`flash.changed` as Planner Notes require. Every `originName` comes from `savedInput`, so rule 1's
"origin missing → rule 3" branch is unreachable. `fromOrigin ?? outputTypes ?? inferred` therefore behaves as
designed. No dead code, no TODOs, no new magic values. The DESIGN.md mechanical rules are untouched: no CSS or class
changes, and the chips reuse the existing `step-preview__schema-chip` and `OutputSchemaDisclosure`.

### Phase 3: UI Review — PASS
Servers were started with the canonical script on the lane DB `helio_hel1777`, with `ANTHROPIC_API_KEY` empty; `assert-phase servers` PASS.
I tested with a throwaway user, a static source (id, region, amount) and a pipeline of rename amount→total then limit 5:
- Draft rename region→zone on step 1: chips `[id, zone, total]`, grid headers `id float | zone string | total float`,
  caption "live". `zone` carries `region`'s saved type (rule 1). The `/api` request list was identical before and after
  the edit, and after switching steps (no new request).
- Step 2 (descendant): chips `[id, zone, total]` equal the grid headers, with `zone` typed `string`.
- Disabling step 1 in the draft: the body reads "This step is off…" and the chips revert to the saved `[id, region, total]`
  (spec scenario "No draft grid shown"). Re-enabling restores the draft chips.
- Console: the only error is the pre-existing `GET /pipelines/:id/schedule` 404, which is normal when no schedule exists
  and is unrelated to this change.
- Breakpoints: at 1440 and 1100 the chips render with no document overflow. At 768 and 375 the page switches to the
  mobile pipeline layout (no step preview open), also with no overflow.
- e2e for chips and schema selectors: hel1668-phone-sheet, hel1668-schema-panel-copy and hel1582-mobile-pipeline, 51/51 passed.
- The throwaway user was deleted by exact id via `buildUserDeleteSql` (count after = 0), and the servers were stopped.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `StepPreviewTable.tsx:26,30` imports two different functions named `renamesOf`: `draftColumnOrder`'s fold-order one
  (aliased `draftRenamesOf`) and `stepNarrowing`'s insertion-order one. Renaming the exported one at its source (e.g.
  `foldOrderRenamesOf`) would make the distinction self-evident.
- No component-level test pins the fold-order `renames` source: swapping in `stepNarrowing.renamesOf` was not caught as
  a test failure; it broke compilation instead. The unit test covers `renameOrigins`' fold order directly, so this gap is minor.
- D4 says the jest tests assert `httpClient.post/get` were not called; the test asserts `fetchStepPreview` was not called. The
  e2e request guards and the live check cover the no-request AC, so this is a wording mismatch only.
- `design.md`, `proposal.md`, `ticket.md` and `specs/` are still untracked in the worktree (only tasks.md and
  files-modified.md are committed). They need committing before archive and PR.
