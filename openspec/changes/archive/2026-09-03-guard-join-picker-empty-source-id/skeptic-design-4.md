## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold reviewer; every claim below derived from files read this round, not from the
prior reports' narratives.

### What I verified (with evidence)

**Round-3 CR1 — picker framing in the durable spec delta. RESOLVED.**
`specs/pipeline-joinstep-right-source-acl/spec.md` now reads "The empty value is the
`defaultConfigFor("join")` seed shape defined in the frontend, reaching this endpoint from
agent/MCP and patch-set callers. Note it does NOT reach it from the op picker: `join` is
deliberately excluded from `OP_TYPES` ... (see HEL-958)." The scenario title is now
"Empty rightDataSourceId join step creation succeeds" — "(picker default)" is gone.
`grep -c picker` on the delta shows the only remaining mentions are the exclusion statement.
`proposal.md` line 3 carries the round-2 parenthetical: "HEL-950's title says 'via picker';
that framing is historical and incorrect — join is picker-excluded."

**Round-3 CR2 — Decision 7's guard mechanism. RESOLVED, and buildable against the real API.**
Checked each moving part against source rather than the design's description of it:
- `PipelineStep.Registry` exists at `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:188`
  and has exactly **23** entries (counted). Matches the baseline the guard asserts.
- `Companion.decodeConfig(raw: String): Any` (L118) is **contractually tolerant** — the trait's own
  doc says "Must be tolerant: missing keys yield typed defaults". Confirmed concretely in
  `JoinStep.scala:17-24` ("Tolerant decoder — missing keys default to empty ids + inner"), so
  `decodeConfig("{}")` yields a default config for every kind, as Decision 7 assumes.
- Scala is `2.13.15` (`backend/build.sbt:1`), so `Product.productElementNames` is available.
- `grep "final case class [A-Za-z]*Config" backend/src/main/scala/com/helio/domain/steps/` → 23;
  grepping those for `DataSourceId` fields → exactly three: `JoinConfig.rightDataSourceId`,
  `UnionConfig.otherDataSourceId`, `LookupConfig.referenceDataSourceId`. The proposal's
  class-closing enumeration reproduces exactly.

**Vacuity hole genuinely closed** (the thing round 3 asked me to judge). The baseline is
falsifiable in both directions, and each leg is falsifiable *alone*:
- add a fourth `*DataSourceId` field → "exactly three found" fails AND the per-field extractor
  assertion fails for the new field (task 4.7a);
- delete one arm from `secondaryDataSourceId` alone → the reflective enumeration still *finds*
  that field, so the `Some("real-id")` assertion fails inside the guard itself, not merely in
  task 2.2's unit test (task 4.7b);
- there is no filesystem path, cwd, or regex in the mechanism, so the round-3 "scan finds nothing
  and passes" failure mode is structurally absent.

**Round-3 CR3 — precedent claims. RESOLVED and independently re-verified.**
`grep -c "Source.fromFile\|Files\.\|listFiles"`: `RlsPolicyGuardSpec.scala` = 0,
`RestConnectorEgressGuardSpec.scala` = 0, `SchemaFieldStructuralGuardSpec.scala` = 0,
`CredentialSurfaceEnumerationSpec.scala` = 5. The design now cites `RlsPolicyGuardSpec` for the
runtime-enumeration form and records the false citation explicitly rather than silently. Reading
`RlsPolicyGuardSpec`'s header confirms it is the right model: runtime enumeration plus an explicit
"non-vacuousness probe" test (HEL-842) — precisely the shape task 4.7 demands here.

**Whole-artifact re-review against ground truth (not only the deltas).**
- The design's six-cell table is accurate: `PipelineService.scala:857-863` (addStep join) and
  `:1096-1103` (updateStep join) are unguarded (`case jc: JoinConfig =>` with no `.nonEmpty`);
  union/lookup at both sites carry `if ...nonEmpty`. `PatchSetApplyResolvers.scala:193-205` has
  join and union unguarded, lookup guarded. Four of six wrong, as stated.
- Helper placement is correct: both `PatchSetApplyResolvers.scala:6` and `PipelineService.scala:6`
  already import `com.helio.api.protocols.pipelines.PipelineStepConfigCodec`, so no new dependency
  edge. `PipelineStepConfigCodec.decode` does return `Try[...]` (the resolver matches
  `Failure`/`Success`), consistent with the `Any` parameter rationale.
- `requireTargetId` is at **L90** (design/proposal now cite L90, corrected). Its
  `.map(_.trim).filter(_.nonEmpty)` genuinely rejects empty target ids, so the audit's
  "every other id path is already guarded" claim holds where I sampled it.
- Error strings the tasks promise to preserve exist verbatim: `s"Data source not found: $id"`
  (PipelineService) and `s"edit $index: data source not found: $id"` (resolvers).
- Round-3 non-blocking notes all addressed: 4.5/4.6 reordered; `PanelServiceHelpers.
  validateCreatePanelRequest` added to the audit; new task 1.1b creates owned join+union steps so
  the patch-set "red" exercises the ACL arm rather than target resolution.

**Six review lessons, traced into the artifacts.** (1) task 4.4 requires per-assertion "why" for any
fixture change and records that no existing test asserts an empty second-source id; (2) ACs are
quoted literally in tasks 3.1-3.3 including the exact preserved error strings; (3) Decision 4
constrains the mechanism (`.nonEmpty`, deliberately not `.trim.nonEmpty`) and task 3.4 requires
reading the diff for non-empty-path drift; (4) task 6.1 explicitly forbids citing the frontend gates
as coverage of a backend-only change; (5) tasks 4.5 and 4.7 break each leg singly, for the ACL tests
AND for the guard itself; (6) task 4.4 forbids blanket-updating expected values.

### Verdict: CONFIRM

All three round-3 change requests are resolved in substance, not just in wording, and the adopted
guard mechanism checks out against the real `Registry`/`Companion` API. The artifact set is
internally consistent, contains no TODO/TBD/deferred decision, covers every AC with a task, and its
evidence plan is falsifiable at every step. Remaining nits are implementation-time details an
executor will hit immediately and cannot get silently wrong.

### Non-blocking notes

- `Companion.decodeConfig` returns `Any`, not a `Product`. The guard will need an explicit
  narrowing (`case p: Product => ...`), and should **fail** rather than skip if a decoded config is
  not a `Product` — a silent skip would reopen the vacuity hole for that kind. Worth one line in
  the spec's implementation, but the mechanism is unaffected.
- Task 4.6's `Some("real-id")` leg constructs `{"<field>":"real-id"}`. If a future op declares a
  second-source field as `Seq[String]`, that decode will fail and the guard will go red. That is
  the correct direction (drift detected), but the executor should let it fail loudly rather than
  wrap the decode in a `Try` that swallows it.
- Task 1.4/1.5 (direct-API join reds) are effectively the same code path as 1.2/1.3's join cell at
  a different surface; both are cheap, so no change requested — just don't let a green 1.4 be read
  as covering the patch-set surface.
