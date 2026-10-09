## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD b409172a53ebe6f80db154847cb1b85c286293e1 (change dir untracked, artifacts read from disk).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/cap-local-test-parallelism/HEL-1442`.
No heavy workloads were run: I only read configs, the workflow file and the planning artifacts.

### What I verified (with evidence)
- `package.json:53` `test` = `jest && npm --prefix frontend test`. Neither `jest.config.cjs` nor `frontend/jest.config.cjs`
  sets `maxWorkers`, `workerIdleMemoryLimit` or `cacheDirectory`. The design's grounding is correct.
- Root jest is the helio-mcp entry point. Its comment says every collected test lives under `helio-mcp/src/**`, and
  `helio-mcp/package.json` has no jest script. Task 3.3 still asks for this to be checked, which is fine.
- `playwright.config.ts:131` is `workers: process.env.CI ? 2 : undefined`. Correct.
- `backend/build.sbt:172-180` lifts the forked-group limit only when `HEL924_TEST_GROUP_CONCURRENCY` is set. `Test /
  javaOptions` (127) and `Compile / run / javaOptions` (224) carry only `--add-opens` and no `-Xmx`. `ci.yml` backend
  job sets concurrency 2 and group count 4, and puts `-Xmx3g` on the sbt JVM through `.jvmopts` and `-J-Xmx3g`. Correct.
- CI's e2e job starts the backend with `sbt run` (`ci.yml:580`), so it runs with `CI=true` and D1 leaves it unaffected.
- Nothing under `scripts/` or `.husky/` sets `CI=` locally. `process.env.CI` is read only by `playwright.config.ts` and
  one selftest. A gate keyed on `CI` will therefore really apply locally.
- `.husky/pre-commit` runs about 25 node steps before `npm test`, including `eslint .` (root and frontend), three
  `tsc --noEmit` runs (frontend, e2e, helio-mcp) and `prettier . --check`.
- sbt is 2.0.9 (`backend/project/build.properties`). `ci.yml:238` and `ci.yml:248` (HEL-1339/HEL-1273 comments) record
  that the default sbtn thin client hands off to a background server. They also record that `-J-Xmx3g` through the
  thin client did not take effect on the runner.

The design is sound and grounded in the codebase. D1 omits keys under CI instead of setting them to equal values, which
is a good choice. Prod is left alone, and D4 confines changes to the Test/run keys, which the Docker `assembly` +
`java -jar` path does not read. Both choices hold up. The design still fails to cover two acceptance criteria, has one
verification step that can pass without proving anything, and has one ambiguous decision.

### Verdict: REFUTE

### Change Requests
1. **The AC says to measure the full pre-commit hook, but D7, task 1.2 and task 5.1 measure only `npm test`.** The
   ticket asks for the "peak RSS of one lane's full pre-commit + full `sbt testFull` + dev servers". The hook also runs
   `eslint .`, three `tsc --noEmit` runs and `prettier . --check`, which are separate node processes and may have
   larger single-process peaks than a jest worker. Change D7 and tasks 1.2 and 5.1 so that "before" and "after" both
   cover the whole `.husky/pre-commit` run (or each of its steps), sampled the same way as the rest. Record which step
   sets the peak.
2. **No decision and no task covers the AC's "node heap cap where it matters".** D6 only hands vite's `NODE_OPTIONS`
   over to a CON ticket. D2's `workerIdleMemoryLimit` recycles idle workers but is not a heap cap. Add a decision with
   a stated rule, for example: "a node process whose measured peak exceeds X gets `--max-old-space-size` set via its
   config or script, gated on CI unset; otherwise state why no cap is needed". Add a task that applies the rule to the
   hook's node processes (jest parent and workers, eslint, tsc) from the item-1 measurements.
3. **The CI-unchanged proof for sbt in D4 and task 2.1 can come out false.** sbt 2.0.9 uses the sbtn thin client by
   default, and `sys.env.get("CI")` is read in the server JVM's environment, not the client's. Suppose
   `CI=true sbt "show Test/javaOptions"` connects to a server that is already running locally, such as a lane's
   `sbt run` or an earlier testFull. It will print that server's local-mode settings, and the reverse can also happen.
   `ci.yml:248` records this thin-client behaviour already. Require each CI/local `show` probe to run in a JVM started
   with the intended environment: use `--server` as `scripts/ci-sbt.sh` does, or confirm no server is up for the
   worktree first. Record the mechanism in the evidence. The same issue applies to the "local shows the cap" check
   and to the forked-JVM heap measurement in task 1.3 and task 5.1.
4. **D4's rule for the sbt server JVM is ambiguous.** "Only cap it if it is unbounded" can be read two ways. Every JVM
   has some default ceiling, so the rule can never fire. Or it means "no explicit `-Xmx`". The owner ruling is "CI's
   numbers are the hard cap". Reword the rule to: "if the measured local sbt server max heap exceeds CI's 3g, cap it
   at or below 3g". D4 rules out tracked `.jvmopts`/`.sbtopts`, so also name the mechanism that would be used, or say
   explicitly that none is available and report it as a finding. The HEL-1273 comment at `ci.yml:248` says the local
   default is probably 1 GB, in which case this rule is a no-op. Either way the rule has to be unambiguous before
   Execution.
5. **The AC says Concertino-side changes "go in a CON ticket", but task 4.3 only lists them in measurements.md.**
   Change 4.3 so each item becomes a filed CON ticket, or is handed to the orchestrator to file, with the ticket IDs
   recorded. A list on its own does not meet the AC.

### Non-blocking notes
- The 3-lane budget should include sbt servers left running after `testFull` (sbtn background servers outlive the
  command) and any `sbt run` server per lane. They are idle but resident.
- D5's "fall back to the default cap loudly or are rejected" leaves the choice to the implementer. Either is
  acceptable, but pick one in tasks so the evaluator has a single behaviour to check.
- The `HEL924_TEST_GROUP_CONCURRENCY` override can already raise local concurrency above 2. That is fine as a
  documented one-off override, but the docs should say it is the override for the forked-group cap.
- The spec scenario "identical apart from fields that depend on the checkout path" is good. Also exclude jest's
  `cacheDirectory` from that allowance under CI, so it cannot become a hidden CI diff.
