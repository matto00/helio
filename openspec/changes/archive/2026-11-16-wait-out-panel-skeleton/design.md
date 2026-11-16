## Context

See proposal.md - Why. Ground truth (verified 2026-11-16 on fd7064f7d):
- `PanelList.tsx` renders `<Crossfade loading=... skeleton={<PanelGridSkeleton/>} block>` around `PanelGrid`.
- `PanelGridSkeleton.tsx:30` is the `aria-label="Loading panels"` wrapper. On desktop widths it renders a real
  react-grid-layout (`DesktopPanelGridSkeleton`), so its stub cards ARE `.react-grid-item`s; on phone widths it
  renders `MobilePanelStackSkeleton` (no `.react-grid-item`). Both render `.panel-grid-card`: each desktop stub is a
  `.react-grid-item > .panel-grid-card` (`PanelCardSkeleton.tsx` root), and the phone stack items carry it too.
- `Crossfade.tsx`: when loading ends the skeleton layer (`.crossfade__layer.crossfade__skeleton`) stays mounted,
  `aria-hidden` and `inert`, until its fade ends, then unmounts. The content layer is `.crossfade__layer` without
  `.crossfade__skeleton`. So for a moment after load the DOM holds BOTH the stub items and the real items.
- `getByLabel` does not filter aria-hidden nodes, so `getByLabel("Loading panels")` count 0 means "skeleton layer
  unmounted", not merely "loading flag false".
- hel1028:78 and hel1457:44/120 already wait for that count 0. hel1572 already uses the live-layer selector
  (HEL-1584). No e2e `flock` lock exists in the repo (`grep -rn flock scripts e2e package.json` hits only
  `scripts/concertino/cleanup.sh`), so repeat runs use no lock.

## Goals / Non-Goals

**Goals:** one reusable, non-vacuous "real grid is up and the skeleton is gone" wait; every `.react-grid-item`
count/measurement made right after a load either uses it (or an equivalent already present) or is justified in
writing; AC1 evidence.

**Non-Goals:** product code changes; HEL-1644; hel1681; widening into an unrelated flake hunt.

## Decisions

**D1. Helper `waitForPanelGrid(page, count, { timeout? })` in a new `e2e/support/panelGridReady.ts`** (desktop
widths only - say so in its doc comment; default per-step timeout 15 s, as hel1457 uses). It (1) asserts the
live-layer items `.crossfade__layer:not(.crossfade__skeleton) .react-grid-item` reach `count`, then (2) asserts
`getByLabel("Loading panels")` reaches count 0. It also exports the live-layer selector constant so specs that measure
use it instead of a bare `.react-grid-item`. Order matters: step 2 alone, right after `goto`, passes vacuously
before React has mounted anything; step 1 is the positive anchor that only the real grid can satisfy. Step 2 then
removes the fading stub items so later bare `.react-grid-item` locators in the same test cannot see them.
Alternative rejected: inline the two lines in each spec (hel1028/hel1457 style) - same behavior, but N copies of a
subtle ordering rule. Existing inline waits in hel1028/hel1457 MAY be switched to the helper only if the line is
otherwise touched; they are correct as they stand.

**D2. Per-hit classification rule for the sweep.** Grep: `grep -rn "react-grid-item" e2e`. Each hit gets exactly
one verdict:
- FIX - a bare `.react-grid-item` count/measure/`.first()`/`.nth()` reached right after a navigation, reload, or
  dashboard switch, with no prior wait in that test that already excludes the skeleton.
- OK-filtered - the locator is filtered by panel content (`hasText`, a title, a `data-*` attribute only real cards
  carry); skeleton stubs carry no titles or content, so they cannot satisfy it. Cite the filter. A filter on a
  skeleton-shared class (`has: .panel-grid-card`, `.panel-grid-card__top`/`__footer`, etc.) is NOT OK-filtered: the
  stubs satisfy it.
- OK-settled - an earlier wait in the same test already excluded the skeleton and no load happened since. Cite it.
- OK-not-a-load - the use is not after a load (e.g. a CSS/selector string in a stylesheet probe), or runs at a phone
  width where the skeleton has no `.react-grid-item`. Cite why.
