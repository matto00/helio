## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `340c9e799e114be6862cb3c38873cc5416f87fd2`. Review base resolved live by `resolve-review-base.sh main origin` gives `2c1ab0326`. `origin/main` is now 2 commits past that base: `5074b6937` HEL-1467 and `e0376657d` HEL-1571 (DESIGN.md v3).

### What I verified (with evidence)

**Gates.** I ran each one fresh at 340c9e799, under `nice -n 19` with 3 jest workers:
- `npm run lint`: exit 0.
- `npm --prefix frontend run typecheck`: exit 0.
- `check:landing-build:selftest`: OK.
- `npm --prefix frontend run build`: exit 0.
- `check:landing-build`: OK against `frontend/dist`.
- Targeted jest (landing, auth, pwaConfig, shared/chrome, app, review pages, theme guards, commandPalette): 85 suites and 889 tests passed, exit 0.

I did not re-run the full e2e suite. My static probes are below.

**AC1 (static HTML at `/`): met.** This is a live curl of the dev server on :6994.
- `/` returns the hero text 3 times and the og:type, title, url, image, image:width and image:height tags, with no `id="root"`.
- `/?gclid=1` also returns the landing page.
- The evaluator's `evidence/preview-curl.txt` shows the same result on the production `vite preview` build.

**AC2 (signed-in user at `/` goes to `/home`): met.** I tested this live in the browser, which already held a dev session cookie.
- Visiting `/home` rendered PanelList and set `localStorage["helio.signedIn"]="1"`.
- A `goto("/")` then landed on `/home`.
- The single choke point is in `signedInHint.ts` (a listener on `auth.status`). `landingHtml.test.ts` pins the storage keys against the app's constants.

**AC3 (deep links): met.**
- A curl with `Accept: text/html` returns the app shell (`#root`) for `/pipelines/abc`, `/login`, `/register`, `/auth/callback`, `/dashboards/abc/panels` and `/home/`.
- On Firebase, real files are served first, so `/` resolves to `index.html`, and `**` rewrites to `/app.html` (`frontend/firebase.json`).
- Header rules match the request path. The `regex` `^[^.]*$` covers every extensionless path.
- `check-landing-build.mjs` pins both the rewrite and the no-cache rules.

**AC4 (old service worker sees the landing page; installed PWA opens to `/home`): met.**
- `pwaConfig.ts` sets:
  - a denylist of `/^\/(\?.*)?$/` and `/^\/index\.html(\?.*)?$/`;
  - `navigateFallback: "/app.html"`;
  - `skipWaiting` and `clientsClaim`;
  - `start_url: "/home"`.
- The old-SW transcript (`evidence/old-service-worker-run.txt`) comes from a local preview origin. I reasoned the Firebase case through instead of re-measuring it:
  - The old build's injected `registerSW` re-registers `/sw.js`. Service-worker update fetches bypass the HTTP cache by default.
  - The new worker skips waiting.
  - A bare `/` then hits the precached landing `index.html`. A query `/` is denylisted and goes to the network, where Firebase serves `index.html` natively.
  - The mechanism is the same as on preview. The one accepted cost is that the first visit after deploy still shows the old shell.

**AC5 (beta CTA): met.**
- `betaRequest.ts` sends a `POST` with `credentials:"include"` and the shared CSRF header, and maps 204/401/409/429/503 to their states. Anything else, or a network error, maps to `error`.
- `betaRequest.test.ts` covers every mapping.
- Live check: in my browser, which had a session cookie, clicking the button returned a real 409 from the backend and showed "Your account already has beta access." That proves the credentialed path end to end.
- The evaluator observed the real 401 path ("Create a free account first. Start free.").

**AC6 (light and dark, 375 and 1440, no horizontal scroll): met.** At 375 the `scrollWidth` was 375, with no in-flow element past the viewport. I looked at the screenshots described under Design judgment.

**AC7 (plan numbers): met.**
- `planNumbers.sourceScan.test.ts` parses `DefaultBetaDailyMessageLimit: Int = (\d+)` from `UserTierConfig.scala` (currently 50) and asserts it equals `BETA_DAILY_MESSAGE_LIMIT`.
- Changing the backend value changes the parsed side of that same equality, so the test goes red.
- The HTML carries only the `%BETA_DAILY_MESSAGE_LIMIT%` placeholder.
- The built `dist/index.html` contains "50 messages a day" (`check-landing-build`).

**AC8 (real captures from the checked-in script): met.**
- All 12 committed `shots/*.jpg` differ by md5 from the bundle's `mockup/shots/*.jpg`.
- The shots show the throwaway account's "L" avatar, where the bundle shows "S".
- The panel rectangles logged by `capture-run.log` equal the committed `rects.json`.
- `capture.mjs`:
  - refuses to save unless the URL, panel count and dashboard name match;
  - paces captures 20 s apart;
  - blurs the news photo, which is visibly blurred in `uc-news-dark.jpg`.
- Caveat: `evidence/capture-run.log` is gitignored (`*.log`), so it is not in the commit. See the notes.

**Constraints.**
- C1–C5 and C7–C9 all hold.
- C7: the 24 hints and the news and helio notes diff identical to the mockup's `CASES`.
- C4: Fraunces is used only on the h1/h2, the wordmark and `.closing-line`.
- C8: `.ask` is set in `--font-sans` italic.
- C9: the headings are "Free: …", "Beta, invite only: …" and "Everywhere: …".
- C5: there are no `.tier` or eyebrow classes.

