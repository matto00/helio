## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `b992e937 → 698961e1 → a720a4ec` against the RESCOPED goal (contention
between the 300ms debounced `/analyze` dispatch and an in-flight pipeline run). Every
number below is mine, produced in this worktree; nothing is taken from `evaluation-*.md`.

### What I verified (with evidence)

**Diff surface (ground truth).** `git diff main...HEAD --stat`: four non-artifact files —
`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`,
`frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`,
`e2e/hel912-lanes-rejoin.spec.ts`, `playwright.config.ts`. No other code touched.

**AC: un-quarantine is exact (item 5).** `git diff main...HEAD -- playwright.config.ts` removes
exactly 15 lines: the `"**/hel912-lanes-rejoin.spec.ts"` entry and its comment block. Nothing
else. `**/hel908-tail-attach.spec.ts` and `**/hel908-full-flow.spec.ts` both remain in
`testIgnore` — **HEL-962/HEL-964 untouched (item 6)**, and zero `hel908` files appear in the
diff.

**The `roots` fixture change in the e2e spec is legitimate, not scope drift.**
`PipelineProtocol.scala:103` records that HEL-913 removed `sourceDataSourceId` outright with no
alias; the quarantined spec's setup POST would have 400'd. Un-quarantining genuinely required it.

**Gates, re-run by me (not read from a report).** `npm run typecheck` PASS; `npm run lint` PASS
(`--max-warnings=0`); `npx jest --testPathPatterns=PipelineDetailPage` → 2 suites / 125 tests PASS.

**The regression guard is genuinely failable (mutation-checked myself).** I reverted ONLY the
hook to `698961e1` and ran the new test unchanged:
`Expected: 2 / Received: 7 — 1 failed`, then green on `a720a4ec`; tree restored (`git status`
clean). This is a real guard, not a green-only assertion.

**Item 1 — I re-derived the loop's death at four entry points with my own probes** (a temporary
copy of the test file, run then deleted; `git status` clean afterwards). `/analyze` mocked at
600ms, i.e. slower than the 300ms debounce — the condition that made cycle 2's loop invisible:

| Probe | Result |
|---|---|
| Analyze **rejects** (600ms → reject), 1 edit + 5.5s idle | **1** dispatch — no loop, no retry storm |
| **6 rapid alternating edits** during a slow analyze, then settle | **0** dispatches — correct: the net fingerprint returned to the last-analyzed one |
| **Run in flight, SSE never terminal**, then 1 edit + 2s idle | **0** dispatches — see CR1 |
| Unmount mid-deferral | no leak: refs die with the component, timer cleared by the effect cleanup |

The unbounded-redispatch defect is dead, and it is dead structurally (the fingerprint bail-out),
not incidentally.

**Item 3 — measurement validity under contention. I ran the experiment.** Servers started via
`scripts/concertino/start-servers.sh`; `assert-phase.sh servers` → `PASS servers`.
70 iterations of `e2e/hel912-lanes-rejoin.spec.ts`, `--workers=1`, on this branch:

| Run | Condition | Result | Failure signature(s) |
|---|---|---|---|
| 1 | idle box | 23/25 | 2 × target signature (`Run status: succeeded` timeout) |
| 2 | idle box | 24/25 | 1 × `locator.click` / `waitForResponse` timeout (the HEL-991 family) |
| 3 | **8 CPU hog processes on 12 cores**, load avg 13.2 | 19/20 | 1 × the `desktopTops[0]).toBe(desktopTops[1])` layout-pixel assertion at `:165` |

**The contention hypothesis is NOT supported by my measurement.** Under heavy artificial load the
target signature did not occur once in 20 iterations. I cannot reproduce a ~30x amplification of
*this* signature, so I do not think the local bar is invalidated by the HEL-991 environment gap —
that is the opposite of what the brief expected, and I am reporting it as measured. Item 3 is
**not** a REFUTE ground.

**Item 4 — the residual is worse than "1.7%, owned by HEL-992".** Across my 70 iterations the
spec red-lined **4 times (~5.7%)** from **three distinct causes**, only one of which is owned:
target signature (HEL-992), the `:165` layout-pixel assertion (**unowned**), and the
`locator.click` timeout (the signature for which PR #566 *just quarantined* `hel968` as HEL-991,
now closed). See CR2.

