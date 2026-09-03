## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 change requests**

- **CR1 (AC6 unsatisfiable) — addressed in ticket.md and design.md, but NOT in proposal.md.**
  `ticket.md` AC6a/6b/6c and `design.md` Decision 6 are correct and well-drawn. **However
  `proposal.md`'s "What Changes" final bullet still reads "and a Playwright UI walkthrough of adding
  a join step and choosing its right-hand source"** — verbatim the impossible task round 1 refuted.
  See CR1 below.
- **CR1's red is genuinely red.** I traced whether AC6a's probe can even reach the ACL arm.
  `PatchSetApplyResolvers.scala:186` runs `validateRawConfig` first; the base implementation
  (`domain/model/PipelineStep.scala:139,152-157`) returns `Some` only for
  `StepConfigTypeMismatch`, and only `CastStep`/`RenameStep`/`ComputeStep` override it — so an
  empty-string id is **not** intercepted upstream. It falls to `case Success(jc: JoinConfig)` /
  `case Success(uc: UnionConfig)` at L190-201, both of which I read and confirmed are **unguarded**
  (only the `LookupConfig` arm at L203 carries `if lc.referenceDataSourceId.nonEmpty`). So AC6a's
  probe fails against unfixed code and succeeds after the fix. The red is real, not a formality.
- **CR2 (repro premise) — satisfied.** `ticket.md`'s CORRECTION section, `proposal.md`'s rewritten
  Why, and `design.md` Decision 6 all state the picker exclusion and the corrected reachability. The
  "two individually-correct facts composed into a false conclusion" framing is accurate and useful.
