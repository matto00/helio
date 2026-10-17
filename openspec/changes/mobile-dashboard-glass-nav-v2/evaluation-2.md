## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed: `d9ab82edd696f9c171632c477cc7d236ef42d91b`. Review base, resolved fresh: `60086f02bb5b1ee48f2246bc09e3e66349199585`.
Scope: Phase A only, as in cycle 1. Phase B and AC3 are blocked on the pending owner escalation (C4) and were not
judged. Task 2.3, the full e2e suite, is deferred to the final head.

Evidence persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/openspec/changes/mobile-dashboard-glass-nav-v2/evidence/`:
`eval2-probe.log`, `eval2-mutation.log`, `eval2-375-{light,dark}-shortchip.png`, `eval2-375-light.png`,
`eval2-768-dark.png`, `eval2-375-dark-bottom.png`.

### Gate runs (this evaluator, this worktree)
- `npm run lint` passed (exit 0) and `npm run format:check` passed (exit 0).
- `npm test` passed (exit 0). Root: 51 suites, 469 tests. Frontend: 615 suites, 7294 tests (+2 new CSS pins).
  A targeted `DashboardChipRow` run from `.../HEL-1583/frontend` passed 14 tests.
- `npm --prefix frontend run build` passed (exit 0).
- e2e on `DEV_PORT=7015` with 2 workers passed 164 of 164 in 9.3 minutes, with no failures and no flakes. 164
  throwaway users were deleted afterwards. The specs run were:
  - the new spec: hel1583
  - the touch-target, layout and remount specs: hel813 (both the spec and its regression), hel1023, hel1028, hel1065,
    hel1277, hel1392 (×2)
  - the chart specs: hel1305, hel1306, hel1307, hel1311, hel1351, hel1398, hel1444, hel1508, hel1512
  - the shell, delete-confirm and navigation specs: hel1574, hel1605, hel773, hel909, hel912

  This is the subset the orchestrator asked me to re-run on this head.

### Phase 1: Spec Review — PASS
- **CR1** (44px-wide floor for chips): fixed. `DashboardChipRow.css` adds `min-width: 44px`. Measured on the rendered
  "Q" chip with the spec's own `elementFromPoint` routine, the hit area is 44 × 44 in both themes and the painted
  width is 44px.
- **CR4** and the cycle-1 spec-wording note: `specs/mobile-viewer-stack/spec.md` now says that only markdown and
  plain-text bodies drop their inset, and that the markdown body's box ends no more than 28px from the right edge.
  This matches the implementation (box right gap 27px) and the e2e assertion.
- AC1, AC2 and AC4 still hold on this head. I re-ran the full probe at 320/375/390/430/768 in light and dark, after
  `document.fonts.ready`:
  - **Markdown/text panels:** the text starts 27px from the edge, cards sit 12px from each edge, and the gaps are 10px.
    The stack renders (not the desktop grid) at every width.
  - **Overlays and clearance:** there is no zoom widget and no horizontal overflow. The only fixed element on screen is
    `.bottom-nav`. The last card's bottom is at 712px and the nav's top is at 732px.
  - **Chips:** the chip A → sheet C → chip A sequence switches back with one tap. Chip order stays the same, and Enter
    activates a chip. The chip row is absent at 769px, on desktop and on `/sources`. It is present on `/home`, which is
    the dashboard view on this base.
- CONSTRAINTS C1–C4 are honoured. Guard pins were recounted or extended, never loosened, and no Phase B work was done.

### Phase 2: Code Review — PASS
- **CR2:** `height: var(--control-md)`, pinned by a test. The rendered height is still 32px.
- **CR3:** the transition now uses `var(--motion-duration-quick) var(--motion-ease-standard)` on all three
  properties. It renders as 0.16s, so behaviour is unchanged. A test now pins that `--app-transition` is absent.
- **The new short-name check can fail.** I verified this with a mutation rather than trusting it. There was no source
  edit: I injected `.dashboard-chip{min-width:0 !important}` at runtime and ran the e2e's exact bisection routine.
  The width measured 38 (painted 37), so the `>= 43` assertion fails, in both themes. Without the injection it
  measures 44 and passes (`eval2-mutation.log`). The CSS pin is a static regex on `min-width: 44px` and would fail
  if the rule were removed.
- The e2e also adds a poll that asserts the active chip ends up inside the row after a tap. This is order-independent,
  so it addresses cycle 1's suggestion about relying on fixture order.
- No new issues. The literal `min-width: 44px` is the tap-target floor value and follows the `tapTarget.css`
  convention.

### Phase 3: UI Review — PASS
- Every check from cycle 1 still holds on this head (see Phase 1). The chip hit areas are now at least 44px in both
  directions. Visible chips pass the vertical 44px probe, and there is an 8px gap between neighbouring chips.
- The one-letter chip renders as a centred 44px pill in both themes (`eval2-375-{light,dark}-shortchip.png`).
  Subjective visual calls are left to the skeptic.
- Console: the only errors were 429s from my own probe's seeding and deleting under the shared rate limit. Those
  dashboards were deleted on retry, and none were left behind. No application errors.

### Overall: PASS

### Non-blocking Suggestions
- `PanelList.tsx` is 508 lines, past CONTRIBUTING.md's ~400-line threshold. Note a split proposal in the PR description.
- Task 2.3: run the full e2e suite on the final head after Phase B, as planned.
