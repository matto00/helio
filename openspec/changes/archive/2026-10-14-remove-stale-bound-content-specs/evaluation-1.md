## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `522c90a0d0005f666bfb0a46671c2b60fd2c94ab` against live-resolved base `273c0b0c9c884a17210f58db811a3bb02718415d` (origin/main).

### Phase 1: Spec Review — FAIL

Ticket items 1, 2, 3, 4 and 5 are all addressed. The deltas pass `openspec validate --strict` and use the right REMOVED+ADDED / MODIFIED shape. The scope is correct: this is a Low ticket, and the follow-up non-goals are recorded. Tasks are all marked done and match the diff. No API, schema or user-visible change.

Constraint C1 (binding) is not fully honored:

1. **False claim introduced in the `panel-content-sizing` delta.** `specs/panel-content-sizing/spec.md`, scenario "Text panel sparseness at default height", says a single short line is "about 21px (`var(--text-sm)` at the inherited `line-height: 1.5`)". In the running app this is false:
   - `frontend/src/theme/theme.css:345-355` sets `body { line-height: 1.5 }`.
   - `theme.css:357-363` then sets `body, button, input, textarea, select { font: inherit; }`. The `font` shorthand resets `line-height`, so `body` inherits `normal` from `html`.
   - Live measurement on the dev server (CSSOM walk plus computed style): every ancestor of `.panel-content__text-live` has computed `line-height: normal`. A one-line `var(--text-sm)` span is **18px**, not 21px.
   - So the old claim ("< 20px") was true, and the "correction" made it false. That is the opposite of C1 ("corrected to match ground truth, never the reverse").
   - The executor's evidence for this (`evidence.md` §1.4) is a grep of `theme.css:350` with no cascade check. It is evidence-shaped but does not prove the claim.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1466/evidence/.concertino/eval-HEL-1466-c1-lineheight.txt` and `/home/matt/Development/helio/.concertino/runs/HEL-1466/evidence/.concertino/eval-HEL-1466-c1-text-panel.png`.
2. **Recorded probe output contradicts its own caption.** In `evidence.md` §1.3, the caption "Both strings also appear verbatim in the delta:" is followed by the output `0` / `0`. The quotes are in fact verbatim. The delta hard-wraps both quoted strings across lines, and the line-based `grep -cF` cannot see them. I confirmed both match (1/1) after joining lines and collapsing whitespace. As written, though, the evidence record shows the claim failing. The same block also ends in a stray `85- */` fragment.
3. **Some claims have no recorded output.** In `evidence.md` §1.4, the delta's compact `var(--text-xs)` and spacious `var(--text-lg)` claims for `.panel-content__text-live` have no recorded output. Those rules are at `PanelContent.css:381-393`. The `text-xs` lines that are recorded (175/213/242/250) belong to other selectors. `overflow-y: auto` (`PanelContent.css:80`) and `white-space: pre-wrap` (`:260`) are asserted as "all verified" with no output. I checked the values myself and they are correct, but C1 requires the command and output in `evidence.md`.

Applying C1 to the font-size, radius and sparseness values: the decision to correct values was correct and in scope. The requirement is REMOVED and re-ADDED. Re-adding it with values known to be false would itself breach C1, and the correction is disclosed in the REMOVED Migration text. Results of my independent check:
- Font sizes are correct: `var(--text-xs|sm|lg)` = 0.75/0.875/1.125rem (`theme.css:29,30,32`; `PanelContent.css:258,383,391`). I measured 18px live at spacious height.
- Skeleton radius is correct: `var(--app-radius-sm)` = 6px (`theme.css:64`, `PanelContent.css:146`). I measured 6px live.
- Padding 12px 16px (`PanelContent.css:6`) and gap 8px (`:100`) are correct.
- Only the sparseness line-height/21px value is wrong (item 1).

### Phase 2: Code Review — PASS

