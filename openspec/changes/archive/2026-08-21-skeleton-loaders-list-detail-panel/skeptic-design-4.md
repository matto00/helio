## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold review. I re-derived the plan from `ticket.md` + the real tree at `3d93e82a` before opening any
prior skeptic report, then read rounds 1–3 to check their CRs were genuinely resolved. Every claim
below is from a file I read myself in this worktree.

---

### What I verified (with evidence)

#### 1. Gates — both re-run by me

```
$ openspec validate skeleton-loaders-list-detail-panel --strict
Change 'skeleton-loaders-list-detail-panel' is valid
$ node scripts/check-openspec-hygiene.mjs
openspec/ is clean
```

#### 2. The plan's factual grounding is accurate on every claim I sampled

| Claim | Ground truth |
|---|---|
| `panelsSlice.ts:85-89` `markDashboardPanelsStale` sets `status="idle"` **and** clears `loadedDashboardId` | ✓ exactly, incl. the `loadedDashboardId !== payload` early-return guard |
| `panelsSlice.ts:88` is the frontend's only `status = "idle"` assignment | ✓ `grep -rn 'status = "idle"'` returns that one line |
| `App.tsx:119-121` dispatches `fetchDashboards()` unconditionally; `:123-129` early-returns on `selectedDashboardId === null`, keyed `[dispatch, selectedDashboardId]` | ✓ |
| `fetchPanels.pending` (`:102-106`) does not clear `items` | ✓ |
| `items` is never mixed-dashboard | ✓ only `fetchPanels.fulfilled` / `duplicateDashboard.fulfilled` / `importDashboard.fulfilled` replace it wholesale; `deletePanel.fulfilled` filters; `createPanel`/`duplicatePanel` **refetch** rather than optimistically inserting (`panelThunks.ts:107-108`, `:148-150`); `patchSetsSlice.ts:207-221` marks stale then refetches. `items[0].dashboardId` (`panel.ts:321` `PanelBase.dashboardId`) is a valid representative — **D12's discriminator is sound** |
| `theme.css:240-248` sets only `animation-duration`/`-iteration-count`/`transition-duration` `!important`, never `animation-name` | ✓ — D2's cascade reasoning is correct and `animation: none` is the right mitigation |
| `EmptyState.css:16` `--main` `min-height: 320px`; `DataGrid.css:34-39` `--preview` `max-height: 320px` | ✓ |
| `panelGridConfig` `rowHeight: 52`, `margin: [18,18]`, `itemHeights.default: 5`, `breakpoints.sm: 768` | ✓ (`panelGridConfig.ts:25-41`) |
| Both grids render `resolveDashboardLayout(panels, layout)` (`DesktopPanelGrid.tsx:115`, `MobilePanelStack.tsx:46`); `useLayoutSave.ts:60-62` seeds the persisted baseline with the *resolved* layout and `:76-78` early-returns when equal | ✓ — D10's "saved layouts are usually empty" mechanism holds |
| `usePanelData.ts:240` `isLoading = paginationEntry?.isLoadingMore === true && rows.length === 0` | ✓ |
| `SuspenseFallback.tsx:4-9` documents the HEL-512 indistinguishability invariant; `:10-17` takes no props | ✓ — D6 is well-founded |
| `SidebarBody.tsx:78-101` dispatches only the active section's fetch; `:217` is the only `subtitle:` producer; five `SidebarItemList` call sites (119/148/183/221/299) | ✓ |
| `TypeRegistryPage.tsx:12` selects only `{status, error, errorKind}` | ✓ — task 4.2 is right to add `items` |
| `DESIGN.md:227-248` §6 primitives list closes with "Use these; do not hand-roll equivalents" | ✓ — task 1.2a is correctly placed |

#### 3. Round 3's two CRs are genuinely resolved (checked, not taken on trust)

- **CR1 mechanism:** `PanelList` is no longer in task 2.4a's widen list; 2.4b forbids it; 2.7a states the
  `"loading"`-only composed gate; D11 carries both exceptions; the spec gained the two exception
  scenarios. The chosen gate is **correct on the paths I traced**: cold boot ✓, retry after
  `fetchPanels.rejected` (which empties `items`) ✓, create/duplicate panel keeps content because
  `fetchPanels.pending` fires while the same dashboard's `items` are still present ✓, dashboard switch
  fires the skeleton because `"loading"` is set while stale items remain ✓. I found **no path where
  `fetchPanels` is dispatched but `status !== "loading"`** at render, and **no genuine first load the
  narrower gate now misses**.
