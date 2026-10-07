## Context

See proposal.md — Why. Evidence already gathered (CI artifacts of runs 37387266551 / 37384908643, downloaded traces):

- **hel519** (main line 84, test "visiting a source from its list records it under Recent"). Page snapshot at failure:
  route `/pipelines`, palette open, groups Navigation/General/Create, **no Recent group**. Recording of sources is
  `RecentVisitsRouteObserver.tsx`: a `useEffect` on `location.pathname` — it fires only once a render with
  `/sources/:id` *commits*. The spec proceeds on `page.waitForURL(...)`, which resolves on the URL change (history
  push), not on the route rendering. React Router 7 wraps navigations in `startTransition`; a transition that has not
  committed is superseded by the next navigation (the sidebar "Data Pipelines" click) and never commits. Sibling tests
  in the same file wait for the detail heading before moving on; this one does not. Second candidate: the prune
  listener (`recentVisitsListeners.ts`, sources `status` → `succeeded` with a list lacking the id).
- **hel910** (line 90). Both CI traces: no single action stalls (largest single steps are `goto` 1.6–2.8s, the
  "Outputs" tab click 1.5–2.6s, the post-`/` heading wait ~1.6s). Measured from the first trace event, the step in flight at the 30s
  default per-test timeout started at ~29.1s (run 1, 3 workers: third option click) and ~29.5s (run 2, 4 workers:
  first option click; terminal error reported on the next "Dashboard actions" click). Unmeasured overhead before
  the scenario proper: register + UI login ≈4.5–5.5s; a full `page.goto("/")` reload + heading ≈3.4–4.1s.
- **HEL-1289 class** (driver/HEL-1300 coordination, owner ruling: this lane owns all edits to both files). Both specs
  log in through the UI (landing on live `/`) and then seed via API. Both failing steps follow a fresh `page.goto`, which
  discards the live `/` store — so the claim to verify is that this race is **not** the cause of either failure.

## Goals / Non-Goals

**Goals:** one probe-confirmed root cause per spec; a fix at the cause; contended failure rate before, ≥20
consecutive contended greens after; a recorded verdict on whether the HEL-1289 race applies to each file.

**Non-Goals:** `playwright.config.ts`, `ci.yml`, worker counts (HEL-1288); other specs (HEL-1300); the
`isolateLivePage` helper (HEL-1300, unmerged); raising hel910's `toBeLessThanOrEqual(30)` interaction ceiling.

## Decisions

**D1 — Reproduce before fixing; the green-run configuration must be one proven to go red.** Two methods:
(a) host contention: Playwright `--workers=2` under `nice -n 19` plus ≤3 niced CPU burners (PIDs recorded, killed by
PID only), `--repeat-each` on the single test; (b) renderer throttling via CDP `Emulation.setCPUThrottlingRate`.
Per spec, record the failure rate of the *unchanged* spec over a stated sample (≥20 attempts, recorded as "k/n red").
A configuration is **reproducing** only if it fails in the CI failure mode (hel519: no Recent group; hel910: 30s test
timeout) at a rate p with (1−p)^20 ≤ 0.05, i.e. **p ≥ ~14%** — otherwise 20 straight greens on an unfixed spec would be
likely by chance. If (a) falls short, climb the CDP throttle ladder (e.g. 2x, 4x, 6x…), optionally combined with (a),
until the threshold is met; if no permitted configuration meets it, escalate with the numbers and do not claim the AC.
The "cause removed → green" half of the flip-both-ways confirmation uses at least as many attempts as would have shown
≥1 red at the measured p. Throttling alone approximates the CI mode (renderer only, not vite/backend/postgres); record
that, with the confirmatory CI run as backstop.
**Throttle mechanism (named):** an untracked, throttled copy of the spec under test,
`e2e/zz-hel1298-throttle-<spec>.spec.ts` (inside `testDir`, matches no `testIgnore`), identical to the committed spec
except for one `test.beforeEach` that opens a CDP session and calls `Emulation.setCPUThrottlingRate`. Evidence for every
probe/greens batch includes `diff <committed spec> <throttled copy>` captured at that time, showing only the hook (and
any import it needs) differs. Any later edit to the committed spec invalidates prior greens and the copy is regenerated
and re-run. Copies are deleted before commit and listed as created+deleted in `files-modified.md`. The ≥20 consecutive
greens (task 4.1) run under the same reproducing configuration, against the fixed spec (via a regenerated copy when
throttled). A root cause is "confirmed" only when a targeted probe flips the outcome both ways (cause present → red,
cause removed → green).

