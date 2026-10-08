## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/ci-actions-cache-budget/spec.md, skeptic-design-1.md
(uncommitted, in the worktree at HEAD 6caba6b130154a03f5ccd61d985175969fb9c641), checked against `ci.yml`,
`cd-frontend.yml`, the live cache listing, and the on-disk sbt 2 layout.

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/actions-cache-under-limit/HEL-1299`.
- **Round-1 CR1 (D2 proof) is mostly addressed.** D2 now uses option (b): on PR runs, prune right after "Restore
  backend compile output" (ci.yml l.201-210, present in all 4 backend legs) and before the real
  `compile; testFull` (l.216-232). The local experiment is dropped, and C1 forbids writes under `~`. I checked the
  equivalence argument: main prunes its post-build tree to that tree's own links, and a PR prunes the restored copy of
  that same tree, so the PR canary does exercise the content a pruned main entry would hold. **Gap: the step-time
  comparison CR1 asked for was dropped** (see CR1 below).
- **sbt 2 layout, read-only on a compiled worktree** (`HEL-1310/backend/target/out`): 522 symlinks, all into
  `~/.cache/sbt/v2/cas`. They cover `helio-backend` classes/test-classes `.sbtdir.zip`, both zinc analyses
  (`zinc/inc_compile_2.13.zip`, `test-zinc/...`), jars, the meta-build `backend-build/classes/TestShards*.class`, and
  508 `value/*` links. The unique referenced blobs total about **65 MB** (`du -cL`), plus 161 MB of regular files in
  `jvm/`. So S is plausibly a few hundred MB, far under C2's ~1.7 GB break-even. `~/.cache/sbt/v2` holds only `ac`,
  `cas`, `proc`.
- **`ac` content matters for D2's "drop `~/.cache/sbt/v2/ac`".** A sampled `ac` entry is
  `{"outputFiles":["${OUT}/value/sha256-…/64.json>sha256-…/1"],"origin":"disk",…}`. That is sbt's action cache, and
  it maps task keys to CAS outputs. Dropping all of it invalidates every cached sbt task action, not just the pruned
  ones. That should not break correctness, because the zinc analysis is a kept link, but it can cost time on every
  run that restores a pruned entry (every PR leg, permanently, and every main run after merge). That is exactly AC5's
  risk.
- **Round-1 CR2 (D5 acceptance) is addressed.** Task 5.4 adds a static selftest of the exact `--ref` line, `PR_NUMBER`
  sourced only from `github.event.pull_request.number` via `env`, no checkout, no other delete, and red on a mutated
  copy. Task 6.3 adds the driver post-merge check (closed PR's ref has 0 entries; main's count unaffected). D5 deletes
  only the exact `refs/pull/<N>/merge` ref, which satisfies the driver constraint.
- **Round-1 CR3 (decision rule) is partly addressed.** C2 is in tasks.md and workflow-state.md; it records S and
  recomputes the projection, with >5 GB returning to the design gate. `sbt-<64hex>` was added to the janitor at
  KEEP=1. The regexes match the live keys: `gh api .../actions/caches` lists `sbt-42d9636a…b117a5` (64 hex) and
  `codeql-overlay-base-database-1-c801913f1ee29663-javascript-…` / `…-d953d79b74456ce0-python-…`. The C2 triggers
  cover size, failure and full recompile, **not wall-clock** (see CR1).
- Live state now: `actions/cache/usage` reports 10,280,689,153 B / 27 entries. That is 4 `backend-compile-v3`
  entries (1.80 to 1.92 GB), 8 + 8 CodeQL entries, and 2 PR-scoped npm entries (`refs/pull/858/merge`, ~116 MB each).
  This confirms that npm is the only PR-scoped family left once D1 lands, which D5 cleans up.
- Round-1 non-blocking notes were folded in: the restore `id`, `branches: [main]`, the `concurrency` group, and
  default-branch-only checkout (D4).
- AC4: D6 leaves default setup unchanged, and the spec scenario checks `languages`. No coverage reduction is planned.
- D3: `cd-frontend.yml` l.27-31 `setup-node cache: npm` keyed on `frontend/package-lock.json` only. Removal is correct.

### Verdict: REFUTE

D1/D3/D4/D5/D6 are sound, and CR2 is fully fixed. Three items remain. Each is small, but each is a real gap in
acceptance signal or internal consistency.

### Change Requests

1. **D2's PR canary has no wall-clock signal and no source-change case (design.md D2, tasks 2.3, C2).**
   Round-1 CR1(b) asked to capture the step time against an unpruned leg. The revision records only sizes and
   "compiling N" counts, and C2 does not trigger on time. Dropping all of `v2/ac` (verified above to be sbt's task
   action cache) is the change most likely to slow builds without breaking them, and it becomes a permanent cost on
   every PR leg. This PR also does not change `backend/src/**`, so its compile key is an exact hit and its run never
   exercises the spec scenario "one source file changed → compiles incrementally". Revise as follows:
   - (a) In 2.3, record each backend leg's "Compile and test" duration and the prune step's own duration on the PR.
     Compare them against the same legs of the base `main` run (unpruned restore, same sources). Add to C2: a median
     leg slowdown above a stated threshold (for example, more than 10% or 30 s) returns to the design gate.
   - (b) Add a temporary, reverted one-line `backend/src/**` commit, like 6.1's `build.sbt` commit. Its logs must show
     a small "compiling N Scala sources" count from the pruned entry. This is the in-lane evidence for the spec's
     incremental scenario.
   - (c) State whether `ac` is dropped wholesale or filtered to entries whose `outputFiles` blobs all survive the
     prune. Keep wholesale only if (a) shows no regression.
2. **The spec contradicts D4 on the janitor allowlist** (specs/ci-actions-cache-budget/spec.md, "Superseded main
   cache entries are removed"). The spec names the allowlist as "the backend compile cache, and CodeQL overlay base
   databases per language" and says the janitor "SHALL select deletions only from that allowlist". D4 and task 4.1
   also delete `sbt-<64hex>` entries at KEEP=1, so the shipped janitor would violate its own spec. Add the sbt
   dependency family (KEEP=1, content-keyed) to the requirement text. Also make the "after several main pushes"
   scenario cover per-family keep counts.
3. **design.md Risks l.95 is stale and contradicts D2.** It reads: "-> local proof + PR CI report-only run before any
   save; fallback D2." D2 now forbids a local proof and runs in `prune` mode on PRs, and "fallback D2" refers to
   itself. Rewrite the mitigation to match the current design: the PR prune canary, the C2 rule, and the KEEP=2
   unpruned predecessor as the rollback source.

### Non-blocking notes

- D5: `gh` in the workflow needs `GH_TOKEN: ${{ github.token }}` in `env`. The 5.4 static check should allow that one
  extra `env` key, so it does not reject the only working form.
- D2 script scope: prune only `~/.cache/sbt/v2/cas` (and `ac` per CR1c). Never touch `v2/proc` or the coursier and
  ivy paths restored by the separate `sbt-*` entry. The 5.2 fixture should include a `proc/` dir and assert that it
  survives.
- tasks.md lists 5.4 before 5.3, which is cosmetic.
- Expected S from local measurement is a few hundred MB, so the projection is about 1.6 + 2S, roughly 2.2 GB, well
  under 5 GB. CR1 is about time, not size.
