## Context

See proposal.md (Why). HEL-1172 (647f1f111) rendered a multi-denial toast as a `ul.toast__list` (`overflow-y: auto`,
bounded max height) of rows: a router `Link`, reason text, and an optional "Run to update" button. D8 hands focus to the
row's link after its action is consumed (`ToastRowList` `useLayoutEffect` keyed on `items`) and away from a removed
toast (`useToastFocusHandOff`). The failing step focuses Alpha's link programmatically, presses Tab twice, and expects
Beta's link. `Received: inactive` only means the Beta link is not `document.activeElement`; where focus actually went is
unknown until task 1.1 reads the CI error-context and trace. It passes on most CI runs and on main.

Ground truth from CI (design-gate skeptic round 1): `playwright.config.ts` sets `retries: 0`; the two failures are the two
job attempts (138066772289, 138078446434) of run 45281484916, each ending `1 failed`. The same leg on main (run
45274842197, job 138043835875) ran the identical 147-test leg, with `hel1172:105` again the first test of its worker and
`hel1096-run-to-update-affordance.spec.ts:131` again running concurrently, and passed in ~25 s against ~36 s on the
failing run. Shard company is therefore NOT the differentiator. Leading differentiators: timing/load and cold start
(first test of a fresh worker against a just-started Vite dev server, `[dev]` project).

The test is preceded by `page.waitForTimeout(5500)` (auto-dismiss window) and runs after `submitNote` triggers the form
submit that produces the denial toast; background activity in that window (status polling such as `panelStatusStore`,
pipeline-run status, other toasts, a dashboard refresh) is uncontrolled.

## Goals / Non-Goals

**Goals:**
- Name the root cause with a probe (systematic-debugging law: no fix without a probe-confirmed cause).
- Red first under CI-like conditions, then the same repeated run green after the fix.
- Fix the product when a real keyboard user can hit it.

**Non-Goals:**
- Any change to HEL-1825's PR #1252 or CI workflow files.
- Redesigning the toast surface or D8 semantics beyond what the root cause requires.
- Fixing other listed flakes (C11).

## Decisions

**D1 — Evidence before hypothesis.** First pull the failed jobs' artifacts (`gh run download 45281484916`, the `e2e (7)`
report/trace/error-context for both attempts) and read where focus actually was at the failure (the error-context
snapshot / trace's DOM and console). Then reproduce locally on the `[dev]` project (the
failing configuration; primary target) with two complementary loops, both Playwright 2 workers total:
(a) a cold-start loop: for each iteration restart the lane servers via `scripts/concertino/stop-servers.sh` and
`start-servers.sh` (never a bare npm/vite), then run the leg-7 order (`node scripts/e2e-shard.mjs` plan for leg 7 of 8,
or at minimum `hel1172-multi-denial-toast.spec.ts` with `hel1096-run-to-update-affordance.spec.ts` so `hel1172:105` is
worker-first and `hel1096:131` runs concurrently); (b) throttled warm runs with `--repeat-each` under CPU throttle (CDP
`Emulation.setCPUThrottlingRate` via a probe fixture, or `taskset` to restrict cores). `--repeat-each` warms the server and
module graph after the first iteration, so (a) is not optional. `npm run e2e:prod-build` is a secondary widening step
only, since it moves away from the failing configuration. Alternative (reasoning from code alone) rejected: the ticket lists five
plausible candidates and the law requires a probe to choose.

**D1 deviation (HEL-1842 execution):** the cold-start loop (a) and CPU throttle (b) were not run; the probe showed the cause is id-sorted row order, independent of timing, and red reproduced warm (see `root-cause.md`, `red-rate.txt`). CI-condition evidence is the two CI error-contexts (`ci-artifacts.txt`).

**D2 — Probe instrumentation is temporary and out of the shipped diff.** Probes (e.g. a `focusin`/`focusout`/
`MutationObserver` log on `.toast-viewport`, recording `document.activeElement` and whether the toast `li`/`a` nodes are
the same objects before and after each Tab, plus Redux toast-store transitions) live in a scratch spec or a temporary
diff, with their output kept as evidence (`.concertino/runs/HEL-1842/evidence/` and the change dir as `.txt`).

**D3 — Product vs test decision rule.** Product defect if the failing sequence can occur with real key presses and no
test-only action (e.g. DOM replacement of rows on a store update, a focusable scroll container or element inserted between
rows, a focus hand-off firing on a non-removal update, a second toast stealing focus). Test defect only if the failure
requires a Playwright-only action or an assertion of something the product never promised (e.g. a programmatic `.focus()`
on an element that the browser doesn't treat as the sequential-navigation starting point, or a race with test-only
setup). A test-defect fix must not weaken the keyboard-order assertion: it still proves Alpha link -> Alpha run -> Beta link
-> Beta run with real Tab presses.

**D4 — No waits/timeouts as the fix.** Adding `waitForTimeout`, longer `expect` timeouts, retries, or `toPass` loops around
the Tab sequence is not an acceptable fix. Waiting on a named, product-observable condition the root cause identifies (e.g.
"the status refresh that re-renders the list has settled") is acceptable only if the root cause is shown to be test-side.

**D5 — Guard.** Add a guard that fails when the fix is mutated away: a jest test in `Toast.items.test.tsx`/
`ToastRowList`-level for a product fix (e.g. row DOM identity / tab order survives the triggering update), and the e2e spec
under repeat for the integration. Record the mutation run.

**D5a — Acceptance signal.** The red baseline is recorded as k failures in N runs under named conditions (which loop,
throttle rate, worker count, company). The post-fix run uses the same conditions (including the cold-start loop if that
is what produced red) with N_post >= ceil(3/p), p = k/N, so zero failures has roughly a 95% chance of detecting an
unchanged defect. The arithmetic is stated in the committed `.txt` or `root-cause.md`.

**D6 — Shard weight.** `e2e/shard-weights.tsv` is generated from CI run artifacts (`node scripts/e2e-shard.mjs weights`).
Its header records provenance as a median across runs and several other specs are also defaulted, so a hand-added row
for this one spec would break that provenance; the expected outcome is to leave it defaulted and say why (in the PR),
unless the planner's own tests or docs say otherwise. Shard company is also shown above not to be the differentiator. The weight row is not the fix.

## Risks / Trade-offs

- [Cannot reproduce locally] -> widen conditions (more cold-start iterations, stronger throttle, exact leg-7 company,
  repeat count up; production build via `npm run e2e:prod-build` per C1 last, as secondary) before concluding; if still not reproducible, escalate with the artifact
  evidence rather than shipping a speculative fix.
- [Root cause is in a shared toast mechanism] -> keep the fix minimal and run every toast unit test and the HEL-1172 and
  toast-related e2e specs.
- [Fix changes D8 semantics] -> D8's own scenarios in `run-to-update-affordance` must still pass unchanged.

## Migration Plan

None (frontend/test only, no data or API change).