**e2e retargeting.**
- I ran the D11 probe and wider probes: `toHaveURL`/`waitForURL` regexes, bare-base `goto`, and `"/"` literals outside string ops.
- The only remaining code hits are inside `hel1562-landing-page.spec.ts`. Every other hit is a comment.
- One mechanical-replace artifact turned up in a comment: `e2e/state-surface-contrast-guard.spec.ts:316` reads `"Test connection"/home"Preview schema"`.
- The full e2e suite is CI's to run. I found no unconverted navigation site.

**Design judgment.**
- Screenshots (viewed, not persisted, not load-bearing for the verdict) under `/home/matt/Development/helio/.playwright-mcp/hel1562-sk-*`:
  - 1440 light hero
  - 1440 dark build section at step 3
  - 1440 dark plans and closing
  - 1440 dark news case with an open hint
  - 375 light hero with the 409 state
  - 375 light plans and closing
- The page is faithful to `mockup/index.html` (layout, rhythm, type hierarchy and copy), adapted to theme.css tokens with canonical breakpoints.
- Light/dark parity is good:
  - captures swap per theme;
  - the veils and hint popover read well on dark;
  - the pill `aria-current` inverts correctly in both themes.
- The closing and build-caption spacing fixed in cycle 2 is visibly correct.
- At 375, the pill rows tile and the CTAs stay clear of each other.
- I would not reject anything visually at this head.

**Integration with current main (the blocking finding).** I simulated the merge with `git merge-tree --write-tree origin/main 340c9e799`. It merges with no conflict and produces tree `672230bc6…`. That tree contains:
- `frontend/app.html:17`: `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121110" />`. HEL-1571 changed this line to `#0f0e0d` in `frontend/index.html`. This branch moved that file to `app.html`, so git applied main's edit to the new landing `index.html` instead, and the app shell keeps the old value.
- `openspec/changes/static-marketing-landing-page/specs/pwa-installability/spec.md:26`: a MODIFIED "iOS meta tags present" scenario that still reads dark `#121110`. On archive it would overwrite main's `openspec/specs/pwa-installability/spec.md`, which reads `#0f0e0d`, back to the old value.

Main's new `openspec/specs/design-language-v3/spec.md` has the scenario "No stale copy of the old dark canvas remains", which searches `frontend` and `openspec/specs` for `#121110`. The merged tree violates it.

No test catches this. A `git grep theme-color` over the merged tree's tests and scripts finds no assertion on the meta. `squash-branch.sh` logs base advancement but never rebases ("never blocks or forces a rebase (D3)"), and GitHub's merge would be textually clean. Shipping this head as-is would silently undo part of HEL-1571 in the installed PWA's dark status bar and in the spec.

### Verdict: REFUTE

### Change Requests

1. **Rebase onto current `origin/main` (past `e0376657d` HEL-1571) and carry the new dark canvas through the moved files.**
   - Set `frontend/app.html`'s dark `theme-color` to `#0f0e0d`.
   - Confirm the landing `frontend/index.html` dark `theme-color` is `#0f0e0d`. It currently reads `#121110`; the auto-merge happens to fix it.
   - Change `specs/pwa-installability/spec.md:26` in this change to `#0f0e0d`, and re-derive the rest of that delta against main's current `pwa-installability` spec so the archive does not revert main.
   - Acceptance: `git grep -n 121110 -- frontend openspec/specs` returns nothing on the rebased head, and an archive dry-run's `openspec/specs/pwa-installability/spec.md` reads `#0f0e0d`.
   - Then re-run lint, typecheck, jest, build and `check:landing-build`.
2. **On that rebase, reconcile `landing.css` with main's design-language-v3 type contract explicitly instead of letting it slide.**
   - v3 states "No CSS consumer reads the serif token directly". `landing.css` reads `var(--font-display)` at 3 sites: `:where(.landing) h1/h2`, `.brand` and `.closing-line`.
   - The landing page's serif headlines are owner-ruled (ticket C4 and the approved mockup), so keep the type.
   - Record this as an explicit, cited exception: a sentence in `specs/marketing-landing-page/spec.md` or `design.md` naming owner ruling C4. That way the next reader, or a future guard, does not treat it as drift.
   - This is a documentation change only; no visual change is wanted.

### Non-blocking notes

- `evidence/capture-run.log` is cited by `files-modified.md` as the AC8 provenance, but `.gitignore`'s `*.log` keeps it out of the commit. Rename it to `capture-run.txt` so the provenance ships with the archive.
- `e2e/state-surface-contrast-guard.spec.ts:316` has a mangled comment from the bulk replace: `"Test connection"/home"Preview schema"`.
- Several e2e comments still say "the live post-login `/`" (hel813, hel666, hel1275, hel503, hel910, hel520). They are harmless but now wrong.
- `landing.css` `.stage` keeps the mockup's literal `56px`/`340px` in its width calc. The rest of the file derives the nav height from `--landing-nav-height`, so this one could too.
- I verified AC4 by reasoning about Firebase's semantics, not by measuring on Firebase. Whoever cuts the release should load `/` once in a browser that has the previous production service worker installed.
- No mtime-ordering claims were relied on. All cited evidence is content-based: md5s, merge-tree output, line numbers and live curl/DOM reads.
