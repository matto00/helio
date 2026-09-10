## Skeptic Report — design gate (round 2, skeptic-design-2.md)

All checks re-derived from the live tree at `7b872db9`, not from the design doc's claims.

### What I verified (with evidence)

**Round-1 change requests, re-checked one by one:**

1. **CR1 (retarget persistence) — ADDRESSED.** `grep -rn "TablePanelConfig" frontend/src` → still
   zero matches. `outputConfigTypes.ts:78-99` confirms `TableOutputConfig` carries `columnOrder`/
   `columnSort`/`columnFilters`/`columnFormats` as flat siblings and names HEL-465 (`pinnedColumns`)
   as the next one. `TableRenderer.tsx:175-190` (`persistColumnSort`/`persistColumnFilters` →
   `updateOutput`), `:162` (`PERSIST_DEBOUNCE_MS = 300`), `:218` (`canWrite`), `:358-364`
   (flush-on-unmount) all match what proposal.md/design.md Context/tasks 1.1-1.3 and the retitled
   spec requirement ("persists on the bound Output's config") now describe. Correct and consistent.
2. **CR2 (`columnWidths` not persisted) — ADDRESSED.** `TableRenderer.tsx:208`
   `const [widths, setWidths] = useState<Record<string, number>>({})`, passed at `:513`; no
   `columnWidths` field on `TableOutputConfig`. Decision 2 states the reload consequence explicitly
   and tasks 4.3/5.4 scope the checks same-session. Defensible trade-off, now on the record.
3. **CR3 (z-index) — ADDRESSED.** `grep -in "z-index" DataGrid.css DataGrid.tsx` → **no matches**
   (re-run, rc=1). Decision 5 now calls it new work, and includes the filter-row corner cell
   (`DataGrid.tsx:782` `<th style={{ top: columnsRowTop }}>` — the measured inline `top`, confirmed).
   Concrete values 3/2/1/unset restated in task 2.5.
4. **CR4 (opaque pinned backgrounds) — ADDRESSED IN INTENT, WRONG TOKEN.** See CR below.
5. **CR5 (ownership split) — ADDRESSED.** `grep -in "columnorder" DataGrid.tsx` → no matches
   (re-run); `TableRenderer.tsx:95,236` `orderedColumns(naturalKeys, columnOrder)` feeds pre-ordered
   `columns`. Decision 1's ownership-split paragraph and tasks 1.3/2.1 now say exactly this.
6. **CR6 (clear must write `[]`) — ADDRESSED.** `OutputService.scala:274-282` re-read:
   `existing.fields ++ patch.fields`, deep-merge only for `mergeableSubObjects = Set("legend",
   "tooltip", "seriesColors", "axisLabels")`. Decision 6, task 1.2, task 5.2 and the spec scenario
   "Clearing the pinned set writes an explicit empty array" all cover it.
7. **CR7 (density) — ADDRESSED.** `TableRenderer.tsx` passes no `density` to `DataGrid`
   (`grep -n "density" TableRenderer.tsx` → no prop at the `:509-521` call site);
   `DataGrid.tsx:296` `density ?? DEFAULT_DENSITY[variant]`. Decision 7 + tasks 4.4/5.1 corrected.
8. **CR8 (separator) — ADDRESSED.** `DataGrid.css:56-67` confirms the existing shadows are `inset`
   and on the *scroll container*. Decision 8 / task 2.6 now specify a non-inset trailing
   `box-shadow: 4px 0 6px -4px color-mix(in srgb, var(--app-text) 35%, transparent)`, and the
   data-grid spec requirement says "non-inset trailing shadow". Consistent.

**New checks:**
- `DataGrid.css:74-77` — `background: var(--app-surface)` is on **`.ui-data-grid--preview`**, not on
  the base `.ui-data-grid`. The `--full` variant scroll container sets **no** background; the file's
  own comment at `:52-54` says so: the shadow is inset "so it composites over whatever the
  container's actual background is (opaque `--app-surface` in the `preview` variant, **or a
  user-customized panel appearance in the `full` variant**, DESIGN.md §0.2)".
