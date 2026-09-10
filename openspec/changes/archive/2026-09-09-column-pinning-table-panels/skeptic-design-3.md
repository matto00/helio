## Skeptic Report — design gate (round 3, skeptic-design-3.md)

All checks re-derived cold from the live tree, not from the orchestrator's summary.

### What I verified (with evidence)

**Round-2 CR1 (pinned-cell background token) — ADDRESSED, and re-grounded independently.**
- `grep -n` on `frontend/src/shared/ui/DataGrid.css`: `background: var(--app-surface)` appears at
  `:77`, inside the `.ui-data-grid--preview` block opened at `:74`. The `--full` block (`:115`)
  declares no container background. The file's own comment at `:52-54` states the inset shadow
  "composites over whatever the container's actual background is (opaque `--app-surface` in the
  `preview` variant, or a user-customized panel appearance in the `full` variant)". Round 2's
  finding reproduces exactly.
- `frontend/src/features/panels/ui/PanelCard.tsx:24-41` — `getPanelCardStyle` sets
  `--panel-surface-override` unconditionally on every panel card from
  `buildPanelSurface(theme, appearance.background, appearance.transparency)`. So the `full`
  variant's real background is that variable, not `--app-surface`.
- `grep -rn "panel-surface-override" frontend/src` → the idiom
  `var(--panel-surface-override, var(--app-surface))` exists at `PanelGrid.css:41`,
  `PanelContent.css:56-57`, `MarkdownPanel.css:16-17`, `CollectionRenderer.css:36-37` (4 files).
  The design's "5 sites" phrasing is inherited from my round-2 report; it is 7 declarations across
  4 files. Editorial only — the token string quoted is exactly right.
- design.md Decision 6 now specifies `background: var(--panel-surface-override, var(--app-surface))`
  with a corrected `DataGrid.css:74-77` / `:52-54` citation (both verified accurate above), and
  correctly scopes pinned `<th>` to keep `--app-surface-soft` (confirmed at `DataGrid.css:141-144`).
- tasks.md 2.4 names the identical token and idiom. No divergence from design.md.
- `specs/data-grid/spec.md` requirement retitled "panel-surface-matched background"; the scenario
  now asserts "no more visible … than under any other opaque-looking element on that same panel",
  with the default-appearance and translucent cases spelled out. This is verifiable as written and
  no longer asks the final gate to prove an unachievable opacity claim. CR1b satisfied.

**Non-blocking cleanups, spot-checked:**
- Decision 5 now reads "**three** tiers covering four cell categories" with bullets 3/2/1/unset and
  no garbled clause. Matches task 2.5 (`z-index: 3 / 2 / 1`) exactly.
- Spec `:5-10` offset chain now leads with "using each column's live drag-resize width when a
  resize is in progress, else its `columnWidths` entry, falling back to `col.width`, then
  `DEFAULT_COLUMN_WIDTH`" — the full four-step chain, matching task 2.2's
  `liveWidths ?? columnWidths[key] ?? col.width ?? DEFAULT_COLUMN_WIDTH`.

**No new contradiction introduced.** Cross-read of Decisions 1/2/4/5/6/7 against tasks 1.x–5.x
found no statement in one contradicted by another; the earlier round-1/round-2 fixes (persistence
target, `columnWidths` non-persistence, ownership split, clear-writes-`[]`, density, separator
shadow) are all still present and consistent.

### Verdict: CONFIRM

### Non-blocking notes
- design.md Decision 4's leading sentence still writes the offset sum as
  `columnWidths[key] ?? col.width ?? DEFAULT_COLUMN_WIDTH`, omitting the `liveWidths` head that the
  very next parenthetical, task 2.2, and the (now-fixed) spec all include. Purely editorial — the
  authoritative chain is stated correctly twice within the same paragraph.
- "the existing 5-site in-repo idiom" (design.md Decision 6, tasks.md 2.4) is 7 declarations across
  the 4 named files. The file list is correct; only the count is off.
- Carried forward from round 2: Decision 1's "preserved by position, not identity" reorder rule is
  the most likely user-surprise in this feature. Documented and internally consistent — worth a look
  in the final UI pass, not a design blocker.
