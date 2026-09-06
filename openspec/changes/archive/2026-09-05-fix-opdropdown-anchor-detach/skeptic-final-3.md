## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Scope per instruction: narrow. Commit `afcb7d80` is documentation-only; round 2 already
established (seven adversarial probes) that there is no code defect. I re-derived every claim
below from the files themselves, not from prior reports.

### What I verified (with evidence)

**0. The commit really is documentation-only.**
`git show --name-only afcb7d80` lists exactly four markdown files (probe-findings.md,
skeptic-final-2.md, specs/pipeline-op-picker-stability/spec.md, tasks.md).
`git diff 75b865cf afcb7d80 -- frontend/ e2e/ playwright.config.ts` is **empty**. No e2e re-run
or watchdog re-probe performed, per instruction. No UI surface changed by this branch (a hook's
dispatch timing only), so no screenshot pass.

**1. CR1(a) — the requirement AND its first scenario are both bounded now.**
`spec.md` requirement heading itself reads "…up to a bounded maximum"; the body carries
"**UP TO a bounded maximum deferral window of `MAX_ANALYZE_DEFER_MS` (15000ms)**, after which the
dispatch proceeds regardless". Round 2's specific finding was that the *scenario* was still
unconditional; it is not now — the scenario is retitled "…within the bound", its WHEN adds "and
fewer than `MAX_ANALYZE_DEFER_MS` have elapsed since that edit was deferred", and its THEN states
outright that the requirement "does NOT guarantee no competing dispatch is ever issued for a run
in flight, only that one is not issued before the bound". The archived contract can no longer be
read as an unconditional no-dispatch-during-run guarantee.

**2. The spec matches the shipped code (the crux). Read `usePipelineDetailPage.ts` directly.**
- Bound: `const MAX_ANALYZE_DEFER_MS = 15000;` (line 75) — matches the documented 15000ms.
- Trigger conditions: the defer branch is `if (sseActiveRef.current || analyzeStatusRef.current === "loading")` (line 371), and the watchdog is armed inside it for *either* condition. The spec's
  second requirement correctly says the forced dispatch happens "regardless of whether `sseActive`
  (or `analyzeStatus === \"loading\"`) has actually cleared" — both conditions, as in the code.
- Clock start: armed only under `if (lastAnalyzedFingerprintRef.current !== stepsFingerprint)` and
  only when `deferWatchdogHandleRef.current === null`, with `pendingSinceRef` set on first defer —
  i.e. the clock runs from when the *deferral* began, which is exactly the phrasing the scenario
  uses ("since that edit was deferred" / "since the deferral began"), not from the edit itself.
- "Exactly once per deferred edit": `forceDeferredAnalyze` early-returns unless
  `pendingAnalyzeRef.current`, then clears it, advances `lastAnalyzedFingerprintRef` to the current
  fingerprint and calls `clearDeferWatchdog` *before* dispatching — so the dispatch's own
  `analyzeStatus → loading` re-entry finds the fingerprint unchanged and cannot re-arm. One
  dispatch per deferred edit, matching the spec.
The spec was corrected in the right direction: it now describes what the code does, and nothing in
it asserts behavior the code lacks.

**3. CR1(b) genuinely constrains the watchdog.**
The new requirement ("A guard that never clears does not suppress the deferred analyze forever")
and its scenario require that with `sseActive` set and no terminal SSE event ever arriving, the
deferred dispatch still fires exactly once at the bound. Delete the watchdog arming from the code
and this scenario fails outright: with a genuinely stuck guard there is no further dependency
change to re-run the debounce effect, so nothing would ever dispatch. That is precisely the
mutation round 2 ran against the CR1 test (`Expected: 2 / Received: 1`). The other four scenarios
would all remain green under that deletion — which is why this one had to exist.