- **CR2:** `loading-state-pattern` now bounds the concession to per-row/per-card geometry (height, gap,
  padding, radius, horizontal position, inherited from the resolved wrapper) with count as a documented
  delta and a non-collapse floor; task 7.1 measures exactly that. It is falsifiable and honestly
  bounded. **Resolved.**

#### 4. Where I broke it

Two findings, both new (neither appears in rounds 1–3), both derived from code I read directly and
both re-verified from a second independent path. Details in the Change Requests.

---

### Verdict: REFUTE

**These are substantively NEW findings, not cosmetics, restatements, or preferences.** I am saying that
plainly because the round-4 budget is borrowed: CR1 is a normative `SHALL` and a locked test that
**cannot pass against the current code**, and CR2 is the ticket's own headline rule ("never flash empty
content before the skeleton") going unaddressed on one of the surfaces the ticket enumerates by name.
Neither was reviewable before this round — 6.5c-ii, 6.5c-i and the two new spec scenarios were written
*as* round 3's fix, and CR2's surface was never examined by any round.

Both fixes are small (artifact-text edits plus, for CR2, one task + one scenario). Neither requires
re-architecting anything. The plan is otherwise strong: D6, D8, D10 and D12 I confirm on my own reading,
and its factual grounding is better than most implementations I review.

Everything in "Non-blocking notes" is genuinely non-blocking and should **not** cost a round.

---

### Change Requests

**1. `PanelList`'s `idle`-with-a-dashboard-selected states render *nothing* — not an empty state — so
   `loading-state-pattern`'s new `SHALL`, task 6.5c-ii, and D11's justification all assert behaviour
   the code does not have, and 6.5c-ii cannot pass as written.
   (`specs/loading-state-pattern/spec.md:206-208` + `:224-227`, `tasks.md` 6.5c-ii, `design.md` D11:167-168)**

The spec now says, normatively:

> "The panel list SHALL render its empty state, and NOT a skeleton, in both states where no fetch is
> pending or coming: when no dashboard is selected, and when the selected dashboard's panels have been
> invalidated or emptied without a refetch being scheduled."

and the matching scenario ends "**THEN** the panel list renders its empty state, and no skeleton".
Task 6.5c-ii mirrors it: "the empty state renders and no skeleton does".

The first half of that (`no dashboard selected`) is true — `PanelList.tsx:224-245` renders an
`EmptyState` there. **The second half is false.** In the post-delete terminal state
(`selectedDashboardId = "d1"`, `status = "idle"`, `items = []`) every branch in the component is false:

- `PanelList.tsx:209-223` — `StatusMessage` returns `null` for `idle` (`StatusMessage.tsx:38-39`).
- `PanelList.tsx:224` — requires `selectedDashboardId === null`. False.
- `PanelList.tsx:246` — **requires `status === "succeeded"`**; `markDashboardPanelsStale` has just
  replaced it with `"idle"`. False.
- `PanelList.tsx:258` — requires `items.length > 0`. False.

→ the content area renders **nothing at all**. The state is plainly reachable: `PanelCard.tsx:211` →
`deletePanel` → `panelThunks.ts:135` `markDashboardPanelsStale` (`panelsSlice.ts:85-89`, guard passes
because `loadedDashboardId` was set by `fetchPanels.pending`) → `deletePanel.fulfilled`
(`panelsSlice.ts:130-132`) empties `items`. `deletePanel` has exactly one call site and nothing
refetches after it.

