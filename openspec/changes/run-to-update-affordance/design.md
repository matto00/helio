## Context

Owner rulings (HEL-1096 escalation, answered via `concertino answer`): surface on a toast (post-write)
AND the pipeline's own page; wire shape is `extend-submit-response`; permission is
`server-computed-canRun-in-response`, mirroring `PipelineRunService.submit`'s owner-or-editor check.

Verified against the live tree at Planning: `AutoRunTriggerService.evaluateAndSchedule` already
computes a full `CostVerdict` per pipeline on every write but discards denied ones after logging
(`AutoRunTriggerService.scala:75-81`). `RowWriteResponse`/`schemas/sources/row-write-response.schema.json`
carry no verdict field today (`additionalProperties: false`). `PipelineService.analyze` already
returns `costVerdict.reasons` (HEL-1092) and the frontend already fetches it
(`usePipelineDetailPage.ts:1466`) but nothing renders `reasons` or offers a run action yet — this
epic's pipeline-page half is additive UI over data that already exists on the wire, no new endpoint.
The toast system (`toastsSlice.ts`) already exempts an action-carrying toast from cap eviction and
coalesces identical `variant`+`message` pushes (replace, not stack) — this is what makes "ten clicks,
one toast" free, provided our message text is deterministic per (pipeline, reasons) pair. The
`PatchSetReviewPage.tsx` sticky Undo toast is existing precedent for `duration: 0` + `action`.
`PipelineService.analyze` already uses `findByIdShared` (viewer-visible); `PipelineRunService.submit`
requires owner or `findGrantRole == "editor"` (403 otherwise) — this asymmetry is why `canRun` must be
a distinct, server-computed field rather than inferred from analyze-visibility alone.