- `PanelCard.tsx:24-41` `getPanelCardStyle` sets `--panel-surface-override` on **every** panel card
  unconditionally, from `buildPanelSurface(theme, appearance.background, appearance.transparency)`
  (`frontend/src/theme/appearance.ts:229-243`) — a tinted `rgb()` whose alpha is
  `1 - transparency * 0.85`, i.e. **not** `--app-surface` whenever a user sets a background colour,
  and **not opaque at all** when transparency > 0.
- The established in-repo idiom for "the panel's actual background" is
  `var(--panel-surface-override, var(--app-surface))` — 5 sites: `PanelGrid.css:41`,
  `PanelContent.css:56-57`, `MarkdownPanel.css:16-17`, `CollectionRenderer.css:36-37`.
- `DataGrid.css:137-139` `table-layout: fixed` is `--full`-scoped (offset math premise holds);
  `:141-144` `thead th { position: sticky; top: 0; background: var(--app-surface-soft) }` confirms
  the header background claim.

### Verdict: REFUTE

Seven of the eight round-1 change requests are properly addressed against ground truth, and
Decision 1 remains sound. One remains materially wrong — CR4's fix names a token that is correct
for the `preview` variant and wrong for the `full` variant this feature exclusively targets, which
would ship exactly the visual defect CR4 was raised to prevent.

### Change Requests

1. **Pinned-cell background must be `var(--panel-surface-override, var(--app-surface))`, not
   `var(--app-surface)`, and the design's citation of it is wrong.**
   design.md Decision 6 states "the opaque background lives on `.ui-data-grid` (the scroll
   container, `--app-surface`)". That declaration is at `DataGrid.css:74-77` on
   **`.ui-data-grid--preview`**; the `--full` variant has no container background at all, and the
   same file's comment at `:52-54` explicitly says the full variant's background is "a
   user-customized panel appearance". Consequences of shipping `background: var(--app-surface)` on
   pinned `<td>`s:
   - On any panel with a non-default `appearance.background`, the pinned columns render as a solid
     off-colour stripe against the rest of the table — a worse defect than the bleed-through it was
     meant to fix, and one that only appears on customized panels (invisible to a default-fixture
     test).
   - At `appearance.transparency > 0` the panel surface is deliberately translucent
     (`appearance.ts:237-242`), so an opaque pinned cell breaks the user's opted-in translucency.
   Fix: use `var(--panel-surface-override, var(--app-surface))` (the existing 5-site idiom) in
   Decision 6, task 2.4, and correct the miscited line reference.
   1b. **Reconcile the resulting spec scenario.** With a translucent panel surface, "no part of a
   scrolling column's cell content is visible underneath a pinned column's body cell"
   (`specs/data-grid/spec.md`, Scenario "Pinned body cells do not show scrolling content through
   them") is unachievable by construction — the correct behaviour there is "the pinned cell paints
   the panel's own surface, matching every other opaque surface on that panel", not "fully opaque".
   Restate the requirement in those terms so the final gate is not asked to verify something the
   appearance system deliberately prevents.

### Non-blocking notes

- Decision 5 says "**four** layers" and then lists five bullets (the fifth being "no z-index"), with
  one garbled clause ("same tier as 1 is unsafe (they never overlap spatially, but for clarity: …)").
  The concrete values at the end of the decision and in task 2.5 are unambiguous, so this is
  editorial only — but it will read as a contradiction to the executor. Worth a one-line tidy.
- `specs/data-grid/spec.md`'s offset requirement gives the fallback chain as "`columnWidths` entry,
  falling back to `col.width`, then `DEFAULT_COLUMN_WIDTH`" — omitting the `liveWidths` head of the
  chain that Decision 4 and task 2.2 both include (`DataGrid.tsx:703-707`). Behaviourally this only
  matters mid-resize-drag, but the spec and the design should state the same four-step chain.
- Decision 1's leading-run rule plus the "preserved by position, not by identity" reorder scenario
  is a genuine product choice (reordering can silently change *which* columns are frozen while
  keeping *how many*). It is documented and internally consistent, so it is not a blocker — but it
  is the most likely thing a user reports as surprising, and worth a look in the final UI pass.
