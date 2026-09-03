# Guard the join op's right-source ACL check against an empty seed id

(HEL-950's title says "via picker"; that framing is historical and incorrect — join is
picker-excluded. See the ticket.md CORRECTION and HEL-958.)

## Why

An ACL pre-flight resolves an EMPTY second-source id as "resource does not exist" and returns `404`,
so a step whose source has not been chosen yet cannot be created. This is the third occurrence of one
defect — HEL-386 fixed it for `lookup`, HEL-620 for `union`, and join is the last op still unguarded.

Premise validation and the design gate corrected the ticket's stated repro. Join is **deliberately
excluded from the op picker** (`stepNarrowing.ts:82-84`; no `JoinConfig.tsx` exists), so this is not
a UI bug: the empty-id join body arrives from the agent/MCP and patch-set surfaces. The gate also
confirmed HEL-620's union fix never reached `PatchSetApplyResolvers`, so the real count of unguarded
call sites is four across two files, and the patch-set surface — where BOTH join and union are
unguarded — is the half reachable today.

## What Changes

- Introduce ONE shared helper, alongside `PipelineStepConfigCodec` in
  `com.helio.api.protocols.pipelines`, that decides whether a decoded step config carries a second-source id
  needing an ownership check, and returns the id only when it is non-empty. Every call site uses it.
- Rewrite the six hand-copied per-op ACL blocks (`PipelineService.addStep`,
  `PipelineService.updateStep`, `PatchSetApplyResolvers`'s pipeline-step-edit triad) in terms of
  that helper, fixing join at both `PipelineService` sites and join + union at the patch-set site.
- Add tests that guard the empty-id leg and the foreign-ownership leg INDEPENDENTLY for each op at
  each surface — a conjunction-only test guards neither leg (HEL-949).
- Record a RED-first probe against the real running backend at the surface where the defect is
  actually reachable — the patch-set apply path, for BOTH the union and join empty-id cells —
  verbatim before the fix and green after. A join picker walkthrough is impossible (join is
  picker-excluded; see HEL-958), so the UI leg is a union regression guard and explicitly NOT proof
  of the join fix. See ticket.md AC6a/6b/6c.
- Add a source-scanning structural guard test so the extractor cannot silently miss a future config,
  standing in for the compile-time check an untyped config parameter cannot provide.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-joinstep-right-source-acl`: the creation and update ownership requirements gain an
  explicit carve-out for an empty `rightDataSourceId` (the picker's own seed value), matching the
  carve-out `pipeline-union-op` and `pipeline-lookup-op` already state.
- `patch-set-apply`: the "when present" qualifier on the pipeline-step second-source pre-validation
  is made explicit — an empty id is not present, for join and union as it already is for lookup.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` (two ACL blocks)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` (one triad)
- One new shared helper alongside `PipelineStepConfigCodec` in `com.helio.api.protocols.pipelines`,
  the object that produces the untyped config both surfaces already consume.
- One new structural guard spec, following this repo's existing `*GuardSpec` precedent.
- Backend test suites covering step creation/update ACL and patch-set pre-validation.
- No migration, no wire-format change, no frontend change.

## Class-closing audit (what was checked, and how)

Two enumerations, so "this is the last one" is a finding rather than a hope:

- **Every step-config kind.** `grep "final case class [A-Za-z]*Config" backend/src/main/scala/com/helio/domain/steps/`
  returns 23 config case classes. Grepping all of them for a `DataSourceId` field returns exactly
  three: `JoinConfig.rightDataSourceId`, `UnionConfig.otherDataSourceId`,
  `LookupConfig.referenceDataSourceId`. No other op carries an id that could reach an ACL lookup, so
  the class is closed at the config level, not merely at the three ops already known.
- **Every resolver in `PatchSetApplyResolvers`.** All 18 `resolve*` functions were checked for
  id-bearing lookups. Every other path is already safe by one of two existing mechanisms:
  `requireTargetId` (L89-90) trims and rejects an empty `target.id`; `resolvePipelineCreate` (L498-499)
  explicitly rejects an empty `sourceDataSourceId` with a `400`; and `PanelServiceHelpers.
  validateCreatePanelRequest` covers the panel-create path. The only unguarded empty-capable ids in
  the file are the three step-config second-source ids at L194/199/204, of which join and union lack
  the filter.

**Caveat on this audit's method, recorded because the findings will be quoted.** Both enumerations
above were keyed on `findByIdOwned`. That has a real blind spot: a call site reaching the ownership
check through a HELPER is invisible to it. Exactly that happened — `PipelineService.
validateStepCrossOwnerRefs` (the transactional `POST /api/pipelines` `steps[]` path) indirects via
`checkOwnedSource` (`PipelineService.scala:223`) and was therefore missed by the audit and by the
design, and was found only during implementation. It is fixed and tested here, bringing the true
total to FIVE call sites, not four. The audit's findings hold; its stated method would not have
found that fifth site, and a future sweep of this kind should key on the PROPERTY (an ACL check
against a config-supplied id) rather than on one function name.

## Non-goals

- Changing what a non-empty but foreign-owned or nonexistent id does: it still 404s, unchanged.
- Changing execute-time behavior for an unset second source: it still fails descriptively at run
  time, per `pipeline-union-op`/`pipeline-lookup-op`.
- Changing `defaultConfigFor`'s seed shapes, or introducing frontend-side validation.
- Any broader refactor of the ACL triad beyond the five call sites named above (four enumerated at
  design time, plus `validateStepCrossOwnerRefs` found during implementation).
