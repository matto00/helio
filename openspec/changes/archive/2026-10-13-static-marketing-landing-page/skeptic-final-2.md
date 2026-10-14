## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed head: `e025f4151aa6c30c37d14ecc1834cfd8a2893ad5`. I resolved the review base live with `resolve-review-base.sh <wt> main origin` and got `e0376657d` (HEL-1571), which equals `origin/main`. The branch is 5 commits on top of it.

### What I verified (with evidence)

**Round-1 CR1 (dark canvas rollback): closed.**
- `git grep -n 121110 -- frontend openspec/specs` returns one hit: the design-language-v3 scenario text that *describes* the search. There are no stale values.
- `frontend/app.html:17` and `frontend/index.html:14` both read dark `#0f0e0d`.
- Archive dry-run: I ran `git archive HEAD openspec` into a scratch dir, then `openspec archive static-marketing-landing-page -y`. It applied +10 and ~19 with no errors. The archived `openspec/specs/pwa-installability/spec.md:31` reads `#0f0e0d`, and no `121110` remains under `openspec/specs`.
- I diffed the archived copy of each of the 12 modified capability specs against main's. The only changes are the intended `/` → `/home` and `index.html` → `app.html` retargets, plus the new PWA scenarios. No main content is reverted, including HEL-1571's.

**Round-1 CR2 (serif-exception record): superseded, and the supersession conforms to the binding standard.**
- The new ruling C10 (sans via `--font-heading`) is what DESIGN.md v3 itself requires: "no component reads `var(--font-display)` directly", and headings are sans by default.
- The Linear description still says "Fraunces only…", but it frames that as "Type per DESIGN.md", and DESIGN.md now means v3 sans.
- So the implementation does not hinge on the relayed ruling alone: it is grounded in the binding standard either way.
- C4 is marked retired, and C10/C11 are present in `tasks.md`, `ticket.md`, `design.md:75` and spec `marketing-landing-page` lines 133–140.

**Rebase integrity.** `git range-diff 2c1ab0326..340c9e799 e0376657d..e025f4151`:
- Commit 2 (`1a0df5ea3`) is `=`, identical to the reviewed `340c9e799`.
- Commit 1 (`683c70b45`) differs from the reviewed `1496762da` in exactly one line: landing `index.html`'s dark theme-color `#121110` → `#0f0e0d`.
- Nothing was dropped or mangled.
- The three new commits are:
  - `c44bd0cb4`: theme-color, spec delta, capture log renamed to `.txt`, and stale e2e comments.
  - `7f7493a68`: one-line `waitUntil: "domcontentloaded"` in the stale-hint e2e.
  - `e025f4151`: the font switch, guards, and docs.

**v3 conformance of landing.css.**
- Every `font-family` in `landing.css` is `var(--font-heading|sans|mono)`.
- There are no `var(--font-display)` reads, no `font:` shorthand, and no numeric weights.
- The Fraunces family has been removed from both the landing font `<link>` and its `<noscript>` copy. The built `dist/index.html` has 0 `Fraunces` hits.
- Live computed styles at 1440 light: `.brand`, `h1`, `#center h2` and `.closing-line` all report `"Schibsted Grotesk"`.
- Loaded faces: Schibsted Grotesk normal and italic, and JetBrains Mono only.
- On dark, `body` background is `rgb(15,14,13)` (`#0f0e0d`).

**Type guards and their mutation evidence: real.**
- `landingFonts.css.test.ts` passed 3/3 in a verbose run.
- I replayed its three assertions in node against mutated inputs:
  - `.closing-line` set to `var(--font-display)` fails 2 of 3, matching `evidence/font-heading-mutations.txt` ("2 failed").
  - A literal `"Fraunces", serif` family fails assertion 2.
  - Re-adding `family=Fraunces` to the link fails assertion 3, matching "1 failed".
  - Unmutated, all 3 pass.
- The e2e computed-font test compares against a probe span resolving `var(--font-heading)`, so it tracks the token and not a hardcoded family. I did not run the e2e suite. I verified the same computed values live, as described above.

