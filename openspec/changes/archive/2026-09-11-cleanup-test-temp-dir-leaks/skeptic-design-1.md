## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/cleanup-temp-dir-leaks-in-tests/HEL-1120` (ambient is an ancestor of WORKTREE_PATH — expected).
- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`, `.openspec.yaml`.
- **Premise re-derived from the tree, not from the artifacts** (this is where the design breaks):

  ```
  $ grep -rn "createTempDirectory\|createTempFile" backend/src/test/scala | wc -l
  59
  $ grep -rl ... | wc -l
  39
  $ grep -rhno "[A-Za-z.]*createTemp[A-Za-z]*" backend/src/test/scala | sort | uniq -c
       45 Files.createTempDirectory
       10 java.io.File.createTempFile
        2 java.nio.file.Files.createTempDirectory
        2 Files.createTempFile
  ```

  The artifacts say "47 call sites across 30+ files". Ground truth is **59 occurrences across 39 files in four distinct spellings.**
- **Guard failability, tested empirically** against the regex the design specifies (Decision 4):

  ```
  MISS   val tmp = java.io.File.createTempFile("helio-csv-", ".csv")
  MATCH  val d = Files.createTempDirectory("x")
  MATCH  val d = java.nio.file.Files.createTempDirectory("output-routes-shared")
  MISS   val f = File.createTempFile("a",".b")
  ```
- **Prefix inventory**: 17 distinct non-`helio` temp prefixes are in use (`output-routes-shared`, `patch-set-*`, `pipeline-root-routes-spec`, `hel1076-rls`, `csv-url-fetch-spec`, …).
- **Wiring precedent verified**: `check-scala-quality.mjs` read in full; `.husky/pre-commit` (18 steps) and `ci.yml` read; `ci-complete: needs: [frontend, backend, security, e2e]` — the `frontend` job IS merge-blocking, so the proposed wiring target is correct. `check-precommit-ci-parity.mjs` read in full: it checks hook→CI only, resolves by npm-script name against `package.json`, and is deliberately CI-only. The design's wiring plan is sound on this axis.
- **Target spec read in full**: `LocalFileSystemSpec.scala` — 0 `afterAll`, `tempDir` at line 19 is a class field, plus `helio-from-env-abs` (278), `-create` (303), `-compat` (311). Premise confirmed.
- **`com/helio/testkit/` does not exist yet** — the new trait creates the package. Fine, just noting it is genuinely new.

### Verdict: REFUTE

The shape of the plan (shared trait + static guard + measured before/after count) is right, and the wiring target is correct. But as specified, **the guard cannot fail on an entire real leak vector**, and the task list's own numbers will lead the executor to stop 12 call sites short. These are cheap to fix now and expensive to discover in an execution cycle.

### Change Requests

1. **Correct the call-site inventory everywhere it appears** (`proposal.md` "46 other", `design.md` Context/Decision 3, `tasks.md` 1.3). Ground truth at review time: **59 occurrences across 39 files**, in four spellings — 45 `Files.createTempDirectory`, 2 `java.nio.file.Files.createTempDirectory` (FQN form: `OutputRoutesSpec.scala:140`, `WorkspaceSearchServiceSpec.scala:91`), 2 `Files.createTempFile`, 10 `java.io.File.createTempFile`. Task 1.3 currently says "all 47", which is a number an executor will work to and then declare complete. Re-derive the count from the tree at execution time rather than hardcoding mine.

2. **The guard as specified is blind to `java.io.File.createTempFile` — fix the pattern.** Decision 4 matches only `Files.createTempDirectory(` / `Files.createTempFile(`. Empirically (output above) that MISSes `java.io.File.createTempFile(` and bare `File.createTempFile(`, which is **10 of the 59 real sites**, all in `InProcessPipelineEngineSpec.scala` (8), `PipelineRunRoutesSpec.scala:153`, `PipelineRunServiceSpec.scala:406`. As written, a new unrouted `java.io.File.createTempFile` call sails through the guard forever. This directly defeats the guard's stated purpose ("fails closed if a *new* direct call is added"). Widen the pattern to cover the `java.io.File` API (and the bare/imported `File.createTempFile` form), and state the final pattern in the design.

3. **Classify the 10 `deleteOnExit()` sites explicitly rather than sweeping them into "already safe".** All 10 `java.io.File.createTempFile` sites call `tmp.deleteOnExit()` on the next line, so they clean up on a *normal* JVM exit — but not when the sbt test JVM is killed, which is exactly the batch-run scenario that produced this incident. Decision 3's binary "leaking / already-safe" classification has no bucket for this. Add a third classification ("cleans up only on graceful JVM exit") and state a deliberate call on whether they migrate. Do not silently label them safe.

4. **The AC's verification count will miss most of the tree.** `tasks.md` 3.1 counts `/tmp/helio-*`. There are **17 non-`helio` prefixes** in use — `output-routes-shared`, `patch-set-apply-service-spec`, `pipeline-root-routes-spec`, `hel1076-rls`, `hel914-ac1-e2e-spec`, `csv-url-fetch-spec`, `audit-mutation-instrumentation-spec`, and others. `design.md` Decision 5 hedges with "any other discovered prefix" but the task does not, and a hedge is not an instruction. Make 3.1 concrete: derive the prefix list from the source grep, or (better, and immune to the enumeration going stale) count total `/tmp` entries/inodes before and after and require no net growth.

5. **Decision 1's "swallow delete errors" conflicts with the AC.** `LocalFileSystemSpec` deliberately sets directories and files non-writable (`d2-readonly-dir` at 216-225, `d2-precondition` at 203-205, `d1-readonly-target` at 176-181); perms are only restored in `finally` blocks, which do not run if the JVM dies mid-suite. A recursive `afterAll` delete that catches-and-logs per-entry failures will then leave the tree behind **while reporting success** — the precise silent-leak failure mode this ticket exists to eliminate, now with a cleanup routine that looks like it works. Specify that cleanup restores write permission before deleting (`setWritable(true)` walking down, or `Files.walkFileTree` with an explicit chmod), and that a *residual* directory after cleanup is surfaced loudly (logged with the path at minimum) rather than swallowed. Keep the "never supersede a real test failure" property — those two goals are compatible.

6. **Add a `:selftest` companion for the guard.** Every comparable guard in this repo ships one and wires both into pre-commit and CI: `check:dependabot:selftest`, `check:openspec:selftest`, `check:no-credential-leak:selftest`, `check:tokens:selftest`, `check:node-root-encoding:selftest`, `check:precommit-ci-parity:selftest`. The design's only failability evidence is a one-off scratch-commit mutation (Decision 6 / task 2.3) that is reverted and leaves nothing behind — so from the next commit onward, nothing proves the guard still bites, and a regex refactor could quietly neuter it. The scratch-mutation demo is still worth doing for the PR body; it is not a substitute for the durable self-test the repo's own precedent establishes. Note the self-test must assert the vectors in CR2, including a `java.io.File.createTempFile` fixture.

### Non-blocking notes

- `skip_specs: true` **is justified** — I checked specifically because it was flagged. The change adds no capability, modifies none, touches no route/schema/wire shape, and `proposal.md`'s Capabilities section correctly declares both sections empty. Test tooling plus a lint script only. No objection.
- The wiring plan is correct and I could not break it: `frontend` is in `ci-complete`'s `needs`, and the parity checker resolves hook scripts by npm name, so adding `check:test-temp-dir-hygiene` to both `.husky/pre-commit` and the `frontend` job keeps parity green. Adding the `:selftest` from CR6 to both sides keeps it green too.
- `PipelineStepRequiredConfigSpec.scala:30` constructs `new LocalFileSystem(Paths.get("/tmp"))` — points a filesystem directly at `/tmp` rather than a temp dir. It is not a `createTemp*` call so it is outside the guard and outside the ticket's literal AC, but it writes into `/tmp` root and is worth a line in the sweep's findings list.
- Decision 4's escape hatch (`// temp-dir-hygiene: reviewed — <reason>`) is a good, grep-visible pattern and matches how this repo handles intentional exceptions elsewhere. No change requested.
