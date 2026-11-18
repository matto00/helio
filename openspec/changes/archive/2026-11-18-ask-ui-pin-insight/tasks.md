## Standing Constraints

- [C1] Fake only the /ask response at the browser seam (page.route); pin POST and everything after it run against the real backend. A backend contract spec validates the REAL /ask 200 (pin null and pin set), 422 ASK_UNGROUNDED and 403 TIER_FORBIDDEN against the same schemas the e2e fixture is validated against, red first. State the seam in the PR.
- [C2] Jest stubs CSS (jest.config.cjs moduleNameMapper), so no jsdom test may be offered as proof of a CSS/layout behaviour: guard CSS with a CSS-text test (Modal.css.test.ts pattern) plus a recorded mutation, and prove rendered geometry (e.g. phone sheet width == viewport width) in a real-browser e2e run.

## Lane rules (driver, binding)

- R1 Never read, cat, grep, source or print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). scripts/concertino/.concertino.env may be read by scripts, never printed.
- R2 Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- R3 No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh. DB residue removed only by exact id with the guarded buildUserDeleteSql.
- R4 jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- R5 timeout 600000 on long calls; use sbt testFull (sbt can print TESTS FAILED and exit 0 -- read the output).
- R6 Red first with recorded red runs; every guard has a mutation recorded in mutations.md.
- R7 Scratch in .concertino/scratch/HEL-1746/ only. Throwaway e2e emails are plain addresses.
- R8 Check the Playwright page URL and port are this lane's (DEV_PORT 7178, BACKEND_PORT 10085) before trusting a screenshot.
- R9 No live model call, no Flyway migration, no production backend code change, no model picker, no billing-weight copy.

## 1. Wire seam (red first)

- [x] 1.1 Add `backend/src/test/scala/com/helio/api/protocols/AskSeamSpec.scala` (new file; do not edit AskRoutesSpec) driving the real ask routes through `AskApiHarness` for: 200 with pin (owner), 200 with `pin: null` (viewer grantee), 422 ASK_UNGROUNDED, 422 ASK_ANSWER_TRUNCATED (ScriptedTransport stopReasons max_tokens), 403 TIER_FORBIDDEN, and 429 CHAT_LIMIT_REACHED if the harness can set the beta cap (else record the gap in red-evidence.md and the PR). Normalise generated ids to placeholders; assert equality with `shared-test-fixtures/ask/*.json` and schema validity. Run it and record the RED run (missing fixtures/schemas) in red-evidence.md.
- [x] 1.2 Add `schemas/ask/ask-ungrounded-response.schema.json` (title AskUngroundedResponse), `schemas/ask/ask-truncated-response.schema.json` (title AskTruncatedResponse) and `schemas/ask/ask-tier-error-response.schema.json` (title TierErrorResponse); `npm run check:schemas` passes.
- [x] 1.3 Generate fixtures with `HEL1746_WRITE_FIXTURE=1`, review them by eye, commit; seam spec green. Mutation: alter one fixture field and confirm the spec fails naming it.
- [x] 1.4 Frontend `features/ask/services/ask.contract.test.ts`: Ajv-2020-validate every fixture against its schema and run each through `parseAskError` / the response types; negative case per error kind.

## 2. Ask module

- [x] 2.1 `features/ask/types/ask.ts`, `services/askService.ts` (askDashboard, askOutput, pinInsight) with unit tests (red first).
- [x] 2.2 `parseAskError.ts` mapping status + `code` only (never message text); tests for 403/429(limit present, absent)/422 ASK_ANSWER_TRUNCATED -> truncated/422 ASK_UNGROUNDED and unknown 422 code -> ungrounded/503/500/400/network.
- [x] 2.3 `useAsk(scope)` hook: idle/pending/answered/error lifecycle, retry re-sends the same question, a stale response after a newer ask is dropped; tests.
- [x] 2.4 `AskQuestionForm`, `AskAnswerCard`, `AskPanel`: answer through `InsightMarkdown` + `CitationChip` (reused; one adapter ask citation -> InsightCitation; non-cited markers plain text); cited Outputs by name; no model/token/cost anywhere; tests.
- [x] 2.5 Pin: action iff `pin !== null`; POST `pin.request` unchanged; on dashboard + owner, place a panel via `createPanel` (which already marks panels stale); non-owner or placement failure -> saved-to-pipeline link; "Pinned" status, non-repeatable; pin error retryable; tests including the viewer (pin null) case and a body-unchanged assertion.
- [x] 2.6 Tier and error states per design D5 (free proactive upsell `AskUpsell` with the exact D5 sentence and its own `ask-upsell` classes, no request sent, 403 -> upsell, 429 with the shared daily-chat-limit copy and never the `limit` number (tested), truncated asks for a narrower question, other 422 neutral without echoing reasons, 5xx/network generic with Retry); live-region announcements; tests.

