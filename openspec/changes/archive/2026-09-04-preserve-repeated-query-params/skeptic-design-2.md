## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold read of the artifacts, then every claim checked against the tree at `0f16b85d`
(clean except the untracked change dir). I did not rely on round 1's report for any
ground-truth fact; I re-derived each one.

Round 1's five change requests:

1. **CR1 (malformed swallowed to empty) — genuinely fixed.** tasks.md 3.3 now states the
   opposite of the round-1 text: a `queryParams` matching neither encoding "SHALL throw
   `DeserializationException` from the format, which `decodeRest:64-68` already catches and
   maps to `Left(\"malformed: ...\")` ... must NOT be swallowed to empty". New task 3.5 adds
   the two concrete assertions (bare string; array entry missing `name`). design.md D2 carries
   the same rule, and the spec delta has a matching scenario. Verified against
   `DataSourceConfigCodec.scala:45-77` that this is what the existing catch actually does.

2. **CR2 (two-line fence achievability) — mechanism verified sound, not just asserted.**
   The claim is a named `QueryParams` wrapper whose `RootJsonFormat` lives in its companion
   object (design D1(b), tasks 2.1a). I checked this against how Scala implicit resolution
   actually works here rather than taking the claim: `PipelineProposalProtocol.scala:153-154`
   is `jsonFormat11(ProposalRestApiConfig.apply)`, whose field type becomes
   `Option[QueryParams]`; resolving `JsonFormat[Option[QueryParams]]` selects spray's
   `optionFormat`, whose own nested implicit `JsonFormat[QueryParams]` is resolved through the
   *implicit scope* of `QueryParams`, which includes its companion object. No import is
   required in that file, so the two-line fence holds. The bare-`Seq` ambiguity risk round 1
   raised (`immSeqFormat`/`tuple2Format`) is correctly avoided by the wrapper, and tasks 3.1
   forbids reintroducing a loose `JsonFormat[Seq[(String, String)]]`.
   Independently: the companion must live in the same file as the class, so the format lands in
   `domain/model/model.scala` — that file already imports `spray.json._` (line 8) and Pekko's
   `ContentType`/`ContentTypes` (line 6), so this creates no new layering violation. (It does
   falsify one sentence of D1's own rationale — see notes.)
   Also confirmed the fence is *compile-compatible*: `grep -rn queryParams backend/src` shows
   no reference in any fenced HEL-914 file, and `PipelineService.scala` touches
   `ProposalRestApiConfig` only via `toRestApiConfigPayload` (line 1267), never a `queryParams`
   literal — so the type change cannot force an out-of-fence edit.

3. **CR3 (fourth collapse point) — in scope.** Confirmed the defect is real at
   `SourceService.scala:113` (`val (baseUrl, endpoint, _, _) = ...splitUrl(url)`) and that the
   `RestApiConfig` built at 126-134 sets no `queryParams` at all. Now covered by design D6a, a
   red test (task 1.4), the fix (4b.1), its verification (4b.2), and a spec scenario. The
   adjacent `request.config.parameters` drop is explicitly excluded with a spinoff (4b.3)
   rather than silently absorbed — the right call.

4. **CR4 (auth-wins collision) — preserved, with one documentation gap.** Confirmed today's
   semantics at `RestApiConnectorDriver.scala:222` (`uri.query().toMap + (apiKeyName -> value)`
   = auth overwrites) and the header-side twin at 150-156. tasks 4.2 now requires "drop every
   existing pair whose name equals `apiKeyName` first, then append", plus a colliding-name test
   labelled a credential-shadowing regression. The spec delta adds both a scenario and a
   `## MODIFIED Requirements` block on **Auth injection** stating the precedence rule. The gap:
   tasks 4.2 cites "design D4a", which does not exist in design.md — see notes.

5. **CR5 (stale contract artifacts / delta structure) — fixed.** Verified
   `schemas/pipelines/create-pipeline-request.schema.json:42` is still
   `"queryParams": { "type": ["object", "null"] }`; it is now named in proposal.md's Impact and
   given task 6b.1, including the accurate warning that `check-schema-drift.mjs` compares field
   names only. proposal.md's false "No schema change" line is gone. The delta is now ADDED (a
   genuinely new requirement) **plus** `## MODIFIED Requirements` for Auth injection, and I
   checked the MODIFIED block reproduces the existing requirement text and all three existing
   scenarios verbatim before adding the new paragraph and scenario, so archiving will not drop
   content. I also re-read the two existing spec lines round 1 flagged: line 10 says only
   "optional `queryParams`" (shape-agnostic) and line 147 lists it as a non-credential field —
   neither contradicts the new requirement, so no further MODIFIED block is owed.

