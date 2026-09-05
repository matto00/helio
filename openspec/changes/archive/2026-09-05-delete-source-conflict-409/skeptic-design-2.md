## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-read of the artifacts plus direct verification of every code fact the revision
asserts. I did not take round 1's report or the revision's own claims on faith.

### What I verified (with evidence)

**CR1 (the sole blocker) is resolved, and resolved against the real precedent.**

- The carrier is no longer `ServiceError.Conflict`. design.md Decision 3 now names option (a)
  explicitly: `DataSourceDeleteConflict(resourceKind, resourceId, resourceName, reason)` wrapped
  in `DataSourceDeleteError(conflict: Option[...], err: ServiceError)`. tasks.md 3.1 states the
  same types and the same signature change (`Future[Either[DataSourceDeleteError, Unit]]`,
  "update every caller").
- The `AuthoringError` precedent it mirrors is real and structurally identical. Read
  `api/routes/proposals/DashboardAuthoringRoutes.scala:56-62`: `completeAuthoring` matches
  `Left(AuthoringError(Some(kind), err, _))` → structured body, `Left(AuthoringError(None, err, _))`
  → generic body, and **both** call `ServiceResponse.statusCodeFor(err)`. Decision 3 and task 4.1
  describe exactly this shape, including the "both branches call `statusCodeFor`, never duplicate
  the switch" constraint. `RefinementRoutes.scala:44-49` is a second instance of the same pattern,
  so this is an established idiom here, not a one-off.
- Task 4.1 is actually implementable: `statusCodeFor` is `private[routes]`
  (`api/routes/ServiceResponse.scala:76`) and `DataSourceRoutes` is `package
  com.helio.api.routes.sources` — inside the `routes` qualifier. No visibility change needed.
- The premise CR1 rested on still holds: `services/ServiceError.scala:23` is
  `final case class Conflict(message: String)`, in a set the file header calls "intentionally a
  small, closed set". Decision 3 rejects widening it (option b) with that reason, and **explicitly
  forbids** the third reading (packing four fields into the message string).
- Critically, the forbidden reading is now *mechanically* excluded, not just prohibited in prose:
  new task 5.0 requires the 409 body be asserted at FIELD level across all five fields, "not by
  substring-matching one blob of text". That is the check that would fail a string-packed
  implementation. This is the strongest part of the revision.

**Both adopted round-1 notes landed properly.**

- `message` field: Decision 3a makes it binding, task 4.2 specifies it as the four
  teardown-compatible fields plus `message` set to the same text as `reason`. The motivation
  checks out — `TeardownConflictResponse` (`api/protocols/workspace/WorkspaceProtocol.scala:13-18`)
  is exactly four fields, so a generic `data.message` reader gets `undefined` today.
- File-delete ordering: I read `DataSourceService.delete`
  (`services/sources/DataSourceService.scala:561-580`) and confirmed `deleteFileF` runs before
  `dataSourceRepo.delete`. Task 3.1a and 3.4 both require the pre-check to run **before**
  `deleteFileF`, and design Risks records the residual race (pre-check passes, trigger then raises,
  file already gone) as pre-existing and out of scope with a correct justification — today's 500
  leaves identical wreckage. Recorded rather than silent, which is what round 1 asked for.

**Nothing else regressed from round 1's confirmed findings.** I re-checked the load-bearing ones
rather than inheriting them: `ServiceResponse.runNoContent`
(`api/routes/ServiceResponse.scala:41-45`) has no conflict path and calls `completeError`, so
today's 500 story is unchanged; the route still reads
`ServiceResponse.runNoContent(dataSourceService.delete(sourceId, user))`
(`api/routes/sources/DataSourceRoutes.scala:90`). Decision 1's sole-root-only scope, the P0001 root
cause, no-migration, and HEL-989 ownership are all still stated as settled and were not reopened.

**Caller impact is bounded and enumerated.** `grep` finds five non-route callers of
`dataSourceService.delete` (`PatchSetApplyRollback.scala:115`, `PatchSetApplyForward.scala:65`,
`PatchSetUndoService.scala:114`, `PipelineProposalService.scala:428` and `:551`). All either
discard the value or read `err.message`; each becomes a mechanical `.err` unwrap. Task 3.1's
"update every caller" covers this, and none of them needs the conflict payload.

**A schema file is NOT required — I checked the gate rather than assuming.** My first instinct was
that a new wire shape needs `schemas/sources/*.schema.json`, since `TeardownConflictResponse` has
schema coverage. That instinct was wrong on two counts, both verified: (1) the teardown conflict
has no standalone schema — it is a nested `$defs.TeardownConflict` inside
`schemas/workspace/workspace-teardown-response.schema.json`, present only because it rides inside a
200 body; (2) `scripts/check-schema-drift.mjs` walks `schemas/` and looks *up* the matching case
class (line 113 onward), so it is one-directional — a new case class with no schema is never
flagged. `ErrorResponse` itself has no schema anywhere under `schemas/`. Error-body shapes are
simply not schema'd in this repo, so requiring one here would be inventing a convention.

### Verdict: CONFIRM

The single blocking defect from round 1 is genuinely fixed — not paraphrased around. The design now
names one mechanism, matches it to a precedent I confirmed line-by-line, forbids the dangerous
reading, and adds a test-level assertion that makes the forbidden reading fail rather than relying
on the implementer's goodwill. The plan is sound enough to implement.

### Non-blocking notes

- **Fold `message` into the spec delta during execution.** `specs/datasource-edit-delete/spec.md`
  enumerates `resourceKind`/`resourceId`/`resourceName`/`reason` and never mentions `message`,
  while Decision 3a and tasks 4.2 / 5.0 make it binding and field-asserted. This is not a
  contradiction — the spec says the body carries those four, not *only* those four, and the
  "same four fields as the tag-scoped teardown conflict" phrasing is the compatibility claim,
  which stays true. But the delta is the artifact that gets archived as the contract, and shipping
  a fifth field the contract never names is exactly the kind of artifact-level divergence that
  gets caught at the final gate. One sentence in the requirement text plus a clause in scenario 1
  closes it; not worth an extra design round on its own.
- Task 3.1's "update every caller" is correct but silent on *how*. The obvious and intended answer
  is to unwrap `.err` at each of the five call sites, since only the route consumes the conflict —
  worth a word in the commit so a reviewer doesn't wonder whether widening those signatures was
  considered.
- Unchanged from round 1: `frontend/src/features/sources/services/dataSourceService.ts:186`
  discards the response body, so the 409 surfaces in `SourceDetailPanel` as a generic failure until
  someone renders it. Correctly out of scope per the proposal; the `message` field at least makes
  the eventual rendering a one-liner.
