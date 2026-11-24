## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 1cdd7df9084fe812729ea4731f1eda502b94fd98 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/multi-denial-toast-focus-flake/HEL-1842`.
- **skip_specs is correct.** `openspec/specs/run-to-update-affordance/spec.md:124` already says a multi-denial toast's
  "link and action SHALL be reachable by Tab in row order". Lines 142-146 add the scenario "Tab then reaches the next
  row's controls". A product fix restores that requirement and a test fix leaves it alone, so neither needs a delta.
  The only case that would need one is a root cause that requires changing D8 semantics. The design already lists that
  under Risks, so it does not block.
- **The failing assertion is at line 146.** `sed -n 144,147p e2e/hel1172-multi-denial-toast.spec.ts` shows the
  Beta-link `toBeFocused` after the second Tab, which matches the ticket.
- **D3 (product vs test) is sound.** The rule asks whether a real keyboard user can hit the failure, and a test-side
  fix still has to prove Alpha link -> Alpha run -> Beta link -> Beta run with real Tab presses. That keeps C3 intact.
- **D4 (no waits) is sound.** A wait on a named condition is allowed only when the root cause is shown to be
  test-side.
- **D5 and D6 reference real files.** `frontend/src/shared/ui/Toast.items.test.tsx`, `ToastRowList.tsx` (D8
  `useLayoutEffect` at lines 16-20), `scripts/e2e-shard.mjs weights` (usage at lines 6/21) and `e2e/shard-weights.tsv`
  all exist. `npm run e2e:prod-build` exists in the root `package.json:71`.
- **CI ground truth for the failure.** I pulled the job logs read-only into
  `/home/matt/Development/helio/.concertino/scratch/HEL-1842/skeptic-design/`.
  - PR #1252, run 45281484916, attempts 1 and 2: job ids 138066772289 and 138078446434 (`gh api .../attempts/{1,2}/jobs`),
    both `failure`.
  - The failing log runs `Running 147 tests using 2 workers`. `hel1172:105` is test #2, the first test in its worker.
    It runs alongside `hel1096-run-to-update-affordance.spec.ts:131` in the other worker and fails at 23:04:09, about
    36 s after its user was created at 23:03:32. The locator resolved to `<a class="toast__link" ...>` 9 times and
    received `inactive` each time. The run ends with `1 failed / 4 skipped / 142 passed`.
  - The same leg on main, run 45274842197 at 1cdd7df90 (job 138043835875): `Running 147 tests using 2 workers`.
    `hel1172:105` is again the first test in its worker and again runs beside `hel1096:131`. It passes in about 25 s.
  - PR #1252's diff (`gh pr diff 1252`) touches only `.github/workflows/ci.yml` (one added selftest step),
    `dependabot-auto-merge.yml`, `package.json`, a selftest script and openspec files. Its base is 1cdd7df90.

### Verdict: REFUTE

Most of the design is sound. Three things are wrong or missing and should be fixed before an execution cycle is spent
on them: the evidence premises, the reproduction lever, and the acceptance signal.

### Change Requests

1. **Fix three false or unverified premises in proposal.md, design.md and ticket context.**
   - "Playwright's own retry failed too" / "failed twice plus retry" (proposal.md, Why) is false.
     `playwright.config.ts:190` sets `retries: 0`. The two failures are the two job attempts of run 45281484916, and
     each log ends `1 failed`, not `flaky`.
   - The ticket implies that shard company varies per PR. It does not here: main (job 138043835875) had the same
     147-test leg, the same worker-first position for `hel1172:105` and the same concurrent `hel1096:131`, and it
     passed. Shard company is therefore not what separates red from green. Record that in design.md Context.
     Recommend timing/load and cold start as the leading differentiators. The failing run took about 36 s against
     about 25 s on main.
   - design.md Context says "the second Tab lands somewhere outside the page/toast". That is unverified: `inactive`
     only means the Beta link is not `document.activeElement`. Reword it as unknown until task 1.1 reads the
     error-context and trace.
2. **Make the reproduction plan able to hit a cold-start cause (D1 and task 1.2).** In both CI runs the failing test
   was the first test of a fresh worker against a just-started Vite dev server (`[dev]` project). `--repeat-each`
   warms the server, the module graph and the browser after the first iteration. A cause that only fires cold would
   then read as "not reproducible", which pushes toward the escalation path in Risks. D1 and task 1.2 must add a
   fresh-start loop:
   - Restart the lane servers through `scripts/concertino/stop-servers.sh` and `start-servers.sh` for each iteration,
     never a bare `npm`/`vite`.
   - Run the leg-7 order with 2 workers, so `hel1172:105` is worker-first and `hel1096:131` runs concurrently
     (`node scripts/e2e-shard.mjs` plan for leg 7 of 8).
   - Keep this loop alongside the throttled `--repeat-each` runs, not instead of them.
   - Keep the `[dev]` project as the primary repro target. The failure was on `[dev]`, and Risks lists
     `e2e:prod-build` as a "widening" step even though it moves away from the failing configuration. Say that it is
     secondary.
3. **Give the AC "passes repeatedly where it failed before" a real acceptance signal (tasks 1.2 and 3.3).**
   - Task 1.2 must record the red rate as k failures in N runs under named conditions.
   - Task 3.3 must use the same conditions, including the cold-start loop if that is what produced red.
   - Task 3.3's N must be large enough that zero failures is meaningful at the measured red rate. Example: if red is
     p = k/N, then post-fix N >= ceil(3/p) gives roughly a 95% chance of at least one failure if nothing changed.
   - The arithmetic must be stated in the committed `.txt` or in `root-cause.md`.

   As written, "zero failures across all repeats" with an arbitrary repeat count can pass by chance, for example when
   red is 1 in 20 and green is 10 repeats.

### Non-blocking notes

- Task 1.1 should name the exact artifacts: `playwright-report-shard-7` and `e2e-runner-shard-7`, per attempt. The
  trace is at `test-results/hel1172-multi-denial-toast-f612a-e-focus-never-drops-to-body-dev/trace.zip` inside the
  report. Note that `gh run view --job <attempt-1 id> --log` returned the attempt-2 log text (identical timestamps),
  so fetch per-attempt logs with `gh api .../runs/45281484916/attempts/1/jobs` and the job-logs endpoint.
- D3's example of a test defect ("a programmatic `.focus()` the browser doesn't treat as the sequential-navigation
  starting point") is unlikely in Chromium, where `focus()` sets that starting point. It does no harm as an example,
  but it should not be relied on without a probe.
- D6: the log line `defaulted (no weight row): hel1172-multi-denial-toast.spec.ts, ...` lists several other defaulted
  specs. Adding a row for this one spec alone breaks the file's "median across runs" provenance header. Leaving it
  defaulted and saying why is probably the right call.