**4. The tradeoff is stated in the open, and the ~6-10s figure is framed honestly.**
The requirement body carries a bolded "**Accepted tradeoff, stated explicitly:**" paragraph naming
the exact case (run legitimately >15s + concurrent edit → exactly one contending `analyzePipeline`
at the 15s mark), why it is deliberate (bounded to one request per edit, fired at the bound rather
than at 300ms, degrading *toward* `main`'s always-contends behavior), and the alternative it was
chosen over (a permanently stuck guard). It is in the requirement body, not a footnote. The
justification explicitly says the ~6-10s figure is "this ticket's own e2e fixture's measured…"
and that "a larger, real production pipeline exceeding 15 seconds is **not** an exotic or
hypothetical case" — the correct framing, not the flattering one. The code comment at lines 66-74
was already scoped to "the dry-run flow this ticket's own e2e guard exercises", so there is no
code-vs-doc disagreement here.

**5. tasks.md:3.7 — corrected, not deleted, and its citation checks out.**
3.7 is still an `[x]` AC with its substance intact; only the discharge changed, now pointing at
`skeptic-final-2.md` §5. I read §5: it does report "three non-quarantined `hel908` siblings at N=5
each: **15/15 passed**" and `grep -rn "Add tail step" frontend/src` returning zero hits. The task
text claims neither more nor less than §5 supports. The prior overstatement ("not re-run…no reason
to expect") is gone.

**6. Cross-document sweep for stale/flattering claims.** No contradiction with the shipped code
found in probe-findings.md, tasks.md, design.md or spec.md. The composite ~5.7% (4/70) accounting
appears identically in spec.md, tasks.md:3.4 and probe-findings.md, always leading with the
composite rather than the single-signature ~1.7-3.3%, and always naming all three signatures. All
three signatures are attributed to HEL-992 (open), with HEL-991's closure disclosed inline in both
spec.md and tasks.md, and a dedicated scenario making the "no unowned signature" property itself
part of the contract.

**7. Un-quarantine scope, confirmed on this branch.**
`git diff main...HEAD -- playwright.config.ts` removes exactly the `hel912-lanes-rejoin.spec.ts`
entry and its rationale comment — nothing else added or removed. Evaluated as-is; the `main`-side
`hel968` quarantine (75f59b04) merge is a Delivery-time task, per instruction.

**8. HEL-962/HEL-964 untouched.** No `hel908` file in `git diff main...HEAD`; both quarantine
entries (`hel908-tail-attach` → HEL-962 at :46, `hel908-full-flow` → HEL-964 at :53-64) remain
present in `playwright.config.ts` and untouched by the diff.

### Verdict: CONFIRM

The written contract now tells the truth about the shipped code. Round 2's blocker is fully
discharged: both the requirement and its scenario are bounded, the bounded-deferral mechanism has
its own requirement that a watchdog removal would violate, the tradeoff is disclosed rather than
buried, and tasks.md:3.7 cites evidence that exists. Nothing I checked contradicts the code. Ships.

### Non-blocking notes

- `spec.md` Purpose (line 14) still says a picker DOM-stability contract "belongs to HEL-991 once
  that ticket's own investigation observes a real mechanism", while line 123 of the same file
  correctly records that **HEL-991 is closed**. A one-line forward pointer at a closed ticket in a
  file about to be archived; retargeting it to HEL-992 (or dropping the pointer) is a Delivery-time
  polish, not a behavior claim.
- The composite could now be pooled to ~6/90 (~6.7%) including round 2's own 18/20; round 2
  explicitly judged its data corroborating rather than contradicting the 4/70 point estimate, so
  4/70 is defensible as stated. Optional tightening only.
- Strictly read, the scenario's "fewer than `MAX_ANALYZE_DEFER_MS` since that edit was deferred"
  is a ceiling, not a floor: a *second* edit made while an already-armed watchdog is counting down
  rides the first edit's timer (the arming is skipped when `deferWatchdogHandleRef.current !==
  null`), so it can dispatch sooner than 15s after its own deferral. This errs toward *less*
  suppression, which the requirement now openly permits; not worth a wording change.
- `pendingSinceRef` is effectively write-only (set on first defer, nulled in `clearDeferWatchdog`,
  never compared). Harmless bookkeeping and referenced by several comments as an anchor, but a
  future reader may look for a read that does not exist.
