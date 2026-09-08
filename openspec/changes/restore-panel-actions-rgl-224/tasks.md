## 1. Dependency

- [x] 1.1 Confirm the range revert to `"react-grid-layout": "^2.2.2"` landed in BOTH `frontend/package.json` AND the root `packages[""]` dependency map inside `frontend/package-lock.json` (D9). `npm ci` does NOT catch a mismatch here — 2.2.4 satisfies `^2.2.2`, so a dry-run succeeds either way; verify by `git diff frontend/package.json` being empty and the lock diff being exactly the 3 lines version/resolved/integrity on `node_modules/react-grid-layout`
- [x] 1.2 Re-confirm the RED baseline BEFORE any fix, from `frontend/`: `npx jest --testPathPatterns='app/App.test'` must show exactly `Tests: 2 failed, 27 passed`, both at `App.test.tsx:893`; paste the counts
- [x] 1.3 Record the full-suite RED baseline from `frontend/`: `npx jest` -> expect `Test Suites: 1 failed, 271 passed, 272 total` / `Tests: 2 failed, 2766 passed, 2768 total`; paste the counts

## 2. Frontend harness fix

- [x] 2.1 In `frontend/src/test/jest.setup.ts`, add the D2 `getComputedStyle` width shim: return the native style object untouched when `style.width` already ends in `px`, otherwise return a proxy reporting `width` and `getPropertyValue("width")` as `"1280px"`; keep the existing `offsetWidth` stub
- [x] 2.2 Comment the shim with the non-obvious mechanism a future bump will re-trip over: 2.2.4 reads `getComputedStyle().width`, jsdom returns the SPECIFIED value (so an inline `width: 100%` parses to a finite `100`) whereas a real browser returns the USED value in px; state that tests must depend on the outcome (a desktop-width measurement) and not on which primitive the library happens to read
- [x] 2.3 Verify RED -> GREEN: `npx jest --testPathPatterns='app/App.test'` goes from 1.2's 2 failures to `Tests: 29 passed, 29 total`, with `git diff --exit-code frontend/src/app/App.test.tsx` clean; paste both

## 3. Tests

- [x] 3.1 Add a stub-integrity guard asserting react-grid-layout's real, unmocked `useContainerWidth` reports >= `panelGridConfig.breakpoints.sm` (768) for a node carrying an INLINE PERCENTAGE WIDTH (the shape `.panel-list__zoom-container` actually renders — a bare `div` would pass vacuously); label it a guard
- [x] 3.2 Add a regression guard asserting the panel-actions trigger is reachable by `getByRole("button", { name: /panel actions/ })` on the desktop branch; label it a guard
- [x] 3.3 Mutation-prove 3.2: temporarily remove the `label` prop at `PanelCard.tsx:303`, verify the guard goes RED, restore, and paste both transcripts into `files-modified.md`
- [x] 3.4 Mutation-prove 3.1 against the shim the fix ACTUALLY adds (not the withdrawn `clientWidth` stub, which is off the consumed path and would prove nothing): neuter the 2.1 shim, verify the guard goes RED, restore, and paste the transcript
- [x] 3.5 Run the full suite as `npx jest` from `frontend/` (NOT root `npm test` — its `jest --passWithNoTests` leg finds zero tests at the worktree root and turns silence into a pass); expect `Test Suites: 272 passed` / `Tests: 2768 passed`; paste the counts against 1.3's baseline so the shim's blast radius is measured

## 4. Real-browser verification

- [x] 4.1 Start the worktree dev server and capture the panel-actions affordance at desktop width under 2.2.4 via the Playwright MCP browser: accessibility snapshot showing role=button with the panel-actions name, plus screenshots in light and dark
- [x] 4.2 Capture the same states with 2.2.3 installed as the before-baseline on this same rebased base (D8), and compare position, size, hover and focus treatment, and stacking against the drag handle
- [x] 4.2a AFTER the 4.2 baseline capture, restore 2.2.4 and re-verify the lockfile shape before proceeding: `git diff frontend/package.json` empty, and the `frontend/package-lock.json` diff exactly the 3 lines version/resolved/integrity at 2.2.4. Installing 2.2.3 for the baseline rewrites both files, and `npm ci` will NOT flag the drift (2.2.3 and 2.2.4 both satisfy `^2.2.2`) — this is the same drift class that already bit this change once
- [x] 4.3 Verify panel drag and resize still work under 2.2.4 in the real browser with no `pointer-events` or z-order change; if 2.2.4 alters overlap behaviour at mismatched breakpoints, REPORT it as an HEL-1023 interaction and DO NOT fix it here (D7)
- [x] 4.4 Confirm phone width still renders `MobilePanelStack` and that nothing here assumes a phone actions host (HEL-1006); report any interaction rather than absorbing it
- [x] 4.5 Record every transcript, screenshot path and comparison verdict in `files-modified.md`; escalate any cohesion call that cannot be made on evidence to the coordinator WITH screenshots rather than resolving it by judgment

## 5. Delivery

- [ ] 5.1 Rebase onto latest `main` and re-run 3.5 and the 4.x visual comparison if frontend files moved
- [ ] 5.2 State explicitly in the PR body whether this blocks the Dependabot bump, that PR #481 is superseded, and that the fix is harness-only with no product code changed
