# Skeptic Report — design gate (round 3, skeptic-design-3.md)

## What I verified (with evidence)

### Round-2 change requests

- **CR1 (JsNull must not join the type lattice) — RESOLVED, and every load-bearing code claim in
  D8 is true.** Verified line by line against
  `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala`:
  - `inferJsonType(JsNull) = (StringType, true)` at `:146` — so D8's "the naive reading widens the
    whole column to `string`" is exactly right.
  - `widenJson` catch-all `case _ => StringType` at `:142` — confirms the poisoning join.
  - `inferFromObjects`' `case JsNull` branch is at `:103-107` (D8 cites `:102-107`, task 2.1 cites
    the accumulator at `:99-118` — both accurate).
  - The four null-writing sites D8 enumerates are real: `PipelineRowJson.anyToJsValue:27`
    (`case null => JsNull`), `LookupStep.scala:97`, `CastStep.scala:66`, `DateBucketStep.scala:121`.
  - D8's blast-radius argument is sound: today `inferFieldType` only ever sees row 0's value, so a
    null poisons the type only from row 0; union-across-rows makes ANY null poison it. The naive
    implementation would be strictly worse than the bug. Correctly promoted to a stated decision.
  - Design D8 + task 2.1's sub-list + two spec scenarios all now carry it. Task 2.1's first bullet is
    imperative and unambiguous ("branched on FIRST", "Do NOT pass it to `inferJsonType`").
- **The all-null fallback claim checks out.** `inferFromObjects` ends with
  `dataTypeOpt.getOrElse(DataFieldType.StringType)` (`:120-123`), and today's
  `inferFieldType`'s catch-all is `case _ => "string"` (`PipelineRunService.scala:746`), which is
  what `orNull` on an absent/None value hits. So D8's "matching `inferFromObjects`' own fallback and
  today's `inferFieldType(null) => "string"`" is true on both halves. No contradiction.
- **"It does not contribute nullability either, because D3 already pins `nullable = true`" — internally
  consistent.** D3 discards the engine's `nullable` unconditionally; `inferFromObjects` tracks
  nullability only to populate `InferredField.nullable`, which this path throws away. Dropping the
  nullability half of the branch changes nothing observable here. The two decisions do not collide.
- **CR2 (fixture had no null shape) — PARTIALLY resolved.** Shape (g) is added and explicitly
  distinguished from shape (a) as a different code branch, and 1.11a is flagged as a
  green-before-and-after regression guard with task 1.12 amended to match. That is the right
  structure. But 1.11a's greenness is only true under fixture constraints nobody stated, and the
  new spec's second null scenario is still untested — see CR1 and CR2 below.
- **Round-2 non-blocking note (PanelCreationModal) — CORRECTED and now accurate.** Verified
  `PanelCreationModal.tsx:107` (`NUMERIC_FIELD_TYPES = {integer,float}`) and `:132`
  (`firstFieldOfType(dataType,"timestamp") ?? firstFieldOfType(dataType,"string")`). D5's cell now
  says the fallback did fire and that C is a *change* in which column wins the x-axis default. True.

### Nothing from round 1 has regressed

Re-read all of D2, D3, D4, D5, D6, D7 against the current file. D2's no-flattening rationale, D4's
delete-not-repair, D6's corrected additive/eligibility split, D7's raw displayName, and D5's
three-transition table are all still present and unweakened; tasks 1.8/1.9/1.10/1.11, 2.4, 3.4 still
pin them. No round-1 request was quietly reverted by the round-2 edits.

## Verdict: REFUTE

Both remaining items are in the round-2 revision's own new material — the shape (g) / 1.11a
apparatus and the second new spec scenario. Nothing else blocks.

## Change Requests

1. **Task 1.11a's "expected GREEN before and after" is false for most legal readings of shape (g),
   and task 1.12 forbids the executor from reporting the red — which pushes it toward weakening the
   only test that distinguishes the correct implementation from the regressive one.**
   Task 1.1(g) says only "a number on some rows and an explicit JSON `null` on another". Pre-change
   inference reads row 0 alone (`PipelineRunService.scala:754`), so 1.11a is green beforehand ONLY if:
   - (i) the null is **not** in row 0. If the fixture puts the null on row 0 — the natural symmetric
     choice, since shape (a) uses row 0 for its absence — then pre-change
     `inferFieldType(null) => "string"` and 1.11a is RED before the change.
   - (ii) the non-null values are **integral**. If shape (g) is fractional, pre-change the column
     types `"double"`, which `PanelCapabilityService.wireType` drops entirely
     (`DataFieldType.fromString` → `None`, `flatMap`ped away), so 1.11a's second half ("IS still
     offered for a `Numeric` slot") is RED before the change regardless of the null.
     Task 1.11a's own wording, "typed `integer`/`float`", explicitly permits the fractional case.
   Required: pin shape (g) in task 1.1 as **integral values with the explicit null on a row other
   than row 0**, and narrow 1.11a's assertion to `integer` (matching the spec scenario, which already
   says `integer`). State in 1.11a that the green-before claim depends on exactly those two fixture
   properties, so if the executor observes a red it knows the fixture — not the expectation — is wrong.

2. **The new spec scenario "A column that is null on every row infers as string" is covered by no
   task, and it is the branch where a D8 implementation is most likely to break.**
   Task 1.1 enumerates shapes (a)-(g); none is all-null. Tests 1.2-1.11a therefore never exercise
   the fallback. This is not a redundant case: implementing D8 correctly leaves the accumulator at
   `None` for an all-null key, and the difference between `getOrElse(StringType)`, an unsafe `.get`,
   and dropping the key from the schema altogether is invisible to every other planned test — while
   dropping the key would silently violate this change's own "key set is strictly additive"
   invariant (D6). Task 2.1's third bullet states the required behaviour but nothing measures it.
   Required: add fixture shape (h) — a column present on rows but explicitly `null` on every one of
   them — and a test asserting the column **appears in the persisted `fields` at all** and is typed
   `string`. Like 1.11a, note its expected pre-change colour so 1.12 is not ambiguous (pre-change it
   is green only if the null-bearing row 0 is present, i.e. it is a second regression guard, not a red).

## Non-blocking notes

- Task 2.1 does not state the shallow entry point's return type. If it returns `InferredField`, the
  `nullable` component is dead by D3 and D8; a purpose-built return shape (or a comment saying the
  `nullable` is discarded at the projection) would keep D3's exception visible at the call site
  rather than only in `upsertFieldsFromRows`. Implementer's discretion.
- D5's `WorkspaceContextService` line references remain a few lines off in the current file (noted in
  round 2, not corrected). Substance still holds; not worth another round.
- Task 3.4(i)'s "no column present in the capability report before is absent after" is the right
  formulation and is now consistent with D6's corrected invariant. No further change needed.
