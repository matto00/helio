## Why

`CastConfig.decode` and `RenameConfig.decode` silently discard a config shape they do not recognise: a
list-shaped `casts` falls through `case _ => Map.empty`, and a map with wrong value types is swallowed by
`Try(...).getOrElse(Map.empty)`. `PipelineService.addStep` calls that tolerant decoder as its only config
check, so the step is persisted as a **no-op** and the API returns 201. The pipeline then runs green while
doing nothing — a rendered dashboard over wrong numbers, with no signal to distrust it. This was hit for
real in the Sleeper field test (issue #4).

The tolerance is deliberate on the READ path: `PipelineStep.Companion.decodeConfig` is contractually
required to be tolerant so legacy/partial stored rows survive. The defect is that the WRITE path reuses
that read-path decoder as if it were validation.

## What Changes

- Add a strict, write-path config check for `cast` and `rename` that rejects a supplied-but-unintelligible
  config with **422** naming the expected shape and the offending key. `POST /api/pipelines/:id/steps` and
  `PATCH /api/pipeline-steps/:id` both reject; no step is created or updated.
- Leave `*Config.decode` tolerance untouched, so existing stored rows keep decoding exactly as today (no
  migration regression).
- Re-run the silent-drop sweep across `domain/steps/` by enumeration, record its raw output and a
  classification of every hit, and file a follow-up for the hits this change deliberately does not fix.
  (The ticket's "exactly two files" premise was refuted at the design gate — the pattern is pervasive,
  because read-path tolerance is a documented contract; the fix here is bounded by the ticket, not by the
  pattern's extent.)
- **Inherited from HEL-859 (required scope):** add analyze-surface coverage for the five validators that
  shipped untested — `aggregate`, `groupby`, `pivot`, `union`, `join` — and for the multi-failure join in
  `validateStepConfig`, exercised through the real analyze surface rather than a unit-level stand-in.
- Demonstrate HEL-859 Decision 7's raw-config-string contract on the **one surface where it holds**:
  `POST /api/pipelines/analyze-proposal`, which passes caller config through un-round-tripped. The
  observation happens in `inferCast`/`parseConfig`'s `validationError` — **not** in `validateStepConfig`,
  which has no `cast`/`rename` case and returns `Vector.empty`. Also assert the converse: the
  stored-pipeline surface `GET /api/pipelines/:id/analyze` **cannot** report such a key, because it
  re-encodes each step from its already-tolerantly-decoded form. That is precisely why the write-path 422
  is the only detection point for a persisted step.

## Capabilities

### New Capabilities

- `pipeline-step-config-rejection`: rejection of a supplied-but-unintelligible step config at create/update
  time with a 422 that names the expected shape and the offending key, instead of storing a silent no-op.

### Modified Capabilities

- `pipeline-step-config-validation`: the analyze-time validation contract gains an explicit, testable
  guarantee that the **proposal** analyze surface (`POST /api/pipelines/analyze-proposal`) is driven from
  the RAW caller-supplied config and therefore reports keys the typed decoder drops, together with an
  explicit disclaimer that the **stored-pipeline** surface cannot report them; and that its multi-failure
  join is observable at the analyze surface.

## Impact

- `backend/src/main/scala/com/helio/domain/steps/CastStep.scala`, `RenameStep.scala`,
  `StepCodecUtil.scala`, `domain/model/PipelineStep.scala` (Companion trait), and
  `services/pipelines/PipelineService.scala` (`addStep` / `updateStep`).
- API behavior change: a previously-accepted (and silently discarded) `cast`/`rename` config now returns
  422. Correctly-shaped configs are unaffected.
- No database migration. No frontend change required.

## Non-goals

- Changing `*Config.decode` read-path tolerance, or any stored-row rewrite/migration.
- Extending strict write-path rejection to step kinds beyond `cast` and `rename`.
- Validating `cast` target-type *values* (e.g. `"float"`), or closing HEL-859's `MatchError` seam — both are
  assessed in design.md and deliberately deferred.
