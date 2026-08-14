## Context

`PATCH /api/panels/:id` (`PanelRoutes.scala:64-68`) decodes `UpdatePanelRequest(title, appearance,
type, config)` — all four fields optional — and routes to `PanelService.update` →
`PanelServiceHelpers.resolvePatch`. `helio-mcp/src/tools/write.ts` only wraps `appearance` today
(`update_panel_appearance`). HEL-328 added the sibling `update_data_source`/`update_data_type`/
`update_pipeline`/`update_pipeline_step` tools onto the same `mcp-edit-in-place-tools` capability;
this change adds the missing fifth resource to that same capability, following its own established
pattern (`updateSchemas.ts` body-builder + thin `HelioApi` method + `guarded` tool registration).

Verified merge semantics directly against the backend (not assumed, per the ticket's own ask):

- `resolvePatch` (`PanelServiceHelpers.scala:21-48`): a request `type` that differs from
  `existing.kind` is rejected (`"cannot change panel type"`, 400); a matching `type` passes
  through as a no-op. `title`, when supplied, is trimmed and rejected if blank
  (`"title must not be blank"`). At least one field must be present or the request 400s
  (`"at least one field is required"`) — the tool does not duplicate this check client-side,
  matching `update_metric`'s existing convention of relying on the server's validation.
- `appearance`: `PanelAppearance.applyPatchJson` (HEL-362) — true per-field partial merge,
  identical to `update_panel_appearance`'s existing documented behavior. Unchanged by this ticket.
- `config`: `PanelConfigCodec.applyConfigPatch` (`PanelConfigCodec.scala:77-89`) dispatches to the
  panel's STORED kind's own `<Kind>PanelConfig.Patch.decode` + `applyPatch`, for **all nine**
  panel subtypes — metric/chart/table/text/markdown/image/collection/timeline/divider — not just
  the "bound trio" plus text/markdown the ticket's own motivating example happened to hit. Every
  one of these uses the SAME absent-vs-null convention as `appearance`: a field absent from the
  patch JSON keeps its stored value; an explicit `null` clears it. This is a genuine per-field
  merge, NOT a wholesale replace — unlike `update_data_type`'s `fields`/`computedFields` (which
  replace the whole array). Documented exceptions to the plain absent/null/set pattern, one per
  affected kind (verified round 1 skeptic REFUTE — the design's first pass under-scoped this to
  5 of 9 kinds; corrected here):
  - `TextPanelConfig.Patch`/`MarkdownPanelConfig.Patch`: `content` is a bare `String`, not
    `Option[Option[String]]` — absent leaves it unchanged, but `null` clears it to `""` (not
    "removed", since there's no Option wrapper to remove).
  - `ChartPanelConfig.Patch`: `annotation` also clears on an empty/whitespace-only string, not
    only on explicit `null` (`ChartPanel.scala:283-287`). `chartOptions` has its OWN, separate
    exception (verified round 2 skeptic REFUTE — missed in round 1 despite chart being one of the
    "already verified" five): absent=unchanged, explicit `null`=clear, a non-null object is
    strict-validated and replaces — but an object that, after per-type validation, carries no
    populated `line`/`bar`/`pie`/`scatter` sub-field (including a bare `{}`) ALSO normalizes to a
    full clear (`ChartOptions.parse`, `ChartPanel.scala:84-95`, called from
    `ChartPanelConfig.Patch.decode`, `ChartPanel.scala:279-286`) — the same
    empty-object-also-clears shape as `collection.itemOptions`/`timeline.timelineOptions.sort`
    below, just not previously named for chart.
  - `ImagePanelConfig.Patch` (`ImagePanel.scala:53-93`): `imageUrl` is the plain-string
    absent/`null`→`""` shape (like `content`); `imageFit` is absent=unchanged,
    `null`→resets to default `"contain"` (not a clear-to-empty), non-null validated against an
    allow-list; `caption` is a **third instance** of the annotation-style exception —
    absent=unchanged, `null`/blank/whitespace→clear, non-blank→set.
  - `CollectionPanelConfig.Patch` (`CollectionPanel.scala:91-144`): `dataTypeId`/`fieldMapping`
    are the standard absent/null-clear/set shape; `baseType` and `layout` are BOTH
    reset-to-named-default on `null` (`baseType`→`"metric"`, `layout`→`"grid"`,
    `CollectionPanel.scala:184-185`) — not a generic clear, same shape as `divider.orientation`/
    `image.imageFit`/`timeline.timelineOptions.sort` — `layout` additionally enum-validated on a
    non-null value; `itemOptions` absent=unchanged, `null` **or an empty object**→clears (the
    same empty-object-also-clears shape `chartOptions` above turned out to share).
  - `TimelinePanelConfig.Patch` (`TimelinePanel.scala:91-128`): `dataTypeId`/`fieldMapping`
    standard; `timelineOptions.sort` absent=unchanged, `null` or an empty object→resets to
    default `"asc"` (same "reset-to-default-not-clear" shape as `imageFit`).
  - `DividerPanelConfig.Patch` (`DividerPanel.scala:46-85`): `orientation` absent=unchanged,
    `null`→resets to default `"horizontal"` (reset-to-default, not a clear, enum-validated on a
    non-null value); `weight`/`color` standard absent/null-clear/set.

## Goals / Non-Goals

**Goals:**
- One new MCP tool, `update_panel`, covering `title`/`type`/`config`/`appearance` via the existing
  `PATCH /api/panels/:id` — no backend changes.
- A tool description precise enough that an agent knows, per panel kind — **all nine**
  `PanelConfigCodec.applyConfigPatch` dispatches to, not only the ones the ticket's own motivating
  example (metric/chart/markdown) happened to hit — which `config` keys are patchable and exactly
  how each one merges — this is the ticket's explicit acceptance criterion, and the direct fix for
  the "description previously claimed partial merge while the backend still replaced wholesale"
  drift the ticket calls out for `appearance` (HEL-362) — the same drift must not recur here for
  `config`, for any of the nine kinds.

**Non-Goals:**
- No backend change — `PATCH /api/panels/:id`, `PanelServiceHelpers`, and every `*PanelConfig.Patch`
  are unmodified; this ticket only adds an MCP-layer caller.
- No re-validation of `config`/`appearance` client-side beyond Zod's `z.record(z.unknown())` shape
  check — the backend is the single source of truth for per-kind validation (`chartType` enum,
  `density` enum, scatter/aggregation conflict, etc.), exactly as `update_panel_appearance` and
  `bind_panel` already rely on it.
- No change to `bind_panel`/`create_panel`/`update_panel_appearance` — they remain as-is; this adds
  a new, complementary tool rather than folding their concerns in (a panel's `dataTypeId`/
  `fieldMapping` binding stays `bind_panel`'s job by convention, even though `config` technically
  carries them too — documented as a cross-reference, not a redundant capability).

## Decisions

**D1 — Where the tool lives.** Register `update_panel` in `write.ts` immediately after
`update_panel_appearance` (same resource, same endpoint, so a reader scanning tool names finds both
together) rather than inside the `## Edit-in-place (HEL-328)` block further down, whose section
comment names a fixed four-tool set from that ticket. Add a short note above `update_panel` cross-
referencing HEL-328/HEL-627 as the same parity gap, so the connection isn't lost to placement alone.

**D2 — Body builder placement.** Add `buildUpdatePanelBody` to `updateSchemas.ts` alongside
`buildUpdateDataTypeBody`/`buildUpdatePipelineStepBody` (same "only include a key the caller
actually supplied" shape) rather than inlining it in `write.ts`, for the same reason that module
exists: keeps `write.ts`'s Zod-schema surface (already expensive to type-check per that module's
own header comment) untouched, and lets a unit test import the narrow builder directly, mirroring
`updateSchemas.test.ts`'s existing coverage style for the other two builders.

**D3 — `config`/`appearance` Zod shape.** `z.record(z.unknown()).optional()` for both, matching
`create_panel`/`update_panel_appearance`/`bind_panel`'s existing convention of not re-typing a
server-validated, per-kind-discriminated JSON blob client-side.

**D4 — `type` stays in the tool, unlike `update_pipeline_step`.** `update_pipeline_step`
deliberately omits `type` because the backend ALWAYS 400s on any provided value that doesn't match
the step's existing kind, so a matching value is a no-op and a mismatched one always fails — "no
successful, meaningful use." A panel's `type` behaves identically (immutable, mismatch 400s, match
no-ops) — the ticket's own scope explicitly asks for it anyway ("mirroring `UpdatePanelRequest`"),
so it stays, documented as a no-op/reject-only field rather than silently dropped — this is a
deliberate, explained divergence from the `update_pipeline_step` precedent, not an inconsistency.

