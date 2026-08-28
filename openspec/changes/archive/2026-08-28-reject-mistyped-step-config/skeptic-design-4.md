## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold reviewer. Every claim below was derived from the tree in this worktree, not from prior reports.

### What I verified (with evidence)

**Round-3 remediation (a) — proposal.md's stale bullets**
- proposal.md "What Changes" now names `POST /api/pipelines/analyze-proposal` as the surface, states the
  observation happens in `inferCast`/`parseConfig`'s `validationError` and NOT in `validateStepConfig`, and
  records that `GET /api/pipelines/:id/analyze` cannot report it. Verified against code:
  `PipelineService.analyzeProposal` builds `config = req.config.compactPrint` (PipelineService.scala:250-257,
  raw passthrough) while `PipelineService.analyze` builds `config = PipelineStepConfigCodec.encode(s)`
  (PipelineService.scala:162-168) from a row already decoded by `rowToDomain`
  (PipelineStepRepository.scala:258-261). `inferCast` (PipelineAnalyzeService.scala:245-248) does
  `json.fields("casts").convertTo[Map[String,String]]` inside `parseConfig`'s try/catch (638-651), so a
  list-shaped `casts` yields `Some("cast config error")` on the proposal path and nothing on the stored path
  (re-encoded to `{"casts":{}}`, which converts fine). The retraction is accurate in both directions.
  `validateStepConfig` (102-127) indeed has no `cast`/`rename` case → `Vector.empty`. No stale claim remains
  in proposal.md, ticket.md, design.md or either spec delta.

**Round-3 remediation (b) — task 2.1a seeding is implementable exactly as written**
- `PipelineAnalyzeRoutesSpec.scala:73-95` really is raw `sqlu` INSERT into `data_sources` / `data_types` /
  `pipelines` (line citation exact, not approximate).
- `pipeline_steps` (V23 + V86 + the op-check ALTERs) is `id TEXT PK, pipeline_id, position INT, op TEXT
  CHECK(...), config TEXT NOT NULL, created_at/updated_at defaulted, enabled BOOLEAN DEFAULT true`. `'cast'`
  is in the op CHECK set from V23 onward. A raw `sqlu` insert carrying the literal
  `{"casts":[{"field":"x","to":"float"}]}` is therefore possible with no owner/FK obstacle beyond the
  pipeline FK the helper already seeds.
- The stated reason the typed seams cannot be used is correct: `insert:66`, `insertInternal:162`,
  `insertAtInternal:214` all take `config: Any` typed and call `encodeConfig`. Line numbers verified.
- The mandated pre-assertion (stored raw text IS the mistyped shape, before asserting no `validationError`)
  binds the negative to real input, discharging the round-3 vacuity finding.

**Round-3 remediation (c) — Decision 6 table additions**
- `FilterStep.scala:35` `stringOr(obj,"combinator","AND")` ✓; `StringOpsStep.scala:42-43` `pattern`/`separator`
  `collect { case JsString(s) => s }` ✓; `FillNullStep.scala:33` `value` ✓; `WindowStep.scala:41` ✓;
  `StringOpsStep.scala:49` `fields` ✓; `GroupByStep.scala:22-27` ✓ (`{"groupBy":"region"}` → `Vector.empty`,
  `aggFunction` defaulting to `"sum"`). `domain/steps/` holds 25 entries = 24 `.scala` + README, i.e. 23 step
  files + `StepCodecUtil` — matching Decision 6's stated count and Decision 1's "other 21 companions".
- `PipelineStep.scala:93-97` is the tolerant-`decodeConfig` scaladoc as cited (corrected citation is right).
- 201 vs 200: ticket.md and proposal.md both now say 201 with the field report's "200 OK" recorded as such.

