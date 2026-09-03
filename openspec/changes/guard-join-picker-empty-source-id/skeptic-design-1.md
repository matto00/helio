## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **The design's six-block table is accurate.** Read `PipelineService.scala:857-895` and
  `:1096-1128`: `joinCheckF` at both sites matches bare `case jc: JoinConfig` with no `.nonEmpty`
  guard, while `unionCheckF` (`case uc: UnionConfig if uc.otherDataSourceId.nonEmpty`) and
  `lookupCheckF` carry it. Read `PatchSetApplyResolvers.scala:190-206`: `case Success(jc: JoinConfig)`
  and `case Success(uc: UnionConfig)` are both unguarded; only `case Success(lc: LookupConfig) if
  lc.referenceDataSourceId.nonEmpty` has the filter. The premise-validation finding (four unguarded
  call sites, HEL-620's fix never reached the patch-set file) is real, not narrative.
- **The seed body is exactly as claimed.** `frontend/src/features/pipelines/state/stepNarrowing.ts:148-149`:
  `case "join": return { rightDataSourceId: "", joinKey: "", joinType: "inner" };`
- **No fixture trap exists.** Grepped `backend/src/test/` for any test asserting an empty
  `rightDataSourceId`/`otherDataSourceId`; none exists. So no pre-existing test encodes the buggy
  404 behavior, and task 4.4's "if any existing test needs changing, state per-assertion why" should
  find nothing to change. Lessons 1 and 6 are satisfied by construction here.
- **Decision 3's mutation plan is actually performable.** The shared extractor's `match` keeps one
  `Option(...).filter(_.nonEmpty)` per config arm, so a per-op single-arm reversion is possible, and
  `findByIdOwned` remains per-surface, so deleting it alone is possible. Each leg can genuinely be
  broken singly — this is not a conjunction-only guard (lesson 5).
- **Decision 4 (no trim) is sound.** `.nonEmpty` on the raw string exactly matches the union/lookup
  guards I read at `PipelineService.scala:873,890`. `.trim.nonEmpty` would be looser than the ACs ask
  and would diverge from the very guards this change exists to make uniform.
- **Decision 2 (skip, not reject) is sound.** It matches the two already-shipped ops byte-for-byte
  and keeps a half-filled step editable; execute-time remains the correct place to report an unset
  source.
- **Decision 1 (shared extractor) is the right call, at the right scope.** A pure
  `Option[String]` extractor is the largest genuinely-common piece: I confirmed the two surfaces emit
  different error strings (`s"Data source not found: $id"` vs `s"edit $index: data source not found:
  $id"`) and different result shapes, so pushing the lookup into the helper would need an
  error-formatting parameter and buy nothing. The bug lives entirely in the extraction step. This is
  not scope creep — it is one new function plus six mechanical rewrites with no non-empty behavior
  change, and the alternative is adding a fourth hand-copy into the file that just demonstrated the
  copy-paste failure mode.

### Verdict: REFUTE

The fix itself is well-designed; I am refuting on a premise contradiction that would send an
execution round after an impossible task, plus two smaller gaps.

### Change Requests

1. **AC6 is unsatisfiable as written, and neither the proposal, design, nor tasks acknowledges it.**
   `join` is deliberately **excluded from the op picker**: `stepNarrowing.ts:83-93` states
   "OP_TYPES drives the picker dropdown — join is intentionally excluded: no `JoinConfig.tsx` editor
   exists (HEL-264's original rationale)", and the `OP_TYPES` array at `:97-119` indeed contains
   `union` and `lookup` but no `join`. I confirmed `frontend/src/features/pipelines/ui/stepConfigs/`
   has `UnionConfig.tsx` and `LookupConfig.tsx` but **no `JoinConfig.tsx`**. `defaultConfigFor` is
   only reached from `usePipelineDetailPage.ts:481,544` with an `opType` that came from the picker.
   Therefore AC6 ("a user can add a join step from the op picker and then choose the right-hand
   source") and task 5.3's Playwright walkthrough **cannot be performed without a frontend change**,
   which the proposal explicitly excludes ("No frontend change"; non-goal: changing `defaultConfigFor`'s
   seed shapes / adding frontend UI). Resolve this explicitly in the artifacts — do not leave the
   executor to discover it and silently either fake the evidence or scope-cut. State which of these
   is chosen and why: (a) rewrite AC6/task 5.3 to a UI-reachable proxy plus an explicit note that
   join is picker-excluded, verifying the union patch-set cell through the UI instead; or (b) add
   join to `OP_TYPES` with a `JoinConfig.tsx` editor as a separate ticket and mark AC6 deferred to it.
2. **Correct the ticket/proposal's stated repro premise, which I could not confirm.** Both say the
   picker seeds a join step with an empty id "making the join op uncreatable from the UI". Given
   finding 1, the picker cannot produce a join step at all, so the empty-id join body realistically
   reaches `addStep` from the agent/MCP and patch-set surfaces, not the picker. This matters
   concretely: it means `PatchSetApplyResolvers` (not `PipelineService`) is the **reachable** half of
   this bug today, which should change where the executor concentrates its live evidence. AC4's
   probe body is still correct (it is what `defaultConfigFor("join")` returns) — only the "via the
   picker" framing is wrong. Restate the reachability analysis in `proposal.md` / `design.md` Context.
3. **Name the extractor's actual home; "the pipelines service package" pushes the dependency the
   wrong way.** `PatchSetApplyResolvers` is in `com.helio.services.patchsets` and its imports
   (`PatchSetApplyResolvers.scala:7,10,12`) reach the pipelines *protocol* and *persistence* packages
   but **not** `com.helio.services.pipelines`. Placing the helper there would introduce a new
   services→services dependency solely for this helper. Put it where both surfaces already depend —
   alongside the config ADT in `com.helio.api.protocols.pipelines` (or the step-config domain
   package) — and state the chosen fully-qualified home in design Decision 1 and task 2.1.

### Non-blocking notes

- Design says "six hand-written ACL blocks", but the patch-set surface is one `match` with three
  arms, not three separate blocks. The count of *unguarded call sites* (four) is right; the "six
  blocks" phrasing overstates the rewrite's shape at that file. Cosmetic.
- Task 3.4 ("confirm by reading the diff that no non-empty-id code path changed behavior") is good
  mechanism-constraining discipline (lesson 3) — keep it, and have it name the two preserved error
  strings explicitly in the evidence record.
- Task 6.1 lists `sbt test` / lint / typecheck / `npm test`. Since the change is backend-only, note
  in the record which of these actually scans the changed files (lesson 4) — the frontend gates
  scan nothing relevant here and should not be cited as coverage of this fix.