I ran every gate myself in WORKTREE_PATH, all exit 0:
- `npm run lint`, `npm run format:check`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`.
- `HELIO_JEST_MAX_WORKERS=3 nice -n 19 npm test`: 51/51 root suites (469 tests) and 596/596 frontend suites (7131 tests).
- Backend, targeted per run constraints: `sbt testOnly PanelContentOwnershipSpec DashboardApplyProposalConfigSpec DashboardApplyProposalSpec` gave 16 succeeded, 0 failed.
- `check:scala-quality`, `check:spec-structure`, `check:openspec`, `check:schemas`, `check:tokens`, `check:test-temp-dir-hygiene`, and `openspec validate remove-stale-bound-content-specs --type change --strict`.

Code changes:
- `TextRenderer.tsx`: the dead `data` prop and import are removed, and the read is `content ?? null`.
- `PanelContent.tsx:237`: the call site is updated.
- The dead-path proof holds: `usePanelData` returns `data: null` on both paths.
- The guard test (`PanelContent.test.tsx`, LITERAL vs BOUND) passes a non-null `data` through `PanelContent`, so restoring the bound read would turn it red. The red run is recorded.
- The old bound-path tests were deleted, not rewritten.
- The new backend `PanelContentOwnershipSpec` is a meaningful route-level guard for the markdown-panel claims.
- The CLAUDE.md change is limited to the single-file command and is backed by a real root-vs-prefix run.

No mechanical CONTRIBUTING violations found. Minor: `PanelContentOwnershipSpec.scala:36-37` has a double blank line (non-blocking).

### Phase 3: UI Review — PASS

Triggered by `frontend/**`. Servers were started with `start-servers.sh`, the `assert-phase` check passed, and they were stopped with `stop-servers.sh`.
- I created a dashboard with one text panel with literal content and one with empty config (logged in as matt@helio.dev).
- The literal panel renders `config.content` with pre-wrap line breaks.
- The empty panel renders the skeleton (10px tall, 6px radius, aria-hidden).
- No console errors.
- The test dashboard was deleted afterwards (204).

No user-visible change, as expected. I did not run the breakpoint sweep: the CSS and markup are unchanged apart from removing a dead prop.

### Overall: FAIL

### Change Requests
1. `openspec/changes/remove-stale-bound-content-specs/specs/panel-content-sizing/spec.md`, scenario "Text panel sparseness at default height": replace "one line of about 21px (`var(--text-sm)` at the inherited `line-height: 1.5`)" with the measured ground truth. A single line at `var(--text-sm)` (14px) is about 18px, because `.panel-content__text-live` resolves `line-height: normal`. The cause is that `theme.css:357-363`'s `body { font: inherit }` resets `body`'s `line-height: 1.5`. Fix the REMOVED block's Migration text to match: drop "one 21px line". In `evidence.md` §1.4, record a probe that shows the computed line-height and height, e.g. a jsdom-independent CSSOM/computed-style measurement on the dev server, or quote `theme.css:345-363` showing the override. Do not change `theme.css`; that is out of scope.
2. In `evidence.md` §1.3, replace the `0` / `0` "verbatim in the delta" output with a probe that handles the hard wrap, so the recorded output actually supports the claim. For example: `tr '\n' ' ' < specs/panel-cross-filtering/spec.md | tr -s ' ' | grep -cF "<quoted string>"` gives 1 for each string. Remove the stray `85- */` line at the end of that block.
3. In `evidence.md` §1.4, add the recorded output for the remaining delta claims. For example, `grep -n -B2 -A2 'text-live' frontend/src/features/panels/ui/PanelContent.css` shows lines 257-261 (`--text-sm`, `pre-wrap`), 381-385 (compact `max-height: 179px` → `--text-xs`) and 389-393 (spacious `min-height: 280px` → `--text-lg`), plus `PanelContent.css:77-80` for `overflow-y: auto`.

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/api/routes/panels/PanelContentOwnershipSpec.scala:36-37`: collapse the double blank line.
- The pre-existing `body { font: inherit }` override that silently cancels `body { line-height: 1.5; font-size: var(--text-sm) }` (computed body font-size is 16px, not 14px) looks like a real, unintended app-wide typography defect. Raise it as a follow-up ticket rather than fixing it here.
