## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- **Read fresh, cold**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/workspace-tag-teardown/spec.md`, `specs/resource-tagging/spec.md`, and both
  prior skeptic reports (`skeptic-design-1.md`, `skeptic-design-2.md`) — treated the
  latter two as claims, not fact, and re-derived independently.

- **Round-2 fix (Decision 6 source-link guard) — traced all four requested scenarios
  against the actual predicate** (`WHERE data_sources.id = dt.sourceId AND
  data_sources.tag IS DISTINCT FROM :tag`, design.md:149-153, tasks.md 3.2):
  - (a) source and companion share tag `T`: `tag IS DISTINCT FROM T` → false → not
    blocked. Correct.
  - (b) companion tagged `T`, linked source untagged (`tag = NULL`): `NULL IS DISTINCT
    FROM T` → true → blocks. Correct, matches original `checkSourceLink` intent.
  - (c) companion tagged `T`, linked source tagged `U` (different, non-null): `U IS
    DISTINCT FROM T` → true → blocks. Correct.
  - (d) untagged companion "somehow swept in": not reachable — the guard only runs
    against DataTypes already in the tagged-`T` set (the tagged-set SELECT), so an
    untagged companion is never a member of the teardown plan in the first place.
  Also traced whether (b)/(c) are reachable in practice: read
  `DataSourceService.scala:87-120` (`createStatic`) and `:675-703`
  (`upsertSourceDataType`, used by `createCsv`/`createTextUpload`/`createPdfUpload`/
  `createImageUpload`/refresh paths) — the `DataSource`/`source` object is in scope at
  every companion-`DataType`-construction call site, so once tasks.md 1.2/2.1 add a
  `tag` field to the domain case class, threading `source.tag` into the companion's
  `tag` at task 2.3 is the only natural implementation (no competing sane reading, even
  though task 2.3's prose doesn't spell out the propagation rule as explicitly as it
  does for the pipeline→output-type case — see non-blocking note). **Round-2's fix is
  correct and its stated rule ("block only when linked source exists and is not tagged
  into the same batch") is the right rule.**

- **tasks.md / spec.md consistency with Decision 6** — grepped both files for
  bare-existence wording; found none. `tasks.md` 3.2, 6.6, 6.6a and
  `specs/workspace-tag-teardown/spec.md`'s "Existing per-DataType delete guards still
  apply" and "A tagged data source and its own tagged companion DataType are torn down
  together" scenarios all correctly encode the same-batch-tag exception. Confirmed
  clean.

- **Whether Decision 2's original two checks "already had this right" — they do not.**
  This is the substantive new finding this round. Traced the exact predicate language
  for Decision 2 (DataSource→Pipeline, output DataType→Pipeline) the same way I traced
  Decision 6:
  - `design.md:61-63` (Decision 2): "whether any tagged DataSource has a dependent
    Pipeline that is **NOT also tagged**, or any tagged output DataType has a producing
    Pipeline that is **NOT also tagged**." This is the same class of ambiguity Decision
    6 had before the round-2 fix — "not also tagged" reads most naturally as "has no
    tag" (`tag IS NULL`), not "not tagged with this same batch's tag"
    (`tag IS DISTINCT FROM :tag`). Unlike Decision 6, **Decision 2 never states the
    disambiguating predicate anywhere** — grepped `design.md` for `IS DISTINCT FROM`;
    the only hit is Decision 6 (line 150). Decision 2 has no equivalent.
  - `specs/workspace-tag-teardown/spec.md:23-38` — the Requirement's own title
    ("...has an **untagged** dependent"), body ("cascade to a Pipeline that is **not
    itself tagged**"), and the Scenario's THEN clause ("blocked by the **untagged**
    pipeline") all use the narrow "no tag" phrasing — while the same Scenario's WHEN
    clause uses the broader "a dependent pipeline that is **NOT tagged `T`**" phrasing.
    The spec is internally inconsistent about which reading is intended, in the same
    document, for the same requirement.
  - `tasks.md` never gives Decision 2's two checks their own implementation task with
    an explicit predicate (contrast Decision 6, which got its own task 3.2 with the
    literal SQL after round 2). Task 3.3 only says it composes "untagged-dependent
    checks from 3.1/3.2" — but 3.1/3.2 are the DataType-level guards
    (panel-bound, source-link); neither is the DataSource→Pipeline or output
    DataType→Pipeline check Decision 2 describes. There is no task 3.x for Decision
    2's own predicate at all.
  - Tests 6.4/6.5 (`tasks.md:85-88`) only exercise the **untagged** (null-tag)
    dependent case ("tagged data source with untagged dependent pipeline", "tagged
    output DataType with untagged producing pipeline"). Neither tests a
    **differently-tagged** (non-null, different value) dependent — unlike task 6.6,
    which explicitly tests both "untagged **or differently-tagged**" for Decision 6's
    guard after the round-2 fix.

  **Why this matters concretely, traced through the actual delete mechanics
  (design.md Decision 3, "the DELETE actions for Pipelines → DataTypes → DataSources"
  are explicit `WHERE tag = :tag` deletes, not ID lists):** if Decision 2's guard is
  implemented per the narrower "untagged only" reading (a real risk given the
  ambiguous prose, the missing explicit predicate, and the missing test), then a
  DataSource tagged `T` with a dependent Pipeline tagged `U` (a **different, live
  tag group**, not null) would **not** trip the guard — the plan would report clean,
  and `DELETE FROM data_sources WHERE tag = 'T'` would fire Postgres's
  `ON DELETE CASCADE` on `pipelines.source_data_source_id` unconditionally (confirmed
  in round 1/round 2: this FK cascade is DB-level and does not consult the dependent
  row's own tag). The `U`-tagged Pipeline — a resource the caller never named, that
  belongs to someone else's teardown batch — would be silently deleted. This is
  exactly the "silent cascading deletion" the human pre-brief's non-negotiable #2
  forbids, and it directly violates the ticket's own acceptance criterion ("resources
  without the tag are untouched") and this design's own stated hard requirement
  (design.md Goals: "A bulk teardown never deletes a resource that does not carry the
  tag"). The symmetric output-DataType→Pipeline check has the identical gap.

  This is not a resurfacing of round 1 or round 2's findings, and not a pure wording
  nit — it's the same underlying bug class round 2 caught and fixed in Decision 6,
  independently present and unfixed in Decision 2, with a plausible concrete trigger
  (any workspace with two or more differently-tagged workflow batches that share a
  DataSource→Pipeline or DataType→Pipeline edge — not a contrived edge case for an
  agent tagging multiple workflow runs, which is the ticket's whole premise). Per the
  ticket's own escalation carve-out ("any data-loss ... concern the orchestrator
  cannot fully resolve in-loop must be escalated"), this is squarely in scope
  regardless of how it's classified.

- **Migration V-number** — `ls backend/src/main/resources/db/migration | sort -V |
  tail -5` → latest is `V72__add_lookup_op.sql`; V73 still free.

- **General design-soundness pass across all three rounds' stacked fixes** — no other
  new inconsistency found. Decision 3's hard `withUserContext`-only constraint, the
  post-commit file-cleanup posture, the dry-run/idempotency semantics, and the
  spray-json Option-normalization note (Decision 8) all still read as coherent and
  internally consistent with tasks.md and the specs.

### Verdict: REFUTE

### Change Requests

1. **Close the same ambiguity in Decision 2 that round 2 closed in Decision 6, with
   the same rigor: an explicit predicate, explicit task, and explicit test.**
   - `design.md` Decision 2 (line 61-63): replace "a dependent Pipeline that is NOT
     also tagged" / "a producing Pipeline that is NOT also tagged" with the same
     `IS DISTINCT FROM` framing Decision 6 now uses, e.g.: "a dependent Pipeline whose
     `tag` is not the same tag being torn down (`pipeline.tag IS DISTINCT FROM :tag`
     — covers both an untagged dependent and one tagged into a different batch)."
   - `specs/workspace-tag-teardown/spec.md` (lines 23-38): make the Requirement title,
     body, and every scenario (WHEN/THEN) consistently use the broad "not tagged with
     this same tag (untagged or differently tagged)" phrasing — currently the WHEN
     clause already has it right but the title/body/THEN clause say "untagged," which
     is the narrower and unsafe reading; pick the safe reading everywhere, matching how
     6.6/6.6a's DataType-guard scenario now correctly says "untagged or
     differently-tagged."
   - `tasks.md`: add an explicit task (parallel to 3.2) implementing Decision 2's two
     checks with the literal `IS DISTINCT FROM :tag` predicate against
     `pipelines.source_data_source_id`/`pipelines.output_data_type_id`, run app-pool/
     `withUserContext`-scoped exactly like 3.1/3.2, and have 3.3 reference it
     explicitly instead of implying 3.1/3.2 already cover it.
   - `tasks.md` 6.4 and 6.5: extend both to also cover the differently-tagged (not
     just untagged/null) dependent case, mirroring 6.6's "untagged or
     differently-tagged source blocks" coverage — e.g. "tagged data source with a
     dependent pipeline tagged into a *different* batch blocks the whole call (not
     just an untagged dependent)."

### Non-blocking notes

- `tasks.md` 2.3's propagation instruction is explicit for the pipeline→output-DataType
  case ("the pipeline's own tag ... is what should propagate to its output DataType's
  tag at run time") but not for the DataSource→companion-DataType case, even though
  design.md Decision 6 relies on that exact propagation as an established fact. Traced
  the actual code (`DataSourceService.scala` create/`upsertSourceDataType` call sites)
  and the source object is in scope at every companion-creation site, so a competent
  implementer following design.md's stated intent would very likely wire it correctly
  regardless — this is a documentation-precision gap, not a functional ambiguity with a
  plausible wrong outcome the way CR1 is. Worth a one-line tightening of 2.3 for
  symmetry, not blocking.
- `proposal.md`'s "What Changes" section still says teardown deletes resources "reusing
  each resource's existing service-layer delete, including its existing guards" —
  stale relative to design.md Decision 6's actual mechanism (raw DBIO deletes + a
  reimplemented existence-and-tag guard), as already noted in round 2. Still stale;
  still non-blocking (executor follows tasks.md/design.md, not proposal.md's summary).
