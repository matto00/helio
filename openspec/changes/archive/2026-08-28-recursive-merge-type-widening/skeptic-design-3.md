## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Tooling note: `scripts/concertino/` in this worktree contains only
`assert-phase.sh cleanup.sh setup-worktree.sh start-servers.sh lib README.md` — there is no
`next-report-number.sh`, `persist-evidence.sh` or `emit-event.sh`. Filename chosen as instructed
after verifying `skeptic-design-3.md` did not already exist; no event emitted (no emitter present).
Same condition round 2 recorded, unchanged.

### What I verified (with evidence)

Worktree HEAD `7972247c HEL-599 Flatten nested JSON ... (#462)`. All source read from this
worktree only; nothing read from the release/v1.7 main tree.

- `SchemaInferenceEngine.scala:14-25` (`fromJson`), `:81-98` (`mergeObjects`, incl. the second
  null-forcing pass `if (v == JsNull) m.updated(k, JsNull)`), `:111-124` (`inferJsonType`),
  `:133+` (`widenType`, CSV). Both ticket defects and the D7 null-forcing pass confirmed by reading.
- `JsonFlattener.scala:1-80` — scaladoc contract block reserves the union/widen-over-paths move for
  HEL-858 "without needing any change to this traversal itself" (line ~36) and names
  `SchemaInferenceEngine.mergeObjects` explicitly, so task 1.5's dangling-reference cleanup is real.
  `leaves` dedupes per object and sorts globally by path — D4's stable-order claim holds.
- `SparkJobSubmitter.scala:107-131` (`loadDataFrame` StaticSource branch), `:223-232`
  (`sparkDataType`), `:234-243` (`jsValueToAny`, `case (JsNumber(n), IntegerType) => n.toInt`,
  `case (JsNumber(n), FloatType) => n.toFloat`).
- `SparkJobSubmitterSpec.scala:22-62` — `staticDs(cols: Seq[(String, String)], rows: Seq[Seq[JsValue]])`
  takes column types as raw STRINGS, stashes the `{columns,rows}` payload in a mutable map, and the
  mock `DataSourceRepository.readRawConfig` serves it back; `submitter` is `new SparkJobSubmitter("local[*]", ...)`;
  ~10 existing `loadDataFrame(ds)` call sites; spec is in `package com.helio.spark`, so
  `private[spark] loadDataFrame` is reachable.
- `model.scala:581-617` — `DataFieldType.asString`: `IntegerType -> "integer"`, `FloatType -> "float"`.
  Both are accepted keys in `sparkDataType`. The type string round-trips.
- Existing consumers of the changed behaviour: `SchemaInferenceEngineSpec.scala:135-152` and
  `NewConnectorInferenceSpec.scala:54-67` are the only tests asserting a `JsNull`-bearing column's
  type; in both, the column's non-null values are strings, so D7's narrowing does NOT break them.
  No pre-existing test pins "null + number ⇒ string". No hidden test churn is being under-scoped.
- Baseline `openspec/specs/schema-inference/spec.md` — the only requirement touching JSON null typing
  is `### Requirement: JSON schema inference`, which the delta MODIFIES wholesale. No stale baseline
  requirement survives to contradict D7. Every baseline scenario under that requirement is carried
  forward in the delta.

### Round 2's three change requests, checked individually

**CR1 (task 3.4 could not go red) — CLOSED, and mechanically possible as specified.** I verified the
test can actually be built: `staticDs` accepts column types as strings, so the executor can write
`DataFieldType.asString(SchemaInferenceEngine.fromJson(JsArray(rows)).fields.head.dataType)` and pass
it straight in. Pre-fix that yields `"integer"` (first-value-wins over `3`), `sparkDataType` gives
`IntegerType`, and `jsValueToAny` truncates `2.5` → `2`: red. Post-fix it yields `"float"` →
`FloatType` → `n.toFloat` = `2.5`: green. Nothing in the wiring is hypothetical. Note for the executor
(not a defect): inference consumes an array of OBJECTS (`[{"v":3},{"v":2.5}]`) while the static payload
takes positional rows (`[[3],[2.5]]`) — two shapes of the same data, which the task's wording permits.

**CR2 (incoherent split classification) — CLOSED; both partitions check out.**
- 3.8a `[CHAR]`: single-shape rows, dots-in-keys, unicode/empty-string keys, depth at/beyond
  `MaxDepth`, non-object array elements, within-object collision. Pre-fix, `mergeObjects` over
  homogeneous rows reproduces row 0's leaf-path set exactly, so subset+union hold; non-object elements
  are `collect`-ed away identically before and after; the no-duplicates clause is green since HEL-599's
  `leaves` dedup. Genuinely green pre-fix.
- 3.8b `[RED]`: heterogeneous shapes and D5's cross-row leaf-vs-subtree collision. Pre-fix a QB row's
  `stats.rec` is absent from the merged schema (subset fails) and the schema's field set is row 0's,
  not the union (union fails). Genuinely red pre-fix.
