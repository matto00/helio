## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read from ground truth, not from narrative: `ticket.md`, `proposal.md`, `design.md`,
`tasks.md`, `specs/mobile-touch-target-verification/spec.md`, plus `DESIGN.md`,
`.github/workflows/ci.yml`, `playwright.config.ts`, `package.json`, `e2e/`.

**Binding-constraint checklist from the delivery request:**

| Constraint | Verdict | Evidence |
|---|---|---|
| NOT a `*.css.test.ts` text-matching test | MET | proposal "What Changes"; design D1; spec Req 1 explicitly forbids matching CSS source text |
| Runtime rendered-geometry Playwright sweep | MET | design D1/D2; `assertFloor` on `getBoundingClientRect()`, both axes, 430/768 |
| RED against HEL-535 above-base-rule `@media` inert floor | PARTIAL | design D1 + task 3.1 plan it; no green-before/red-after pairing specified (CR7) |
| RED against height-only floor on fixed-width control | PARTIAL | task 3.2; same missing baseline pairing (CR7) |
| Fails (not passes) on zero visible matches per surface | PARTIAL | `sweepSurface` throws on zero (D2), spec Req 3 — but collides unresolved with D3 surface 6 (CR5) |
| Intentionally-unfloored discriminating control | PARTIAL | D4 names `input[type="color"]`; verified such inputs exist (`frontend/src/features/settings/ui/PreferencesEditor.tsx:204,237,249`). But no exemption mechanism exists in the helper contract (CR1) |
| `::after` bisection w/ `>= 44 - samplingStep` epsilon | MET | D2 `bisectHitExtent`, task 2.4, spec Req 5. I read `DESIGN.md` lines ~193-224 myself; the epsilon rule ("`>= 44 - samplingStep`, never a literal `>= 44`"; threshold takes the epsilon, not the gap) is reproduced faithfully |
| Surfaces enumerated + exclusions named | MET | design D3: six surfaces, three named exclusions |
| Allowlist new violations + file follow-up tickets | PARTIAL | tasks 5.1-5.3 plan it; the allowlist has no home in the helper API (CR1) |
| Runs in CI | NOT MET | design D5 adds the job, but task 4.2 explicitly plans to *not verify it* on a false premise (CR2) |

**Independently verified factual claims in the plan:**
- design.md's Context claim that `.github/workflows/ci.yml` has no Playwright/e2e job is **true** —
  `grep -n "^  [a-z_-]*:"` returns only `frontend:` (L23) and `backend:` (L41).
- `e2e/` exists with 7 specs and the `helNNN-*.spec.ts` convention; `npm run e2e` = `playwright test`;
  `playwright.config.ts` has `testDir: "./e2e"` and **no `testIgnore`** — load-bearing for CR3.
- Breakpoint concern dissolved (not a CR): all mobile media queries are
  `@media (max-width: 768px)` (29) / `(max-width: 430px)` (10) — inclusive, so measuring at exactly
  430px and 768px does land inside the floor's media block. The plan's viewport choice is sound.

**Environmental note (not a BLOCKER):** the worktree's `scripts/concertino/` is a partial copy and
lacks `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`; I used the main repo's
copies with an absolute path argument, which is what they take. Worth the orchestrator's attention.

### Verdict: REFUTE

The plan is directionally correct and gets the hard parts (rendered geometry, both axes, bisection
epsilon, surface enumeration) right. It fails on two independently-blocking gaps and four smaller
ones. Given this ticket exists *because* seven incidents reached a gate behind verification that
proved nothing, CR1 and CR2 are not nits — each would reproduce the exact failure mode being fixed.

### Change Requests

1. **The helper contract has no exemption/allowlist mechanism, yet two requirements depend on one.**
   design.md D2 specifies `sweepSurface(page, selectors[])` as "runs `assertFloor` over every visible
   match". But D4 requires an `input[type="color"]` swatch to be swept *and pass at sub-44px*, and
   task 5.2 requires "an explicit, commented allowlist skip … referencing that ticket id". Both are
   impossible against the API as designed: the color swatch is a form control that the selector set
   will match and `assertFloor` will fail on. Add an explicit exemption contract to D2 —
   e.g. `sweepSurface(page, { selectors, exempt: [{ selector, reason, ticket? }] })` — and state
   (a) that exempt matches are excluded from the floor assertion but **still counted toward the
   non-zero visible-match requirement is NOT acceptable** (they must not be able to satisfy Req 3
   on their own), and (b) that every allowlist entry requires a ticket id. Without this the executor
   must invent the mechanism, and the cheapest invention (broaden the selector to exclude
   `input[type=color]`) silently deletes the discrimination proof the ticket demands.

