## Context

The test today:

```ts
await page.goto("/login", { waitUntil: "domcontentloaded" });
await page.evaluate((k) => localStorage.setItem(k, "1"), HINT_KEY);
await page.goto("/");
await page.waitForURL("/login");
expect(await page.evaluate((k) => localStorage.getItem(k), HINT_KEY)).toBeNull();
```

`/login` is served the app shell, so the page boots React, Redux and `rehydrateAuth` (`GET /api/auth/me` -> 401 for
a fresh context). On the transition to `unauthenticated`, `registerSignedInHintListener` calls
`localStorage.removeItem("helio.signedIn")`. Nothing orders that removal against the test's `setItem` or against
the next document's inline head script in `frontend/index.html`, which reads the key before first paint and
`location.replace("/home")`s when it is `"1"`. The old document keeps running script until the new navigation
commits, so a late clear can also land during `goto("/")`.

`/` itself is the static landing page: it ships no app bundle (the first test in the spec asserts no `id="root"` and
no `/src/main.tsx`), so nothing on it can clear the hint.

## Goals / Non-Goals

**Goals:** the stale-hint test seeds the hint with no app code running in the page; a forced repro proves the old
shape red and the new shape green; independent of the font stylesheet.

**Non-Goals:** product changes (see proposal); fixing other specs.

## Decisions

### D1. Seed from the static landing page

```ts
await page.goto("/", { waitUntil: "domcontentloaded" });   // landing, no app code, no hint yet
await page.evaluate((k) => localStorage.setItem(k, "1"), HINT_KEY);
await page.goto("/");                                        // inline script bounces to /home
await page.waitForURL("/login");
await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), HINT_KEY)).toBeNull();
```

Executor must verify, not assume, that the landing document loads no script that touches `helio.signedIn` (grep
the served HTML and every script it loads). Alternative considered: `page.addInitScript` - rejected because it
re-runs on every navigation (including `/home` and `/login`), re-seeding the hint and making the final "cleared"
assertion meaningless unless guarded with a one-shot flag; the landing-page seed is simpler. If D1 turns out to be
unsound (e.g. the landing page does run app code), fall back to a one-shot `context.addInitScript` guarded on
`location.pathname === "/"` plus a sessionStorage flag, and record why.

`waitUntil: "domcontentloaded"` on the seed load: confirm under the D3 font-held probe that it does not wait on the
Google Fonts stylesheet; if it does, use `"commit"` and wait for the document to be readable.

### D2. The final read polls

`expect.poll(...).toBeNull()` replaces the single read: the `/login` URL can be reached before the
`/home` app's clear is observable from the new document in some orderings. Executor must check the real order (the
clear happens in the `/home` document before its redirect) and keep `expect.poll` only as ordering-agnostic
assertion, not as a retry of a wrong value - default expect timeout, no larger timeout.

### D3. Red-first, seed-isolation and font proofs (throwaway, under `.concertino/scratch/HEL-1623/`, not committed)

1. **Forced race repro, UNMODIFIED shape.** Route `**/api/auth/me` to hold its response behind a test-controlled
   release. Release it right after the `setItem`, then wait (in the old `/login` document) until `helio.signedIn`
   is gone, then `goto("/")`. Expect red: the browser stays on the landing page `/`. Run several repeats to show it
   is deterministic.
2. **Same release-controlled hold, NEW shape.** Install the identical hold-until-release route, with the release
   placed right after the `setItem`, then run the new test body. Expect green. The load-bearing assertion is a
   count, not the pass/fail result: record every `/api/auth/me` request (`page.on("request")`) and assert that
   **zero** occur between the seed `goto("/")` and the second `goto("/")`. That count is what proves AC1 (no app
   code ran before the seed). The `/home` document's own `/api/auth/me` (after the release) must still return 401
   so the bounce under test can complete; never hold it for the whole test.
3. **Font condition, defined.** "Held" means two runs: (a) the Google Fonts stylesheet request
   (`https://fonts.googleapis.com/**`) hangs until the test ends (route handler never fulfils), and (b) it is
   delayed 5 s and then continued. For each, probe whether any of the new test's navigation waits - seed `goto`,
   second `goto("/")`, `waitForURL("/login")` - block on it: both `index.html` and `app.html` load that stylesheet
   with `media="print"`, which may still delay the `load` event that `goto`/`waitForURL` wait on by default. If any
   wait depends on it, change that wait's `waitUntil` to `"domcontentloaded"` (or `"commit"` where the document is
   not read afterwards); never a larger timeout (C2). Record per-wait results and the chosen `waitUntil` values.
4. **CI corroboration (advisory).** If run 43993159078 (shard `e2e (4)`) uploaded a trace or `error-context.md`
   for the failed test (`gh run download`), record whether the page sat on `/` at timeout (hint race, cured by this
   fix) or on `/home` (a broken 401 bounce, which this fix would not cure - escalate if so).

Record commands, counts and outputs for all four in `proofs.md` in the change dir (persisted as evidence).

### D4. Sweep the spec

Check the other tests in `e2e/hel1562-landing-page.spec.ts` for the same "seed localStorage from a booted app page,
then navigate" pattern. Fix only the same race; justify any non-fix with a line reference in `proofs.md`.

### D5. hel813

No code. `proofs.md` records the CI-history scan (failed main CI runs since 2026-10-16, zero hel813 failures). The
orchestrator closes the item in Linear at Phase 4.

## Risks / Trade-offs

- The bounce path itself (`/home` app boot -> 401 -> redirect to `/login`) still runs real app code; that is the
  behavior under test, and its timing is bounded by the default test timeout, not raced against the test's own
  writes.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or gate-chain script is touched.
