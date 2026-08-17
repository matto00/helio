## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/frontend-code-splitting/spec.md` fresh, in full, plus round 1's
  `skeptic-design-1.md` (treated as a claim, re-verified below, not trusted).
- Confirmed `git status` is clean and this worktree's `HEAD` (`6ba9988b`) equals
  `git merge-base main HEAD` — no code has been touched yet, this is still a pure
  planning-artifact revision.
- Re-read the actual current source of every file Decision 1 now names:
  - `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — named export
    `ChartRenderer`; top-level `import { ChartPanel } from "../ChartPanel";` (line 3) —
    exactly what Decision 1 says gets replaced with a `React.lazy` call.
  - `frontend/src/features/panels/ui/renderers/MarkdownRenderer.tsx` — named export
    `MarkdownRenderer`; top-level `import { MarkdownPanel as MarkdownPanelView } from
    "../MarkdownPanel";` — same shape (named export, module-scope import of a named
    inner component), modulo the local alias Decision 1's prose doesn't mention (see
    non-blocking notes).
  - `frontend/src/features/panels/ui/ChartPanel.tsx` — named export, no default;
    imports `echarts` only as a type (`import type { EChartsOption } from "echarts"`,
    erased at compile time) plus `echarts-for-react/esm/core` and the real dependency,
    `./echartsCore` (a dedicated module that does `import * as echarts from
    "echarts/core"` + selective `.use()` registration of only bar/line/pie/scatter +
    grid/legend/tooltip/canvas-renderer). Confirms Decision 1's "the actual heavy
    imports live one level deeper than the renderer files" claim.
  - `frontend/src/features/panels/ui/MarkdownPanel.tsx` — named export; top-level
    `import ReactMarkdown from "react-markdown"; import remarkGfm from "remark-gfm";` —
    confirms this, not `MarkdownRenderer.tsx`, is where the heavy dependency actually
    lives.
  - `frontend/src/features/panels/ui/PanelContent.tsx` — still imports `ChartRenderer`/
    `MarkdownRenderer` via unchanged named imports (`import { ChartRenderer } from
    "./renderers/ChartRenderer"`, line 16; `import { MarkdownRenderer } from
    "./renderers/MarkdownRenderer"`, line 20) and renders them synchronously — confirms
    Decision 1's "`PanelContent.tsx`'s import of it are unchanged" claim now holds,
    because the lazy boundary Decision 1 describes is *inside* the renderer files, not
    on their own export.
- Confirmed no stale "convert the renderer's default export" / "rather than
  lazy-loading `ChartPanel`/`MarkdownPanel` directly" framing remains anywhere in
  `design.md`/`proposal.md`/`tasks.md` (`grep -n "default export\|rather than
  lazy-loading"` — only hit is the correct, intentional explanation of why the
  `.then(m => ({ default: m.X }))` adapter is needed for `ChartPanel`/`MarkdownPanel`'s
  named exports).
- Confirmed `design.md` Decision 1, `proposal.md`'s Impact section ("inner components
  become lazy imports, wrapped in `Suspense`"), and `tasks.md` Tasks 3.1/4.1 ("Convert
  `ChartRenderer.tsx`'s/`MarkdownRenderer.tsx`'s inner chart/markdown component to a
  `React.lazy(...)` target") now describe the same, single, technically-coherent
  approach — round 1's two blocking change requests are resolved.
- Re-checked `frontend/vite.config.ts`'s HEL-553 comment verbatim — still matches
  design.md's Context section (~2.04 MiB main chunk, 4 MiB `maximumFileSizeToCacheInBytes`,
  code-splitting flagged as the deferred fix).
- Re-checked `shared/ui/index.ts` (still the only `index.ts*` in the tree, still only
  lightweight primitives) and `Spinner.tsx`/`PanelContent.tsx`'s existing loading-state
  markup (`<div aria-label="Loading data"><Spinner size="xl" /><span>Loading...</span></div>`,
  `Spinner` itself always `aria-hidden`) against Decision 3's fallback description —
  holds up; the accessible label lives on the wrapper, matching `Spinner`'s own
  documented contract, not misdescribed as living on the `Spinner` itself.
