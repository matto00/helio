## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from the diff, the source files, and gates/mutations I ran myself in
this worktree. The executor's and evaluator's reports were read as claims only.

### What I verified (with evidence)

**Scope / guardrails.** `git diff --stat db51e936..HEAD`: 24 files, 5 backend main sources
(`JsonFlattener`, `SchemaInferenceEngine`, `PipelineRowJson`, `InProcessPipelineEngine`, `SourceService`), tests,
3 real-payload fixtures under `backend/src/test/resources/hel1015/`, and change docs. **No frontend file, no Flyway
migration, no backfill** — the HEL-1030 deferral was not smuggled back in. Nothing touching HEL-1009's area;
HEL-891's `inferShallowFromJsObjects`, HEL-868's nullability arithmetic, HEL-599's dedup/sort/`MaxDepth` policy are
all textually unchanged.

**Gates, re-run by me from `backend/` (not root `npm test`).**
- `sbt test` → `Total number of tests run: 4050 / Suites: completed 272 / succeeded 4050, failed 0`. I did **not**
  hit the `MfaApiRoutesSpec` interference the evaluator saw; the executor's 4050/4050 reproduces cleanly here. The
  environmental note therefore did not need to be invoked and nothing was discounted.
- `node scripts/check-scala-quality.mjs` → exit 0, "clean (161 soft warning(s))"; `check-openspec-hygiene.mjs` clean.
- CONTRIBUTING inline-FQN rule: the one FQN in `JsonFlattener` (`scala.collection.immutable.ListMap`) is pre-existing
  and untouched by this diff (verified via the file's own diff hunks). No new FQN introduced.

**(1) The binding invariant, judged independently.** I enumerated consumers myself rather than trusting the "three"
count: `grep -rn "leaves(\|flattenJsObject\|jsRowToRow\|detectMapPaths" backend/src/main`. Production call sites are
exactly `SchemaInferenceEngine.inferFromObjects:115/117`, `PipelineRowJson.jsRowToRow:106` (called only from
`InProcessPipelineEngine:652,661`), and `SourceService:425/427`. Each computes `detectMapPaths` **once over its full
batch** and passes the same set to every row. The required-parameter guarantee is real for **both** entry points —
there is no single-arg `leaves`/`flattenJsObject`; the escape hatches are separately named
(`leavesUnclassified`/`flattenJsObjectUnclassified`) and appear only in test code.

Candidate fourth consumer investigated: `SchemaInferenceEngine.inferShallowFromJsObjects`
(`PipelineRunService:724,1165`). It is **not** a divergence: it is a deliberately shallow, top-level-key union over
pipeline-output rows that are *already* flattened engine rows (HEL-891 D2), and it never calls `JsonFlattener`. It
therefore describes exactly the keys those rows carry, map-classified or not. `parseStaticRows` (static sources)
never touches `JsonFlattener` either. No fourth flattening surface exists.

Divergence paths I probed by hand and found closed:
- *D2a, map-of-objects*: `walk` stops at a `mapPaths` hit before recursing, so nothing beneath a MAP path can be
  emitted on any surface. Confirmed live by test 4.4b (`leaves(row, mapPaths).map(_._1) shouldBe Seq("m")`) and by my
  own mutation below.
- *Null-in-some-rows / map-in-others (`drops`)*: the null rows' `JsNull` leaf and the object rows' map leaf land on
  the **same** path, so there is one column on all three surfaces; schema says `StringType`, `nullable = true`
  (verified by test 4.2 against the real `tx.json`, and by reading `inferFromObjects`' arithmetic).
- *Non-object rows*: all three consumers `collect { case o: JsObject => o }` for classification and fall through
  identically for non-object rows. Consistent.
- The remaining divergence is the **cross-fetch** one (D7), which is stated in the design in its own worst-case terms
  and is a property today's code already has.

**(4)+(5) Evidence quality — I re-ran the mutations rather than reading transcripts.** All against
`MapAwareJsonFlatteningSpec` unless noted; source restored and verified clean (`git diff --stat` empty) after each.

| Mutation | Result | Reading |
| -- | -- | -- |
| threshold `0.25 → 0.99` | **RED (1)** — exactly the coverage-isolation fixture | evaluation-1 CR1 genuinely closed |
| threshold `0.25 → 0.4` | GREEN (18) | the stated residual, reproduced (judged in (2)) |
| drop the `intersection.isEmpty` conjunct | **RED (2)** — 4.4a and 4.4c | both conjuncts load-bearing and guarded |
| `leaves` ignores `mapPaths` (revert the walk guard) | **RED (6)** | the fix itself is guarded end-to-end |
| `previewRest` classifies over `jsRows.take(10)` | **RED (1)** — `Set(Set("m.shared")) was not equal to Set(Set("m"))` in `SourceServiceSpec` | D6's ordering trap has a live guard |
| `MinObjectRowsForMapClassification 2 → 1` | GREEN | **equivalent mutant**, see note 3 |
| classifier recurses beneath a MAP path | GREEN | **equivalent mutant**, see note 3 |

The boundary numbers are genuinely *computed* from the committed fixtures — I read the test: `coverageAndIntersection`
/ `objectsAt` derive union/coverage/intersection from the loaded rows and compare to pinned constants with `+- 0.001`;
they are not hardcoded expectations divorced from data. The new `SourceServiceSpec` test drives the **real seam**
(`svc.createRest` then `svc.preview`) and asserts only on observable output (`inferredSchema` field names,
`previewed.rows` key sets) — it never calls `detectMapPaths` or recomputes classification. `assertAgreement`'s change
is a strengthening: it previously passed `Set.empty`, which would have made it structurally blind to any map-shaped
input despite its name.

**Signature migration spot-check (task 5.1).** I read every hunk in `JsonFlattenerSpec`, `ExpressionEvaluatorSpec`,
`NestedJsonFlatteningSymmetrySpec`, `SchemaInferenceEngineSpec`. Every change is a call expression only
(`leaves(x)` → `leavesUnclassified(x)`, `jsRowToRow(x)` → `jsRowToRow(x, Set.empty)`,
`flattenJsObject` → `flattenJsObjectUnclassified`). **No assertion, no expected value, and no fixture was altered.**
The `Set.empty` choice is correct for these: they are single-object tests where classification is undefined by
construction.

**Acceptance criteria traced.**
- AC1 — `MapAwareJsonFlatteningSpec` 4.1 asserts the exact post-fix field-name set for real `matchups.json`:
  `players_points` is one column (was 173). Traced to `walk`'s `!mapPaths.contains(fullKey)` guard.
- AC2 — 4.2: exactly one `drops`, `StringType`, `nullable = true`, zero `drops.*`, on the real `tx.json`.
- AC3 — 4.3: `stats.*`/`player.*` still flatten over 200 real projection rows; `settings.*`/`metadata.*` over
  `tx.json`; `stats`/`player` explicitly absent as bare columns. The load-bearing prod near-miss is verified, not
  assumed — and note it is protected by the *coverage* conjunct (0.580, far above 0.25), i.e. by the robust conjunct
  rather than the fragile intersection one.
- AC4 — red arm reachable and reproduced by me (the `leaves`-ignores-`mapPaths` mutation reddens 6 tests; the
  `leavesUnclassified` baseline tests 1.1/1.2 pin the pre-fix 173/16 explosion from real data).
- AC5 — heuristic stated in design.md D2 and pinned on both sides including the near-miss and a variant-payload
  counterexample; both conjuncts asserted per field.

**(2) The threshold residual — judged deliberately, and I accept it.** Reproduced: `0.25 → 0.4` is green, so the
guard brackets the threshold to `(0.2, 0.5]`, not to `0.25` exactly. I judge this acceptable rather than a defect,
for a reason stronger than "that is normal for a real-valued threshold": across the whole drift band, classification
of every real field is **unchanged**. The maps sit at ≤ 0.083 and the load-bearing struct near-miss `stats` at 0.580;
the variant payload (0.122) is decided by the intersection conjunct regardless. A drift to 0.4 is therefore
behaviourally unobservable on all committed data, which is exactly the class of drift a fixture-based guard cannot
and need not catch. Tightening it is polish, not a ship blocker — recorded as note 1.

**(3) The accepted failure modes — honestly bounded and correctly characterised.** MAP-direction (a genuine map whose
sample coincidentally shares a key) is correctly labelled **conservative**: the outcome is byte-identical to today's
behaviour, so it can never produce a schema/row divergence; the measured rates (25/630 at n=2, 9/4000 at n=3 for
`adds`) are stated in design.md and shrink with sample size. STRUCT-direction (one row missing the discriminator flips
STRUCT → MAP, silently losing columns) is correctly labelled **non-conservative and silent** — design.md says so in
those words after the r2 CR3 correction, rather than in a softened form. Task 4.4c's fixture genuinely pins it: it
constructs the payload, deletes `type` from one row, measures the intersection flip to empty, and asserts
`detectMapPaths(mutatedWrapped) should contain("payload")`. It is a live assertion, not a comment — my
intersection-conjunct mutation reddens it. The acceptance is defensible: the direction is reachable only for a payload
already below the coverage threshold (0.25), which excludes every real struct measured here by a wide margin, and the
alternative on the table is the unbounded, per-fetch-unstable schema the ticket exists to fix.

### Verdict: CONFIRM

### Non-blocking notes

1. **Threshold bracket could be tightened cheaply.** A third synthetic fixture with an empty intersection and
   coverage ≈ 0.3 asserted STRUCT would narrow the guard from `(0.2, 0.5]` to `(0.2, 0.3]` and kill the surviving
   `0.25 → 0.4` mutant. Optional; no committed fixture's classification changes anywhere in the current band.
2. **`MinObjectRowsForMapClassification` is arithmetically redundant.** With a single object-row, `union` equals that
   row's key set, so `coverage = 1.0` and the coverage conjunct already forces STRUCT. Mutating `>= 2` to `>= 1`
   leaves the suite green because the mutant is *equivalent*, not because D3 is untested. Worth a one-line comment on
   the constant saying it is a statement of intent that the coverage arithmetic independently enforces.
3. **Outermost-wins is enforced where it matters, not in the classifier.** Making `classify` recurse beneath a MAP
   path leaves the suite green: the extra deeper entries in `mapPaths` are inert because `walk` never reaches them.
   The observable invariant (emitted leaves) is guarded by 4.4b and by the `leaves`-ignores-`mapPaths` mutation, so
   this is fine — but the design's "nothing beneath it is classified" is, in the code, "nothing beneath it is
   *emitted*". Editorial only.
4. Test file `MapAwareJsonFlatteningSpec.scala` (341 lines) exceeds the 250-line soft budget the Scala quality check
   warns on. The check exits 0 and 161 such warnings pre-exist; noted for completeness only.
