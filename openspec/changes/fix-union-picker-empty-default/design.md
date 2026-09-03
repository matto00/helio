## Context

`PipelineService.addStep`/`updateStep` run three pre-flight ACL checks — `joinCheckF`,
`unionCheckF`, `lookupCheckF` — each calling `dataSourceRepo.findByIdOwned` against a config's
second-source id. `lookupCheckF` already guards with `case lc: LookupConfig if
lc.referenceDataSourceId.nonEmpty =>` (HEL-386, PipelineService.scala:885-892 addStep,
~1113-1120 updateStep). `unionCheckF` has no such guard (PipelineService.scala:867-874 addStep,
~1101-1108 updateStep), so an empty `otherDataSourceId` — the picker's `defaultConfigFor("union")`
seed — resolves `findByIdOwned(DataSourceId(""), user)` → `None` → 404, blocking the picker-add
flow entirely. `joinCheckF` has the identical gap but is out of this ticket's file-ownership
scope (HEL-278, predates the HEL-336 op-expansion epic) — reported as a follow-up finding, not
fixed here.

## Goals / Non-Goals

**Goals:**
- Union steps addable via the picker's empty default, with no 404.
- Preserve the HEL-384 cross-user ACL boundary for a non-empty `otherDataSourceId` unchanged.
- Match `lookupCheckF`'s guard shape exactly — no new abstraction/helper introduced.

**Non-Goals:**
- Fixing `joinCheckF`'s identical gap (out of scope; reported as a follow-up finding).
- Any frontend change — the picker already sends the correct empty default (confirmed during
  premise validation and to be reconfirmed live via Playwright).
- Extracting a shared "check-only-if-non-empty" helper across join/union/lookup — the ticket
  permits it if HEL-386 had extracted one, but it didn't; inlining stays consistent with the
  existing per-config pattern.

## Decisions

**Decision 1 — Backend-only fix, guard shape mirrors `lookupCheckF` exactly.** Change
`unionCheckF`'s pattern match in both `addStep` and `updateStep` from
`case uc: UnionConfig =>` to `case uc: UnionConfig if uc.otherDataSourceId.nonEmpty =>`, with the
same explanatory comment style `lookupCheckF` already carries. No frontend change: the picker's
`defaultConfigFor("union")` already seeds an empty `otherDataSourceId` correctly (identical to
`defaultConfigFor("lookup")`, which needed no change either) — this is analysis item (b) from the
ticket ("backend treats unset id as not-yet-chosen"), confirmed by direct comparison against
HEL-386's already-shipped fix.

**Decision 2 — `joinCheckF` gap is a follow-up finding, not fixed here.** `joinCheckF`
(`JoinConfig.rightDataSourceId`) has the same unguarded-empty-id shape and predates the HEL-336
op-expansion epic (HEL-278). It is out of this ticket's stated file-ownership scope ("ONLY touch
the union step's backend validation/ACL path"). Filed as a Linear follow-up ticket during
Delivery, not touched in this change.

**Decision 3 — No other HEL-336 op affected.** Scanned every `findByIdOwned` call site in
`PipelineService.scala`: only `joinCheckF`/`unionCheckF`/`lookupCheckF` reference a second
`DataSource` by id. No other op among the 9 shipped in HEL-336 has a second-datasource ACL check
at all, so there is no third op sharing this defect to fix or list.

## Risks / Trade-offs

- Loosening `unionCheckF` to skip the check on empty ids could, in principle, be a security
  regression if some other code path trusted an empty `otherDataSourceId` as "verified owned."
  Mitigated: `UnionStep.evaluate`'s execute-time resolution already treats an empty/unresolvable
  id as a descriptive execution failure (existing `pipeline-union-op` spec, "Missing
  otherDataSourceId fails at execute time" scenario) — the empty-id case was never executable
  data-leak surface, only a persistence-time false-positive 404. Directly mirrors HEL-386's
  already-shipped, already-reviewed precedent for `lookup`.
- Existing HEL-384 cross-user ACL tests must continue to pass unchanged — verified by running the
  full existing suite for touched files, not just the new regression cases.
