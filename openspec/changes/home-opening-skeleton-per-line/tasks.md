## Standing Constraints

- [C1] Red first: the new e2e spec is run against base and the failing run is recorded and COMMITTED before any implementation change; after green, mutations (drop clone, drop visibility:visible, restore the absolute bar) each re-run and recorded red.
- [C2] Zero layout change: the HEL-1737 320-1300px placeholder sweep (vsweep2.cjs, helio1678-ci and helio1678-dv images, light and dark, CDP-proven faces) shows zero differing widths at head, and the full hel1665 four spec files + hel1678 + hel1572 pass; any sweep difference = STOP and ESCALATE, never narrow the AC.
- [C3] No change to Skeleton.tsx/Skeleton.css; no shimmer gradient or keyframes outside Skeleton.css; no JS line counting.
- [C4] Bar look targets (design D2): thickness 0.8em +/-1px, gap between bars >= 8px, corners rounded with --app-radius-sm, via a per-fragment mask; never change line-height or font-size; unmet in Playwright Chromium = STOP and ESCALATE with measurements.

## 1. Feasibility in the Playwright Chromium build

- [x] 1.1 With a throwaway probe (scratch only, `.concertino/scratch/HEL-1749/`), in the repo's Playwright 1.55 bundled Chromium (record the exact build string) AND in the helio1678-ci and helio1678-dv images: load Home with `/api/home-summary` held, inject the D1+D2 markup/CSS via page.evaluate; record computed `box-decoration-break`/`-webkit-box-decoration-break`, fragment count vs line count at 431/500/604 and 375, painted bar thickness, gap and corner rounding (web font, and fonts blocked: Liberation-matched face in ci, DejaVu-matched face in dv, CDP-proven), screenshots light/dark into the change's `evidence/`. Verify: `evidence/feasibility.md` states PASS against the D2 targets or FAIL; on FAIL, STOP and return ESCALATION with the numbers.

## 2. Red first

- [x] 2.1 Write `e2e/hel1749-home-opening-skeleton-lines.spec.ts` per design D4; run the full file against unchanged base code (lane-private DB, servers via start-servers.sh); record the failing output to `evidence/red-base.txt` and commit spec + red evidence before touching implementation. Verify: commit exists, red output shows the fragment-count/bar assertions failing.
- [x] 2.2 Update `HomePage.css.test.ts` and `HomePage.test.tsx` to the D4 shapes; run them on base and record red in `evidence/red-unit.txt` (same commit as 2.1 or a separate pre-implementation commit).

## 3. Implementation

- [x] 3.1 `HomeOpeningLine.tsx`: wrap DEFAULT_SENTENCE in the `ui-skeleton home-opening__ghost-bar` span; remove the separate `<Skeleton>` bar; replace the `Skeleton` import with an explicit side-effect `import "../../../shared/ui/Skeleton.css";` plus a comment naming why (design D1, CR 3). Update the ghost comment. Verify: HomePage.test.tsx green including the direct-import assertion.
- [x] 3.2 `HomePage.css`: add the D1 rule and the D2 per-fragment rounded-rect mask (do not touch HEL-1584's `tl-nudge` keyframes/animation; the unit shimmer assertion is scoped per design D2 so it passes with `tl-nudge` present); remove `.home-opening__loading .home-opening__skeleton-line`; keep `.home-opening__loading { position: relative }` only if still needed (unit test updated accordingly); update the comments. Verify: HomePage.css.test.ts green, new e2e spec green light and dark.
- [x] 3.3 Re-grep `e2e/`, `frontend/src/` for `home-opening__skeleton-line` and `home-opening__ghost`; any remaining reference updated or justified in `evidence/grep.txt`.

## 4. Guards and evidence

- [x] 4.1 Mutations (C1): each of the four design D4 mutations (clone, visibility, mask, absolute bar) re-run against the full new spec, red recorded in `evidence/mutations.txt`, then reverted.
- [x] 4.2 Full spec files: all four `e2e/hel1665-home-phone-stability-*.spec.ts`, `e2e/hel1678-home-large-font.spec.ts`, `e2e/hel1572-appearance-preferences.spec.ts`, and the new spec pass (host Chromium, 2 workers); output in `evidence/guards-host.txt`. Where feasible also run the hel1665/hel1678 files in the `helio1678-ci` browser (as HEL-1737 did) into `evidence/guards-ci.txt`.
- [x] 4.3 HEL-1737 sweep (C2) at head: `vsweep2.cjs` in `helio1678-ci` and `helio1678-dv` (a lane-private DB user replaces the hardcoded dev login; copy the tool to scratch, adjust only the credentials), light and dark; zero differing widths each; output `evidence/sweep-ci.out`, `evidence/sweep-dv.out`, plus a base run for comparison. Any difference: STOP and ESCALATE.
- [x] 4.4 Screenshots light and dark at 431, 500, 604, 1280 (and reduced motion at 500) into `evidence/screens/`, web font and fonts-blocked (ci and dv faces); `evidence/measurements.md` tabulates bar thickness, gaps, corner rounding and fragment counts per face against the D2 targets.
- [x] 4.5 Frontend gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, the home + Skeleton jest files (3 workers), and the pre-commit hook on commit.
