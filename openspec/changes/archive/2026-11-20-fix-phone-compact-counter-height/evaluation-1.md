## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 5175f1a99e07fa3c66a22e081add429d648ffe23 (commits 2713623b4 red spec, 5175f1a99 fix) against base
3b9f4c83d (resolved live by resolve-review-base.sh).

Evidence root (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1791/evidence/.concertino/scratch/HEL-1791/eval/`
(`probe.cjs`, `probe-results.json`, `counter-*-{fixed,base}.png`, `full-editor-light-1100-fixed.png`).

### Phase 1: Spec Review — PASS
- AC1 (390 px, value, both buttons and the non-owner caption with no inner scroll, light and dark): met. Measured
  independently (below). The caption renders for the editor in both themes and is fully inside the card: light
  `rgb(100, 94, 86)`, dark `rgb(170, 164, 156)`, visible, opacity 1. It is absent for the owner.
- AC2 (768 px, and 1100 px with the sidebar open): met. At 1100 a fresh user has the sidebar open
  (`aside[Dashboards list]` 248 px wide, see `full-editor-light-1100-fixed.png`), and the single-column stack renders.
- AC3 (other kinds keep their height): met. I measured this myself and did not rely on the executor's JSON (method
  below).
- AC4 (a test that fails first): met. 2713623b4 commits the spec and the recorded red run before the CSS fix. My base
  measurement agrees with the red run: body scrollHeight 56 against clientHeight 24, so the spec's no-inner-scroll
  assertion would fail.
- Tasks are all ticked and match the diff. No scope creep: the diff is 2 CSS rules, 1 jest guard, 1 e2e spec and the
  change artifacts. No HEL-1649 or HEL-1697 files are touched. The spec delta adds the `form` entry to the per-kind
  policy, which matches what was built.
- CONSTRAINTS C1–C14 were honoured: the red run was committed first, the mutation is recorded, the lane DB was used,
  and evidence is in the evidence dir.

### Phase 2: Code Review — PASS
I ran each gate myself in WORKTREE_PATH:
- `npm run lint`: clean (zero warnings).
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test` (3 workers): root 71 of 71 suites and 621 tests passed; frontend 891 of 891 suites and 10429 tests passed.
- `npm --prefix frontend run build`: succeeded.
- e2e (2 workers, lane DB, own servers on 7223/10130): `hel1791-compact-counter-stack-height.spec.ts` and
  `hel1088-compact-counter-chrome.spec.ts` gave 6 of 6 passed. The global teardown deleted the 4 throwaway users.

Code:
- The fix adds the `--form` selector to the existing two-class intrinsic-height rule (same pattern as its siblings). It
  also adds one rule scoped to the stack, `.mobile-panel-stack__item--form .panel-content--form { height: auto;
  overflow-y: visible }`. Both rules only match form cards inside the stack, so the desktop grid and the shared
  `PanelContent.css`/`Crossfade.css` are unchanged. The fix is minimal, matches the root cause, and uses no tokens or
  magic values.
- The jest guard adds `form` to the intrinsic kinds and asserts the body override.
- The e2e spec uses the shared helpers (`registerUser`, `evidencePath`, `LIVE_STACK_ITEMS`). Its geometry assertions
  do not hardcode padding.

### Phase 3: UI Review — PASS
Independent probe (`probe.cjs`, an isolated Chromium; the shared MCP browser was reset by a sibling lane, so I did not
use it):
- Seed: owner plus an editor grantee, one dashboard with 8 cards (chart Output, table Output, text, markdown, image,
  divider, multi-field form, compact counter).
- For each role (owner, editor), theme (light, dark) and width (390, 768, 1100 with the sidebar open), the probe
  measured every card on the live fixed CSS.
- It then removed exactly the fix's two CSS changes from the live CSSOM: it dropped the `--form` selector from the
  grouped rule and deleted the form-body rule. That reproduces the base CSS, and the probe measured again.

Results (`probe-results.json`):

| Width | Counter card, base → fixed (owner / editor) | Multi-field form, base → fixed |
| ----- | ------------------------------------------- | ------------------------------ |
| 390   | 30 → 211.2 / 226.2                          | 30 → 270.2                     |
| 768   | 30 → 211.2 / 226.2                          | 30 → 270.2                     |
| 1100  | 42 → 223.2 / 238.2                          | 42 → 282.2                     |

- The counter card's `container-type` went from `size` to `inline-size`.
- The form body went from scrollHeight 56 / clientHeight 24 (`overflow-y: auto`) to equal heights (151 owner, 166
  editor) with `overflow-y: visible`.
- Both step buttons are inside the card in all 12 combinations. The value is shown (screenshots, and the spec's
  spinbutton assertion).
- Every non-form card changed by 0 px at every width, role and theme. That covers the chart Output (166/166/178), the
  table Output (235 at 1100), text, markdown, image and divider.
- There were 0 console errors and 0 page errors in all 12 page loads.
- Screenshots: `counter-editor-dark-390-base.png` shows the title-only sliver; `counter-editor-dark-390-fixed.png`
  and `counter-editor-light-1100-fixed.png` show the value, −/+ and the caption.
- Accessible names and keyboard support are unchanged; the hel1088 spec passes.
- I did not resize to 1440, because both new selectors require `.mobile-panel-stack__item`, so the desktop grid cannot
  match them.

Cleanup: the probe's dashboard, pipeline and 3 sources were deleted over the API. I confirmed 0 rows left. The 2 probe
users were deleted by exact id with `buildUserDeleteSql` on `helio_hel1791`, and I confirmed 0 left. Servers were
stopped with `stop-servers.sh`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The per-kind height test in `e2e/hel1791-compact-counter-stack-height.spec.ts` only records heights and asserts that
  7 cards were measured. AC3 rests on the recorded JSON, not on an assertion. A follow-up could assert the non-form
  heights against fixed bands, or against each other across widths, so the spec guards AC3 on its own.
- The spec's `afterAll` deletes the dashboard and sources but not the pipeline. Today the run's user-teardown cascade
  removes it. Deleting it explicitly would match the other seeded resources.
- For the skeptic, a visual-judgment point that I am not ruling on: the compact counter card keeps roughly 50 px of
  empty space below the caption in the stack (see the 1100 screenshot).