**Weight change to `--weight-medium` (h1 `.tag`, `.center h2`, `.closing-line`).**
- It uses tokens, with no literals.
- DESIGN.md's "distinguish a heading by `--weight-semibold`" is aimed at in-app headings at `--text-*` sizes. These are 64–88px display lines, where 500 reads as a deliberate display weight.
- Visually it is right: semibold at 84px would be heavy, and regular sans would look thin next to the hero captures.
- The wordmark stays semibold, matching the app.
- Accepted as a design judgment. See the notes.

**Gates, run fresh at e025f4151 with `nice -n 19` and 3 jest workers.**
- `npm run lint`: exit 0.
- `format:check`: exit 0, "All matched files use Prettier code style!".
- `typecheck`: exit 0.
- `check:landing-build:selftest`: OK.
- `npm --prefix frontend run build`: exit 0.
- `check:landing-build`: OK, and `dist/index.html` contains "50 messages a day".
- Full `npm test`:
  - root: 51 suites / 469 tests passed;
  - frontend: 596 suites / 7133 tests passed;
  - exit 0.
- Targeted landing, signedInHint and pwaConfig: 77/77 passed.
- The backend is unchanged by this diff, so I did not run the backend gate.

**AC re-check on the running app (`assert-phase servers` PASS on :6994/:9901).**
- `curl /` returns the hero text (3 hits) and no Fraunces.
- The signed-in redirect still works: in my browser session, `/login` bounced to `/home`.
- AC1–AC5, AC7 and AC8 were traced in round 1. Their code is byte-identical apart from the deltas above, which I re-verified.

**AC6 (light and dark at 375 and desktop): met.** I looked at each screenshot.
- 1440 light hero: `.../sk2-1440-light-hero.png`
- 1440 dark hero: `.../sk2-1440-dark-hero.png`
- 1440 dark "The center of your workflow.": `.../sk2-1440-dark-center.png`
- 1440 dark plans and closing: `.../sk2-1440-dark-closing.png`
- 375 dark hero: `.../sk2-375-dark-hero.png`
- 375 light center and build opening: `.../sk2-375-light-center.png`
- 375 light closing: `.../sk2-375-light-closing.png`

All seven are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1562/evidence/openspec/changes/static-marketing-landing-page/evidence/`. The md5s are in my session log.

- At 375, `scrollWidth` equals 375, and no non-fixed element extends past the viewport.
- All six reel endings stack in a 335×71 box: each wraps to at most 2 lines and none overflows, so the sans metrics did not break the endings grid.
- No console errors.
- On judgment: the sans headlines now read as the same product as the app chrome, and the italic sans tagline and closing hold up in both themes. Parity is good.
- One first dark-closing capture showed the nav offset. I re-measured: `scroll-behavior: smooth` was mid-animation, and nav top was 0 once settled. The re-capture is clean, so this is a measurement artifact and not a defect.

### Verdict: CONFIRM

### Non-blocking notes
- C11: the shipped captures still show pre-v3 chrome, a serif "Helio" wordmark and the `#121110` dark canvas inside the screenshots. This sits slightly against the owner's "never set expectations the app doesn't meet". It is owner-ruled, and the recapture follow-up is driver-owned. Whoever closes this out should confirm the follow-up ticket actually exists in Linear. I did not find it referenced in `ticket.md`.
- The `--weight-medium` display-headline choice has no recorded rationale in `design.md`. A one-line note would stop a future v3 audit from "fixing" it to semibold.
- The Linear issue description still says "Fraunces only for the wordmark, headlines and the tagline". After merge it should be updated to the v3 ruling so the ticket of record matches what shipped.
- From round 1, still open and cosmetic: `landing.css` `.stage` keeps literal `56px`/`340px` in its width calc. The `state-surface-contrast-guard.spec.ts:316` mangled comment is fixed.
- `skeptic-final-1.md` and `evaluation-2.md` are untracked in the worktree. The orchestrator should make sure they are committed with the archive if that is the convention.
- My screenshots (`evidence/sk2-*.png`) are untracked files in the change's `evidence/` dir. Their durable copies are under `.concertino/runs/HEL-1562/`.
- No mtime-ordering evidence was relied on. Rebase integrity rests on `range-diff` content, and the screenshots on persisted copies.
