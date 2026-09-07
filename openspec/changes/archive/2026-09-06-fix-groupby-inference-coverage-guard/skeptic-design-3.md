## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read all four planning docs + the spec delta in full from the live worktree, plus
  `PipelineAnalyzeService.scala`, `GroupByStep.scala`, `PipelineStep.scala`,
  `PipelineAnalyzeServiceSpec.scala`, `InProcessPipelineEngineSpec.scala`,
  `PipelineAnalyzeRoutesSpec.scala`.
- **Registry vs dispatch (ground truth).** `PipelineStep.Registry` (`PipelineStep.scala:205-229`)
  = 23 kinds. `inferOutputSchema` (`PipelineAnalyzeService.scala:441-482`) dispatches 22
  (5 in the identity group + 17 named); `groupby` is the sole gap and falls to
  `case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`. Ticket premise holds.
- **Guard soundness (re-derived, not taken on trust).** A missing arm returns
  `Some("Unknown op: '<kind>'")`, so `validationError shouldBe None` cannot pass for an
  undispatched kind. The guard is sound *provided* the exemption map stays empty/named —
  tasks 3.5 asserts exactly that.
- **Achievability of `validationError == None` for all 23, re-checked per kind against
  the source, not on round 2's word:** `union`/`join`/`lookup` return `None` when
  `secondarySchema` is `None` (`inferUnion`/`inferJoin` at :~490, both `case None => (inputSchema, None)`).
  `pivot` (:742) and `unpivot` (:~810) only error on `index`/`column`/`values`/`idVars`/
  `valueVars` absent from `inputSchema`. `assert` (:942) only errors on bad kind/severity
  or an unknown field. `compute` (:~512) errors only on `ExpressionEvaluator.validate` Left
  or a malformed config. `window` (:778) goes through `parseConfig` and cannot error on a
  well-formed config at all. `splittext`/`extractheadings`/`chunkbytokencount` additionally
  require the named field to exist AND be typed `string-body`. All are under the guard
  author's control via the per-kind input schema. Achievability confirmed independently.
- **Previously-approved parts intact.** `GroupByStep.scala:58-79`: `SupportedFunctions =
  Vector("sum","count")`, `aggFn = cfg.aggFunction.toLowerCase`, `outputCol = aggFn+"_"+aggCol`,
  `count => .toLong`, `sum => nums.sum` over Doubles. `aggResultType` (end of file):
  `count -> "integer"`, `sum|avg -> "float"`, `case _ => "string"` — so Decision 2's
  "pass the lowercased value" (CR3) is a real hazard and correctly captured.
  `validateGroupBy` (:414-419) does lowercase. Decision 3 (best-effort `string` for an
  absent group key, documented in-source), Decision 4's by-name-only exemption rule, and
  tasks 5.1/5.1a/5.2 (including proving redness on a validator-bearing kind, both
  transcripts required) are all intact and undamaged.
- **Independent-derivation anchors exist:** `InProcessPipelineEngineSpec.scala:359,367`
  (`engRow("sum_age") shouldBe 30.0`, `engRow("count_name") shouldBe 2L`) and the join
  regression test `"join with no dispatch case before this ticket now projects a schema…"`
  at `PipelineAnalyzeServiceSpec.scala:1043`.

### Verdict: REFUTE

Two of the three findings are the *same* residue class that rounds 1 and 2 each caught
once; the third is a scope statement that ground truth contradicts.

### Change Requests

1. **`design.md:85` still states the refuted weak form as the guard's actual assertion.**
   Decision 4's opening sentence reads: "Actual coverage: **call `inferOutputSchema`
   directly**, once per kind, and assert the result is **not an `Unknown op` report**."
   That is verbatim the form design.md:176 calls "the refuted vacuous form … forbidden,
   not a fallback", and that :117-121 overrides. It is the lead, normative sentence of the
   decision an executor implements from. Rewrite it to the strict form: assert the returned
   `validationError` is `None`.

2. **`ticket.md`'s AC3 states the same weak form.** AC3 reads "actual coverage probed by
   CALLING `inferOutputSchema` per kind and **asserting no `Unknown op`**". AC3 is the
   criterion the evaluator and skeptic trace at the final gate, so as written a guard that
   merely checks "not an Unknown op" would satisfy the stated AC while violating design.md
   and tasks 3.3. Restate AC3's probe clause as "asserting `validationError` is `None`
   (never merely 'no Unknown op')".

3. **The "unassertable comments are already gone" scope claim is false on the live tree.**
   `ticket.md` (premise correction), `proposal.md:38-39`, and `design.md:24` all assert
   HEL-860's "unassertable" comments are gone and place their removal explicitly out of
   scope. One survives: `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:492-497`
   — "design Decision 7a: `groupby`/`join` have no `inferOutputSchema` dispatch case, so
   the valid-config (no validationError) path is unassertable for these two kinds … the
   positive path is deliberately not asserted here." It is already half-false today (`join`
   has had a dispatch arm since HEL-911) and becomes wholly false the moment this ticket
   lands, leaving a comment that actively misinforms the next reader about the exact
   invariant this change establishes. Either (a) correct the scope statements in all three
   docs and add a task to delete/update that comment (and, if cheap, assert the positive
   path it says is unassertable), or (b) if it is genuinely to stay out of scope, say so
   accurately — "one stale comment remains at PipelineAnalyzeRoutesSpec.scala:492 and is
   deliberately left to <named ticket>" — never "already gone". A deferral must name a real
   task, and a scope claim must match the tree.

### Non-blocking notes

- `design.md:123-124` and `tasks.md:44-47` list the input-schema-validating kinds as
  `pivot`, `window`, `assert`, `compute`. `window` does not validate against the input
  schema at all, while `splittext`/`extractheadings`/`chunkbytokencount` (which require a
  `string-body`-typed field to be present) and `unpivot` do. The governing requirement
  ("a per-kind input schema compatible with each probe config") is right; only the
  illustrative list is off. Worth correcting so the executor does not treat it as complete.
- `tasks.md` has no task covering the `private[engine]` widening's effect on any existing
  callers — there are none (only internal uses), so this is genuinely a no-op; noted only
  so a reviewer does not re-derive it.
