## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

Read fresh, cold: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/workspace-tag-teardown/spec.md`, `specs/resource-tagging/spec.md`, and all
three prior skeptic reports (`skeptic-design-1.md` through `-3.md`) — treated the
latter as claims, not fact, and independently re-derived every conclusion below
against the current file contents.

**1. Round-3 fix — Decision 2 predicate — confirmed correct and complete.**
- `design.md:61-78` (Decision 2) now reads: "whether any tagged DataSource has a
  dependent Pipeline whose `tag` is not the same tag being torn down
  (`pipeline.tag IS DISTINCT FROM :tag` — covers both an untagged dependent, `tag IS
  NULL`, and one tagged into a different, live batch, e.g. `tag = 'U'`), or any
  tagged output DataType has a producing Pipeline whose `tag` is likewise `IS
  DISTINCT FROM :tag`." This is the exact fix CR1 of round 3 requested — both
  directions (DataSource→Pipeline and output DataType→Pipeline) now carry the
  explicit `IS DISTINCT FROM` predicate, matching Decision 6's already-fixed shape.
  The old ambiguous "NOT also tagged" phrasing is gone — grepped `design.md` for
  `also tagged`/`not also` and found no remaining instances of the buggy phrase (the
  only "also tagged T" hits left are the correct, safe usage — "is also tagged T" —
  in the positive-path scenarios).
- `tasks.md:48-56` — new task 3.3 added, with the literal predicates spelled out for
  both directions: "DataSource→Pipeline: for each tagged DataSource, block if a
  Pipeline exists with `source_data_source_id = <that source's id>` AND
  `pipelines.tag IS DISTINCT FROM :tag`" and the symmetric output-DataType→Pipeline
  check. Explicitly app-pool/`withUserContext`-scoped, matching 3.1/3.2's pattern.
