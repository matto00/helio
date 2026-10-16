## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 67c434c6b01f9b91681870488975be5ca370c896. The change dir is untracked: ticket.md, proposal.md, design.md, tasks.md and workflow-state.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.
- **The helper is row-scoped (design Context bullet 1): TRUE.** `e2e/support/webFonts.ts` `readFontState` does `const row = button.closest("tr")`, and `settled` requires `row !== null`. A non-row target therefore never settles. Its only caller is `settledRowTop` (`e2e/support/rowDeleteGesture.ts:26`), which is used by hel1605 and the rowDeleteGesture helpers. D4's `closest("tr") ?? target` is backward compatible for every current caller, because each one passes a button that sits inside a `<tr>`.
- **hel1510 description: TRUE.** The spec computes `contentRight(card) + 0.5`, loops `getBoundingClientRect().right` over 13 or more controls, then checks the modal body's `scrollWidth <= clientWidth`. It has no font wait.
- **hel813 surface 7 is at :298: TRUE.** The test runs three measurement steps in one navigation: the empty-state CTA, the "Add connector" dialog controls (`assertExpanderFloor`), and then the list-row actions after a connector is created.
- **`.regression.spec.ts` is excluded: TRUE.** It is listed in `playwright.config.ts` `testIgnore`. `retries: 0` is at :139.
- **HEL-1606's forced-delay method: TRUE.** `evidence/scratch-specs/zzrepro-hel1606.spec.ts.txt` uses `page.route(/fonts\.gstatic\.com/)` with `FONT_DELAY_MS`, and the PR #1037 body also cites a 4 s `fonts.googleapis.com` stylesheet delay. The original hel1510 and hel813 failure messages are not recorded anywhere I found: not in the archive *.md files, and not in the PR body, which says only "`hel813` Connectors 768, then `hel1510` 0.1px overflow". The probe therefore has no failing assertion text to match. D1 handles this correctly by measuring rather than assuming.
- **Sweep count: about right.** I re-ran the design's pattern (`boundingBox|getBoundingClientRect|scrollWidth|clientWidth|offsetWidth|overflow|toHaveScreenshot`). It hits 35 `e2e/*.spec.ts` files (the design says 34; the regression spec is probably the difference) and 4 support files (`focusPresenceProbe.ts`, `webFonts.ts`, `touchTargetProbe.ts`, `rowDeleteGesture.ts`). The design already says the executor re-runs and records the sweep, so this is not blocking.
- **Fonts on the Connectors surface.** `frontend/app.html:32` loads three families: Fraunces, Schibsted Grotesk, and JetBrains Mono at 400/500/600 plus italic. `frontend/src/features/connectors/ui/ConnectorsPage.css:110-111` (`.connectors-page__td--mono`) and `:230-231` (`.connectors-page__credential-mask`) set `font-family: var(--font-mono)`. These are list-row cells, and they render only after the connector is created, in the same navigation as surface 7's first sweep. This is the basis for CR1.
- **AC coverage.** AC1 maps to task 1.1 and D1. AC2 to 1.2 and D2. AC3 to 1.3, 2.1–2.3, D3 and D5. AC4 to C1. AC5 to 3.1 and D6. The tension between AC3's "can affect the measurement" and D3's "convert iff red under the delay" is resolved acceptably: AC3 itself requires every converted spec to be shown red, so a spec that cannot go red cannot satisfy it. Recording such specs in the sweep with their measured values is the right handling.
- **No placeholders.** The artifacts contain no TODO or TBD and defer no decisions. No API or schema is touched, and `skip_specs` is appropriate.

### Verdict: REFUTE

### Change Requests

1. **D4's "the wait runs once per navigation" is wrong for multi-step measurement specs, and the ticket's own hel813 surface 7 is one (design.md D4, last sentence).** `waitForWebFonts` only guarantees the faces needed by the text present when it is called. Text rendered later in the same navigation can request faces that were never fetched, and those swap after the wait has returned:
   - a different family (JetBrains Mono in `.connectors-page__td--mono`, ConnectorsPage.css:110);
   - a different weight or style;
   - a new unicode-range subset.

   In surface 7 the list row is created and measured after the CTA and the dialog, without a navigation. A wait placed once, before the CTA sweep, therefore leaves the list-row sweep exposed to exactly the swap this ticket targets. Under a forced gstatic delay, the new mono request would be held again.

   Revise D4 (and task 2.2) to: **wait before each measurement step whose measured scope contains newly rendered text (a newly opened dialog, a newly inserted row/card), scoped to that step's element; never inside a retry/poll of the assertion.** Also fix the helper's doc comment ("once per navigation") so it matches. For each multi-step converted spec, the red/green proof (D5) must cover every step that got a wait, not just the first one.

2. **D1's REFUTED bar asks for a "mid-swap measurement" but gives no deterministic way to produce one.** As written, a REFUTED verdict needs the assertion to hold "under fallback-face and mid-swap measurement", using a delay "tuned so the swap lands inside the measurement window". For hel1510 that window is about 13 sequential `evaluate` round trips, so a time-tuned delay is itself flaky. A competent executor could run only a long delay, which measures entirely in the fallback face, and call the spec REFUTED.

   Specify the mechanism. Recommended: a **gated route**. Hold the `fonts.gstatic.com` responses on a promise that the scratch spec releases at a chosen point. For hel1510 that point is after `limit` is computed and before the controls loop. For hel813 it is between the CTA sweep and the dialog sweep, and between the dialog sweep and the row sweep. Then wait for the swap and continue measuring.

   Also hold one family at a time, for example by routing only the JetBrains Mono or only the Schibsted Grotesk face URLs, so that partial (mixed-family) states are covered. If the executor judges a state unreachable, D1 should require the report to say which states were exercised, rather than implying full coverage.

### Non-blocking notes

- The sweep pattern should be widened to catch geometry checks that the first pass misses: `toBeInViewport` (for example `e2e/hel1331-history-payloads-toggle.spec.ts:178`), `scrollHeight|clientHeight|offsetHeight|offsetTop|elementFromPoint|scrollTop`. Most will classify as N/A or position-only, but the recorded command should show they were considered.
- On the D4 timeout message: with `?? target`, a body-scoped wait walks every element under `<body>` on each 50 ms poll. That is fine at this app's DOM size. If a body scope is ever used, prefer the narrowest measured container, both for speed and for a clearer error state.
- hel813's dialog step already relies on a fixed `waitForTimeout(400)` to get past the entrance animation. The font wait does not replace it and should not be confused with it. Keep both, ordered as: visible, then the 400 ms animation settle, then the font wait for the dialog scope, then measure.
