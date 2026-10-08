## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 24f6de4cf290c216c8ba94359f82d1d35ae88f2a (change dir untracked). Artifacts: ticket.md,
proposal.md, design.md, tasks.md, workflow-state.md, skeptic-design-1.md. PR #847 fetched:
`git fetch origin pull/847/head` gives FETCH_HEAD = ca3f5619376829fbe97cd4ed61bf90c7be7f80d9.

### What I verified (with evidence)

**Round-1 CR1 (`$$` filter): addressed in substance.** D5b(b) now requires:
- the raw, unfiltered diff;
- a classification of every differing line;
- a failure on any ADDED `$$` name on any checked class;
- the two named `NodeSnapshotRepository$$escapeLikeTerm`/`$$likeEscapeChar` removals as the only permitted `$$`
  delta, backed by `git grep` on HEAD and on ca3f5619;
- `$anonfun$` treated as a synthetic that may differ;
- two red runs (a defaulted param added, and `rowReads` widened).

C2 is updated consistently in design.md, tasks.md and the workflow-state.md CONSTRAINTS. I checked the ground truth
myself:
- `javap -public` on a sibling build whose `OutputService.scala` and `OutputConfigValidation.scala` are
  byte-identical to the base (`diff -q` was silent; build at `task/split-panelcard-sync-specs/hel-1365`) shows **no**
  `$$` member on `OutputService`/`OutputService$`. Moving D1/D2 code therefore cannot cause an unlisted `$$` removal.
- `OutputService.scala` has only two `collect { case ...}` anonymous classes (:468, :471). Both are in
  `validateFieldMapping`, and neither reads a private member, so moving them adds no `$$` accessor to
  `OutputConfigValidation`.
- `OutputConfigValidation$` already exposes `com$helio$services$pipelines$OutputConfigValidation$$tolerated`. It is
  pre-existing and unchanged, which is fine.

**Round-1 CR2 (duplicate config-validation home): addressed.** D3 now moves `validateFieldMapping`, `validateConfig`
and `mergeConfig` into the existing `object OutputConfigValidation`.

- **Name clashes: none.** The existing members are `Shared`, `KnownKeys`, `Aggs`, `ChartTypes`, `Renames`,
  `DeadStyling`, `KeysDoc`, `validate`, `tolerated`, `changed`, `describe`, `nearest`, `distance`,
  `validateChartType`, `nonEmpty`, `validateAggregation`, `chartShape` and `metricShape`.
- **External references stay qualified:** `OutputBindingSpec.validateFieldMapping`, `OutputCompare.validateConfig`
  and `PayloadOptIn.validateConfig`.
- **Internal references resolve to the right members:** the bare `validateFieldMapping(kind, merged)` and
  `mergeConfig(...)` hit the moved members, and the self-qualified `OutputConfigValidation.validate(...)` still
  resolves.
- **Callers outside the file:** `PatchSetPreviewProjection.scala:134-135` and OutputService :133/:244/:249 keep
  calling `OutputService.*` through the same-signature forwarders.
- **Other users of the file:** `KeysDoc`/`KnownKeys` users (AssistantProposalToolSchemas, RefinementEditShape, their
  specs, OutputConfigValidationSpec) are unaffected.
- **PR #847** does not touch `OutputConfigValidation.scala` (diff vs FETCH_HEAD is empty).
- **File-name scanners:** none names `OutputConfigValidation.scala` (grep over `backend/src/test` and `scripts/`).
- **Size:** about 205 lines, which is under budget.

Two new problems come with this revision (CR1 and CR2 below).

