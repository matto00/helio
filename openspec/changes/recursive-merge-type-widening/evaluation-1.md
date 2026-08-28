# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `50f3140b` on `bug/recursive-merge-type-widening/HEL-858`, based on
`7972247c` (origin/main). All findings below come from my own fresh runs in the worktree, not
from the executor's report.

Note on tooling: `scripts/concertino/next-report-number.sh` does not exist at this repo revision
(the worktree ships only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`).
`persist-evidence.sh` / `emit-event.sh` are likewise absent, so the durable-copy and verdict-event
steps could not be run. Filename taken from the orchestrator's explicit instruction. This is a
harness-version gap, not a defect in the change, and is not tagged BLOCKER.

---

### Phase 1: Spec Review — FAIL

**What passes.**

- **AC1** (field present in any row appears regardless of position) — covered by test 3.2, and it
  is genuinely red on revert (verified independently, below).
- **AC2** (order-independence, the central criterion) — test 3.1 compares whole `InferredSchema`
  values across reverse and a seeded shuffle, not field-name sets. Correct as designed (D4 makes
  the `Seq` comparison meaningful by globally re-sorting the merged path set).
- **AC3** (mixed integral/fractional infers `float`, no truncation on materialisation) — covered
  at unit level by 3.3 and end-to-end by 3.4. See Phase 2 for the 3.4 scrutiny; it is built the
  way design D6 demands.
- **AC4** (mixed-position Sleeper URL yields the full `stats.rec*` family) — covered by 3.9
  against a real captured fixture, with the adequacy property asserted in code.
- **Adversarial probe set** from the ticket's final-gate section — all eight classes are present
  and split correctly across 3.8a/[CHAR] and 3.8b/[RED].
- **Design D1** — honoured exactly: `mergeObjects` and `flattenObject` are deleted, the array and
  root-object branches both route through the single `inferFromObjects` accumulator, and recursion
  falls out of `JsonFlattener.leaves` rather than a second walk.
- **Design D3** — `widenJson` is the specified lattice, `JsNull` never reaches it, the all-null
  path falls back to `StringType` via `dataTypeOpt.getOrElse`. Commutative/associative/idempotent
  by inspection.
- **Design D5** — no special case was needed; the path-union naturally emits both `a` and `a.b`,
  and 3.6 pins that plus its reversal.
- **Design D1 / task 1.6 — `JsonFlattener` traversal genuinely untouched.** Confirmed: the whole
  `JsonFlattener.scala` diff is 9 lines inside the scaladoc contract block (lines 33-40), zero
  lines of the `object JsonFlattener` body. That is exactly the task-1.5 comment fix and nothing
  more.
- Scope is tight — no changes outside the two source files, their specs, the fixture, and the
  change dir.

**Issues.**

1. **Task 3.10's required deliverable is missing from every committed artifact, and the one
   committed statement about it asserts the opposite.** Task 3.10 requires that any difference
   between the WR-only fixture's pre-fix and post-fix schema be "REPORTED explicitly in the
   delivery report", classified as legitimate widening or a D7 null-rule flip. The executor did
   find two differences (`player.injury_body_part` and `player.injury_status` flipping
   `nullable false → true`) and reported them to the orchestrator, but nothing in the repo
   records them: `grep -rn "injury_body_part\|injury_status"` over the whole change dir returns
   nothing, and `files-modified.md` describes 3.10 only as an "informational baseline". The
   finding therefore does not survive the delivery; a future reader of this change has no record
   of a behaviour change on an existing source. See Change Request 1.

2. **Confidently-false comment in the committed test.**
   `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala:264` states
   *"No difference is expected here (single-shape source, HEL-858's D7 null-narrowing needs an
   actual sampled null to trigger, and none of this fixture's numeric columns are null)"*. The
   parenthetical about numeric columns is true; the leading claim "No difference is expected
   here" is false — there are two differences on this exact fixture. This is precisely the
   confidently-false-documentation class that this ticket's own task 1.5 exists to fix, and that
   HEL-849/850 made a standing repo standard. See Change Request 2.

3. **`design.md` D2's claim no longer matches implemented behaviour.** D2 says the nullability
   rule "preserves today's semantics exactly (AC5)". The *rule* is preserved, but its *observed
   output* is not, on any source with a nested null outside row 0 — see the AC5 analysis below.
   The planning artifact should record the consequence, as it already does for D7's narrowing.
   See Change Request 3.

**AC5 (nullability unchanged for existing sources) — analysed, and NOT a blocking regression.**
I verified the executor's attribution rather than accepting it.

- `backend/src/test/resources/hel599/sleeper-wr-projections-slice.json` has 3 elements.
  `player.injury_body_part` is `"Undisclosed"` in element 0, `"Knee"` in element 1, `null` in
  element 2 (same pattern for `player.injury_status`: `"Questionable"`, `"Questionable"`, `null`).
- Pre-fix, `mergeObjects` merged only top-level keys with first-non-null-wins, and its `withNulls`
  second pass only ever wrote `JsNull` at a *top-level* key. `player` is a `JsObject` and is never
  itself `JsNull`, so element 0's `player` subtree won wholesale and the null in element 2 was
  invisible → `nullable = false`.
- Post-fix, the path union sees element 2's explicit `JsNull` at `player.injury_body_part` →
  `nullable = true`. The inferred *type* is `StringType` both ways.

The executor's attribution is **correct**. This is not a D7 narrowing (D7 is `string → numeric`,
a type change; here the type is unchanged). It is the unchanged D2 rule — "explicit `JsNull`
anywhere ⇒ nullable" — being applied to nested paths for the first time, which is an inseparable
consequence of fixing defect 1: you cannot union nested paths across rows and simultaneously keep
nested nulls in non-first rows invisible. The direction is `false → true`, i.e. strictly more
permissive and strictly more accurate; a consumer told a column may be null when it may indeed be
null is not misled. So AC5's intent (the rule is unchanged; nothing silently becomes less
nullable) holds. What fails is only the *recording* of it — Change Requests 1-3.

---

### Phase 2: Code Review — PASS

**Gates, all re-run by me in `WORKTREE_PATH` (not trusted from the executor's report):**

| Gate | Result |
|---|---|
| `sbt "testOnly *SchemaInferenceEngineSpec *JsonFlattenerSpec *NestedJsonFlatteningSymmetrySpec *SparkJobSubmitterSpec"` | **80 succeeded, 0 failed** |
| `sbt test` (full backend suite) | **238 suites, 3663 succeeded, 0 failed, 0 aborted** |
| `npm run check:scala-quality` | clean (140 pre-existing soft file-size warnings, none introduced as hard failures) |
| `npm run format:check` | clean |
| `npm run check:openspec` | `openspec/ is clean` |
| `npm run check:spec-structure` | passed, 341 canonical specs, 0 issues |

Frontend gates not run — zero `frontend/**` files in the diff.

**Red-verification transcript (`evidence/red-verification.md`) — independently reproduced.**
This was the single highest-risk artifact given the ticket's history, so I re-ran the revert
myself rather than reading the transcript: `git checkout main -- SchemaInferenceEngine.scala`,
re-ran the targeted suite, then restored (`git status --porcelain` confirmed clean afterward).

My run: **73 succeeded, 7 failed, 80 total** — byte-for-byte the executor's claimed counts. The 7
failures were:

1. "infer an identical schema regardless of row order (reversed and shuffled)" — 3.1
2. "include a nested path even when the first element lacks it" — 3.2
3. "widen types across sampled values per the JSON lattice" — 3.3
4. "emit both a scalar path and its subtree path on a cross-row leaf-vs-subtree collision" — 3.6
5. "hold the three-sided agreement property on heterogeneous shapes and cross-row collisions
   (fix-dependent)" — 3.8b
6. "infer the full stats.rec* family from the live mixed-position Sleeper fixture" — 3.9
7. `SparkJobSubmitterSpec` "does not truncate a fractional value when the declared column type is
   derived from SchemaInferenceEngine.fromJson (HEL-858 AC3)" — 3.4

That is **exactly** the set classified `[RED]` in tasks.md, no more and no less, and every
`[CHAR]` test (3.3b, 3.5, 3.7, 3.8a, 3.10) plus all pre-existing tests stayed green. The
transcript is a real captured run, not a reconstruction. Its "Raw sbt output" block is lightly
abridged (`(all 14 GREEN)` roll-ups and an ellipsis in the 3.9 failure message) rather than
verbatim, which normally I would flag as transcript-shaped-non-evidence — but since I reproduced
the identical split and counts from scratch, the abridgement is cosmetic and I raise it only as a
non-blocking note.

**Task 3.4 — built the load-bearing way, confirmed.** `SparkJobSubmitterSpec.scala:110-129` calls
`SchemaInferenceEngine.fromJson(JsArray(JsObject("v" -> JsNumber(3)), JsObject("v" -> JsNumber(2.5))))`,
extracts field `v`'s `dataType`, converts it with `DataFieldType.asString`, and feeds *that* string
into `staticDs(...)` → `submitter.loadDataFrame`. The declared type is not hand-written anywhere.
My revert run confirms the consequence rather than the intent: on revert it fails with
`"[integer]" was not equal to "[float]"`, i.e. inference itself declared `integer` pre-fix. This
is the version design D6 demanded, not the green-on-revert hand-declared version it warned against.

**Task 3.9 fixture — real, adequate, and adequacy asserted rather than attested.** I parsed
`backend/src/test/resources/hel858/sleeper-mixed-projections-slice.json` directly: 15 elements,
real 2026 NFL players in descending-`pts_ppr` order (Allen QB, Gibbs RB, Jackson QB, Robinson RB,
Maye QB, Nacua WR, Chase WR, Hurts, Daniels, Burrow, Prescott, Lawrence, Purdy, Williams, Dart),
each with a full 30-33-key `stats` object and a 14-key `player` object including
`injury_*`/`team_changed_at`/`news_updated`. Element 0 (Allen, QB) lacks `stats.rec`,
`stats.rec_yd`, `stats.rec_td` entirely; element 1 (Gibbs, RB) carries all three. My per-element
presence table matches `evidence/live-probe-transcript.md`'s spot-check row for row. The shape,
key cardinality and player set are not something that would be plausibly hand-fabricated — this
reads as genuine live API data.

Crucially, `SchemaInferenceEngineSpec.scala:245-259` **asserts** the adequacy property in the same
test (`firstIdxWithout >= 0` and `laterIdxWith > firstIdxWithout`, under a `withClue`) before
asserting the `rec*` family is inferred. A degenerate or resampled fixture fails loudly. This is
design D6 satisfied properly — the checksum in the transcript is provenance only, exactly as D6
says it should be, and is not load-bearing.

**Code quality.** `inferFromObjects` is a single readable fold with a named `PathAcc`; the
`Option[DataFieldType]` "no non-null value seen yet" encoding is the right shape and removes the
need for a sentinel. `widenJson` is total, has no magic values, and carries the WHY-it-diverges
comment task 1.1 required. No FQNs inlined, no dead code, no `asInstanceOf` in main sources, no
new type-safety escape hatches. `mergeObjects` had no other caller — I re-verified by grep. No
security or error-handling surface is touched (pure functions over already-parsed JSON). No
over-engineering; the diff is smaller than the design it implements, which is the good direction.

Non-blocking: the two `asInstanceOf[JsArray]`/`asInstanceOf[JsObject]` casts in the new fixture
tests are test-local and fail loudly on a malformed fixture, which is acceptable here.

---

### Phase 3: UI Review — N/A

Backend-only change. No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`. `openspec/specs/**`
is untouched (task 4.4 correctly defers the spec sync to archive); the only openspec edits are
inside the change dir. No UI surface exists to review.

---

### Overall: FAIL

The implementation itself is correct, well-designed and — unusually for this ticket's history —
backed by evidence that survives independent reproduction. I re-ran the revert and got the
executor's exact split, and task 3.4 and task 3.9 are both built the load-bearing way rather than
the green-on-revert way the design warned about. That part of the work is done.

What fails is narrow and cheap: a real behaviour change on an existing source was found, correctly
diagnosed, and then not written down anywhere in the repo — while a committed comment asserts the
opposite. Three small edits, no source-logic change, no re-planning.

### Change Requests

1. **Record the task-3.10 finding in a committed artifact.** Add it to
   `openspec/changes/recursive-merge-type-widening/files-modified.md` (or a new
   `evidence/wr-fixture-characterisation.md`), stating: on
   `backend/src/test/resources/hel599/sleeper-wr-projections-slice.json`,
   `player.injury_body_part` and `player.injury_status` change from `nullable = false` to
   `nullable = true`; the inferred type (`StringType`) is unchanged for both; no other field
   changes type, name or nullability. Classify it explicitly as **neither** legitimate widening
   **nor** a D7 null-rule flip, but as the unchanged D2 rule reaching nested paths for the first
   time (element 2's `player.injury_body_part` is `null`; pre-fix, element 0's `player` subtree
   won wholesale and `withNulls` only ever nulled top-level keys, so the nested null was
   invisible). Note the direction is `false → true` and therefore not a narrowing.

2. **Fix the false comment at
   `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala:264`.** Replace
   "No difference is expected here (single-shape source, ...)" with a statement of what is
   actually true: no *type* difference is expected on this fixture (no numeric column is null, so
   D7's narrowing does not trigger), but `player.injury_body_part` and `player.injury_status` do
   flip to `nullable = true` because the fix now sees element 2's nested nulls. Cross-reference the
   artifact from Change Request 1.

3. **Correct `design.md` D2's "preserves today's semantics exactly (AC5)" claim.** Append one or
   two sentences in the same style D7 already uses for its own blast radius: the nullability
   *rule* is unchanged, but its output changes for any nested path that is null only in a
   non-first sampled object — such a path was previously inferred non-nullable because
   `mergeObjects` never looked past the first object's subtree, and is now correctly nullable.
   Name the WR fixture's two fields as the observed instance. This keeps the planning artifact a
   true description of what shipped.

### Non-blocking Suggestions

- `evidence/red-verification.md`'s "Raw sbt output" block is abridged (`(all 14 GREEN)` roll-ups,
  an ellipsis inside the 3.9 failure message) rather than verbatim. It happened to be accurate —
  I reproduced it exactly — but an abridged block presented under a "Raw" heading is the shape of
  the non-evidence this ticket exists to guard against. Prefer pasting the untouched output, or
  label the block "abridged".
- Task 3.10's test is not actually a field-by-field characterisation; it asserts three field names
  are present. Consider pinning the full `Seq[InferredField]` (or at least name+type+nullable for
  every field) so the next change to inference has to confront any diff on this fixture rather
  than discover it by hand. The two nullability flips above would have been caught by the test
  itself, not by manual comparison.
- `design.md`'s Planner Notes already flag that `inferJsonType` types `2.0` as `IntegerType`
  (task 4.3). That note is correctly out of scope, but it is currently only in the design; worth
  carrying into the delivery report so it is not mistaken for a miss of AC3.
- Consider filing the D2 follow-up the design promised at Delivery ("a path absent from some
  sampled rows should infer as nullable") before this change is archived, so the deferral has a
  ticket rather than a paragraph.