**Cross-document consistency (standing requirement 2, re-run from scratch)**
- `ServiceError.UnprocessableEntity` at `services/ServiceError.scala:27` ✓; mapped at
  `api/routes/ServiceResponse.scala:82` ✓; `PipelineShapeService.scala:55` is the named precedent ✓;
  `helio-mcp/src/httpClient.ts:237-247` `describeError` renders `"<status> <statusText>: <message>"` ✓
  (Decision 2's standing-requirement-3 surface claim holds).
- `addStep` (PipelineService.scala:460-466): the `PipelineStepKind.All` 400 check is genuinely first, decode
  second — Decision 2's ordering claim is achievable as written. `updateStep`'s config branch (631) has
  `cfgJson` raw in hand, so 3.5 is symmetric. Both step routes exist (`PipelineStepRoutes.scala:14,46`).
- `StepCodecUtil` is `private[steps]` and both step files are in `com.helio.domain.steps` ✓ (Decision 3's
  placement works).
- Decision 4's coverage set: `PipelineAnalyzeServiceSpec.scala:138` is the union *pass*-path assertion, and
  `:695` is the `window`/`median` test asserting `validationError shouldBe defined` — exactly as claimed,
  including the reason the `Unsupported`-grep heuristic overcounted. The five uncovered failure paths
  (`validateAggregate`/`GroupBy`/`Pivot`/`Union`/`Join`, PipelineAnalyzeService.scala:158-196) and the
  untested join at line 126 are confirmed.
- Decision 7a: `inferOutputSchema` (196-227) has no `"groupby"` and no `"join"` case; both fall to
  `case unknown => Some(s"Unknown op: '$unknown'")`. Its impact claim is also correct — `analyze` (71-73)
  short-circuits: on a validation failure `inferOutputSchema` is never called, so task 1.4's invalid-enum
  assertions are honest and the valid-config negative is genuinely unassertable for those two kinds.
- Decision 7b: each of the 8 validators guards with `SupportedX.contains` before its match; `MatchError` is
  unreachable today. Deferral is justified.
- Spec deltas: the MODIFIED requirement header matches `openspec/specs/pipeline-step-config-validation/spec.md:8`
  verbatim, and a diff of the delta against the live spec shows a **pure superset** — no existing sentence or
  scenario silently dropped. The ADDED `pipeline-step-config-rejection` capability is new and its scenarios
  map 1:1 onto tasks 4.1-4.5.

**AC traceability (question 3)**
AC1→4.1; AC2→4.3; AC3→4.4+4.6+3.3 ("byte-for-byte unchanged"); AC4 (corrected)→5.1+5.1a; AC5→4.1-4.5;
AC6→1.2+1.3+1.4 at the route spec; AC7→2.1 (+2.2's no-relocation guard). No AC is unsigned, and none is
signable only by a test that dodges the behaviour: 4.1/4.5 require re-listing steps / re-reading stored
config, 2.1 pairs the surface assertion with `CastConfig.decode(raw).casts.isEmpty`, 2.1a now pre-asserts the
seeded raw text. Feasibility of the harder ones confirmed: `POST /api/pipelines/analyze-proposal` only runs
`validateStepKinds` before analyze (PipelineService.scala:240-241), so a mistyped `cast` config reaches
`inferCast` — 2.1 will observe a real `validationError`; and a multi-failure step for 1.3 is constructible
(e.g. an `aggregate` with two unsupported `fn`s, or `window` `lag` missing `field` with a non-positive
`offset`, PipelineAnalyzeService.scala:143-157).

**Green-test-over-wrong-input traps (question 4)**
The two known traps are both closed: 2.1a's typed-seam vacuity (closed by the raw INSERT + pre-assertion) and
the AC7 surface relocation (closed by 2.2's stop-and-escalate). I found no third.

### Verdict: CONFIRM

### Non-blocking notes
- design.md Decision 6: the paragraph "The table classifies every one of the 23 decoders…" is inserted *inside*
  the markdown table, orphaning the last three rows (`case _ => 0`, `StringOpsStep:49`, `AssertStep:50-73`)
  from the header. Content is right; move the paragraph below the final row so the table renders.
- Decision 2's sentence "A malformed non-JSON body still yields today's 400 via the decode `Failure` branch"
  is moot rather than wrong: `req.config` is already a parsed `JsValue`, and `StepCodecUtil.asObject`
  (StepCodecUtil.scala:20-23) returns `JsObject.empty` for a non-object top level rather than throwing. Have
  `requireStringMap` reuse `asObject` semantics so a top-level array config cannot throw out of
  `validateRawConfig` and become a 500; treat it as "key absent → accept", matching today's behaviour.
- Task 3.2 gives `requireStringMap(obj, key, kind)` a `JsObject` first parameter while
  `validateRawConfig(raw: String)` takes text; the overrides must call `StepCodecUtil.asObject` first. Worth
  one word in the task so the executor doesn't invent a second signature.
- Task 1.2 doesn't name the seeding mechanism for the five route-level validator tests. The simplest one works
  and should be stated: `pipelineStepRepo.insert(pid, kind, <typed config carrying the unsupported enum
  value>, dummyUser)` — the bad enum is a plain string field, so it survives encode→decode→re-encode and still
  reaches the validator. No raw SQL is needed there (unlike 2.1a).
