## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 586da928abb6b7000d5e17799d3b5fb9b181ebce (planning artifacts untracked in the change dir).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/truncation-note-narrow-chart/HEL-1398`.
- Ticket text (Linear HEL-1398, fetched live) matches `ticket.md`: four items. The ACs are: item 1 measured chart height >= a stated minimum at w=2 with both footnotes, red-first; items 2-4 as described.
- AC coverage:
  - Item 1 -> D1 (measure first, stop if the claim is false), D2 (short form), D3 (1-line clamp plus a 96px canvas floor, stated as the AC minimum), D4 (red-first e2e, light and dark, mobile stack measured), tasks 1.1-1.3, 2.1-2.3. The ticket asked for "both themes and the mobile stack", and both are covered.
  - Item 2 -> D5, task 3.1. Confirmed live: `ChartRenderer.tsx:32` still says "one-line note".
  - Item 3 -> D6, task 3.2. Confirmed live: the current guard `/(?:^|\})\s*\.chart-panel__truncation-note\s*\{/` (no `m` flag) misses a rule that comes after `}\n/* c */\n`, because `\s*` cannot get past the comment. The ticket's premise holds.
  - Item 4 -> D7, task 4.1. Persisted with persist-evidence.sh; screenshots stay inside the worktree.
- Live-code claims in design.md checked:
  - The shared `.chart-panel__annotation, .chart-panel__truncation-note` rule uses a 2-line clamp, `--text-xs`, and padding `--space-1 --space-3 --space-2` (PanelContent.css:180-196).
  - The join rule `.chart-panel__annotation + .chart-panel__truncation-note { padding-top: 0 }` is at PanelContent.css:396.
  - `.chart-panel__canvas` is `flex: 1 1 auto; min-height: 0` (PanelContent.css:172).
  - `panel-card` is a size container on `.panel-grid-card` (PanelGrid.css:28-30).
  - rowHeight 52, margin 18, and min h 4 (panelGridConfig.ts) give a 262px card.
  - `chartTruncationNoteText(loaded,total,narrowed)` exists in chartTruncationNote.ts.
  - The `narrowed` flag is `viewerFilterActive || crossFilterMode === "server"` (PanelContent.tsx:287).
  - `.sr-only` is defined canonically in theme/theme.css:505.
- Callers: the `truncationNote` prop flows through PanelContent.tsx -> ChartOutputPanel.tsx -> ChartRenderer.tsx only. D2's "one place" constraint is achievable.
- Mobile stack: `.mobile-panel-stack__item--output` overrides containment to `inline-size` but keeps the `panel-card` name. Width-based container queries therefore still apply in the stack. Phone widths are far wider than a w=2 lg card (about 200px), so a narrow max-width query should not fire there. D4/task 1.3/2.3 also measure the stack before and after.
- Spec delta: `openspec validate truncation-note-narrow-chart --strict` -> "Change 'truncation-note-narrow-chart' is valid". The MODIFIED block reproduces the base requirement and adds the short-form paragraph and scenario. The ADDED requirement states the 96px floor and both themes.
- Scope: no backend, schema or API change, and no change to HEL-1392 data hooks. HEL-1438 is limited to reporting measurements. The "{loaded} of {total} matching rows." short form applies the ticket's own suggested short copy to the existing narrowed variant. I do not count it as a new product decision.
- No TBD/TODO placeholders. The one open number, the container-query width threshold, is deliberately deferred to D1's measurement, with a defined procedure and a stated bound: w>=3 keeps the long form, and the result is recorded in files-modified.md. That is not hand-waving.

### Verdict: CONFIRM

### Non-blocking notes
- D6 trap: with the `m` flag and "after a newline" as a selector start, the regex also matches the second line of the existing shared list (`.chart-panel__annotation,\n.chart-panel__truncation-note {`). D6 already says this must NOT match. The existing `expect(own).toBeNull()` assertion against the real CSS will catch it at once. The implementer should exclude a selector preceded by a comma (for example with a lookbehind) and should include that negative case in the fixture.
- Keep the narrow-width threshold below the narrowest phone-stack card width. Otherwise the 96px floor would land inside HEL-1438's 100px stack card. Task 2.3's before/after stack measurement should state the threshold next to the stack width.
- The 1-line clamp in D3 overrides the shared pair, so the joined-note `padding-top: 0` still applies. When the evaluator inspects the screenshots, they should check that the clamped annotation still ends in a visible ellipsis.
- Wrapping the note in two spans changes the paragraph's `textContent` because it now contains both strings. Any test using `toHaveTextContent` on the `<p>` will need its intended change stated, as the Risks section already requires.
- tasks.md has an empty `## Standing Constraints` heading. This is cosmetic.