**Round-1 CR3 (README conflict with #847): addressed.**
- #847's only README hunk rewrites services README line 5 (`git diff 24f6de4cf...FETCH_HEAD -- .../README.md`). The
  file is 11 lines.
- Task 2.6 appends after line 11, so lines 6-11 are unchanged context between the two edits.
- C5 plus the trial-merge step make this checkable.
- The persistence README is untouched by #847.

**Round-1 CR4 (mutation plan): addressed.**
- D5b(c) now asks for one mutation per new or receiving file (four in total), each red through the public
  `OutputService`/`NodeSnapshotRepository` methods, with a recorded follow-up and a second attempt if one stays green.
- The targets exist: `Gte` is at NodeSnapshotRepository.scala:258, `!t.isBefore` at OutputService.scala:446, and
  `roots.size > 1` at :182.
- Multi-root create tests exist (PipelineRootRoutesSpec, among others).

**Guards still hold.**
- ExistenceNotLeakedRoutesSpec names only `OutputService.scala` (:448-449, :525). `create` and `listByPipeline` stay,
  and no moved code produces `ServiceError.Forbidden(`.
- check-node-root-encoding targets `NodeSnapshotRepository.scala` by name (:50, :106). D4 adds the new file to the
  targets and leaves the exemption scopes where they are.

### Verdict: REFUTE

Both change requests are one-clause fixes to the plan text. They exist because the round-1 fix (D3) moved code into an
object whose bytecode and doc the plan does not yet account for.

### Change Requests

1. **D5b(b)'s expectation for `OutputConfigValidation` is literally false, so a correct implementation fails its own
   classifier.** The plan says "`OutputConfigValidation`'s diff may only ADD the three moved public methods" and
   "Everything else (... `*$default$N` ...) must be identical". Today's bytecode for the companion
   (`javap -public 'com.helio.services.pipelines.OutputService$'`) shows that moving a method with a defaulted
   `policy` also carries `public OutputConfigWritePolicy validateConfig$default$4()`. The mirror class `OutputService`
   likewise has the static forwarders `validateConfig$default$4`, `validateConfig`, `validateFieldMapping` and
   `mergeConfig` (lines 87-90 of that javap). The current mirror `OutputConfigValidation` carries only static
   `validate`, `KeysDoc` and `KnownKeys`. After D3, both `OutputConfigValidation$` and the mirror `OutputConfigValidation`
   will therefore ADD `validateConfig$default$4` and the static forwarders, plus public `$anonfun$validateFieldMapping$*`,
   `$anonfun$validateConfig$*` and `$anonfun$mergeConfig$*` synthetics (which are public static in Scala 2.13 javap
   output). Revise D5b(b) and the C2 wording in all three places to list the exact permitted additions:
   - on `OutputConfigValidation$`: the three methods plus `validateConfig$default$4()`;
   - on the mirror class: their static forwarders, including the static `validateConfig$default$4()`;
   - `$anonfun$` as synthetics.

   Also require that `OutputService`/`OutputService$` still carry `validateConfig$default$4` unchanged, which proves the
   forwarder kept its default. Without this, the executor must improvise a classifier exception mid-run, which is the
   silent loosening round-1 CR1 was written to prevent.
2. **The receiving object's doc becomes false after D3, and D3/D5 forbid fixing it.**
   `OutputConfigValidation.scala:6-11` describes the object as validation "against a per-kind known-key set, plus the
   `aggregation`/`chartType` shape rules". Its tolerance rule says "only what a write introduces or changes is judged".
   The moved `validateConfig` (base OutputService.scala:483-498) validates the **merged** config's `fieldMapping`,
   `compare` and `historyPayloads`. A stored value it rejects therefore fails an unrelated write, which contradicts that
   object-level claim, and the object would now also host `ServiceError`-typed results. D3 says "Its existing members
   are not edited", and D5's permitted non-move lines do not include this doc, so the plan guarantees a misleading
   contract doc on the file the revision chose as the single home. Add a D5 permitted category: a scoped amendment of
   at most two lines to the object doc (lines 6-11). It should say that the object also hosts the write-path composite
   (`validateConfig`/`validateFieldMapping`/`mergeConfig`, moved from `OutputService`) and that the tolerance rule
   covers `validate`'s key and shape checks only. The move checker (D5b(a)) must list that amendment as an allow-listed
   line.

### Non-blocking notes

- After the move, the moved `IllegalStateException` text `"OutputService: no OutputBindingSpec ..."` is thrown from
  `OutputConfigValidation`. Keeping it verbatim is correct under C3. List it as a follow-up candidate rather than
  editing it.
- The moved `resolveExplicitRootId` doc says "no caller of THIS class". After D2, "this class" refers to
  `OutputRootResolution`. This falls under D5's positional-word category and should appear in the executor's
  enumerated list.
- Unused imports left in `OutputService` after the move (`OutputCompare`, `PayloadOptIn`, `OutputBindingSpec`, possibly
  `JsString`) fall under D5's "package/imports" category. Remove them so `check:scala-quality` and scalac stay clean.
- tasks.md lists C5 before C4. This is cosmetic.
- The sibling-build javap provenance rests on `diff -q` source equality of both source files with the base, not on
  `.class` mtimes. No mtime ordering is relied on.
