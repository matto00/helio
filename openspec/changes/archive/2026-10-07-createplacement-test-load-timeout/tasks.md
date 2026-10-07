## Standing Constraints

- [C1] Test-side fix only; no `usePipelineDetailPage` behaviour change and no product-file edit without driver sign-off (HEL-1354 is concurrently editing the page).
- [C2] Load generation: at most 3 niced burners, PIDs recorded to a file and killed only via `kill <pid>` from that file; never pkill/pgrep/killall.
- [C3] Never write under `~` (project-local / scratch npm cache); never bypass hooks; keep full logs of every failing run.
- [C4] Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`.

## 1. Probe

- [x] 1.1 Add temporary per-phase timing and escaped-request capture to case (b) and its siblings (not committed); verify the instrumentation prints per-phase ms and every escaped URL.
- [x] 1.2 (Set `npm_config_cache` to a scratch/project path before any `npx`; keep burner count, `--maxWorkers` and file set IDENTICAL between BEFORE and AFTER.) Record BEFORE: >= 10 runs of the unfixed file under the D3 load recipe (plus the sibling-contention fallback if needed); verify failure count and per-case max duration are captured with full logs of any failure.
- [x] 1.3 Classify the cause (fixed wait / unresolved promise / fake-timer interplay / genuinely long work / escaped XHR / other) from the numbers and write `probe-evidence.md` in this change directory; verify each of the four named hypotheses has an explicit confirmed/refuted line with the supporting numbers.

## 2. Fix

- [x] 2.1 Apply the D2 fix for the confirmed cause(s) in `PipelineDetailPage.createPlacement.test.tsx`; verify the file passes unloaded and no escaped XHR remains (if that was a finding).
- [x] 2.2 If a timeout is raised, add the inline measured-reason comment; verify the value is >= 2x the worst loaded observation and is per-case/shared-constant, not global.
- [x] 2.3 Remove all probe instrumentation; verify `git diff` shows only the intended test change.

## 3. Evidence

- [x] 3.1 Record AFTER: >= 20 consecutive green runs under the identical recipe; capture the same per-case max-duration data as 1.2 (not only a pass count), state plainly whether the BEFORE recipe reproduced the red, and verify the run log and burner PID file/kill log are saved as evidence.
- [x] 3.2 PanelCard.test.tsx (HEL-1215) comparison note in `probe-evidence.md`; verify it states shared / not shared with evidence (escalate if shared, no change to it).
- [x] 3.3 Run the frontend gates (lint, typecheck, format:check, jest for the pipelines ui directory) and commit through hooks; verify all pass.
