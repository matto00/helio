## Standing Constraints

- [C1] No retries, no larger timeouts, no loosened thresholds that could pass a hard cut or a missing pop.
- [C2] Red-first: each of the three tests is shown failing under CPU throttle (4-6x CDP or taskset) before its fix.
- [C3] Test-only; a probe-proven app defect is escalated, never fixed here.
- [C4] Scratch only under /home/matt/Development/helio/.concertino/scratch/HEL-1658/; no process kills/pgrep/pkill; Playwright <= 2 workers; throttled repeat runs under the e2e flock; heavy work under nice -n 19.

### Tests

## 1. Reproduce

- [x] 1.1 Build a throttle harness (CDP setCPUThrottlingRate 4-6x or taskset) and record a red run of hel1584 :487, :562 and hel1260 :108 in evidence

## 2. Fix

- [x] 2.1 :562 polls the motion log for the check pop; verify green throttled and red with the pop removed
- [x] 2.2 :487 asserts the morph on animation state; verify green throttled and red under a hard-cut mutation
- [x] 2.3 hel1260 :108 (and the sibling orphan test) wait for a non-null, stable grid-item box; verify green throttled
- [x] 2.4 Sweep hel1584 and hel1573 motion specs for the same pattern; fix clear cases, list the rest in evidence

## 3. Verify

- [x] 3.1 40/40 throttled repeat of each fixed test, transcript in evidence
- [x] 3.2 HEL-1584 controls (Off lift token removed, width block, expand strictmode, palette label) plus hard cut and missing pop still red, transcripts in evidence
- [x] 3.3 Lint, typecheck, prettier pass on changed e2e files