**D5 — No new capability.** Extend `mcp-edit-in-place-tools` (Modified Capability) with a new
`update_panel MCP tool` requirement mirroring the spec's existing four requirements' shape, rather
than creating a new `mcp-panel-edit-tools` capability — this is explicitly "the missing fifth
resource in that same parity gap" per the ticket, and the existing spec already generalizes cleanly
(one requirement per resource).

**D6 — `bind_panel` cross-reference is explicit tool-description content, not just a design note.**
Since `config.dataTypeId`/`config.fieldMapping` are technically patchable through `update_panel`
too (every bound kind's `Patch` carries them), the tool description itself states that binding
changes are better made via `bind_panel` (which also validates the V41 pipeline-only rule and
`panelType` consistency) — `update_panel` still accepts them since the backend does, but a caller
should prefer `bind_panel` for binding changes. `tasks.md` §1.4 lists this as required tool-
description content directly (not left to the executor to infer from this design doc alone), per
round-1 skeptic REFUTE change request 2.

## Risks / Trade-offs

- **Tool-description drift** (the exact bug the ticket flags for `appearance`) → mitigated by
  grounding every merge-semantics claim in this design doc against the actual `Patch.decode`/
  `applyPatch` source read during planning, not the ticket's own prose, and cross-checking the
  `content`/`annotation` exceptions explicitly (easy to miss since they don't fit the standard
  absent/null/set pattern the other fields use).
- **Per-kind config field list going stale** if a future panel kind or field is added → same risk
  `create_panel`'s existing per-type config description already carries; no new mitigation beyond
  what that precedent already accepts.

## Planner Notes

Self-approved: no new external dependency, no architectural change, no breaking API change — a
single new thin-passthrough MCP tool onto an already-existing, unmodified backend endpoint,
directly following the HEL-328 precedent this ticket names as its sibling. No escalation raised.
