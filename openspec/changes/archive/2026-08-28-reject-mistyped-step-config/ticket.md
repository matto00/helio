# HEL-860: Reject mistyped step config instead of silently storing an empty no-op

## Description

From the Sleeper field report (`/home/matt/Development/fantasy/docs/helio-issues.md`, issue #4). Leaf 4 of epic HEL-857 (agent-authored external-API ingestion), v1.7.

A step that does nothing, reported as success, is the most dangerous failure shape in the pipeline layer: the run is green, the dashboard renders, and the numbers are wrong.

### The bug (verified in code, 2026-08-28)

`CastConfig.decode` (`backend/src/main/scala/com/helio/domain/steps/CastStep.scala:22-26`) discards any config it does not recognise:

```scala
val casts = obj.fields.get("casts") match {
  case Some(o: JsObject) => Try(o.convertTo[Map[String, String]]).getOrElse(Map.empty)
  case _                 => Map.empty[String, String]
}
```

A list-shaped `casts` falls to `case _` and becomes `Map.empty`. A map with the wrong value types is swallowed by `getOrElse(Map.empty)`. Either way the step is stored as a **no-op** and the API returns success (201 Created; the field report records it as "200 OK").

Observed:

```
add_pipeline_step type=cast config={"casts":[{"field":"stats.adp_ppr","to":"float"}]}
-> 200 OK, stored config: {"casts": {}}      # step is now a no-op
```

The correct form is `{"casts": {"stats.adp_ppr": "float"}}`. Nothing warns that the supplied config was dropped; the pipeline runs green while doing nothing.

Expected: 422 naming the expected shape, as `create_pipeline_from_shape` already does for shape params.

## Scope

- Reject unknown or mistyped config shapes with a 422 whose message names the expected shape and the offending key.
- **Breadth is bounded.** The ticket's premise was that a sweep found this silent-drop pattern in exactly two files (`CastStep.scala`, `RenameStep.scala`). **Re-verification by enumeration refuted that count** — the pattern is present in nearly every step decoder, because read-path tolerance is a documented system-wide contract. Fix `cast` and `rename` as the ticket directs; the binding scope criterion is *field-verified harm plus this explicit ticket bound*, not *"nowhere else has the pattern."* Record the rest as known-remaining.
- Prefer failing the decode over defaulting: a config the caller supplied and we could not understand is an error, never an empty default.
- **Inherited coverage debt from HEL-859 (required scope, not optional).** HEL-859 shipped the analyze-time validation hook, but five of its eight validators and the multi-failure join ship without analyze-surface tests. The join is the stated contract this ticket builds on — the new checks compose into one `validationError` through it — so cover it here *before* adding to it. Verify the contract behaves as HEL-859 design Decision 7 claims rather than assuming it: the hook takes the RAW config string precisely so this ticket can see keys the typed decoder drops. If that raw-string contract turns out not to hold, say so loudly — it is the foundation of this ticket's whole approach.
- Coordinate with HEL-859: that ticket moves validation to analyze/create time; this one gives it something meaningful to report.

### Correction log (inline AC corrections, per standing requirement 4)

- **AC4** corrected — see the struck-through criterion below. Grounds: the "exactly two files" sweep premise is false.
- **AC7** clarified — see below. Grounds: the named hook cannot satisfy the assertion; the analyze surface can.

### Orchestrator premise-validation finding — RETRACTED AND CORRECTED (design gate round 2)

**The original finding recorded here was wrong, and is retracted in full.** It stated that the Decision 7
raw-config contract "was independently confirmed to hold" and that a list-shaped `casts` "already surfaces
today as the generic message `cast config error`". That was derived from reading
`PipelineAnalyzeService.analyze`'s signature without tracing how its input is built. Standing requirement 2
(audit prose against code) applies to it, and it failed that audit.

**The corrected finding — stated loudly, as the ticket requires:**

The contract holds on **one** analyze surface, not both.

- **`POST /api/pipelines/analyze-proposal` — holds.** `PipelineService.analyzeProposal:251-257` passes
  `req.config.compactPrint`, the caller's raw JSON, straight through. A mistyped `casts` reaches `inferCast`
  intact and is reported.
- **`GET /api/pipelines/:id/analyze` (stored pipeline) — does NOT hold.**
  `PipelineService.analyze:162-168` builds its input with `config = PipelineStepConfigCodec.encode(s)`,
  re-encoding a step that `PipelineStepRepository.rowToDomain` already decoded with the **tolerant**
  decoder. A row stored as `{"casts":[{"field":"x","to":"float"}]}` becomes `CastConfig(Map.empty)` and is
  re-encoded to `{"casts":{}}`, which `inferCast` accepts as a valid empty object. **No `validationError` is
  produced.** The dropped key is destroyed by the read round-trip before inference; no seeding method
  avoids this, because the round-trip happens on read.

**What this changes for the ticket.** It does not undermine the approach — it strengthens it. The ticket
assumed the analyze hook would report what this ticket rejects. For a persisted step it cannot. The
write-path 422 is therefore not a better-placed alternative to the analyze advisory; it is the **only**
point at which a mistyped `cast`/`rename` config on a stored step is detectable at all. AC7 is bound to the
proposal surface accordingly.

## Acceptance criteria

- [ ] A list-shaped `casts` config returns 422 naming the expected map shape, and no step is created.
- [ ] A `rename` config with the analogous wrong shape is likewise rejected.
- [ ] A correctly-shaped config for both steps still succeeds unchanged, with existing stored configs unaffected (no migration regression).
- [ ] ~~A re-run of the silent-drop sweep across `domain/steps/` finds no remaining instances, and the check is recorded in the PR.~~ **CORRECTED INLINE (standing requirement 4)** — the original is unsignable: the design gate refuted the "exactly two files" premise it rests on (the tolerant-decode pattern is present in essentially every step decoder, by documented design), while this change's stated non-goal bounds the fix to `cast`/`rename`. Signing it would require mis-stating the sweep. Corrected to: **the sweep is re-run by enumeration over all files in `domain/steps/`, its raw output and a classification of every hit are recorded in the PR, and the hits this change does not address are recorded as known-remaining with a follow-up ticket filed.**
- [ ] Tests cover the rejection path for both step kinds and assert the message names the expected shape.
- [ ] HEL-859's five untested analyze validators and its multi-failure join have analyze-surface test coverage, verified against the real analyze surface rather than a unit-level stand-in.
- [ ] The raw-config-string contract (HEL-859 Decision 7) is confirmed to expose keys the typed decoder drops, demonstrated by a test using a config `CastConfig.decode` would silently reduce to `Map.empty`. **CLARIFIED INLINE:** the demonstration binds to the **analyze surface's observable `validationError`** (via `inferCast`/`parseConfig`), not to `validateStepConfig` — that hook has no `cast`/`rename` case and returns `Vector.empty`, so a test asserting against it would assert the opposite of the truth. The contract holds; the observation happens in `inferCast`. See design Decision 5.

## Standing requirements (binding — each has found a real defect in this epic)

1. **Verify by measurement, not attestation.** Confirm red-on-revert by re-running the revert against the FINAL committed tests. If tests change after evidence is captured, the evidence is stale — recapture it.
2. **Audit prose against code.** Check every sentence asserting something is unchanged, preserved, or already handled.
3. **A green test over the wrong input proves nothing.** Verify a rejection actually reaches the MCP/HTTP surface as a readable 422 naming the expected shape — not merely that a backend function returns a `Left`.
4. **Re-check ACs against the tree** for staleness; correct inline rather than escalating.
5. **Derive sets by enumeration, not intuition.** Enumerate for the silent-drop sweep and for the uncovered-validator set.

## Known adjacent seam (decide in design, do not expand silently)

HEL-859 deleted the `case other =>` default arms from several step kinds when extracting shared vals, so a future enum value added without a matching arm throws `MatchError` rather than `IllegalArgumentException` and degrades to a generic reason. Its closing comment documents this seam and proposes a one-line guard test. If this work touches those match sites, decide explicitly in design whether closing that seam belongs here — and say so either way.

## Environmental notes

- `squash-branch.sh` parses only the FIRST backtick-quoted path on each `^-` bullet in `files-modified.md`. Declare exactly one full path per bullet.
- `scripts/concertino/` is gitignored except a few force-tracked files, so `emit-event.sh`, `persist-evidence.sh`, `next-report-number.sh` and `tui-attached.sh` DO NOT EXIST in the worktree. That is expected, not an error; fall back to `SendMessage` to `main`.
