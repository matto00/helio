## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b80fdc13c982407f62015f36bb1cbc5db8530596` against the live-resolved base `a6ac494b47f756d38520e17b4fb5aeab898ace6b` (two commits: red `5ef08e011`, then the implementation `b80fdc13c`).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (a test that fails first; same run every time; documented rule). The red commit `5ef08e011` contains only the specs and planning artifacts. The repository code is unchanged in that commit, and the implementation lands in `b80fdc13c`. `red-run.txt` shows the tied-`started_at` cases failing, in `PipelineRunActiveLookupSpec` and also in `HookRoutesSpec` (the hook case fails by itself, at HookRoutesSpec.scala:343). The rule `(started_at DESC, id DESC)` is documented in three places: the doc comment (PipelineRunRepository.scala:635-645), the spec delta and `docs/agent-native.md:105-106`. The cases with distinct `started_at` passed against the unchanged code because the V136 index happens to serve that order. The executor disclosed this, and the tied cases still give a real red.
- AC2 (overlap question). Answered in design.md Context and in Risks. The owner ruling C15 is honoured: `hasActiveRunInternal`, the scheduler and auto-run guards, the HEL-505 cap and the frontend are all untouched (the diff shows only `findActiveRunInternal` in main code).
- All tasks are ticked and match the diff. There is no scope creep.
- `findActiveRunInternal` has a single caller, `HookTriggerService.scala:59` (I grepped for it). The response shape is unchanged, so no schema or API contract update is needed.
- The spec delta `specs/external-run-hooks/spec.md` matches the implemented behaviour.

### Phase 2: Code Review — PASS
Gates, run fresh by me:
- Backend: `sbt -J-Xmx3g testOnly PipelineRunActiveLookupSpec HookRoutesSpec PipelineRunOrderTiebreakSpec *PipelineRunGuardIntegrationSpec *ExistenceNotLeakedRoutesSpec *PipelineRunRepositorySpec` on the lane DB `helio_hel1833`. Result: 6 suites, 165 tests passed, 0 failed, exit 0. I ran sharded `testOnly` per C5 instead of a full `testFull`, because the diff touches one repository method with one caller.
- `npm run check:scala-quality`: clean (only pre-existing soft warnings, none in the changed files).
- Prettier `--check` on the changed markdown (docs/agent-native.md and the change dir): clean.
- The frontend gates do not apply, since no `frontend/**` files changed.

Code:
- The query (PipelineRunRepository.scala:648-653) uses `filter → sortBy(startedAt.desc, id.desc) → take(1) → headOption`. It matches the HEL-1626 order and has no escape hatches.
- The tests are meaningful. Each case seeds both insertion orders and calls the lookup five times. One case puts the later `started_at` on the smaller id, which proves `started_at` dominates. Another adds noise (a newer completed run, a dry run, and another pipeline's open run) to prove the filter excludes them. `mutations.txt` records all four mutations as red: no sort, `startedAt.asc`, no `id.desc`, and no `completedAt` filter.
- `explain-active-run.txt` measures a bitmap index scan plus a top-N sort of 2 rows in 0.043 ms. That supports not adding a migration. It was measured in a scratch schema that reproduces the relevant columns and indexes (disclosed). This is acceptable for a no-index decision.

### Phase 3: UI Review — N/A
No trigger paths changed: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files. No servers were started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineRunActiveLookupSpec` uses only `running` as the open status. A `queued` open run would exercise the same `completed_at IS NULL` predicate, so this is optional.
- `green-run.txt` holds only the two summary lines. Including the suite list would make it self-describing.
