## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md`, `tasks.md`, and all four spec deltas
  (`patch-set-undo`, `patch-set-apply`, `patch-set-preview`, `mcp-patch-set-tools`) fresh from the
  worktree, plus round 1's `skeptic-design-1.md` (treated as claims to re-verify, not fact).
- **Round-1 CR3 (Toast auto-dismiss) — confirmed genuinely fixed.** `toastsSlice.ts:14` (`duration?:
  number` doc: "Defaults to 4000. Set to 0 to never auto-dismiss") and `Toast.tsx:46,49`
  (`const duration = toast.duration ?? DEFAULT_DURATION`; `if (duration === 0) return;` — skips the
  `setTimeout` entirely) confirm `duration: 0` really does mean "never auto-dismiss," not "dismiss
  after 0ms." Design.md D6 and tasks.md 3.2 now both specify `duration: 0` explicitly for the Undo
  toast. `PatchSetReviewPage.tsx:79-80`'s immediate `navigate("/")` after apply is unchanged, but the
  toast will now survive it. Fixed.
- **Round-1 CR2 (delete-edit-undo vs. the atomicity spec) — the literal contradiction is fixed, but
  reveals an unresolved sibling gap (see CR2 below).** Design.md D4/D5 and
  `specs/patch-set-undo/spec.md`'s new "A structurally-unrecoverable delete edit SHALL refuse the
  whole undo" requirement (with its own scenario) now correctly treat a `dashboard`/`dataSource`/
  `dataType`/`pipeline` delete edit as a Phase-1 blocker. tasks.md 5.3 no longer claims those four
  kinds' delete-undo "restores" anything — it now tests refusal. This part is genuinely reconciled.
- **Round-1 CR1 (D4a whole-JSON conflict check) — the pipeline half is genuinely fixed; the
  metric-panel half is NOT, despite being named in the same sentence.** Traced the actual field-scoped
  comparison mechanics for all six kinds against real source (see CR1 below for full evidence chain):
  `pipeline` (scalar `name`-only restored field, `PatchSetApplyRollback.scala:170-174`) is now sound —
  `lastRunStatus`/`lastRunAt`/`lastRunRowCount` are simply never in the compared set. `dashboard`
  (`fullDashboardInverse`, `:300-313`), `dataType` (`fullDataTypeInverse`, `:315-320`), `dataSource`
  (scalar `name`-only, `:141-145`), and `pipelineStep` (`fullPipelineStepInverse`, `:322-327`, no
  materialized sub-fields found in any of the 21 step config types) all check out clean — no dynamic
  sub-fields hide inside their restored field sets. **`panel` does not check out**: `config` is
  compared as one opaque JSON blob (`fullPanelInverse`'s `config`-via-`fullConfigInverse`,
  `PatchSetApplyRollback.scala:269-281`), and for `MetricPanel`/`ChartPanel`/`TablePanel` that blob
  genuinely contains the exact server-materialized fields design.md D4a names as excluded
  (`metricDeprecated` on all three — `MetricPanel.scala:32`, `ChartPanel.scala:199`,
  `TablePanel.scala:31`; plus MetricPanel's effective `dataTypeId`/`fieldMapping`/`aggregation`/`unit`
  — `MetricPanel.scala:19-24`, `PanelServiceHelpers.scala:276-293`). Confirmed the blob is not
  actually decomposed anywhere in the described mechanism (see CR1).
- Confirmed `PatchSetApplyForward.scala:28-30`'s `resultingState` for a `PanelUpdate` is captured
  from `services.panelService.update(...)`'s return value, and `PanelService.scala:462`
  (`patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user))`) proves that return value
  IS materialized (goes through `resolveSingleBinding`, `PanelService.scala:138-164`) — so the
  captured post-apply reference state genuinely carries `metricDeprecated`/effective fields when the
  panel is metric-bound, not just a theoretical possibility.
- Confirmed `EditOutcome` (`PatchSetApplyProtocol.scala:33-39`) really has no `targetKind`/`op` field
  and `ResolvedEdit` (`PatchSetApplyTypes.scala:69-77`) really does carry `kind`/`op` alongside the
  outcome within `PatchSetApplyService`'s scope — D1's claim that `PatchSetApplyService` must thread
  `targetKind`/`op` through at journal-write time is accurate and the data is available to do so.
- Confirmed V79 is still the correct next-unclaimed Flyway version (`ls
  backend/.../db/migration` tops out at `V78__refinement_conversations.sql`) and that
  `V77__authoring_conversations.sql`'s RLS pattern (`FORCE ROW LEVEL SECURITY` +
  `owner_id = current_setting('app.current_user_id')::uuid`) matches D1's now-corrected citation
  exactly.