Fresh checks beyond round 1's list:

- **Hard constraints hold.** No task adds a Flyway migration (8.4 asserts it); no browser work
  anywhere; `PipelineProposalProtocol.scala` limited to its two `queryParams` lines with 8.5
  as the diff-level guard; nothing reaches into HEL-868 inference logic (the `/infer` path
  inherits the encoding via the shared payload only) or HEL-881.
- **Proof strategy still real.** Tasks 1.1-1.4 assert the query string the bound server
  *received*, and 8.1 restates "never a status code". 1.2's `(z,1),(a,2),(z,3)` fixture defeats
  both alphabetical and map-iteration accidents. 8.2 requires a real map-shaped persisted blob.
- **Every AC traceable.** Repeated keys → 1.1/4.1; order → 1.2; endpoint-carried query →
  1.3/4.1; bare-url authoring → 1.4/4b; legacy rows → 3.4/8.2; migration → 5.2.
- **D7 (deleting the `hasDuplicateKeys` warning)** is justified: I confirmed the warning text
  at `RestSourceConnectorMigration.scala` describes precisely the condition `splitUrl` can no
  longer produce.

### Verdict: CONFIRM

Sound enough to implement. All five round-1 requests are substantively addressed in the
artifacts, not merely acknowledged, and the one mechanism I was asked to distrust (the
companion-object format keeping the fence at two lines) holds up against how Scala and the
existing `jsonFormatN` wiring actually behave.

### Non-blocking notes

- **Fix the dangling `D4a` citation while doing task 4.2.** tasks.md 4.2 and the spec delta both
  state the drop-then-append rule correctly, but design.md has no `D4a`; D4's only sentence on
  this is "appends the auth pair to the existing query the same way", which omits the collision
  rule the tasks attribute to it. The operative instruction is unambiguous and the spec scenario
  and test pin the behavior, so this does not block — but the design should carry a real D4a
  before the artifacts are archived, so the shipped record of a credential-precedence rule is
  not a broken cross-reference.
- **D1's rationale contains a factual error.** It rejects `Uri.Query` partly because
  `domain/model` "currently holds only plain Scala types". It does not: `model.scala` already
  imports `spray.json._` and Pekko's `ContentType`/`ContentTypes`. The *conclusion* (a named
  wrapper, for interleaving and implicit-scope reasons) stands on its own; only the stated
  reason is wrong. Worth correcting so a future reader does not inherit a false invariant.
- **Task 8.5 may over-specify.** If both sides of the mapping become `Option[QueryParams]`, the
  `cfg.queryParams = ...` pass-through at line 91 needs no edit and the diff will show *one*
  changed line, not two. 8.5's "exactly two changed lines ... stop and escalate" should read
  "at most two, and no added import" so a correct one-line diff is not escalated as an anomaly.
- Line-number drift, minor: design D6a and tasks 4b.1 cite `SourceService.scala:113`, which is
  correct today; the `cfg -> DTO` mapping in `PipelineProposalProtocol` is line 91, not 95 (the
  artifacts no longer cite 95, so this is only a caution against reintroducing it).
