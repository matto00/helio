## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Commit reviewed: `75b865cf` on `bug/opdropdown-anchor-detach-race/hel-972`. Cold review; every
result below is from a command I ran myself in this worktree.

### Headline

**No fourth code defect exists.** I hunted the watchdog hard, adversarially, with slow mocks and
long idle windows, and it is bounded, leak-free, and self-cancelling on every path I could
construct. The code is sound and strictly better than `main`.

The one thing I am blocking on is **documentation, not code**: the spec delta this change ships
states an unconditional `SHALL NOT`, and the shipped code demonstrably violates it (by design,
via the new watchdog). That is the same class of defect that got cycle 1 refuted — a contract
artifact that describes behavior the code does not have — and it conceals this ticket's one
remaining known-unsafe case from whoever reads the archived spec next.

### What I verified (with evidence)

**1. The watchdog — my primary assignment. Probed, not read.**
I copied `PipelineDetailPage.test.tsx` to a throwaway probe file, added seven adversarial cases,
ran them, then deleted the probe (`git status` clean, verified). Results (dispatch counts):

| Probe | Setup | Result |
| --- | --- | --- |
| P1 | Stuck `sseActive` (run resolves, no SSE event ever), 1 edit, watchdog fires, then **120s idle** | base=1 → afterWatchdog=2 → after 120s=**2**. No re-arm. |
| P2 | Same **plus 600ms slow `/analyze`** (cycle 2's blind spot), 120s idle | base=1 → 2 → **2**. Bounded. |
| P3 | Stuck guard + **6 rapid alternating edits**, then 140s | total = base+**1**. Bounded. |
| P4 | **Unmount mid-watchdog**, then 60s | dispatches unchanged; no post-unmount fire, no timer leak, no act() warning. |
| P5 | **Real timers**, 600ms analyze, one edit, **20s of pure idle** (cycle-2 loop probe, longer than the shipped test's 5.5s) | exactly **1** dispatch. Cycle-2 loop is dead on this commit. |
| P7 | Stuck guard, watchdog already fired, **later** edit | fires again for the new edit (base+2). Deferral is bounded *and* still functional — not a one-shot that then goes permanently stale. |

Structural reading agrees: the watchdog is armed only inside `if (lastAnalyzedFingerprintRef.current
!== stepsFingerprint)` and only when `deferWatchdogHandleRef.current === null` (one timer max);
`forceDeferredAnalyze` sets `lastAnalyzedFingerprintRef` to the *current* fingerprint and calls
`clearDeferWatchdog` before dispatching, so its own dispatch's `analyzeStatus → loading` re-entry
finds the fingerprint unchanged and cannot re-arm. `clearDeferWatchdog` is `useCallback([])`, so
`useEffect(() => clearDeferWatchdog, [clearDeferWatchdog])` is a true unmount-only cleanup.
**Worst case under a permanently stuck guard with continuous editing is one `/analyze` per 15s** —
versus one per edit at 300ms on `main`. Bounded in every dimension I could test.

**2. The CR1 test is genuinely RED without the fix (mutation-verified).**
I mutated the hook — removed the watchdog arming only — and re-ran the new test:
`Expected: 2 / Received: 1`, 1 failed. Restored the hook and confirmed `git status` clean. The
test models the *stuck* case (run submitted, `sseActive` set the ordinary way, no SSE event ever
arrives), not a watchdog happy path.

**3. Gates, run by me.** `npm run lint` clean (`--max-warnings=0`), `npm run typecheck` clean,
full frontend Jest **256 suites / 2650 tests, all passing**. Backend untouched (no backend files
in `git diff main...HEAD`).

**4. Un-quarantine scope.** `git diff main...HEAD -- playwright.config.ts` removes exactly the
`hel912-lanes-rejoin` entry and its 14-line rationale comment, nothing else. `retries: 0` intact.
`hel908-tail-attach` (HEL-962) and `hel908-full-flow` (HEL-964) entries both still present and
byte-identical. Confirmed on this commit, per instruction. (The `main`-side `hel968` quarantine
merge is deliberately a Delivery-time task; evaluated as-is.)

**5. HEL-962 / HEL-964 untouched, and I discharged AC5's "report whether affected" with real
evidence rather than reasoning.** No `hel908` file appears in the diff. I ran the three
non-quarantined `hel908` siblings at N=5 each: **15/15 passed**. For `hel908-tail-attach` itself I
confirmed the stale-locator claim directly: the spec asserts `getByRole("button", { name: "Add
tail step" })` at `:76/:79/:95`, and `grep -rn "Add tail step" frontend/src` returns **zero hits**
— a deterministic locator mismatch, categorically not a timing/contention path this fix touches.
**Not affected.**

**6. My own e2e measurement on this commit.** `hel912-lanes-rejoin` at `--repeat-each=20
--workers=1`: **18/20 passed**. The two failures were one `Run status: succeeded` timeout (this
ticket's target signature) and one `locator.click` timeout — i.e. two of the three signatures the
change now claims. My 2/20 sits above the stated 4/70 point estimate but well inside its interval;
pooled with the prior runs it is ~6/90 (~6.7%). The composite framing is honest and my data
corroborates it rather than contradicting it.

**7. CR2 accounting is honest.** The spec scenario, `tasks.md:68-76` and `probe-findings.md:467-481`
all lead with the **composite ~5.7% (4/70), three signatures**, and explicitly say a reader judging
a red `hel912` should use the composite, not the flattering single-signature number. I pulled
HEL-992 from Linear directly: it is **open (Backlog)**, retitled to the composite residual, and its
body and ACs enumerate all three signatures with an explicit note that HEL-991 is closed and that
the click-timeout occurrence in `hel912` is therefore folded in here. No signature is unowned.
The `e2e/hel912-lanes-rejoin.spec.ts` one-line `sourceDataSourceId → roots[]` repair is disclosed
in `files-modified.md` as unrelated schema-drift housekeeping — correctly, and the spec would 400
at setup without it.

### Verdict: REFUTE

One change request. It is **documentation-only** and does not implicate the code.

### Change Requests

1. **`openspec/changes/fix-opdropdown-anchor-detach/specs/pipeline-op-picker-stability/spec.md`
   asserts behavior the shipped code does not have.** The requirement at the top of "ADDED
   Requirements" says the debounced dispatch *"SHALL NOT issue a new `analyzePipeline` request
   while a pipeline run submitted from the same page is in flight"*, and its first scenario says
   *"the debounced re-analyze effect does not dispatch `analyzePipeline` **for as long as the run
   remains in flight**"*. Both are unconditional. The shipped code contradicts them: my probe P6
   (run held in flight indefinitely, one step edit, 16s advanced) measured **1 dispatch issued
   while the run was still in flight** — the `MAX_ANALYZE_DEFER_MS` watchdog firing exactly as
   designed. Additionally, `grep -ni "watchdog|MAX_ANALYZE_DEFER|15000|bounded"` over `spec.md`,
   `tasks.md` and `design.md` returns **zero hits**: the entire bounded-deferral mechanism added
   by round 1's CR1 exists only in code comments and `files-modified.md`, with no contract
   coverage at all — even though its siblings (resume, termination) each earned a scenario.
   Required:
   (a) qualify the requirement and its first scenario with the time bound (e.g. "...does not
   dispatch for as long as the run remains in flight, **up to a bounded maximum deferral of
   `MAX_ANALYZE_DEFER_MS` (15s), after which it dispatches regardless**"), so the archived
   contract cannot be read as an unconditional guarantee; and
   (b) add a scenario for the bounded deferral itself — a guard that never clears (SSE stream
   never opens / drops / misses its terminal event) SHALL still result in the deferred analyze
   dispatching within the bound, **exactly once per edit**, rather than being suppressed forever.
   Without (b) nothing in the contract prevents a future change from removing the watchdog and
   silently restoring round 1's permanent-staleness defect, which is precisely why the resume and
   termination scenarios were added in cycle 3.

   Scope: two paragraphs in one file. No code change, no re-measurement, no e2e re-run. If the
   owner prefers, applying this edit at Delivery rather than spending another executor round is a
   defensible resolution — my objection is to shipping the contradiction, not to the branch.

### Non-blocking notes

- **The 15s bound is a real, accepted tradeoff and should be understood as one.** On a legitimately
  slow-but-healthy run exceeding 15s, a step edit made during that run *will* produce one
  `/analyze` mid-run — the very contention this ticket removes. I judge this acceptable and not
  REFUTE-worthy: it is bounded to one request per edit (P6/P7), it fires at 15s rather than at
  300ms, it degrades toward `main`'s behavior rather than past it, and the alternative
  (unbounded deferral) is the round-1 CR1 defect. But the code comment's justification — "a normal
  run's measured ~6-10s" — is a local, small-fixture measurement; a larger production pipeline
  exceeding 15s is not exotic, so the case will occur in the field. This is the substance CR1(a)
  asks to be written down.
- `tasks.md:3.7` discharges AC5 by reasoning rather than by running anything. My §5 above supplies
  the missing evidence, so the AC is satisfied in substance — but the task text overstates what
  was done and could be trimmed to match at Delivery.
- The `:165` layout-pixel signature did not recur in my N=20; the other two did. Nothing to act on.