## 3. Surfaces

- [x] 3.0 Add an optional `size` prop to `shared/motion/BottomSheet.tsx`, passed to `Modal`, default `"full"` (existing callers unchanged); export `ModalSize` from `Modal.tsx` (or restate the union); a CSS-text guard (Modal.css.test.ts pattern, with a recorded mutation) that `.ui-modal.bottom-sheet` inside the 768px query sets width/max-width 100% at higher specificity than every `.ui-modal--*` size class, plus a unit test that the default stays `full`; the phone e2e run asserts the ask sheet's width equals the viewport width (C2); amend DESIGN.md §10 "Bottom sheet".
- [x] 3.1 `AskDrawer` built on the shared `BottomSheet` with `size="md"` (540 px Modal above 768 px, swipe sheet at/below; no feature-CSS width override), mounted in `App.tsx` beside RefinementChatDrawer (gated on selectedDashboardId). Openers: `DashboardMetaRow` secondary icon-only `IconButton` "Ask about this dashboard" immediately before the assistant button at tiers 0-1, a kebab item at tier >= 2; an item inside the existing `CommandBar` dashboard kebab (`dashboardActionItems`; phone and non-rail shells), no top-level CommandBar control. Focus to the field on open; Modal restores to the opener; when the opener was a kebab item, restore to the kebab trigger via a passed selector (KEBAB_TRIGGER_SELECTOR / restoreFocusSelector precedent); tests for each opener's focus return.
- [x] 3.1a Re-measure `META_ROW_TIER_WIDTHS` live with the new control (view and edit mode), update the constants if needed, record numbers in measurements.md; amend DESIGN.md §9 "Meta row" to list Ask and its tier behaviour; re-run the meta-row tier unit tests and e2e specs.
- [x] 3.2 "Ask about this Output" disclosure group in `OutputEditorSheet` gated on `hasServerRow`; pin from here refreshes the pipeline's Output list; Pin disabled with the visible reason "Save or discard your draft to pin." while `draft` is set; tests (absent in create mode and for a draft Output; pin disabled during a draft).
- [x] 3.3 CSS with existing tokens only (DESIGN.md); drawer width comes only from `size="md"`; 44 px targets on phone; final visual check judges the Ask glyph against the assistant glyph (switch to `CircleHelp` if they read as one).

## 4. End to end and visual

- [x] 4.1 `e2e/hel1746-ask-ui.spec.ts` per design D8 (owner and viewer set to beta with `setUserTierForTest` on exactly their registered ids; fixture-fulfilled /ask, real pin POST and placement, not-yet-rendered panel, viewer no pin, free upsell with zero ask requests, 422 ungrounded, 422 truncated and 503 states, keyboard-only flow and focus return, Output-sheet ask and pin) in light/dark x desktop/phone; record the RED run before the UI exists.
- [x] 4.2 Visual check against the running app in light and dark, desktop and phone, alongside neighbouring dashboard chrome and the Output sheet; screenshots and notes in visual-check.md.
- [x] 4.3 Run the full affected spec files: hel1746, hel1744-insight-panel, and the dashboard meta row / command bar / Output sheet e2e specs touched by the change; record results.
- [x] 4.4 Clean up e2e DB residue by exact id. Cycle 2: the one residue user left by cycle 1 (`b8728b04-2f6b-40c0-9ef8-e4032d0b94a9`, recorded in `.e2e-user-registry/1795007098796-3295251`) was deleted through the guarded `buildUserDeleteSql` (`deleteRecordedUsers`), count verified 0, and the registry directory removed.

## 5. Docs and delivery prep

- [x] 5.1 CLAUDE.md ask endpoint entry: name the new error-body schemas.
- [x] 5.2 Merge origin/main before the final gates (HEL-1757 may land); if any ask body changed, regenerate the seam fixtures and re-run the seam + contract tests. Done again in cycle 2: merged origin/main (f2358c16d HEL-1757 web-fonts fixture, 506c22442 HEL-1760 chart chunk preload) with merge commit 0da85ecfa, no conflicts. HEL-1757 is config-level (`playwright.config.ts` host rules and a fonts webServer), so the spec needed no change. After the merge: lint 0, typecheck 0, format:check pass, jest (features/ask, OutputEditorSheet, BottomSheet, CommandBar, DashboardMetaRow) 27 suites / 316 tests passed, `AskSeamSpec` 6/6, `hel1746-ask-ui.spec.ts` 14/14 on 7178/10085. No ask body changed, so the fixtures were not regenerated.
- [x] 5.3 Write files-modified.md.