**D2 — hel519 decision tree.** Instrument the probe run to log, per attempt: (i) whether the `/sources/:id` detail view
rendered before the sidebar click; (ii) the recent-history `localStorage` contents just before opening the palette,
including whether the source entry carries a `title`; (iii) whether a prune ran (sources status → `succeeded`).
- (A) Detail view never rendered, no entry → **test defect**: the test asserted an arrival it never waited for. Fix:
  replace the bare `waitForURL` gate with a web-first assertion that the detail view rendered (as the pipeline tests do
  with their heading), then navigate. Assertions unchanged.
- (B) Detail view rendered, entry absent (never recorded, or recorded then pruned/lost) → **product defect**.
- (C) Entry present in storage but no Recent row (e.g. recorded untitled because `sources.items` was not loaded at
  commit, then `useRecentPaletteActions.ts` skips the `null` title) → **product defect**.
- (D) Detail view rendered and no entry recorded at all → **product defect** (sub-case of B, called out explicitly).
- Product branches (B/C/D): fix in `frontend/src/features/commandPalette/**`, add a Jest test red without the fix
  (mutation-proven), add a `palette-recent-navigation` delta spec and remove `skip_specs`.
- Any outcome outside A–D, or mixed outcomes across attempts → keep probing; do not force-fit a branch. Every
  observed failing attempt must be classified; if attempts split across branches, each branch gets its own fix.
Self-approved: a click whose route never rendered is not a "visit" under the spec's "arrival" wording; recording on
URL change instead of commit would be a product behavior change and needs its own ticket.

**D3 — hel910 decision rule, with margin arithmetic.** Projected from the CI traces: run 1 (3w) needed ~31.7s to
finish (in-flight option click + picker hide ~0.8s + grid count ~0.5s); run 2 (4w) needed ~37–38s (two remaining
Dashboard-actions → menuitem → option → hide cycles at ~2.8s each). Replacing UI login with an API session saves ~4–5s:
~27s for run 1 (~8% headroom) and ~33s for run 2 (still red). Overhead removal alone is therefore **not** presumed
sufficient. Before concluding "overhead only", measure idle vs. contended per-step cost for the dominant steps —
Outputs tab click (1.5–2.6s contended), "New pipeline" click (0.9–2.1s), Add-panel option click (1.1–1.5s), `/` heading
wait (1.6s) — and investigate any step whose contended cost is disproportionate as a possible product slowness
(HEL-1294 precedent: e.g. an actionability wait on an element that keeps re-rendering/animating), fixing it at the
cause with a red-without-fix test if it is product. Remove unmeasured overhead without changing any `io.click`/
`io.enter` count or assertion: e.g. an API session (`page.request` shares the context's cookie jar) instead of a UI
login page load, and seeding the dashboard before the first page load (which also retires this file's HEL-1289 shape).
**Robustness criterion:** every green run in task 4.1 records its wall-clock duration; report max and p95. The max
under the reproducing configuration must be ≤ 27s (≥10% headroom below the 30s budget). A green set with max > 27s is
not delivered — escalate with the numbers, stating the throttle rate/contention used so the owner can judge it. Raising the test timeout (`test.setTimeout`/`test.slow()`) is not a fix;
if the criterion cannot be met, escalate rather than add one.

**D4 — HEL-1289 verdict.** Record per file in the PR body: does the seed-while-`/`-live race apply, and did it cause
the failure (expected: no for both failing tests, per the fresh-`goto` evidence). Also check HEL-1300's claim that
hel519's "full reload auto-selected dashboard" test can pass for the wrong reason (the live `/` records the dashboard
before the reload under test); record the verdict with evidence. Fixing that test is out of this ticket's AC unless the
fix is the same edit already made for D3-style seeding; otherwise report it as a follow-up.

## Risks / Trade-offs

- [Local 6c/12t host ≠ 4-vCPU CI runner] → use both methods in D1; finish with one CI run (shards as configured on
  main, 2 workers) — CI evidence is confirmatory, the ≥20 greens are local contended runs.
- [Shared dev DB residue] → each run registers users; record every created user email/id from the run output.
- [HEL-1288 also edits hel519's header] → this change touches only test bodies/helpers; different hunk.

## Planner Notes

- Self-approved: `skip_specs: true` unless D2's product branch is taken.
- Self-approved: probe specs live in the scratchpad (or an untracked file deleted before commit), never committed.