- 3.3 `[RED]` / 3.3b `[CHAR]`: 3.3's clauses "integral-then-fractional ⇒ float", "number+boolean ⇒
  string", "timestamp+non-timestamp ⇒ string", "null+fractional ⇒ nullable float" are each red pre-fix,
  so the artifact is red. (Its "fractional-then-integral ⇒ float" clause happens to be green pre-fix —
  harmless, since the label is per-artifact and the artifact still fails.) 3.3b's all-null ⇒ nullable
  string is green pre-fix via the null-forcing pass + `inferJsonType(JsNull)`. Partition correct.

**CR3 (unrecorded null narrowing) — decision is defensible and design.md/spec.md record it correctly,
but the record is NOT complete: proposal.md still asserts the opposite.** D7 is honest and specific
(names the exact line range, calls it a narrowing, states the blast radius, does not dress it as
widening); the Risks bullet is corrected; spec scenario "A null alongside integral values yields a
nullable integer, not a string" pins it; task 3.10's rewording now forbids absorbing a
`string → numeric` flip as legitimate widening. That is four of the five surfaces. The fifth still
contradicts it — see CR1 below.

### Judged independently

- Approach soundness: D1's flatten-then-merge-over-paths is the right shape, is pre-authorised by the
  HEL-599 contract block I read, and makes recursion structural rather than a second walk. D3's join is
  a genuine lattice (commutative/associative/idempotent, `String` at top) and the CSV divergence is
  stated normatively in the spec, not left latent. D5's "emit both" is correct under union semantics.
- Traceability: every ticket AC maps to a task (AC1→3.2, AC2→3.1, AC3→3.3+3.4, AC4→3.9, AC5→3.5) and
  every task maps back. No orphan work; nothing in tasks.md exceeds the ticket's scope.
- Executor-follows-verbatim test: 1.1-1.6 produce the intended diff, 3.11 forces a real revert
  transcript with a checkable per-artifact expectation, and 3.9's in-test fixture-adequacy assertion
  means a degenerate capture fails loudly rather than passing for the wrong reason. The evidence would
  be conclusive.
- design.md at 190 lines vs openspec's 150-line guideline: the excess is now largely load-bearing —
  D7 (~20 lines) is a decision record that did not exist in round 2, D6's classified RED-verification
  and three-sided agreement property are normative instructions to the executor, and D2's deferral
  rationale is a real decision. What remains as pure review residue is small: D7's opening two lines
  ("Found by the round-2 design gate ... the Risks section originally denied outright"), the Risks
  bullet's "contrary to what this section originally claimed", and D6's "the naive wording was wrong"
  framing. That is process history, not design, but it is roughly five lines — polish, not padding.

### Verdict: REFUTE

One blocking defect, and it is the incomplete half of round 2's own CR3. Everything else in the plan
is sound and I would ship it.

### Change Requests

1. **[BLOCKING] `proposal.md:27` states the opposite of design D7.** It reads "Not breaking: existing
   single-shape sources infer exactly as before." Under D7 that is false: a single-shape source with a
   numeric column that is `JsNull` in one sampled row infers `StringType` today and `IntegerType`/
   `FloatType` after this change. D7 says so explicitly ("it applies to single-shape sources too, not
   only the heterogeneous ones this ticket targets"). Round 2's CR3 required the narrowing to be
   "recorded, not glossed"; it was recorded in design.md and spec.md but the flat denial survives
   verbatim in the proposal — the document that gets archived and read first. Required: (a) correct
   line 27 to say that single-shape sources infer as before EXCEPT for paths that are null in some
   sampled row, which narrow from `string` to their non-null type per design D7; and (b) add the null
   rule change to the "What Changes" list — bullet 3 (line 21-23) currently mentions only the
   `nullable` FLAG, which is accurate but reads as "nothing about nulls changes" and is the sentence
   that makes line 27 plausible. One sentence in each place; no design or spec change follows.

### Non-blocking notes

- Trim design.md's review residue (D7's first two lines, the Risks bullet's "contrary to what this
  section originally claimed", D6's wrong-first-wording framing). The decisions survive intact without
  them and the doc lands near the 150-line guideline. This report chain is where that history belongs.
- Tasks 2.2 / 3.11 write to `evidence/…` without saying relative to what. Say "relative to the change
  directory" so the paths in the delivery report resolve.
- Task 3.8a lists input families ("dots inside keys", "unicode keys", "depth beyond `MaxDepth`") whose
  `[CHAR]` classification holds only if each is written as single-row or shape-homogeneous input. It
  will be, on the plain reading of "inputs where it already holds pre-fix", and 3.11's transcript
  catches it if not — but one clause saying so would remove the trap.
- Task 3.4's inference input is an array of objects while the static payload takes positional rows;
  worth one parenthetical in the task so the executor does not read "feed the resulting type into a
  StaticSource config" as "reuse the same JSON".
