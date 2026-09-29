## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `pwd -P` → `/home/matt/Development/helio`; `scripts/concertino/assert-cwd.sh`
  (invoked with the full `$WORKTREE_PATH`-absolute path) returned
  `READY ambient=/home/matt/Development/helio branch=bug/repro-pipeline-guard-flake/HEL-1195`.
  Proceeded normally.
- Read round 1's report in full (`skeptic-design-1.md`) to know exactly what the two Change
  Requests said, rather than trusting the orchestrator's paraphrase of them.
- Read `design.md` and `tasks.md` **in full** (not just the sections the orchestrator says it
  touched), to confirm the rest of round 1's clean bill of health still holds. Confirmed:
  Context, Goals/Non-Goals, Decision 2 (evidence capture), Decision 3 (hypothesis branching, H1
  escalation, H2 fix shape, H3, nothing-reproduces escalation), Decision 4 (guardrail), Risks, and
  the Planner Notes are all unchanged in substance from round 1 and still internally consistent —
  no new placeholders, no new scope drift, AC traceability still holds (re-checked against
  `ticket.md`'s three ACs, not re-read verbatim this round since round 1 already confirmed the
  mapping and nothing in the diff touches it).
- `git status --porcelain` shows the entire change dir as untracked (`??
  openspec/changes/pipeline-guard-flake-repro/`) — this is pre-commit design-gate work, so there is
  no meaningful `git diff` to inspect; I verified the revision by reading the current file content
  directly and comparing it against round 1's quoted Change Request text.

**Change Request 1 (no stated iteration/time bound) — resolved.** Decision 1 method 1 now states:
"run `PipelineRunGuardIntegrationSpec` in a loop, bounded to **up to 40 iterations OR 20 minutes of
wall-clock time, whichever comes first**" (design.md lines 49-51), and `tasks.md` 1.1 states the
identical bound and its Verify line no longer presupposes an unfilled variable ("at least one
failure is observed within the stated bound, OR the bound (40 iterations or 20 minutes) is reached
with 0 failures", tasks.md lines 11-13). This is a concrete, executable number with the same
concreteness as method 2's "3 sequential iterations." Standing constraint C5 and tasks.md 3.3 now
have something real to "exhaust." Resolved as written.

**Change Request 2 (ambiguous "3-4 concurrent JVMs" given `Test / fork := true`) — resolved.**
Design.md Decision 1 now states the cap in OS-level-invocation terms, not raw JVM count: "at most 3
concurrent `sbt` OS-level invocations at any time (1 spec-loop + up to 2 contenders) — never more"
(design.md lines 63-65), and specifies the implementation mechanism to avoid re-spawning a driver
JVM per iteration: "ONE `sbt` OS-level invocation for the loop itself, chaining repeated `testOnly`
commands... or an interactive `sbt` shell fed repeated `testOnly` commands" (lines 53-58).
`tasks.md` 1.1 mirrors this exactly. The arithmetic is internally consistent (1 + 2 = 3, matching
the stated cap), and this is exactly the "OS-level invocations, not JVMs" concreteness the Change
Request asked for. Resolved as written.

I independently checked the factual premise behind Decision 1's parenthetical justification
("Each invocation's own sbt-launcher JVM is a lightweight, mostly-idle bookkeeping process while
its one forked child JVM does the real work") against `backend/build.sbt` (re-read lines 110-170,
confirming `Test / fork := true` behavior and HEL-924's `Test / testGrouping`/
`Global / concurrentRestrictions` mechanism first cited in round 1). The design's claim that
repeated `testOnly` invocations in one interactive sbt session "reuse... the same... forked test
JVM across every iteration" is questionable: sbt forks a fresh child JVM per `Test`-task execution
(each `testOnly` command triggers its own fork/teardown), not a single persistent forked JVM
reused across commands — only the sbt-launcher/driver process itself persists across the session.
This does not change the substance of either resolution: the stated caps (40 iterations/20
minutes; 3 concurrent OS-level invocations) are unambiguous and directly actionable regardless of
whether the underlying forked JVM is reused or re-forked serially within one launcher session,
since the loop is sequential either way and the peak concurrent forked-JVM count the design relies
on (≤3) holds under either description. I am treating this as a non-blocking accuracy note, not a
new Change Request, because it does not reintroduce the ambiguity-about-process-count the original
Change Request 2 was about, and it does not affect what an implementer is actually told to run.

### Verdict: CONFIRM

Both round-1 Change Requests are resolved as written, with concrete, self-consistent, directly
actionable numbers (40 iterations/20 minutes; 3 concurrent `sbt` OS-level invocations, 1 loop + 2
contenders) that mirror the concreteness round 1 already accepted for method 2. No new
placeholders, contradictions, ambiguity, scope drift, or missing-contract gaps were introduced by
the revision, and the rest of round 1's clean bill of health (hypothesis-branch fix shapes, H1
escalation requirement, `deleteOldRuns` treated as candidate not conclusion, AC traceability, no
scope drift) still holds on a full re-read of both files.

### Non-blocking notes

- Design.md Decision 1's rationale that repeated `testOnly` invocations inside one interactive sbt
  session reuse "the same... forked test JVM across every iteration" is likely technically
  imprecise (sbt forks a new child JVM per `Test`-task execution under `Test / fork := true`; only
  the launcher/driver process is actually persistent across the session) — worth a one-line
  correction for accuracy, but it does not change the stated, actionable caps or their
  correctness, since the loop is sequential and the peak concurrent forked-JVM count is ≤3 either
  way.
