# HEL-1405: Stale legacy markdown-panel specs still describe DataType-bound content; crossFilterRows reads fieldMapping for markdown Outputs

## Description

origin_kind: followup
origin_ticket: HEL-1240

From HEL-1240 (76816d406). Verify each.

1. Living specs still describe legacy DataType-bound markdown/text content panels (DataTypes were retired in the
   pipelines/outputs remodel):
   * `openspec/specs/markdown-panel/spec.md` ~:35-48 ("the bound DataType field's value", scenario "Grid renders
     bound content when panel is bound");
   * the Purpose line of `openspec/specs/markdown-panel-content-source/spec.md` ("Source/Static content modes…
     bound-over-literal render resolution");
   * `openspec/specs/mcp-panel-composition-tools/spec.md` ~:5 ("bind text/markdown/collection panels…").
   Update or remove via proper OpenSpec MODIFIED/REMOVED deltas so they match current behaviour (markdown content
   is literal `config.content`).
2. Optional cleanup: `frontend/src/utils/crossFilterRows.ts` ~:91-92 still reads `fieldMapping` for markdown
   Outputs. It's harmless today (writes store `{}`, markdown renders no rows), but it's a dead path. Remove it,
   with a test proving no behaviour change.

## Acceptance Criteria

- AC1: `openspec/specs/markdown-panel/spec.md` no longer describes DataType-bound / field-bound markdown content;
  its render requirement states content is the literal `config.content` (REMOVED+ADDED delta: a MODIFIED delta
  cannot drop the stale scenario). Its `TBD` Purpose is filled.
- AC2: `openspec/specs/markdown-panel-content-source/spec.md` Purpose no longer mentions Source/Static modes or
  bound-over-literal resolution.
- AC3: `openspec/specs/mcp-panel-composition-tools/spec.md` Purpose and its markdown-binding phrases (:22 "bound/
  authored markdown panel", :61-62 "text/markdown content binding") no longer describe a markdown binding.
- AC4: `crossFilterRows.ts` no longer reads `fieldMapping` for `markdown` Outputs; a markdown Output is never
  cross-filter-filterable (ADDED `panel-cross-filtering` requirement), with tests (labelled red-first vs guard
  honestly).
- AC5: every behaviour statement written into a spec is backed by a cited grep/code location in the evidence and
  PR body; `npm run check:openspec`, `npm run check:spec-structure`, `openspec validate` pass.

## Planning note (premise validation)

Item 2's "no behaviour change" premise is partially stale: V94 kept legacy markdown Outputs' `fieldMapping`
unfiltered and nothing clears it (living spec `pipeline-output-sheet` :84 names this case). For such a stored
legacy row the removal changes `isPanelFilterableByDimension` from true to false — red-first for that case, a
guard for the `{}` case. Rendered markdown content is unchanged either way.