2. **The "Runs in CI" acceptance criterion is planned to ship unverified, on a false premise.**
   Task 4.2 states "a real CI run cannot be observed pre-merge". That is incorrect: `ci.yml` line 11
   triggers on `pull_request: branches: [main]`, and this workflow opens a PR before merging, so the
   new `e2e` job **will** run and be observable on the PR before merge. Replace 4.2 with: push the
   branch, open the PR, and capture the actual `gh run view` / `gh pr checks` output for the new
   `e2e` job as evidence that it ran and passed. A YAML-validity review is not evidence that a
   full-stack (postgres + `sbt run` + Vite + Playwright) job works, and "documented as a limitation"
   is precisely the shape of non-evidence this ticket was filed to eliminate. If the job proves too
   slow/flaky to go green, that is a design finding to surface, not to defer.

3. **The source-mutating regression harness will be collected by the default test run.**
   `playwright.config.ts` sets `testDir: "./e2e"` with no `testIgnore`, so
   `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` is picked up by a bare `npm run e2e` —
   meaning any developer or agent running the e2e suite silently mutates real component source
   (design.md's own Risks section flags interrupted mutation as dangerous). Add to the plan either a
   `testIgnore` entry for `*.regression.spec.ts`, or a required env-var opt-in guard
   (`test.skip(!process.env.HEL813_REGRESSION, ...)`), and state which. Also note this interacts with
   D5's stated follow-up of broadening the CI e2e job to all of `e2e/`.

4. **proposal.md's Impact section contradicts design.md D5 and is factually wrong.**
   proposal.md Impact says "CI: Playwright job picks the new spec up automatically (existing glob in
   `e2e/`)". There is no existing CI Playwright job (design.md's own Context correctly says so, and I
   confirmed it), and D5 deliberately scopes CI to a single named spec file rather than a glob.
   Correct the proposal to match D5: a new `e2e` job is added, scoped to the one guard spec.

5. **The no-vacuous-pass rule and covered-surface 6 are in unresolved tension.**
   D2 says `sweepSurface` "throws (fails) if the visible-match count is zero"; spec Req 3 says a
   surface with all-hidden candidates must fail. But D3 surface 6 / task 2.2 require asserting the
   panel-list zoom controls **are** hidden at 430px. As written, the executor faces a contradiction
   and will resolve it by inventing an escape hatch — the same class of hatch that produced HEL-781's
   vacuous pass. Specify the contract explicitly: an *expected-hidden* control is asserted hidden by a
   named, per-control assertion (`assertHiddenAtWidth`) that is **separate from** `sweepSurface`, and
   the surface's `sweepSurface` call must still find >0 visible floored candidates from other
   controls on that surface (name at least one, e.g. `.panel-list__add`) or the surface is not
   coverable at that width and must be listed as such.

6. **Task 1.2 is a non-task.** It reads as a checkbox whose body says to skip it ("skip a jsdom unit
   test"). It can never be meaningfully completed or verified. Delete it, or convert its content into
   a design.md note.

7. **The RED demonstrations need an explicit green-before / red-after pairing per case.**
   Tasks 3.1/3.2 assert the guard "goes red" after mutation but never require capturing that the same
   control, measured by the same helper, was **green immediately before** the mutation and green
   again after revert. Without the paired baseline, a red proves only that the mutation broke
   something. Add to 3.1/3.2/3.3 an explicit three-point capture per case (pass → mutate → fail →
   revert → pass), and require the evidence in 3.3 to show all three.

### Non-blocking notes

- D2's `bisectHitExtent(page, centerPoint, axis, samplingStep)` returns an extent and leaves the
  epsilon comparison to callers. Consider asserting inside the helper instead, so no caller can
  reintroduce a literal `>= 44` — DESIGN.md is emphatic that this specific mistake recurs.
- D5 picks `postgres:16` "matching `embedded-postgres` used in backend tests"; note that dev is
  Postgres 18 and prod 16 (a known drift documented in prior incidents). 16 is the right pick for CI;
  just don't let a version-sensitive failure be misdiagnosed.
- D3 lists surfaces by incident ticket, which is good provenance. Consider also recording, per
  surface, the concrete route/URL the spec navigates to — it makes surface coverage auditable at
  review time rather than inferable from class names.
