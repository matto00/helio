## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full (4 numbered change requests + 2 non-blocking notes) to
  re-establish exactly what was demanded.
- Read the revised `design.md` in full.
- Read the revised `tasks.md` in full.
- Cross-checked each of the 4 change requests against the revision:
  1. Decision 8 now carries an explicit "**Correction (design-gate round 1):**" paragraph stating
     none of the 6 enumeration sites fail at *compile* time — `PipelineStep` is not sealed, the
     `rowToDomain`/`encodeConfig` matches are over `Any` (never exhaustiveness-checked regardless of
     sealedness), and even the one sealed union (`PipelineStepResponse`) would at most warn since
     `build.sbt` sets no `-Xfatal-warnings`. States plainly that every site fails silently at compile
     time and only surfaces as a runtime `MatchError`/`IllegalStateException` if a test happens to
     exercise that exact path — matching the required correction verbatim, including the CHECK
     constraint being the one migration-time exception.
  2. `tasks.md` 3.4 (add `"splittext" -> SplitTextConfig(...)` to `PipelineStepConfigCodecSpec.scala`'s
     `cases` list) and 3.5 (add `SplitTextStepResponse(...)` to `PipelineStepProtocolSpec.scala`'s
     `subtypes` list) are both present, each cross-referenced to the task whose new match arms they
     exercise (1.5, 1.4). Design.md decision 9 lists both as part of the "four hand-curated per-kind
     lists" that are the actual safety net.
  3. `tasks.md` 3.7 adds a route-level `"POST with type 'splittext' is accepted"` test to
     `PipelineStepRoutesSpec.scala`, explicitly named as mirroring the "AllowedOps drift" regression
     test and tied to the `pipeline-steps-persistence` spec delta's required scenario. Design.md
     decision 9's closing paragraph states the same rationale (single test most likely to catch a
     missed arm across the full request→repository→response path).
  4. `tasks.md` 1.1 no longer contains any "mirror CastStep/GroupByStep" language — it just describes
     building `SplitTextStep.scala` directly. `tasks.md` 3.1 now explicitly states "new precedent —
     no `CastStepSpec`/`GroupByStepSpec` exist to mirror; see design.md decision 10." Design.md
     decision 10 makes the explicit two-tier decision: a **new, standalone**
     `SplitTextStepSpec.scala` for step-level unit tests, **in addition to** extending
     `InProcessPipelineEngineSpec.scala`'s `makeStep` helper for full-engine round-trip coverage, and
     states HEL-220/HEL-221 should follow this same two-tier shape. `tasks.md` 3.6 (extend `makeStep`
     + one or two engine-level scenarios) matches the second tier precisely — no ambiguity remains.
- Checked for new inconsistencies introduced by the revision: decision 9's four-list enumeration
  matches tasks 3.3–3.6 one-for-one; decision 9's route-test paragraph matches task 3.7; decision
  10's two-tier plan matches tasks 3.1 and 3.6 without contradiction.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 3.1's scope ("passthrough fields, null-field row dropped, no-matching-heading row
  dropped") is slightly broader than decision 10's phrasing ("split-function unit tests"), since it
  also covers step-level `evaluate` behavior rather than just the pure split functions in isolation.
  Not a defect — arguably the more thorough choice — but worth noting since HEL-220/HEL-221 will
  copy this file's scope as precedent.
- The two non-blocking notes from round 1 (row-level last-write-wins for `indexField == field`, and
  the pre-existing `inferOutputSchema` gap for `"join"`/`"groupby"`) were not explicitly addressed in
  this revision but were already flagged as non-blocking in round 1 and remain so.