- **Renumbering verified correct end-to-end**: `grep -n "3\.[0-9]" tasks.md` shows
  3.1 (panel-bound extraction), 3.2 (source-link guard), 3.3 (NEW — Decision 2's two
  guards), 3.4 (DBIO composition, now correctly citing "the dependent-cascade checks
  from 3.1/3.2/3.3" — includes the new 3.3), 3.5 (post-commit file cleanup, "after
  3.4's transaction commits" — correct forward reference), 3.6 (service wrapper),
  3.7 (routes). No stale or orphaned task-number references found anywhere in the
  file.
- `tasks.md:99-108` — tests 6.4 and 6.5 both extended with an explicit "Also:"
  clause covering the differently-tagged (non-null, e.g. tag `U`) dependent case for
  both the DataSource→Pipeline and output-DataType→Pipeline directions, each stating
  the `U`-tagged dependent "is left completely untouched by the blocked call" —
  mirrors 6.6's already-fixed "untagged or differently-tagged" coverage from round 2.

**2. specs/workspace-tag-teardown/spec.md — updated consistently, no leftover unsafe
normative phrasing.**
- Requirement title (line 23): "Teardown refuses when a tagged resource has a
  dependent **outside this batch**" — no longer "untagged."
- Requirement body (lines 24-29): "...cascade to a Pipeline whose `tag` is not the
  same tag being torn down (untagged, or tagged into a different batch)..." — broad,
  safe reading, applied to both directions.
- Two scenarios present: "Tagged data source with an **untagged** dependent pipeline
  blocks the whole call" (lines 31-36, the null-tag case) and "Tagged data source
  with a **differently-tagged** dependent pipeline blocks the whole call" (lines
  38-42, new — the `U`-tag case, whose THEN clause explicitly asserts "the `U`-tagged
  pipeline is left completely untouched"). Having a scenario titled "untagged" is
  correct and unambiguous here because it's one of two named scenarios covering both
  cases — not a lone ambiguous requirement anymore.
- Grepped the whole spec file for "untagged": every remaining hit is either (a) a
  scenario specifically about the null-tag case (fine, paired with its
  differently-tagged sibling), or (b) already-broadened body/WHEN text that reads
  "untagged, or tagged into a different batch" / "untagged or differently tagged."
  No requirement title/body/THEN clause anywhere still asserts the narrow,
  unsafe-if-implemented-literally "no tag at all" reading in isolation.

**3. Stray 409 reference — confirmed gone.** `grep -n "409" design.md tasks.md
proposal.md ticket.md specs/*/spec.md` returns nothing. Decision 4's HTTP-200-always
framing (clean and blocked cases both 200; only malformed input/auth returns 4xx) is
now the only status-code statement in the artifact set — internally consistent.

**4. Systematic sweep for other instances of the same bug pattern — none found.**
Walked the full DataSource/Pipeline/DataType dependency graph and every guard the
design defines, checking each for the same "must exclude dependents only if outside
this exact batch, not just if untagged" requirement:
- DataSource → Pipeline (`source_data_source_id`, `ON DELETE CASCADE`) — Decision 2,
  fixed (§1 above).
- Output DataType → Pipeline (`output_data_type_id`, `ON DELETE CASCADE`) — Decision
  2, fixed (§1 above).
- DataType → DataSource (`source_id`, `ON DELETE SET NULL`, Decision 6's
  `checkSourceLink` replacement) — already fixed in round 2, re-confirmed present
  and unchanged in the current `design.md:149-171`/`tasks.md:37-47` text (`WHERE id
  = :sourceId AND tag IS DISTINCT FROM :tag`).
- Reverse of the DataSource→companion-DataType relationship (tagged DataSource torn
  down, companion DataType untagged/differently-tagged): the FK here is `ON DELETE
  SET NULL`, not `CASCADE` — deleting the DataSource only orphans (nulls the FK on)
  the companion DataType, it does not delete it. No data is destroyed, so this isn't
  an instance of the "silently deletes an out-of-batch resource" pattern; the
  design's Context section correctly documents this as pre-existing, unchanged
  behavior, and by construction (tag propagates from DataSource→companion at create
  time only, no retro-tagging per the ticket's own non-goals) a companion's tag can
  never actually diverge from its owning DataSource's tag in practice, making this
  case doubly moot.
- `existsBoundToAnyOwnedPanel` (panel-bound guard) — correctly has NO batch-scoping
  exception, and correctly so: panels are explicitly out of the tag model (ticket
  non-goal), so there is no "same batch" a panel could ever belong to — an
  unconditional block is the only sound rule here, not an instance of the missed
  pattern.
- `pipeline_steps`/`pipeline_runs`/`pipeline_schedules` — intrinsic children
  cascading from `pipelines`, not independently taggable, no guard needed (unchanged
  from round 1's original analysis, still accurate).
No sibling instance of the bug class survives in the design as currently written.

**5. General cross-round consistency / sanity pass.**
- Migration V-number: `ls backend/src/main/resources/db/migration | sort -V | tail
  -5` → latest is `V72__add_lookup_op.sql` in this worktree; cross-checked against
  `origin/main` (`git show origin/main:backend/src/main/resources/db/migration`) —
  same latest, V72. V73 is still genuinely free at this review point (executor still
  owns the pre-push re-confirmation per Decision 7/task 1.1).
- No orphaned task/decision cross-references found elsewhere in `design.md` (grepped
  for `tasks.md`, `task 3`, `Decision 6's`, `Decision 2's`, `round-2`, `round-3` —
  all hits are self-consistent).
- Bonus, unrequested but positive: `proposal.md`'s "What Changes" section, flagged as
  stale in rounds 2 and 3 ("reusing each resource's existing service-layer delete,
  including its existing guards"), now correctly reads "raw DBIO deletes, not calls
  into the existing per-resource service-layer delete methods" and "outside this
  same tag batch (untagged, or tagged into a different batch)" — that non-blocking
  note from rounds 2/3 has also been resolved, even though it wasn't required this
  round.
- `specs/resource-tagging/spec.md` untouched and correctly so — Decision 2/6 don't
  concern resource-tagging's requirements (create/read/filter), only teardown's.

### Verdict: CONFIRM

(a) The round-3 finding is fully and correctly resolved: Decision 2's guard now uses
the exact `IS DISTINCT FROM :tag` predicate on both the DataSource→Pipeline and
output-DataType→Pipeline directions, `tasks.md` carries an explicit new task (3.3)
with the literal predicates and correct renumbering/cross-references throughout, the
spec's normative title/body/scenario set no longer contains the unsafe narrow
reading anywhere, and tests 6.4/6.5 now cover the differently-tagged case that would
have caught the original ambiguity if implemented literally per the old prose.

(b) A structural sweep of the entire DataSource/Pipeline/DataType dependency graph
and every guard the design defines found no other unresolved instance of the same
bug pattern — the one remaining orphan-vs-delete asymmetry (tagged DataSource torn
down, differently-tagged companion DataType) is not a data-loss case (FK is `SET
NULL`, not `CASCADE`) and is doubly moot given the no-retro-tagging invariant.

(c) No cosmetic/consistency issues remain that would independently justify another
round; the one prior non-blocking note (stale `proposal.md` prose) has in fact
already been cleaned up as a bonus.

This design is sound to proceed to execution.

### Non-blocking notes

- None new. The round-3 non-blocking note about `tasks.md` 2.3's asymmetric
  precision (explicit propagation rule for pipeline→output-DataType, less explicit
  for DataSource→companion-DataType) was already classified non-blocking and remains
  unaddressed in the prose, but — as round 3 itself traced — the actual code call
  sites make the correct implementation the only natural reading regardless. Still
  worth a one-line tightening at execution time if convenient, not a gate blocker.