**Design-gate history (both self-resolved except where noted; full detail in `skeptic-design-{1,2}.md`):**
Round 1 REFUTEd on (1) the write-response surface having no visibility check — a writer with zero
grant on a denied pipeline would learn its name/reasons, new cross-tenant disclosure
(`AutoRunTriggerService.scala:22-26`, `PipelineRootRepository.scala:62-68`: a root's pipeline "may be
owned by a DIFFERENT user") — resolved in D1 via the `visible` gate; and (2) `replaceRows`
(`DataSourceService.scala:837-856`, same helper/wire type as `appendRows`/`appendFormRow`) silently
excluded from scope — resolved in D1 by extending to it. Round 2 REFUTEd on a third+fourth call site
found by re-deriving the claim from a fresh grep instead of trusting round 1's count: `triggerAutoRun`
is called from FIVE places, not three — also `patchRow` (`:876`, `PATCH .../:rowId`, `200` + JSON
`RowResponse`) and `deleteRow` (`:901`, `DELETE .../:rowId`, `204` no body), both live/UI-reachable via
`DatasetRowGrid.tsx`. **Owner ruling (2026-09-24, `extend-patchRow-exclude-deleteRow-with-followup`):**
extend to `patchRow` (D1, now four call sites); leave `deleteRow` untouched (Non-Goals) —
`helio-mcp`'s `deleteDatasetRow` depends on its exact `204` contract, so changing it would be an
undiscussed breaking change. Follow-up filed: HEL-1171.

## Goals / Non-Goals

**Goals:** name the specific denying rule per AC; offer a manual run gated on real permission; reuse
`POST /api/pipelines/:id/run` and the existing SSE fan-out unmodified; keep ALLOWED-pipeline behavior
byte-for-byte unchanged; make the copy mapping mutation-provable (Show the red).

**Non-Goals:** a persisted denial-history/notification log (recomputed on demand, per owner ruling
1b); a batch "run all denied pipelines" action; changing `PipelineRunGuard`'s limits; hiding the
pre-existing unconditional "Run pipeline"/"Dry run" buttons on the pipeline footer (a separate, older
control this ticket doesn't touch); **surfacing an auto-run denial triggered by `deleteRow`** —
deliberately excluded per owner ruling (2026-09-24): `DELETE /api/data-sources/:id/rows/:rowId`
returns `204 No Content` with no body today, and `helio-mcp`'s `deleteDatasetRow` tool depends on that
exact contract, so changing it here would be an undiscussed breaking change. `deleteRow` keeps its
existing fire-and-forget `triggerAutoRun` call (logged only), unchanged by this ticket. Follow-up
filed: HEL-1171, "Design a non-breaking way to surface auto-run denials for row DELETE."

## Decisions

**D1 — `AutoRunTriggerService.triggerAutoRun` returns per-pipeline results instead of `Future[Unit]`,
gated on the writer's VISIBILITY into each denied pipeline, not just their run permission.**
`evaluateAndSchedule` already computes the verdict per pipeline; change its return type to
`Future[Vector[EvaluatedPipeline]]` (allowed | denied(pipelineId, name, reasons, canRun)),
`Future.traverse` collects them, and the shared private `triggerAutoRun` helper in
`DataSourceService` — currently `Unit`-returning/fire-and-forget, called identically from
`appendRows`, `appendFormRow`, `replaceRows`, AND `patchRow` (`:80-84`, called at lines
796/828/849/876) — is changed to return `Future[Vector[EvaluatedPipeline]]` and AWAITED by all FOUR of
those call sites, folding denied entries into `RowWriteResult` (first three) or a new
`deniedPipelines` field on `patchRow`'s `RowResponse` (already `200` + JSON — additive, non-breaking).
`deleteRow` (`:901`) keeps its existing fire-and-forget call UNCHANGED (Non-Goals) — never migrated to
the awaited form, so its `204`/no-body contract never changes. Debounce-upsert for the ALLOWED branch
is unchanged everywhere; only the response shape changes, and only for the four in scope.

Two ACL checks per denied pipeline, both computed against the WRITER (not the pipeline owner — the
writer may not be the owner; `AutoRunTriggerService`'s own doc already notes downstream pipelines "may
be owned by a DIFFERENT user"):
- `visible: Boolean` — owner OR any grant at all (`pipelineRepo.findGrantRole(pipelineId, user)`
  returns `Some(_)`, viewer or editor), mirroring what `findByIdShared` treats as "shared." **When
  `visible` is false, that pipeline's entry is OMITTED from the response entirely** — no name, no
  reasons, nothing. The denial is still logged server-side exactly as today (no regression); the
  writer simply learns nothing about a pipeline they have no relationship to, matching the fact that
  no existing API lets a data-source writer discover who reads their data today.
- `canRun: Boolean` — owner or `findGrantRole == "editor"` (identical to `PipelineRunService.submit`'s
  check) — gates the run ACTION only, and is only meaningful/present on an entry that already passed
  the `visible` gate above.

If every downstream pipeline denied for a given write is invisible to the writer, the response's
`deniedPipelines` is empty and no toast is shown — this is correct, not a regression: it's the same
"no leak to someone with zero relationship to the resource" posture `submit`'s 403 already embodies,
just expressed as silence instead of an error (there is nothing to error about — the write itself
still succeeded).

**D2 — Measure the added latency, per owner instruction.** Awaiting `triggerAutoRun` (previously
fire-and-forget) adds its own wall-clock time to the request. The executor measures p50/p95 submit
latency before/after on a fixture with 5 downstream pipelines (mix of allowed/denied) and reports both
in the PR for `appendFormRow`, `replaceRows`, and `patchRow` (all three now in D1's scope) — a
measurement task, not an optimization one; p95 growth >200ms is a PR-body finding, not a silent ship.

**D3 — One toast per write, not one per denied pipeline.** Denied toasts carry an action and are
therefore eviction-exempt (`toastsSlice.ts` D1); one per pipeline would stack unboundedly across
writes to a heavily-fanned-out dataset. The pushed toast's `message` aggregates every denied
pipeline's specific-rule sentence (one line each via the copy mapping); the toast carries a
"Run to update" `action` only when exactly one pipeline was denied AND `canRun` for it — a toast
`action` is a single `{label, onClick}`, so N>1 denied pipelines has no single well-defined target.
For N>1, the message still names every rule (AC is satisfied without an action); the pipeline page
(D5) is where a user resolves each one individually. `variant: "warning"` (denial is actionable, not
a hard failure) so it announces via the polite live region, not assertive.

**D4 — The dedup-driven "ten clicks, one toast" property is free, not built.** `pushToast` replaces an
existing entry with identical `variant`+`message` rather than stacking (`toastsSlice.ts`, already
speced in `toast-surface-behavior`). Building the message deterministically from
`(sorted pipelineIds, reasons)` — no timestamps, no per-request ids — means a burst of counter clicks
against an unchanged verdict produces byte-identical messages and coalesces automatically. No new
debounce/throttle logic is added in this change.

**D5 — Pipeline page: additive rendering over already-fetched data, gated the same way as the toast.**
`PipelineDetailFooter.tsx` gains a denial block (rendered when `costVerdict.autoRunnable` is false)
listing `costVerdict.reasons` via the SAME copy-mapping module as D3, plus a "Run to update" button
shown only when `costVerdict.canRun` is true. This intentionally diverges from the footer's existing
"Run pipeline"/"Dry run" buttons (always rendered, relying on the 403 backstop) — the owner's ruling
for THIS ticket is explicit (server-computed canRun), and retrofitting the pre-existing buttons is
out of scope (Non-Goals).

**D6 — Deny-copy mapping is one exhaustive module with a coverage test.** Mirrors
`PipelineCostEstimator`'s own "hand-maintained set + coverage invariant" pattern (its own doc comment
on `CheapOps`). One `denyReasonCopy: Record<CostReasonCode, (reason: CostReason) => string>` covering
all ten codes, including honest, non-alarming copy for `unclassified-op`/`unclassified-source`/
`row-estimate-unavailable`/`no-roots` (name what wasn't recognized, not why it's risky — nothing IS
known about risk for these). A test asserts every code the backend can emit
(`PipelineCostEstimator`'s own reason-code set, cross-checked) has a mapping entry, and a mutation
test removes one entry and asserts the specific-rule scenario test fails — this is the AC's "Show
the red" requirement made concrete.

**D7 — Guard-rejection (429) message is a distinct code path, not a copy variant of gate-denial.**
Both surfaces' "Run to update" click handler calls the existing `submit` service function and branches
on HTTP status: 429 → "Too many runs right now — try again in Ns" (reading `Retry-After`), any other
failure → generic run-failed copy. Never routes a 429 through the deny-reason copy mapping (D6) —
that mapping is for `CostReason.code`, an entirely different error channel.

## Risks / Trade-offs

Awaiting `triggerAutoRun` couples write latency to pipeline count (D2 measures, doesn't yet bound,
this); acceptable for v0.8's expected fan-out sizes per the design spec's "loosen on evidence" posture.
Two copy-mapping call sites (toast, pipeline page) importing one shared module is the chosen
de-duplication. `deleteRow`'s denial gap (Non-Goals) is a known, owner-accepted limitation until
HEL-1171 lands, not an oversight.

## Planner Notes

Self-approved: `variant: "warning"` for the denial toast (expected/recoverable, not a failure); one
shared frontend copy-mapping module under `frontend/src/features/pipelines/` (imported by both the
panel-submit path and the pipeline page) so there's exactly one place a reviewer checks D6's coverage;
`EvaluatedPipeline` as a new backend case class rather than reusing `CostVerdict`, since the write
response's per-pipeline-entry shape genuinely differs from `analyze`'s per-pipeline-verdict shape.

## Delivery Correction (2026-09-24)

`skeptic-final-1.md` (an evidence artifact, left unedited) describes D3's no-action-for-N>1-denied-
pipelines toast shape as an "explicit, reasoned owner ruling." That characterization is wrong and is
corrected here: the owner ruled only on WHERE to surface (toast + pipeline page) and the wire
shape/permission model (see Context above) — the N>1-toast-has-no-action shape was D3's own
design-gate decision, never put to the owner as a question. The owner has since reviewed and accepted
D3's shape for this ticket as shipped, and asked for a follow-up to improve it: HEL-1172 ("Multi-pipeline
denial toast: link each denied pipeline to its page / Run to update"), filed with the same
`origin_ticket`/`Follow-up`/v0.8-project convention as HEL-1171, `relatedTo` HEL-1096.