The same hole makes **D11's own justification wrong**: "Accepting one frame of an already-legitimate
empty state is strictly cheaper than a permanently lying loading state" (`design.md:167-168`). On cold
boot the accepted pre-dispatch frame is *after* a dashboard has been auto-selected, so
`selectedDashboardId !== null`, `status === "idle"`, `items === []` — the same three false branches.
What is accepted is one painted frame of **nothing**, which is what the ticket forbids outright ("Never
render nothing during load") and what `DESIGN.md` §7 forbids ("Empty: render `EmptyState` — never render
nothing"). That does not necessarily change the *decision* — one frame of blank is still cheaper than a
permanent skeleton — but the artifacts must stop describing it as something it isn't, because an
executor writing 6.5c-ii will hit a failing assertion with no sanctioned way to resolve it.

Round 3 actually saw this ("Today this path renders a blank grid area (a pre-existing empty-state gap,
HEL-548's territory)") but its *required fix* asked for "the empty state renders" anyway; the planner
transcribed the unachievable half faithfully into a `SHALL` that will be archived into
`openspec/specs/loading-state-pattern/`.

**Required — pick one and make all three artifacts say it:**

- **(a) Accept the gap.** Reword the spec sentence and the "Emptying a dashboard's panels…" scenario,
  and task 6.5c-ii, to assert only that **no skeleton** renders (which *is* satisfiable and is the
  regression round 3 was guarding against). Correct `design.md:167-168` to say the accepted frame is the
  pre-existing blank grid area, and record the missing `EmptyState` as a known §7 empty-state gap owned
  by HEL-548 — explicitly out of this ticket's fence.
- **(b) Close it.** Add a task widening `PanelList.tsx:246`'s gate to cover a selected dashboard at
  `idle` (e.g. `(status === "succeeded" || status === "idle") && items.length === 0 &&
  selectedDashboardId !== null`), keep the spec as written, and record it in Planner Notes as a
  self-approved call with its scope-fence rationale. Note this trades "one frame of blank" for "one
  frame of *No panels yet* before the skeleton", which is a different §7 trade-off — so if you take (b),
  say so deliberately rather than as a side effect.

Either is cheap. What is not acceptable is shipping a `SHALL` and a locked test that ground truth
contradicts.

---

**2. `PanelContent`'s pre-dispatch frame paints resolved-but-empty content *before* the skeleton — the
   exact hazard D11 exists to prevent — on a surface the ticket enumerates by name, and no artifact
   mentions it. (`design.md` Context:16-18 and D11, `tasks.md` 3.2, `specs/loading-state-pattern` R1/R11)**

`design.md`'s Context says `PanelContent`'s `isLoading` is "*already* initial-only" and moves on. True,
but it omits the other half: `isLoading` is also **false before the fetch is dispatched**, so the panel
body paints its renderer with null data for one frame first. Traced through two independent paths:

- `usePanelData.ts:39` reads `paginationEntry` from `state.panels.paginationState[panel.id]` — `{}` on
  first mount, so `undefined`.
- `:240` `isLoading = paginationEntry?.isLoadingMore === true && …` → **false**; `:241-242` `noData`
  requires `paginationEntry != null` → **false**; `data`/`rawRows`/`headers` are all `null` (`:186-187`,
  `:159-173`).
- The fetch is dispatched from the effect at `usePanelData.ts:90-124`, which React runs **after paint**.
- `PanelCard.tsx:70` calls the hook in the same component that renders the body, and `:97-113` passes
  `isLoading` straight through (`tableIsLoading` at `:89-93` *also* requires `paginationEntry != null`,
  so tables have the identical frame).
- `PanelContent.tsx:80` is therefore skipped and `:115-167` falls through to the renderer. For a metric
  panel `MetricRenderer.tsx:42,50` paints **"--" and "No data"**.

So on every dashboard load the sequence is: grid skeleton → real cards showing **"No data"** → body
skeleton → data. That is not merely a blank flash, it is a *misleading* one: a data-availability signal
shown while the fetch has not even started. It is masked for chart/markdown (their `React.lazy` suspends
into `PanelSuspenseFallback`, which task 3.3 turns into the skeleton) and real for metric/table/text/
image/collection/timeline.

The plan spent an entire decision (D11), two spec requirements and four tasks on exactly this hazard for
the list surfaces — including treating `SourcesPage.tsx:77`'s idle frame as serious enough to widen a
gate for. Leaving the panel body silently undiscussed is an internal-consistency gap in the plan, not a
matter of taste, and the final gate's mandatory visual verification on `PanelContent` will surface it.

Crucially, **the discriminator D11 wished it had for `PanelList` already exists here**:
`currentFetchKey !== null && paginationEntry == null` is guaranteed to be followed by a dispatch, because
`usePanelData.ts:99`'s dedupe guard deliberately bypasses when `paginationEntry == null`
(`:95-98`, HEL-242), and `:91-92` early-returns when there is no fetch key at all. It is not re-entrant
the way `PanelList`'s `idle` is, so widening here carries none of CR1's risk.

**Required:** name this state and *decide* it in `design.md` — either
- widen `PanelContent`'s loading condition to cover it (add the clause to task 3.2, plus a scenario under
  `loading-state-pattern`'s "Named surfaces render a skeleton on initial load" or the pre-dispatch-frame
  requirement, and a test under 6.4), or
- state explicitly that the one-frame flash is accepted on panel bodies, with the reason, so the final
  gate judges it against a stated position instead of against the ticket's unqualified rule.

I do not require a specific outcome — I require that the plan not be silent about it. Note that
`PanelDetailModal.tsx:78` uses the same hook and inherits whichever choice is made.

---

### Non-blocking notes

1. **`tasks.md` 4.2 and 2.4a give contradictory gates for the same three pages.** 4.2 says "gating each
   on `status === "loading" && items.length === 0`"; 2.4a says widen those same three (plus
   `DashboardList`) to `(idle || loading) && items.length === 0`. 2.4a's "Widen" wording makes the intent
   clear, but the letter conflicts. One clause in 4.2 ("as widened by 2.4a") removes the ambiguity.