- Re-checked `AppRoutes.tsx` route table fresh (not trusting round 1's or this round's
  cited numbers): **17** `<Route path=...>` entries, **16** unique page components
  (`TypeRegistryPage` reused at `/registry` and `/registry/:id`) — includes
  `PatchSetReviewPage` at `/patch-sets/review`, which is present in the file today.
  `proposal.md`'s "Why" section now says "15 routed page components" and `design.md`'s
  Context says "15 unique routed page components (16 routed paths)" — both are off by
  one from the current file (see non-blocking note below; same non-blocking category as
  round 1's original nit #3, not a new blocker).
- Confirmed no `TODO`/`TBD`/hand-waving language was introduced anywhere in the four
  artifacts (`grep -i "TODO\|TBD\|figure out\|placeholder"` — no hits).
- Re-traced all four of `ticket.md`'s acceptance criteria against `tasks.md`: AC1
  (bundle report + heavy deps out of entry chunk) → Tasks 1.1–1.3, 7.1, 3.1, 4.1; AC2
  (measurable reduction, functionality unchanged) → Task 7.1, 8.3/8.4; AC3 (on-demand
  load, graceful fallback, no console errors) → Tasks 2.1, 3.1, 4.1, 5.1, 8.3; AC4 (lint/
  tests pass, no new eager heavy imports) → Tasks 6.1, 6.2, 8.4. All four trace cleanly;
  no AC is left uncovered and no task is scope drift beyond the ticket.

### Verdict: CONFIRM

Both of round 1's blocking change requests are genuinely resolved, verified against
the real code (not just re-reading the requested words back). `design.md`'s Decision 1
now describes the only technically-coherent version of the chart/markdown lazy
boundary, and it is now word-for-word consistent with `proposal.md`'s Impact section
and `tasks.md` Tasks 3.1/4.1. Nothing else in the design regressed.

### Non-blocking notes

1. **Routed-page count is still off by one, a second time.** Ground truth today is
   **16** unique routed page components / **17** `<Route path=...>` entries (the
   revision matched round 1's *reported* "15/16" rather than re-deriving from the
   current file, and the file has since gained `PatchSetReviewPage` at
   `/patch-sets/review`). Affects `proposal.md`'s "Why" section ("15 routed page
   components" → 16) and `design.md`'s Context ("15 unique... 16 routed paths" → 16
   unique... 17 routed paths). Doesn't change the technical plan (`ProposalReviewPage`
   is the only route in scope either way), but worth a final `grep -c "<Route path"
   frontend/src/app/AppRoutes.tsx` immediately before this change lands, since it's now
   missed the target twice.
2. **`design.md`'s Non-Goals arithmetic doesn't reconcile with its own Context section.**
   Non-Goals says "the other 11 pages are smaller and not flagged in scope," but
   Context (two paragraphs earlier) says there are "15 unique routed page components"
   total — 15 minus `ProposalReviewPage` is 14, not 11, under any reading of the current
   route table. Recommend dropping the specific "11" count or recomputing it once the
   routed-page count above is corrected, so the two sections agree.
3. **`tasks.md` Task 3.2** ("Verify `PanelContent.tsx`, `PanelCard.tsx`,
   `PanelDetailModal.tsx`, and `MobilePanelStack.tsx` require no changes beyond the
   renderer's own export shape") reads, on a literal parse, as if the renderer's own
   export shape *does* change — which now contradicts Decision 1's explicit "the
   renderer's own signature, export shape... are all unchanged." `design.md` is
   unambiguous and governs, so this isn't implementation-blocking, but tightening the
   task wording (e.g. "require no changes at all") would remove the residual echo of
   the pre-revision design.
