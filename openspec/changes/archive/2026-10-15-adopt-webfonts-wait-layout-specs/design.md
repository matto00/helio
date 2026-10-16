## Context

See proposal.md - Why. Facts from the tree (main 67c434c6b):

- `e2e/support/webFonts.ts` `waitForWebFonts(target: Locator)` is ROW-SCOPED: `readFontState` resolves
  `target.closest("tr")` and is never `settled` when that is `null`. Its only caller is `settledRowTop`
  (`e2e/support/rowDeleteGesture.ts:26`). Adopting it outside table rows therefore needs a scope change.
- `e2e/hel1510-output-editor-table-overflow.spec.ts` measures `getBoundingClientRect().right` of Configuration-card
  controls against the card's content box (+0.5px slack) and the modal body's `scrollWidth <= clientWidth`, right
  after the long column name is visible - no font wait.
- `e2e/hel813-mobile-touch-target-floor.spec.ts` measures rendered tap-target boxes via `e2e/support/
  touchTargetProbe.ts` (`measureBox`/`assertFloor`/`sweepSurface`/`bisectHitExtent`) at 430/768px; surface 7 is
  `/connectors` (:298). `.regression.spec.ts` is one-shot and NOT CI-gated (`testIgnore`, env guard, own config).
- A first-pass grep (`boundingBox|getBoundingClientRect|scrollWidth|clientWidth|offsetWidth|overflow|
  toHaveScreenshot`; the recorded sweep also adds `toBeInViewport|scrollHeight|clientHeight|offsetHeight|
  elementFromPoint|getClientRects`) hits 35 spec files plus 4 support files; many use `boundingBox` only to compute a click point,
  not to assert geometry. The executor re-runs and records the sweep (D2).
- HEL-1606's forced-delay method: `page.route` on `fonts.gstatic.com` (and/or `fonts.googleapis.com`) delaying the
  response so the swap lands after the measurement (archive `.../2026-10-15-wait-webfonts-row-gestures/
  evidence/scratch-specs/zzrepro-hel1606.spec.ts.txt`). `playwright.config.ts` has `retries: 0`.

## Goals / Non-Goals

**Goals:** a probe-grounded answer for hel1510/hel813; a recorded, classified sweep; every font-sensitive geometry
assertion waits for the swap, each conversion proven red-under-delay then green.

**Non-Goals:** product font changes; touching specs whose asserted measurement the delay cannot change; any spec
owned by a concurrent lane (HEL-1612 is jest-only, HEL-1610 backend-only - no e2e overlap expected).

## Decisions

**D1 - Probe first (gating).** Before converting anything, the executor runs scratch (uncommitted) forced-delay
variants of `hel1510` and `hel813` surface 7 at 768px (and 430px),
and records: the asserted values with and without the delay, and whether the assertion goes red.
The delay is NOT a tuned timer (flaky for a ~13-call window): the scratch spec HOLDS the font responses
(`page.route` handler awaiting a promise the spec resolves) and releases them at chosen points - hel1510: after the card
limit is computed and before the controls are measured; hel813 surface 7: between each pair of measurement steps.
It also exercises fallback-only (never released) and mixed states (one family released at a time: Schibsted Grotesk
vs JetBrains Mono), or the report states exactly which states were exercised. Outcome per spec: CONFIRMED (red in some
exercised state) or REFUTED (assertion holds in every exercised state, fallback-only AND mid-measurement release). A REFUTED spec is not converted on the ticket's suspicion alone; the report states the evidence, and
any remaining unexplained flake is surfaced as a follow-up suggestion (not silently "fixed").

**D2 - Recorded sweep.** The exact grep command(s) and full hit list are saved as change evidence
(`openspec/changes/<change>/evidence/sweep.md`), with one row per hit file: ASSERTS-GEOMETRY (an `expect` depends on
a px measurement / overflow / screenshot) vs POSITION-ONLY (box used only to aim a pointer, or a non-text-dependent
measurement) vs N/A, plus the line numbers relied on. Support helpers that feed assertions (`touchTargetProbe.ts`,
`focusPresenceProbe.ts`) are classified too, and their callers inherit their classification.

**D3 - Conversion criterion.** A spec/test is converted iff a forced-delay run makes its asserted measurement fail
(red) - the ticket's own proof bar. ASSERTS-GEOMETRY tests whose assertion stays green under the delay are listed
in the sweep as "font-insensitive under delay (value X vs Y)" and left unchanged; this keeps the diff to proven
cases. Position-only uses are out of scope (HEL-1606 already covers the row double-click path).

**D4 - Helper scope (backward compatible).** Generalise `readFontState` to scope to `target.closest("tr") ??
target`, so existing row callers behave identically and a non-row target (a card, a dialog, `page.locator("body")`)
checks the families of text inside that element. The timeout message names the scope instead of "the target row".
Alternative rejected: a separate page-wide helper - duplicates the non-vacuity logic HEL-1606's skeptic hardened.
Where a shared helper is the measurement entry point (e.g. `touchTargetProbe.ts`), the wait goes there if every
caller benefits; otherwise per spec. The wait runs before EACH measurement step whose measured element contains newly
rendered text (not once per navigation: e.g. hel813 surface 7 measures the empty-state button, then the Add connector
dialog, then a list row whose cells use JetBrains Mono, `ConnectorsPage.css:110-111/:230-231`, first requested only
after the row exists), scoped to the narrowest measured container, after any existing animation settle (hel813's
400ms wait stays, the font wait follows it), and never inside a retry/poll of an assertion. The helper's
"once per navigation" comment is updated to match.

**D5 - Red/green proof.** For each converted spec, covering EVERY step that gets a wait (D4): a forced-delay run on the pre-conversion code (red, with the
failing assertion text), and the same forced-delay run with the conversion (green). The forced-delay mechanism lives
in a scratch file or an uncommitted local patch - not in the committed suite - unless the executor finds it cheap
and deterministic (state which). Logs saved under `evidence/` with this worktree's paths and non-zero counts.

Green-run note: with held fonts, release them concurrently (e.g. on a timer) in the green run, else a newly inserted
wait placed before a fixed release point deadlocks to its 10s timeout. Fraunces joins the mixed-state list only if a
measured surface uses it (else the report says it was not exercised). The settled check is page-wide for `loading`
faces, so a scoped wait can block on a held face the scope does not use - read mixed-state results accordingly.

**D6 - Full suite.** Run the FULL e2e suite (`npm run e2e` equivalent, every project, not `--grep`) on the final
head with `--workers=2` under `nice -n 19`; record pass/fail/skip counts. Any failure is investigated, not retried.

## Risks / Trade-offs

- [Delay cannot make hel1510/hel813 red -> mechanism refuted] -> report honestly per D1; no speculative conversion.
- [Body-scoped wait slower in CI (fonts from Google CDN)] -> bounded 10s, loud; fonts cached per context.
- [Converting touchTargetProbe.ts also changes the regression harness] -> it reuses the same helper by design; run
  it only if changed and cheap, else state it is NOT CI-gated and untouched by behaviour.

## Planner Notes

- Self-approved: test-only, no new dependency, no product change, `skip_specs: true`.
- Unattended overnight run: refuted mechanisms become follow-up suggestions, not escalations.