2. **`tasks.md` never says to make the pre-existing sibling branches mutually exclusive with the new
   skeleton branch**, and four call sites will double-render if 2.4a/2.7a are implemented literally:
   `SourcesPage.tsx:77` (`succeeded || idle` → the 331px hero), `PipelinesPage.tsx:66` (`succeeded ||
   idle` → `PipelineEmptyState`), `TypeRegistryPage.tsx:48` (`succeeded || idle` → `TypeRegistryBrowser`),
   `DashboardList.tsx:269` (`status !== "loading"` → the sidebar `EmptyState`), plus `PanelList.tsx:258`
   during a dashboard switch (`items.length > 0` is true with the *previous* dashboard's panels). The
   spec and tests 6.5c/6.5d do force the right outcome ("its empty state is not rendered", "the previous
   dashboard's panels are not rendered"), so this is recoverable — but naming the five conditions in the
   tasks would save the executor a cycle.

3. **Task 1.5's "easing from `--transition-slow`" is still not extractable** (round 3's note 2, unfixed).
   `theme.css:71` is `--transition-slow: 0.28s cubic-bezier(0.3, 0.9, 0.4, 1)` — a *transition shorthand
   fragment*, duration included. Dropping it into an `animation` shorthand's timing-function slot is
   invalid CSS. Either add a separate easing token or name a literal easing keyword and say so.

4. **The fallback card count is still unnamed** (round 3's note 6, unfixed). Tasks 2.6a/2.8 and the spec
   say "a documented fixed count" / "a documented, non-zero number" and never state the number.
   `itemHeights.default: 5` is the card *height* in rows, not a count. Testable as written (`> 0`), but on
   a ticket whose accepted concession *is* the count delta, leaving the number to the executor is a
   design judgement being delegated. Worth naming — and note the most common path is jarring: creating
   the first panel on an empty dashboard takes `items` from `[]` through `loading`, so the gate fires and
   N default-sized placeholders resolve into one real card.

5. **D11's sidebar-exception rationale is still factually wrong** (round 3's note 1, unfixed). I
   re-derived it independently: `SidebarBody.tsx:246-284` early-returns a locked-notice `<section>` for
   `chat` + free tier and never renders a `SidebarItemList` at all, and because `SidebarBody`
   early-returns per section, the only list mounted is the active section's — the one the effect at
   `:78-101` dispatches for. The prescription (call-site flag) is right and future-proof; only the
   sentence is wrong.

6. **`design.md:201` still credits "(e) the bounded phone-stack shift (D11)"** — the phone stack is D10
   (round 3's note 8, unfixed). One-character fix.

7. **Task 3.4 is loose about `SourceDetailPanel`'s Reload path.** `handlePreview` (`:136-141`) does not
   clear `previewRows`, so on a Reload the `DataGrid` is still mounted while `isLoading` is true. "while
   its local `isLoading` is true" would put a skeleton over existing content, contradicting D4;
   "replacing the 'Click Preview…' hint for that window only" implies the opposite. The spec's
   initial-load-only requirement resolves it correctly, so this is wording only.

8. **The non-collapse floor is only defined for `--main`.** `EmptyState.css:56-60`'s `--sidebar` variant
   has no `min-height`, so "the container SHALL NOT collapse below the minimum height its sibling empty
   and error states occupy" has no CSS floor to cite on the five sidebar surfaces. Still empirically
   measurable (render the empty state, measure it), so not a defect — just worth knowing before task 7.1
   goes looking for a token.

9. **Two spec scenarios have no owning task**: `shared-skeleton`'s "No competing shimmer implementation
   exists" (a repo-wide grep, trivially true if only `Skeleton.css` is written) and three of the five
   spinners named in "Short in-place work continues to use the accent border-spinner" (task 6.7 covers
   `TableRenderer` and `PageSuspenseFallback` only; the assistant/refinement-drawer indicators are simply
   untouched). Low risk; noted for completeness.

10. **On the 205-line `design.md` (you asked):** keep it. It does not harm the executor — the growth is
    D11, which is the single most decision-dense part of the plan and the part three reviewers have
    pushed on. If you want a cut, D7 still restates `loading-state-pattern`'s "Short in-place work"
    requirement almost verbatim and could become a one-line pointer.

11. **Environment:** `scripts/concertino/` is partly gitignored, so this worktree carries only the
    tracked subset. I ran `next-report-number.sh` / `persist-evidence.sh` from the main checkout, as
    rounds 2 and 3 did.
