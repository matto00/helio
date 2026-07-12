## Context

HEL-240 (Data Grid Standardization) is delivered as a serial chain: HEL-254 (scroll, merged) ->
HEL-252 (this change) -> HEL-253 (draggable widths, next) -> HEL-255 (Table config rework).

Reading the current code before planning: the `density` prop on `DataGrid`
(`frontend/src/shared/ui/DataGrid.tsx`) is **already fully implemented** — `"condensed" | "normal"
| "spacious"`, `DEFAULT_DENSITY` per `variant` (`preview` -> `condensed`, `full` -> `normal`), and
all three CSS classes exist in `DataGrid.css` with padding/font-size scaled per density. The
`openspec/specs/data-grid/spec.md` capability spec already documents this contract (Requirement:
"DataGrid supports full and preview variants" includes the density-default scenarios), and
`DataGrid.test.tsx` already has a density describe block covering all three modes, both variant
defaults, and explicit override. This groundwork landed as part of HEL-251/HEL-254.

All six current consumers (`TypeDetailPanel`, `SourceDetailPanel`, `PipelinePreviewModal`,
`StepCard`, `SqlTab`, `TableRenderer`) call `<DataGrid>` without an explicit `density` prop, so they
inherit the variant default already.

## Goals / Non-Goals

**Goals:**
- Verify (not re-implement) that the density contract holds correctly across all six consumers,
  and that the rendered padding/font-size match `DESIGN.md`'s spacing/type scale tokens rather than
  ad hoc values.
- Close any gaps in the existing test matrix (e.g. missing spacious-mode assertions, missing
  font-size assertions if `DESIGN.md` requires a specific token mapping).
- Document the density API clearly (JSDoc on the prop, plus a short design note) so HEL-253 and
  HEL-255 do not need to re-derive the contract.

**Non-Goals:**
- **Table panel config dropdown for density, and any backend `TablePanelConfig` field/codec/patch/
  schema change.** Per project decision (2026-07-11), this DoD item from the Linear ticket text is
  explicitly deferred to HEL-255 ("Table config rework"), which owns surfacing density (and
  HEL-253's widths) in the Table panel config UI + persistence. HEL-255 has been notified via a
  Linear comment. This change only hardens/documents the primitive-level `density` prop that
  HEL-255 will consume.
- No change to `DataGrid` scroll, column-derivation, or cell-formatting behavior (HEL-254/HEL-251
  territory, already spec'd and unaffected here).
- No new density modes or configurable density scale — the three modes are fixed.

## Decisions

- **Treat this as a hardening/verification change, not new implementation**, since discovery shows
  the primitive-level density feature already exists and is already spec'd. If verification finds
  the CSS token usage or a consumer's rendering does not match `DESIGN.md`, fix it in place; if
  everything already conforms, the change is limited to tests + docs. Either outcome satisfies the
  ticket's actual (descoped) DoD.
- **Modify the existing `data-grid` capability spec** rather than create a new capability, adding a
  requirement that formalizes the *consumer contract*: the six listed surfaces rely on `DataGrid`'s
  variant-based density default and do not pass an unintended override. This gives HEL-253/HEL-255
  a spec anchor for "don't break this" without duplicating the primitive-level requirements that
  already exist.
- **Document via JSDoc + `DESIGN.md`**, not a new standalone doc file, so the density contract lives
  next to the other DataGrid documentation (variant/rows/columns are already JSDoc'd inline) and
  next to the project's existing spacing/type-scale tokens reference.

## Risks / Trade-offs

- [Risk] Verification could reveal a real DESIGN.md mismatch (e.g. a hardcoded padding value not
  using a space/type token) in one of the six consumers or in `DataGrid.css` itself, expanding
  scope beyond "verify only" → Mitigation: fix is still contained to CSS/token substitution, no
  API or behavior change, stays within this change's blast radius.
- [Risk] A future reader of the Linear ticket sees "Table panel config exposes density" in the DoD
  and assumes it's unmet → Mitigation: PR description and Linear comment on HEL-255 make the
  deferral explicit and traceable; this design.md is the canonical record.

## Planner Notes

- Self-approved: scoping this change down to hardening/documentation per the explicit project
  decision relayed by the human operator (not a new escalation — decision already made).
- Self-approved: modifying `data-grid` capability spec (existing capability, no new capability
  needed) since the primitive-level requirements are already fully specified.
