# HEL-1365: PanelCard.tsx over size threshold; stale chart-type specs after HEL-1351

## Description

Leftovers from HEL-1351 (PR matto00/helio#820, de1ae5b00):

1. **File size:** `frontend/.../PanelCard.tsx` is now about 840 lines, over CONTRIBUTING's 400-line threshold. Split
   it along its natural seams. The split must not change behaviour: refactor discipline applies, and any bug found
   along the way gets its own ticket.
2. **Stale specs:**
   * `openspec/specs/panel-appearance-settings/spec.md` still says renderers fall back to line. HEL-1351 added a single
     resolver: the panel's stored chart type, else the Output's, else line.
   * The `chart-type-selector` spec still describes a selector that hasn't been shown since HEL-909.

   Sync both specs with the code.
3. **Column order:** the aggregated-chart Inspect view orders columns by record key, not header order. This is
   cosmetic.

## Absorbed duplicates (closed as Duplicates of this ticket, owner-approved 2026-10-08)

- HEL-1201 proposed seams: (1) `PanelCardBody` and its sort/filter/controls/cross-filter wiring into its own file,
  (2) the live-region/announcement assembly, (3) the desktop `PanelCard` host (drag/resize/inspect wiring).
- HEL-1183 proposed seams: header/title-editing chrome, ActionsMenu wiring, fullscreen/inspect mount points,
  cross-filter derivation, core card body — mirroring HEL-1180 (ChartPanel split). Its ACs: each module under (or much
  closer to) ~400 lines; existing PanelCard suites pass unmodified or with only import-path updates; lint/test pass
  with zero new warnings.

## Related comment carried in

- HEL-1215 (f9f38bb42) found the older HEL-1027 comment in `PanelCard.test.tsx` (~line 597-606) claiming the two-tick
  flush gives a "genuinely SETTLED baseline" is false. Correct/trim it here (comment only).

## Acceptance Criteria

- `PanelCard.tsx` and every module extracted from it are each under 400 lines; the split is behaviour-preserving
  (moved code byte-identical modulo indentation/import lines), with existing PanelCard/PanelCardBody tests passing with
  import-path-only changes and render-count tests unchanged.
- `panel-appearance-settings` and `chart-type-selector` specs describe the code as it is (resolver order; no selector
  in the panel detail modal).
- Item 3 (Inspect column order) is investigated against the live code path first; per the design gate (skeptic-design-1
  CR1) the live `headers` are `Object.keys(rows[0])`, so "order by headers" is a no-op. No code change ships for item 3;
  the evidence is recorded and "should Inspect follow the Output's declared `schema` order?" is surfaced as an owner
  question (a wider behaviour change than this ticket's cosmetic item).
- The `chart-type-selector` spec's `## Purpose` no longer describes a visible selector.
- The false "genuinely SETTLED baseline" comment in `PanelCard.test.tsx` is corrected.
- `npm run lint`, `npm run typecheck`, `npm test` pass with zero new warnings; both themes visually unchanged.
