## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/panelcard-rerender-count-flake/HEL-1215`.
- HEAD is `0a1eacd7da55c2612894d991f2f2df88df7f69c6`, the same as main. The only untracked item is the change dir (`git -C <wt> status --short`).
- I read ticket.md, proposal.md, design.md, tasks.md, workflow-state.md, and my own round-1 report (skeptic-design-1.md).
- I re-read the code against the design's claims:
  - `PanelCard.test.tsx` around lines 564-622: the sequence is mount, `waitFor(getOutputRows x1)`, a two-`Promise.resolve()` `act`, the baseline sample, `rerender` with title-edit props, then `toBe(callsBeforeRerender)`. This matches the design's Context section.
  - `PanelCard.tsx:735-750` is the `<PanelCardBody` call site. It passes the callback props `refresh={panelData.refresh}` and `onDataPointSelect={handleDataPointSelect}`, so M1 ("wrap one existing callback prop in an inline arrow") is concrete and can be done as a one-line scratch edit. The title-edit `rerender` re-renders `PanelCard`, so a fresh-per-render prop makes `PanelCardBody` re-render on every run. M1 therefore goes red every time, not depending on timing.
- Each round-1 Change Request is now resolved in the artifacts:
  1. **AFTER sizing.** D4, C6 and task 3.1 now set N_after >= max(50, ceil(3 / p_before)) with 0 failures. If that N does not fit within the cap, the run stops and escalates. Resolved.
  2. **Rates only on un-instrumented tests.** D2 says rates are always measured on the committed test (BEFORE) or the fixed test (AFTER), and the instrumented copy is used for timelines only. Task 1.3 says COMMITTED/un-instrumented explicitly, and C6 repeats it. Resolved.
  3. **Mutation checks.** M1 names an exact call-site mutation. C5 carves out an exception for that reverted scratch edit, and the revert must be proven with an empty `git -C <wt> diff -- .../PanelCard.tsx`. M2 restores the old two-tick settle while the forced delay is active, which proves the fix itself is what makes the test pass. Both must be red 5/5 (task 3.2). Resolved.
- I checked the plan's other properties cold:
  - **Load cap.** C3/D2 allow at most 4 concurrent CPU-heavy processes in total, all `nice -n 19`. Kills go through a pidfile with `kill <pid>`, never pkill/pgrep/killall, and `--coverage` is never used. The cap is never raised, so this stays within the owner's hard cap.
  - **Stop and escalate.** C1/D2/task 1.5: zero natural failures means the run stops before any fix and reports.
  - **No assertion loosening.** C2/D3 forbid `<=`, ranges and retries. Any change to the assertion's meaning goes to escalation. The settle is allowed before the baseline sample only, has an iteration cap, and throws when it hits the cap.
  - **Hypotheses.** D1 now also names test-to-test leakage (compared using `-t` single-test runs against whole-file runs) and the `waitFor` sync-first-check vs. interval-retry boundary as the likely reason the failure depends on load. Both were round-1 notes, now folded in.
  - **Scope.** The test file is the expected diff. A behaviour-preserving edit to the hook is allowed only if the probe implicates it. PanelCard.tsx is protected by C5, which keeps HEL-1304/HEL-1365 out of scope. Every ticket AC maps to at least one task: root cause (1.1, 1.2, 1.4, 1.5), measured red then 0/N (1.3, 3.1), escalate if not reproduced (1.5, C1), no loosening (C2), mutation check (3.2), minimal PanelCard.tsx diff (C5, 2.2).
- No TODO/TBD placeholders or contradictions between the proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
- **Which recipe sets p_before.** D2 measures three sub-recipes (single-test `-t`, whole file, and sibling contention with `--maxWorkers=3`), but D4/3.1 say "the identical recipe". The executor should compute p_before per sub-recipe. The AFTER run should repeat the exact sub-recipe(s) that produced natural failures, sized from that sub-recipe's own p. Running 0/N on a sub-recipe that never failed BEFORE proves nothing.
- **Process count with sibling contention.** The `--maxWorkers=3` sibling batch, plus the jest parent and any burner, must still total 4 or fewer CPU-heavy processes. The jest parent is mostly idle, but count burners against the total, so the sibling batch runs with 0-1 burners.
- **M1 target.** Use `onDataPointSelect` for M1, not `refresh`. Wrapping `refresh` could also change how the body handles a refresh, which is fine for a red but muddier as a single-variable mutation.
- **Evidence persistence.** Persist `probe-evidence.md` and the failure logs via `persist-evidence.sh` when they are captured (CON-160), not only at report time.

head_sha reviewed: 0a1eacd7da55c2612894d991f2f2df88df7f69c6 (no branch commits yet; the artifacts are untracked).
