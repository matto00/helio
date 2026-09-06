## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/pipeline-zero-root-db-guard/spec.md`, `skeptic-design-1.md`, `skeptic-design-2.md` in full
from the worktree.

**Round-2 CR1 (dangling "D5 step 5") — ADDRESSED.** `design.md:116-132` now has step 4 naming
MUTATION STATE A (revert `OWNER TO` AND remove `SET row_security = off`; right-reason red = silent
non-firing, post-state `roots=0`) and a real step 5 defining MUTATION STATE B (revert `OWNER TO`,
KEEP `SET row_security = off`; right-reason red = loud `42501` / "query would be affected by
row-level security policy", explicitly NOT to be discarded as A's wrong reason; a silent red in B
means the tripwire is dead). `:129-132` adds the mutual-exclusivity argument. The citations at
`D2:71`, `D8:252` and `tasks.md:79/85` now all dereference text that exists, and design D5 step
4/5 and tasks 3.7/3.7a say the same thing with the same expected SQLSTATEs. No dangling reference
remains.

**Round-2 CR2 (D9 gates vacuous in the superuser `new DbContext(db, db)` harness) — ADDRESSED.**
New `D10` (`design.md:197-217`) names the disqualification explicitly (`DataSourceRoutesSpec`
connects as `postgres` and passes one connection as both pools, so nothing is ever invisible and
all three gates pass for the wrong reason), and pins the replacement harness: two genuinely
distinct `JdbcBackend.Database`s — an app connection as `helio_migration_test` (`NOSUPERUSER
NOBYPASSRLS`, the D4 role shape) and a separate `helio_privileged` connection. Invisibility is
produced by RLS, not asserted. The mandatory fixture-liveness assertion is stated in D10
(`:214-217`) and carried into the tasks: `3.7b1` builds the harness and forbids
`DataSourceRoutesSpec`; `3.7c` opens with "FIRST assert fixture liveness:
`soleRootDependentPipelines` returns EMPTY"; `3.7d` carries "same liveness precondition". This is
the item that would have reproduced the ticket's own failure class, and it is now closed at both
the design and task layer.

**Round-2 CR3 (unpinned privileged predicate; no service-level multi-root negative gate) —
ADDRESSED, and the pinned predicate matches ground truth.** `design.md:172-180` pins the predicate
as IDENTICAL to `soleRootDependentPipelines`, differing only in pool and in projecting `count(*)`,
and explicitly rejects `WorkspaceTeardownRepository`'s any-referencing shape with the reason (every
multi-root delete would 409). `tasks.md:31-38` (1.6a) restates it verbatim. I checked the pinned
SQL against the real source rather than the narrative:
`backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala:229-236`
is exactly `... GROUP BY p.id, p.name HAVING count(*) = 1 AND bool_and(r.data_source_id = ${id.value})`
under `ctx.withUserContext` — so D9's quoted `HAVING` clause is accurate, and the count-only
privileged shape has real precedent two definitions below at `:241-249`
(`countRestSourcesReferencing`, run under `withSystemContext`, justified in-comment precisely
because it returns only a count). New task `3.7f` supplies the missing service-level false-positive
gate (several roots, including of an invisible pipeline → delete succeeds, file removed) and
correctly explains why 3.4 does not cover it.

**Round-2 non-blocking notes — all three folded in.** TOCTOU scope sentence at `design.md:192-195`
("guarantees no NEW file destruction, not no file destruction"); short-circuit at `:190-191` and in
task 1.6b; the "don't assert absence against silence" caveat closes task 3.7d.

**Independent checks beyond the checklist.** Spec scenarios cover both AC1 (no-context raise +
rollback), AC2's two negative cases, and the GUC-set parity case; tasks 3.2-3.5 map onto them
one-for-one. AC3 is satisfied by D4's named equivalent spec; AC4 by 3.7/3.7a; AC5's intent by task
2.1 plus V100's header (1.5/1.6) under the settled `v100-header-only` ruling. Proof ordering
(vacuity probe strictly first, escalate if the premise is dead — task 1.1) is intact, and D8 keeps
all mutation work off the shared dev DB with task 1.7 last. I found no task that could pass without
exercising the behaviour it certifies.

### Verdict: CONFIRM

All three round-2 change requests are genuinely addressed in the artifacts — not merely
acknowledged — and the pinned predicate checks out against the actual repository code. The plan is
implementable and its proof obligations are sound.

### Non-blocking notes

- **Stale prose in D7 contradicts the settled `v100-header-only` ruling.** `design.md:143-146`
  still reads "That section is rewritten to state the limit *was* real..." of V99's header, and
  `proposal.md`'s Impact still lists "`V99__prevent_zero_root_pipelines.sql` header comment". The
  ruling, the Risks bullet (`design.md:221-231`), the Planner Notes (`:273`) and task 1.6 all say
  the opposite and say it loudly, so the operative instruction is unambiguous — but an executor
  reading D7 in isolation could edit an already-applied migration and break the next deploy.
  Cheapest fix: reword D7's first sentence to "V99's header is left byte-untouched; the corrected
  narrative goes in V100's header (see Risks / `v100-header-only`)", and drop the V99 line from the
  proposal's Impact. Not blocking, because the task list the executor works from forbids it
  explicitly and names the ruling.
- Ordering nit: `D8` is physically placed after the `Risks / Trade-offs` section (`design.md:250`),
  out of numeric order with D9/D10 above it. Purely cosmetic.
- Task 3.7f does not restate the fixture-liveness precondition that 3.7c/3.7d carry. It is a
  positive-outcome gate so a drift back into visibility would not make it pass falsely in the same
  way, but adding the same one-line assertion would cost nothing and keep the three D9 gates
  uniform.
