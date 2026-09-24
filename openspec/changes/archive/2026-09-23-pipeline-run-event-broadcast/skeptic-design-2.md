## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `pwd -P` → `/home/matt/Development/helio`; `scripts/concertino/assert-cwd.sh` returned
  `READY ambient=/home/matt/Development/helio branch=feature/cross-instance-run-event-broadcast/HEL-1168`.
- Read `workflow-state.md` fresh (all C1-C9 constraints, `CONSTRAINT_REVIEWS` showing the round-1 REFUTE, and
  `DESIGN_ESCALATION_RESOLVED` confirming `answer=listen-notify` remains the owner ruling for C9).
- Read the round-1 report (`skeptic-design-1.md`) as a claim, then read the **current** `design.md` (144 lines)
  and `tasks.md` (27 lines) fresh, not from round-1 quotes.

**Revision 1 (D9 byte-based truncation) — addressed.** `design.md` D9 (lines 106-118) now explicitly states
the 8000-byte Postgres limit is enforced "on the UTF-8-**encoded byte length** of the payload, not on
`String.length` (UTF-16 code units)", marks the correction "Skeptic-round-1 correction", and mandates
truncating `errorLog` "by UTF-8 byte length: encode to UTF-8 first, then trim to a fixed byte budget ... at a
valid UTF-8 boundary (never splitting a multi-byte sequence ...)". It requires the unit test to include "a
variant containing non-ASCII (e.g. CJK or emoji) content, not only ASCII". `tasks.md` task 2.4 mirrors this
("Truncate `errorLog` to a fixed UTF-8 **byte** budget ... encode to UTF-8 first, trim at a valid UTF-8
boundary") and task 3.5 requires "TWO fixtures: an oversized ASCII `errorLog` AND an oversized non-ASCII (e.g.
CJK or emoji-bearing) `errorLog`", citing the round-1 finding by name. Both design.md and tasks.md agree.

**Revision 2 (D8 CoordinatedShutdown claim) — addressed.** `design.md` D8 (lines 87-104) now says: "a
repository-wide grep found zero existing uses of Pekko `CoordinatedShutdown` anywhere in
`backend/src/main/scala/` ... This change introduces the FIRST `CoordinatedShutdown` registration in this
codebase," and goes on to scale back its production value exactly as required: "best-effort JVM hygiene, not
a correctness requirement: Cloud Run's actual instance-teardown path is SIGTERM-then-kill with no other
resource-cleanup precedent today ... the registration mainly matters for clean `sbt test`/local-dev process
exit ... rather than for production correctness." `tasks.md` task 2.6 matches: "register a NEW
`CoordinatedShutdown` task (skeptic round 1: this is the first use of `CoordinatedShutdown` in this
codebase — there is no existing one to 'register alongside')". **Re-ran** `grep -rn "CoordinatedShutdown"
backend/src/main/scala/` myself — still zero hits (exit code 1), confirming the corrected claim is accurate,
not just reworded.

**Revision 3 (application.conf's stale comment) — addressed.** `design.md` D2 (lines 34-46) now names both
stale comments explicitly: "Two comments go stale once this ships, both must be updated (skeptic round 1:
`application.conf`'s own comment was missed in the first pass): `cd-backend.yml`'s `--max-instances=2`
comment ... and `application.conf` (near the privileged-pool config) separately states 'total max connections
per instance is 10 (5 app + 5 privileged)' — both need updating to the full 11/instance." `tasks.md` adds a
**new task 2.8**: "Update `application.conf`'s own now-stale comment (...) to reflect the true post-change
count of 11, so it stays consistent with task 2.7's `cd-backend.yml` update (skeptic round 1: this comment
was missed in the first pass)." I independently read `backend/src/main/resources/application.conf` lines
95-120 and confirmed the exact comment text task 2.8 targets ("Match app-pool Cloud Run tuning so total max
connections per instance is 10 (5 app + 5 privileged)") is present verbatim at that location today, and
`.github/workflows/cd-backend.yml` lines 75-76 still state only the privileged pool's 5/instance figure —
both are real, current staleness targets for tasks 2.7/2.8.

**No new inconsistency introduced by the edits.** Task 2.5's nullable `eventBus` param and D6's
`new PipelineRunRegistry(eventBus = ...)` still agree; D7's self-echo guard and task 2.3/3.4 still agree; the
`5+5+1=11`, `2×11=22` arithmetic in D2 is internally consistent with C9's `2x(10+1)=22` mandate. Grepped for
leftover placeholders: `grep -ni "TODO\|TBD\|figure out later" design.md tasks.md proposal.md` → no output.

**Re-verified the untouched parts of the design against the live tree (not just diffed):**
- `openspec validate pipeline-run-event-broadcast --strict` → `Change 'pipeline-run-event-broadcast' is valid`.
- Read `PipelineRunRegistry.scala` fresh — `refs = new ConcurrentHashMap[String, ActorRef]()`, `refs.put`
  unconditional overwrite in `subscribe`, `Option(refs.get(pipelineId)).foreach` single-ref publish — matches
  design.md's Context and D5's stated fix target exactly.
- Read `PipelineRunStreamRoutes.scala` line 29 — `pipelineExistsShared` is still the sole ACL gate at
  subscribe time, matching D4.
- `grep -n "= null" ApiRoutes.scala` — `alertRuleRepo: AlertRuleRepository = null` (line 130),
  `pipelineRunGuardRepo: PipelineRunGuardRepository = null` (line 182) — confirms D6's nullable-optional-
  collaborator precedent still exists as claimed.
- `application.conf` — `maximumPoolSize = 5` at both line 83 (app pool) and line 127 (privileged pool) —
  confirms the `5+5=10` baseline D2 builds on.
- `backend/build.sbt` line 205 — `"org.postgresql" % "postgresql" % "42.7.13"` present, supporting
  `PGConnection.getNotifications` per D8.
- `V100ZeroRootGuardNonSuperuserSpec.scala` exists under `backend/src/test/scala/com/helio/infrastructure/
  persistence/` — confirms task 3.3's `EmbeddedPostgres`-backed two-registry cross-instance proof has a real
  precedent pattern to follow, not a hand-waved fixture.
- Re-read `ticket.md`'s acceptance criteria and "Must hold" list — every AC (multi-subscriber fan-out,
  cross-instance A→B delivery, ACL scoping, HEL-1094 frontend contract unaffected) maps to a specific task
  (1.x/3.2, 2.x/3.3, D4/3.6, 3.7) with a required red-then-green proof (3.1, 3.3) — no AC left uncovered, no
  task doing unrequested scope.

### Verdict: CONFIRM

All three round-1 required revisions are genuinely fixed in both `design.md` and `tasks.md` (not merely
acknowledged in prose), are internally consistent with each other and with the rest of the document, and
match the live codebase's current state. `openspec validate --strict` passes. The mechanism choice (C9),
ACL/duplication reasoning (D4/D7), and connection-budget arithmetic (D2) were re-verified against the live
tree independently of round 1's report and remain sound. No new gaps found.

### Non-blocking notes

- Same as round 1: the `2×11=22` vs. "~30 exhaustion" framing still rests on an inferred reading of
  `cd-backend.yml`'s history comment (privileged-pool-only vs. total-per-instance); design.md already
  discloses this as an assumption, and C9 pre-approved documenting exactly this arithmetic, so still not
  blocking.
- Task 2.4's chosen 4000-byte truncation budget (self-approved in Planner Notes) leaves roughly 4000 bytes of
  headroom for `originInstanceId`/`pipelineId`/`status`/`rowCount`/`nodeId`/`nodeKind`/JSON overhead within
  the 8000-byte total — generous, not tight; worth the executor confirming with a real encoded-size assertion
  in task 2.4/3.5 rather than trusting the arithmetic, but the design already requires exactly that test.