- OK-already-waits - an existing `Loading panels` count 0 wait or live-layer selector covers it. Cite the line.
A "justified" verdict needs a line reference, not a category name alone.

**D3. Secondary grep for `.panel-grid-card`** (every skeleton stub renders that class, desktop and phone): recorded
in the same sweep file with its hit count; hits in files this change already edits get the D2 treatment; the rest
are listed as a follow-up candidate (noted as desktop-exposed too), not fixed here.

**D4. Guard spec `e2e/hel1633-panel-grid-ready.spec.ts`.** Desktop width, seed a dashboard with N panels, delay
`GET /api/dashboards/*/panels` with `page.route` (~1.5 s) so the skeleton is guaranteed on screen. Before navigating,
inject a style (`page.addInitScript` or equivalent) that sets ONLY `.crossfade__skeleton { transition-duration:
3000ms }` (constraint C3) - not the global motion token. Navigate with
`page.goto(url, { waitUntil: "commit" })` and call the helper immediately (timeout 15 s, above the stretched fade), so the "skeleton not mounted yet" window
deterministically exists when the helper starts. Directly after the helper returns, take ONE-SHOT, NON-RETRYING reads
(constraint C1): `await page.locator(".react-grid-item").count()`, `await getByLabel("Loading panels").count()`, one
`evaluateAll` for item boxes, then plain `expect(value)` - no `toHaveCount`/`expect.poll` there, because the stub
layer unmounts within ~280 ms (`--motion-duration-standard`) and a retrying matcher would hide a broken helper.
Asserts: total `.react-grid-item` count exactly N (no stub left), `Loading panels` count 0, every box non-zero.
Red-first proof (constraint C2), each recorded with its transcript: mutant A = helper with only step 2 (skeleton
count 0) - red because it returns vacuously before anything mounted; mutant B = helper with only step 1 (live-layer
count) - red because the stretched 3000 ms fade outlasts Playwright's longest retry interval (1000 ms), so the stubs
are deterministically still in the DOM at the one-shot read. Why the stretch: the guarded property is "the helper
waits out the fade however long it is"; at the real 280 ms a missing step 2 is visible only by poll-timing luck. Each mutant must be red on 5/5
repetitions of `--repeat-each 5`; a mutant red only sometimes is not evidence and must be redesigned, not reported.
Round-3 skeptic notes (adopted): the stretch rule must win the cascade over `Crossfade.css` (raise specificity,
e.g. `:root .crossfade .crossfade__skeleton`, or `!important`), and the guard asserts once while the skeleton is up
that its computed `transitionDuration` is `3s` and that the stub layer holds at least one `.react-grid-item` (seed a
real saved layout so stubs render). The fade-observing hel1584 motion specs are classified, not converted.
Registration / user cleanup follow the repo's existing e2e conventions (`registerAndLogin`, user registry) so
`check:e2e-user-cleanup` and the e2e-evidence checks stay green.

**D5. AC1 run.** Servers via `scripts/concertino/start-servers.sh`; then
`DEV_PORT=<port> nice -n 19 npx playwright test e2e/hel1572-appearance-preferences.spec.ts --repeat-each 30
--workers=2 --trace retain-on-failure`. "Under load" = the whole hel1572 file (every test, 30x) at 2 workers while
the machine carries its normal concurrent lane work; `uptime` load average and `free -g` are recorded before and
after. The pass/fail summary line and counts go into durable evidence. Also run the guard spec and every FIX'd spec
once (repeat-each 5 for the guard spec).

## Risks / Trade-offs

- [The 1-in-17 flake may now be gone already via HEL-1584's selector] -> AC1's 30x run measures it; the helper still
  adds the skeleton-gone wait so hel1572's `gridBoxes` never reads during the crossfade.
- [A guard that cannot go red] -> D4's recorded mutations, 5/5 red each, one-shot reads.
- [Helper called at a phone viewport times out (no `.react-grid-item` there)] -> doc comment says desktop only.
- [Machine contention with another lane] -> 2 workers, `nice -n 19`, check `free -g` first.

## Planner Notes

- Self-approved: test-only, no new dependency, no API change, `skip_specs: true`.
- Self-approved: helper over inline copies (D1).