**Item 2 — design judgment (mine to make).** One dispatch decision is now governed by six pieces
of mutable state: `skipNextAnalyzeRef`, `stepsRef`, `sseActiveRef`, `analyzeStatusRef`,
`pendingAnalyzeRef`, `lastAnalyzedFingerprintRef`, plus an effect whose own dependency
(`analyzeStatus`) is a side effect of the dispatch it performs. Cycle 2 demonstrates empirically
that this is already past the point where a competent engineer gets it right by reading. The
comments are unusually good and the guard test is mutation-verified, so I do **not** block on
this — but see the non-blocking note; CR1's fix touches this same logic and is the right moment.

### Verdict: REFUTE

Two required revisions. Neither re-litigates the settled A/B history or the refuted DOM-detach
premise; both are new findings from my own probes.

### Change Requests

1. **The `sseActive` guard is unbounded in time and can permanently disable re-analyze for the
   rest of the page session.** `usePipelineDetailPage.ts:307` suppresses the dispatch while
   `sseActiveRef.current` is true. `sseActive` is set true in `handleRunPipeline`
   (`:1076`) / `handleDryRun` (`:1089`) and cleared in exactly two places: the SSE `onTerminal`
   handler (`:187`) and the submit-failure `catch` (`:1082`/`:1095`). It is **never** cleared when
   the stream fails to open, returns a non-SSE response, or drops mid-run —
   `usePipelineRunEvents.ts` sets `connectionError` for all three and returns, and
   `grep -rn connectionError frontend/src` shows **no non-test consumer anywhere**. It is also
   never cleared if the terminal event is simply missed: `PipelineRunStreamRoutes.scala:43` is a
   live `registry.subscribe` with no replay, so a run that finishes before the browser's
   subscription lands emits its terminal event to nobody.
   Measured consequence on this branch (my probe, above): after a run whose stream never
   terminates, a subsequent step edit produces **0** analyze dispatches — and every later edit does
   too, silently, forever. `pendingAnalyzeRef` stays armed and the analyze panel keeps showing
   pre-edit results with no pending request to correct it, which is precisely the outcome the
   design doc says deferral (rather than dropping) exists to prevent. On `main` the same sequence
   dispatches normally, so this is a regression introduced here, and it is the same *shape* as the
   cycle-2 defect: unbounded, and invisible to every happy-path fixture.
   Required: make the guard fail-safe rather than fail-stuck. Either clear `sseActive` when
   `usePipelineRunEvents` reports a `connectionError`, or bound the deferral (e.g. a maximum defer
   window after which the pending dispatch proceeds regardless), so no single stuck flag can
   suppress re-analyze indefinitely. Add a test that exercises "run submitted, no terminal event
   ever arrives, edit → analyze eventually dispatches" — my probe shows this is testable in the
   existing jsdom harness without an SSE transport.

2. **"Un-quarantined AND passes repeatedly" is not what the measurements show, and two of the
   three causes are unowned.** My 70 iterations: 4 failures (~5.7%) from three distinct
   signatures. HEL-992 covers only `Run status: succeeded`. The `:165` layout-pixel assertion
   (2/60 for the evaluator, 1/20 for me) and the `locator.click`/`waitForResponse` timeout (1/25
   for me — the same signature for which `hel968` was quarantined via PR #566) are owned by
   nothing. Un-quarantining as-is re-arms a spec that will red roughly one PR in eighteen from
   causes no ticket is tracking — the exact tax this ticket was raised Urgent to remove.
   Required, and cheap: (a) file/extend ownership so **every** signature observed in this spec has
   a ticket (extend HEL-992's scope or file a sibling for the `:165` assertion and for the
   click-timeout occurrence in `hel912`, noting HEL-991 is closed); and (b) correct the change's
   own claims — `probe-findings.md` / `workflow-state.md` / `tasks.md` should state the measured
   **composite** red rate for this spec and its three components, not "passes repeatedly" against
   the target signature alone. A reader deciding whether to trust a red `hel912` in CI needs the
   composite number.

### Non-blocking notes

- **Extract the debounced-analyze decision into its own hook.** Six pieces of state and a
  self-triggering dependency for one `dispatch` is at the edge of maintainable. `useDebouncedAnalyze
  ({ id, stepsFingerprint, blocked })` with its own focused unit tests would make the invariant
  ("dispatch iff the guard is clear AND something new is pending") testable in isolation instead of
  through a 2,600-line page harness. CR1 touches this logic anyway.
- The evaluator's own Finding 1 identified the `sseActive` risk and consciously declined to block.
  I reached the same finding independently and reached the opposite conclusion — the deciding
  evidence is the missed-terminal race in `PipelineRunStreamRoutes.scala` (no replay), which makes
  the trigger ordinary rather than exotic.
- Contention probing (item 3) came back clean; I would not spend further budget there.
