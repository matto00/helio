## Standing Constraints

- [C1] Behaviour-preserving: no change to any assertion, test body, or production logic; per-suite testFull counts identical base vs head.
- [C2] Resource caps: sbt `-J-Xmx3g`, jest `--maxWorkers=3`, all under `nice -n 19`; check `free -g` (>= ~15 GB available) before every commit.
- [C3] No pkill/pgrep/killall; `git -C`, not cd; throwaway worktrees outside the delivery worktree root, removed by exact path.

### Backend

## 1. Gate-test relabel (item 1)
- [x] 1.1 Run current FireTimeRunConfigGateSpec against a 1bf11f55 checkout; record per-test pass/fail and failure kind
- [x] 1.2 Relabel the tests that fail on assertions red-first (header paragraph, group name, section banner); keep passers GUARD

## 2. Comments and docs (items 2, 7, 8, 9)
- [x] 2.1 Fix the "this `recover`" comment in PipelineSchedulerService.fire() to point at gatedSubmit's recover
- [x] 2.2 Append the post-#888 pin note to the archived forbidden-classification.md
- [x] 2.3 Check each "Defaulted to `None`" hit against its signature; correct false ones; record verdicts
- [x] 2.4 Tighten explicitRootId `None` wording at PipelineRunService/PipelineRunBackfill if callers support it

## 3. PipelineSchedulerService split (item 3)
- [x] 3.1 Move processAutoRunDebounce/processAutoRunClaim/fireAutoRun into PipelineAutoRunDebounceFirer (D1 a-e)
- [x] 3.2 Show moved bodies are a pure move; same logger name and message strings; constructor/wiring sites unchanged

## 3b. Dead method (item 6)
- [x] 3b.1 Grep all callers of findPrimaryDataSourceIdInternal; delete if none; fix referring doc comments; compile

### Tests

## 4. Test names and behaviour proof (items 5, 4)
- [x] 4.1 Rename stale describe/it strings in PipelineRunServiceSpec (~447/547/749/2167) per D3; ~2144 quote kept + note
- [x] 4.2 Investigate audit_events scoping recurrence; add MISTAKES.md line only with a second concrete instance
- [x] 4.3 testFull per-suite counts on base and head; record the comparison