- Checked the retention/pruning design (D3, tasks.md 1.2) for race-safety under concurrent applies
  from the same user, per this round's brief. Design.md doesn't specify the exact SQL shape, but the
  codebase has a clean, directly analogous precedent — `PipelineRunRepository.deleteOldRunsInternal`
  (`PipelineRunRepository.scala:154-167`) — a single `DELETE ... WHERE ... NOT IN (SELECT id ...
  ORDER BY startedAt DESC LIMIT N)` Slick action, which is self-converging and idempotent under
  concurrent writers (each prune re-evaluates against currently-committed rows; a transient >20-row
  window before the next write self-heals; no correctness violation). Not flagging this as a design
  blocker — it's implementable safely with existing precedent, just not spelled out at SQL-statement
  granularity in design.md (typical for this repo's design docs).
- Did a fresh completeness pass on D5's inverse-builders for all six kinds against their
  `Update*Request`/response shapes (`DataSourceResponse.name` exists for the dataSource case;
  `PipelineStepResponse.position`/`type`/typed `config` exist for the pipelineStep case) — no missing
  field gaps found beyond the CR1 issue below.

### Verdict: REFUTE

### Change Requests

1. **D4a's field-scoped conflict check still whole-JSON-compares the `config` blob for
   `panel`-kind edits, so it does not actually achieve the metric-bound-panel exclusion the design
   itself claims to have added.** Design.md's own text says: "Server-materialized/dynamic fields
   (`lastRunStatus`/`lastRunAt`/`lastRunRowCount`, `metricDeprecated`/metric-derived effective
   fields) are excluded by simply never being in that restored-field set." That's true for pipeline
   (`name` is a scalar, top-level field — `lastRunStatus` etc. are genuinely different top-level
   fields, never touched). It is **false** for panel: the "restored field set" design.md defines is
   `title`/`appearance`/`config` (mirroring `fullPanelInverse`, `PatchSetApplyRollback.scala:275-281`),
   and `config` is copied through **wholesale** as one `JsValue`, not decomposed field-by-field:
   - `fullConfigInverse` (`PatchSetApplyRollback.scala:269-273`): `JsObject(nullDefaults ++
     encoded.fields)` where `encoded = PanelConfigCodec.encodeConfig(prior).asJsObject` —
     `nullDefaults` only *adds* `null` defaults for `optionalConfigFieldNames` (which deliberately
     excludes `metricDeprecated`, per the comment at `:239-244`, precisely *because* it can never be
     patched — not because it's stripped from `encoded.fields`). `encoded.fields` itself is
     `mp.config.toJson.fields` (`PanelConfigCodec.scala:24-26`) — the **plain, complete** JSON encode
     of `MetricPanelConfig`'s 7 fields (`MetricPanel.scala:25-33`), `ChartPanelConfig`'s 7
     (`ChartPanel.scala:191-199`), or `TablePanelConfig`'s 7 (`TablePanel.scala:24-31`) — every one
     of which includes `metricDeprecated` verbatim whenever it's `Some(...)`. Nothing anywhere in
     `fullConfigInverse` removes an already-present field from `encoded.fields`.
   - `PanelResponse.fromDomain` (`PanelProtocol.scala:112-123`) sets `config =
     PanelConfigCodec.encodeConfig(panel)` — the *same* unfiltered encode. `PatchSetApplyForward.scala:
     28-30`'s `resultingState` for a `PanelUpdate` is built from `PanelResponse.fromDomain(panel)`
     where `panel` is the result of `services.panelService.update(...)` — confirmed materialized
     (`PanelService.scala:462`, `resolveSingleBinding`). So the *captured, persisted* comparison
     reference genuinely carries `metricDeprecated` (and, for MetricPanel with empty raw fields and a
     bound `metricId`, the metric-derived effective `dataTypeId`/`fieldMapping`/`aggregation`/`unit` —
     `PanelServiceHelpers.scala:276-293`).
   - Whatever "current live state" fetch the conflict check performs (design.md never specifies
     the mechanism — bare repo read vs. the normal materializing read path), if it uses any
     materializing read (the natural choice, since it needs to be comparable to a materialized
     `resultingState` at all), the live-fetched `config` blob will ALSO carry `metricDeprecated`/
     effective fields — now reflecting the metric's **current** definition, not its definition at
     apply-time.
   - **Net effect:** deprecating a metric (HEL-560, shipped) or editing a bound metric's
     `measureField`/`aggregation`/`format.unit` (HEL-553, shipped) between a patch-set apply and its
     undo — entirely unrelated to the patch-set edit itself — flips `metricDeprecated` or an
     "effective" field inside the compared `config` blob and produces a false `409` conflict,
     reproducing round 1's exact false-positive-conflict failure mode, just relocated from
     `PipelineSummaryResponse`'s top level into `MetricPanelConfig`/`ChartPanelConfig`/
     `TablePanelConfig`'s `config` blob. This is not a rare edge case for the same reason round 1's
     pipeline finding wasn't: metric deprecation and metric editing are normal, independent admin
     actions on a live, shipped feature (the HEL-418 Semantic/Metric Layer epic), not tied to
     panel edits.
   - **Corroborating tell:** the round-2 revision added exactly **one** new spec scenario for
     "unrelated field changing since apply is not treated as a conflict"
     (`specs/patch-set-undo/spec.md:32-36`), and it is pipeline-specific (last-run status/timestamp/
     row-count). No analogous scenario exists for a metric-bound panel's `metricDeprecated`/effective
     fields, even though design.md's own D4a prose explicitly names them as something to exclude —
     strong evidence the pipeline half of round 1's CR1 was fixed but the metric-panel half was
     believed fixed by the same top-level "field-scoped" framing without checking that `config`
     itself needed to be decomposed.
   - **Required revision:** D4a must specify that the panel-kind comparison decomposes `config`
     rather than treating it as an opaque blob — explicitly stripping `metricDeprecated` (all three
     bound-trio kinds) and, for `MetricPanel` specifically, comparing only the panel's own *raw*
     `dataTypeId`/`fieldMapping`/`aggregation`/`unit` values (not the metric-materialized effective
     ones) before the equality check. Since `priorState`'s config is captured via the bare,
     unmaterialized `ctx.panelRepo.findByIdInternal` path (confirmed by round 1,
     `PatchSetApplyResolvers.scala:282,298` — still accurate), the raw values are already available
     there as a model for what "current live state" should also fetch/derive for this comparison,
     rather than routing through a materializing read.

2. **D4's newly-added Phase-2 runtime-failure policy narrows the atomicity guarantee in a way
   `specs/patch-set-undo/spec.md`'s binding Requirement text does not authorize, and no Scenario
   documents it — the same class of spec/design contradiction round 1's CR2 caught for the
   delete-edit case, now recurring for a different trigger the round-1 fix didn't cover.**
   - Design.md D4 (added this round): "A genuine Phase-2 runtime failure ... aborts the REMAINDER of
     the walk immediately and reports every edit not yet reached as `notAttempted`; edits already
     restored earlier in this SAME Phase-2 walk are NOT compensated back — undo does not recursively
     undo itself. ... This is a documented, narrower guarantee than Phase 1's ('every edit restores or
     none does' holds for everything Phase 1 could foresee; a genuinely unforeseeable Phase-2 failure
     is reported honestly, never silently hidden...)." Design.md's own words concede this does **not**
     satisfy "restore every edit or none" for this trigger.
   - tasks.md 5.3 (also added/revised this round) now bakes in a test asserting exactly that narrower
     behavior: "a Phase-2 runtime failure reports remaining edits `notAttempted` **without
     un-restoring what Phase 2 already completed**."
   - But `specs/patch-set-undo/spec.md`'s Requirement 1 (lines 3-6) is unconditional: "`POST
     /api/patch-sets/:id/undo` SHALL restore every edit in the named application to its pre-apply
     state via the same per-resource services the apply path uses, **or restore none of them**." None
     of its two scenarios (lines 7-16), nor the sibling "structurally-unrecoverable delete edit"
     requirement (lines 38-48, which *did* get its own new requirement + scenario this round,
     correctly reconciling that half of round 1's CR2), cover a Phase-2 partial-failure outcome. A
     test that asserts a mixed `restored`/`notAttempted` result (per tasks.md 5.3) would pass against
     an implementation that is, by the spec's own literal unconditional text, in violation of
     Requirement 1 for that case.
   - This is exactly the "spec vs. design/tasks contradiction on the all-or-nothing guarantee" defect
     class round 1's CR2 already found once (for delete-edit undo) — the delete-edit half was
     properly reconciled by adding a matching spec requirement/scenario this round, but the identical
     reconciliation was not done for the newly-introduced Phase-2-runtime-failure carve-out, even
     though it's the same shape of exception to the same guarantee.
   - **Required revision:** either (a) add a spec.md Requirement + Scenario documenting the narrower
     Phase-2 guarantee (mirroring exactly how the structurally-unrecoverable-delete case was handled
     this round — a `notAttempted` outcome for a genuine, Phase-1-unforeseeable runtime failure, with
     edits already restored earlier in the same walk left restored, not compensated), or (b) if full
     atomicity is actually intended even across Phase-2 service-layer failures, design.md needs to
     specify a real compensation mechanism for that case (mirroring `PatchSetApplyRollback`'s own
     compensating-walk pattern) rather than accepting a silent narrowing. Given design.md already
     argues (a) is the pragmatic choice, (a) is almost certainly the lower-cost fix — but it must
     actually be written into the binding spec, not just design.md's prose, or the AC "the changed-
     since-apply conflict case behaves as documented" (ticket.md) has no documented case to point to
     for this specific, now-designed-for failure mode.

### Non-blocking notes

- Retention race-safety (D3): not a blocker (see verification above) — worth a one-line note in
  design.md that the intended mechanism is a single atomic `DELETE ... NOT IN (SELECT top-N)`
  statement (the `PipelineRunRepository.deleteOldRunsInternal` precedent), so a future implementer
  doesn't reach for a non-atomic SELECT-then-DELETE round trip instead.
- D4a's "current live state" fetch mechanism (bare vs. materializing read) is unspecified for every
  kind, not just panel — for the five kinds without a nested-blob problem this is harmless either way,
  but worth naming explicitly once CR1 is resolved, so the implementer doesn't accidentally reintroduce
  an unmaterialized-vs-materialized mismatch as a *new* false-positive source distinct from the one
  CR1 describes.