- **CR3 (extractor home) — satisfies my constraint, does not evade it.** I confirmed
  `PatchSetApplyResolvers.scala:11` is `import com.helio.domain.{JoinConfig, LookupConfig, UnionConfig}`
  and that the file does NOT import `com.helio.services.pipelines`. `com.helio.domain` is where the
  ADT lives (via `domain/package.scala`'s re-exports of `domain.steps.*`), so both services already
  point down at it. `com.helio.domain` is a better answer than my `com.helio.api.protocols.pipelines`
  suggestion. Accepted.

**Class-closing audit — both counts and both claims verified independently**

- **23 step-config case classes: CONFIRMED.** `grep -rh "final case class [A-Za-z]*Config"
  backend/src/main/scala/com/helio/domain/steps/ | wc -l` → `23`. I enumerated all 23 signatures and
  read each parameter list: exactly three carry a data-source id — `JoinConfig.rightDataSourceId`
  (`JoinStep.scala:12`), `UnionConfig.otherDataSourceId` (`UnionStep.scala:11`),
  `LookupConfig.referenceDataSourceId` (`LookupStep.scala:12`). No fourth. Claim (a) holds.
- **18 `resolve*` functions: CONFIRMED.** `grep -c "def resolve[A-Za-z]*(" PatchSetApplyResolvers.scala`
  → `18`. I read `requireTargetId` (L90-93 — the design says L91; it is L90) and confirmed it does
  `.map(_.trim).filter(_.nonEmpty)`, and `resolvePipelineCreate` (L500-503) rejecting an empty
  `sourceDataSourceId` with a `400`. Claim (b)'s **conclusion** holds — the only unguarded
  empty-capable ids in the file are the three step-config second-source ids — but its **mechanism
  count is incomplete**: `resolvePanelCreate` (L277) guards its embedded `dashboardId` through a
  *third* mechanism, `PanelServiceHelpers.validateCreatePanelRequest` (L146-150,
  `.map(_.trim).filter(_.nonEmpty)`), not through either of the two named. Non-blocking; noted below.

**Other independent checks**

- `openspec validate guard-join-picker-empty-source-id --type change` → `Change ... is valid`. Both
  `## MODIFIED Requirements` headers match the baseline headers byte-for-byte
  (`openspec/specs/pipeline-joinstep-right-source-acl/spec.md:6,29`;
  `openspec/specs/patch-set-apply/spec.md:43`).
- The six-block table in design.md is still accurate against `PipelineService.scala:856-895`
  (`joinCheckF` bare `case jc: JoinConfig`; `unionCheckF`/`lookupCheckF` carry `.nonEmpty`).
- No fixture trap: re-grepped `backend/src/test/` for an asserted empty second-source id — none. Task
  4.4's "state per-assertion why" should find nothing to change (lessons 1 and 6 hold by construction).
- Lesson 5 (conjunction-only guards): task 4.5 demands each leg be broken singly and the result
  recorded. Design Decision 3 confirms the shape permits it. Good.
- Lesson 4 (a green gate may scan nothing): task 6.1 explicitly names the frontend gates as scanning
  nothing relevant. Good.
- Lesson 3 (constrain the mechanism): tasks 3.1-3.4 name both preserved error strings, and I verified
  both exist verbatim (`s"Data source not found: ..."` at `PipelineService.scala:859`;
  `s"edit $index: data source not found: ..."` at `PatchSetApplyResolvers.scala:192`).

### Verdict: REFUTE

The corrected reachability analysis, the AC6a/b/c rewrite, the extractor placement, and both audit
claims all survive independent verification. I am refuting on one un-propagated correction and one
signature that names a type the codebase does not have — both cheap to fix, both capable of sending
an execution round somewhere wrong.

### Change Requests

1. **`proposal.md` still mandates the impossible join-picker walkthrough — CR1 was fixed in two of
   three artifacts.** `proposal.md` "What Changes", final bullet: *"Record a RED-first probe against
   the real running backend using the picker's exact body, **and a Playwright UI walkthrough of
   adding a join step and choosing its right-hand source**."* That directly contradicts
   `ticket.md` AC6b/6c and `design.md` Decision 6, which state a join picker walkthrough is
   impossible and that only a **union** walkthrough is required, as a labelled regression guard.
   This is the exact contradiction that invites an executor to fake evidence or silently scope-cut.
   Rewrite that bullet to match AC6a/6b/6c: RED-first patch-set probes for the union AND join cells,
   plus a union-only UI regression guard explicitly not offered as join evidence. Also note the
   proposal's Why says the picker exclusion means "this is not a UI bug" while the change's own
   title still reads "against the picker's empty seed id" — the title is now misleading about
   provenance; either retitle or add a one-line parenthetical.

2. **`PipelineStepConfig` does not exist — design Decision 1 and task 2.1 specify an unwritable
   signature.** Both state
   `def secondaryDataSourceId(config: PipelineStepConfig): Option[String]`. I grepped the entire
   backend for `PipelineStepConfig` (excluding `PipelineStepConfigCodec`): **zero hits**. There is no
   sealed trait over the 23 configs; they are unrelated case classes, and
   `PipelineStepConfigCodec.decode` returns **`Try[Any]`**
   (`api/protocols/pipelines/PipelineStepConfigCodec.scala:29`) — which is why every existing call
   site pattern-matches on a bare value with a `case _ =>` fallthrough. Decide this explicitly rather
   than leaving the executor to invent it, and state the decision in Decision 1 and task 2.1:
   - the parameter type must be `Any` (matching what the two call sites actually hold), and
   - because `Any` gives no exhaustivity checking, the "future op drifts from the extractor" risk
     already named in design.md's Risks section is **not** mitigated by the compiler. Say so, and say
     what does mitigate it (e.g. the doc comment + a unit test enumerating all three kinds), or
     decide instead to introduce the sealed trait — which would be a materially larger change than
     this ticket's stated scope and should then be an explicit scope amendment, not a surprise.
   - Relatedly, name the placement precisely: `backend/src/main/scala/com/helio/domain/package.scala`
     currently documents itself as a **type-alias re-export shim** ("The actual definitions live one
     package down — these aliases keep the service / repo / test call sites untouched"). Adding the
     first behavioral function to it either needs that doc comment amended, or the helper belongs in
     `com.helio.domain.steps` (still satisfying CR3's dependency-direction constraint, since both
     surfaces already depend on it transitively). Pick one and record why.

### Non-blocking notes

- The class-closing audit says every other id path is safe "by one of two existing mechanisms". There
  is a **third**: `PanelServiceHelpers.validateCreatePanelRequest` (L146-150) guards
  `resolvePanelCreate`'s embedded `dashboardId`. The conclusion is unaffected — I verified it
  independently — but the enumeration should name all three so a later reader re-deriving it does not
  find the same mismatch and distrust the whole audit.
- Design Decision 5 cites `requireTargetId` at L91; it is L90.
- The `patch-set-apply` spec delta faithfully carries forward two baseline scenarios referencing
  `rejectCompanionBinding` and `rejectUnresolvableMetric`, which `PatchSetApplyResolvers.scala:149-150`
  says HEL-904 **removed**. That staleness is pre-existing in `openspec/specs/patch-set-apply/spec.md`
  and correctly out of scope here — but worth a spinoff.
- AC6a/tasks 1.2-1.3 need an existing, caller-owned `join` step and `union` step to target with a
  `pipelineStep` update edit (`resolvePipelineStepUpdate` L519-526 does `findByIdInternal` +
  `authorizeEditorOrOwnerOnPipeline` before reaching the config check). Achievable, but the tasks do
  not mention the setup; adding it would keep "deterministic" honest.
