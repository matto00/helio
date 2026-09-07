## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

1. **Independent weak-form sweep** (not the orchestrator's pattern). Ran a broad
   case-insensitive regex over all five artifacts covering paraphrases, not just the
   literal phrase: `unknown op|no error|not an error|does not report|absent|is None|
   non-empty|suffic|weaker|acceptable|instead of asserting|at minimum|at least`.
   Every hit is either (a) a description of the DEFECT ("reports Unknown op"), (b) an
   explicit PROHIBITION of the weak form, or (c) the strict form itself. Specifically:
   - design.md:95-96, :129, :189-190 — all three are prohibitions ("Never merely…",
     "not merely…", "is the refuted vacuous form … and is forbidden, not a fallback").
   - proposal.md:32 — strict form, with the weak form named as rejected.
   - ticket.md:56 (AC3) — "asserting `validationError` is `None` — never merely 'no
     `Unknown op`'". Strict.
   - tasks.md:50 (3.3) — "assert the returned `validationError` is `None`, not merely
     'not an Unknown op'". Strict.
   - proposal.md:57 (Modified Capabilities) — "must never report `Unknown op` for a kind
     registered in `PipelineStep.Registry`". This is a *capability* statement about
     production behaviour, not a statement of the guard's assertion form, and the spec
     delta (spec.md:56-59) states the guard form strictly. Not a license.
   - specs spec.md:22 / :37 — both THENs read "`validationError` is absent". Strict.
   No surviving license to weaken found. The orchestrator's count is correct.

2. **Round-4 spec-delta fix, and the rest of the delta.** spec.md:37 now reads
   "that step's `validationError` is absent and the key field is projected using the
   documented best-effort fallback type" — correct and complete. Checked every other
   scenario in the delta for the same defect: :22 strict; :27 and :32 assert projected
   schema/type (no validationError claim to weaken); :59 is the strongest form in the
   document ("no invocation reports any validationError at all, so no kind can be
   certified as covered by a probe that validation intercepted"); :64 asserts the
   named-kind failure message. No sibling defect.

3. **Design claims checked against the live tree, not the narrative.**
   - `PipelineStep.Registry` (`com/helio/domain/model/PipelineStep.scala:205-229`) has
     exactly 23 kinds. `inferOutputSchema` (`PipelineAnalyzeService.scala:441-479`)
     dispatches 22: the 5-kind first arm plus 17 named arms. `groupby` is the sole gap;
     `case "join"` is present at :461 (HEL-911 live) — the restated scope is accurate.
   - `aggResultType` at :1006 returns `integer` for `count`, `float` for `sum|avg`, and
     `case _ => "string"` — which makes design Decision 2's lowercase-before-lookup point
     a real hazard, not a manufactured one.
   - `GroupByStep.scala:15` — `GroupByConfig(groupBy, aggColumn, aggFunction)`, no alias
     field (ticket AC3 correction accurate). :58 `SupportedFunctions = Vector("sum",
     "count")`. :64 `val outputCol = aggFn + "_" + aggCol` — the expression Decision 1
     extracts.
   - The stale HEL-860 comment is really at `PipelineAnalyzeRoutesSpec.scala:492-497`,
     verbatim as described, and a full-tree grep for "unassertable" under `backend/src`
     returns exactly 1 hit — so AC5/tasks 7 is correctly scoped and 7.3's zero-hit check
     is meaningful.
   - Decision 4's achievability claim verified: `inferUnion` (:906) and `inferJoin` (:926)
     return `None` on `secondarySchema = None`; `inferLookup` (:869-888) reports no error
     on a valid config, falling back to a `"string"` placeholder. So `validationError ==
     None` is attainable for all 23 kinds under direct invocation, as claimed.

4. **Executability of tasks 1-7 in order.** No step depends on an undecided item.
   Access widening is decided (Decision 4 / task 3.0), the naming helper is decided
   (Decision 1 / 2.1), the type source is decided (Decision 2 / 2.3), the absent-key
   fallback is decided (Decision 3 / 2.3, 4.5), the exemption mechanism is decided
   (3.5), and the error convention for a malformed config is named (2.4). Open Questions
   is empty and the one premise question was escalated and answered.

5. **Previously-approved substance survived.** groupby type semantics (count→integer,
   sum→float, single lowercased `fn` fed to BOTH the column name and `aggResultType`) —
   design :62-69, tasks 2.3/4.6, spec :14-17. Decision 3 best-effort fallback — design
   :81-89, tasks 2.3/4.5, spec :34-37. By-name-only exemption rule — design :150-154,
   tasks 3.5, spec :52-54. Two-part red-arm proof — tasks 5.1 (groupby) and 5.1a
   (a second, validator-bearing kind; both transcripts required). AC5 fold-in — ticket
   AC5, proposal What-Changes, design :26-32, tasks section 7. Scope restatement (join
   fixed by HEL-911) — ticket premise correction, proposal Non-Goals, design :23-24.

### Verdict: CONFIRM

### Non-blocking notes

- tasks.md 1.2 asks for the guard "in its red state" before section 3, which contains
  the `private[engine]` widening (3.0) the guard needs to compile. The forward reference
  "(task 3)" makes this unambiguous and 3.0 is fully decided, so it is an ordering
  wrinkle rather than a gap; an executor may simply do 3.0 as part of 1.2.
- design.md cites `inferOutputSchema` at "~line 447"; it is at 441 in the live tree. The
  "~" makes this fine, and Decision 5 already establishes the cite-by-name convention.
