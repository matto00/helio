## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed against the live tree at HEAD `a6ac494b47f756d38520e17b4fb5aeab898ace6b`. The change dir is still untracked and there are no code changes yet.

### What I verified (with evidence)

**Round-1 CR1 (the hook proof could pass vacuously): addressed.**
- D3 now puts the hook case in `HookRoutesSpec`, beside the existing collapse test.
- It seeds two open runs in both insertion orders, with the newer run inserted LAST at minimum, and asserts the response `runId`.
- It requires `red-run.txt` to show the hook case failing on its own. Tasks 3.2 and 3.3 carry the same wording.
- The anchor is real: `backend/src/test/scala/com/helio/api/routes/hooks/HookRoutesSpec.scala:292` is "collapse a duplicate trigger into the already in-flight run...". It seeds via `insertRunInternal(id, pid, Instant, triggerSource)`, which takes an explicit start time, so distinct and tied `started_at` seeds can be built.

**Round-1 CR2 (`HookRoutesSpec` missing from the regression set): addressed.** Task 3.5 now lists `HookRoutesSpec`, `PipelineRunGuardIntegrationSpec` and `ExistenceNotLeakedRoutesSpec`. All three exist in the test tree.

**Round-1 CR3 (D1 must engage the retry and orphan cases): addressed.** D1 states (a) the retry consequence and (b) the orphan reason, and Risks/Trade-offs now names the retry consequence as observable. I checked each claim in the D1 rationale against the code:
- *"The hook starts a run only when none is open."* True. `HookTriggerService.scala:51-54` branches on `hasActiveRunInternal`: if true it collapses, if false it submits.
- *"A caller whose first response was lost does not know its own run id; the submit is synchronous."* True, and stronger than stated. `submitNewRun` (:69-91) maps `executeRun`'s completed result. The existing test at :313 sees a terminal `failed` status from a fresh trigger. So a retry that arrives while the first run is still open means the first response has not reached the caller yet. The caller cannot hold that run's id, and newest-first breaks no promise the API makes.
- *"Both runs started at or after the caller's trigger."* True apart from the check-then-act race. No run was open when the hook submitted, so every other open run started later.
- *Orphan case.* Valid. The HEL-1511 stale window is `PIPELINE_RUN_STALE_AFTER_SECONDS` (`PipelineRunGuardConfig.scala:43-52`). Newest-first never prefers a dead run over a live run started after it.
- *"Oldest-first would be the only run read ordered ascending."* True. `grep -rn "startedAt.asc\|started_at ASC" backend/src/main` returns nothing.

**Ground truth re-checked.**
- `findActiveRunInternal` is still unordered `headOption` with the stale doc comment (`PipelineRunRepository.scala:636-645`).
- It has one caller, `HookTriggerService.scala:59`.
- The base spec's requirement text matches the MODIFIED delta's original wording (`openspec/specs/external-run-hooks/spec.md:71-79`), and the delta keeps the original scenario.
- The `docs/agent-native.md` hook paragraph (~:103-106) uses the singular "the in-flight run's `runId`/status". Task 1.3 targets the right place.
- `ExistenceNotLeakedRoutesSpec.scala:547` pins `HookTriggerService.scala -> 1`, and the file currently has exactly 1 `Forbidden`. Task 1.3's "no comment edit there" guard is consistent with that.

**Scope and the owner ruling.** No refuse or coalesce rule is planned. C15 is restated in tasks.md, and `hasActiveRunInternal`, the guards, the cap and the frontend are untouched.

**AC coverage.** AC1 (fails first, deterministic, documented rule) is covered by D3 and tasks 3.1-3.4, with the rule documented in the spec delta and D2. AC2 (the overlap question answered in the PR with evidence) is covered by Context, the Risks line and the Planner Notes.

### Verdict: CONFIRM

### Non-blocking notes
- The delta's scenario "In-flight runs with tied start times" is worded at the hook level, but D3 proves ties only at the repository level (case b). Either add a tied-`started_at` variant to the 3.2 hook case, or accept the repository proof as covering it because the hook only forwards the lookup result.
- Design Context cites `HookTriggerService.scala` without its package. The path is `backend/src/main/scala/com/helio/services/hooks/HookTriggerService.scala`. The line numbers are correct.
- The round-1 note still applies. If the "drop id.desc" mutation stays green because of planner tie order, record the plan rather than reshuffling seeds. D3 already says this.
