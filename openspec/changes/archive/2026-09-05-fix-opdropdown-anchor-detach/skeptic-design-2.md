## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Round-1 change requests — all three landed for real, verified in the current artifacts:

1. **hel968 coverage.** `tasks.md` 1.4 ("run `e2e/hel968-multi-root-editor-flow.spec.ts` at the same N,
   pre-fix, and record its own tally"), 1.5's finding clause, and 3.5 (post-fix at the same N, compared
   against the 1.4 baseline) are present. CR1 is satisfied.
2. **Spec Requirement 2 restated observably.** `specs/pipeline-op-picker-stability/spec.md:38-47` now reads
   "SHALL remain at a stable position on screen and SHALL remain continuously clickable ... deliberately
   does NOT prescribe which internal mechanism". No `SHALL NOT ... update its position state` / `re-render`
   language remains (`grep -n "re-render\|position state" spec.md` returns only the observable ancestor-
   re-render phrasing in Requirement 1). `design.md:88-91` Risks entry now matches ("no requirement names an
   internal mechanism, so a probe outcome that clears the anchor path does not leave a stranded spec
   commitment"). CR2 is satisfied.
3. **Fix shape no longer pre-decided.** `tasks.md` 2.2/2.3/2.4 are mutually exclusive `IF 1.10 found ...`
   branches, with 2.4 explicitly covering an outcome outside D4's shortlist and requiring the shortfall be
   recorded. `design.md` D4:67-69 now says the (a)-then-(c) ordering "is a tie-break for the case where D3
   implicates anchor identity — it is NOT a pre-selection". CR3 is satisfied.

Non-blocking notes from round 1 also applied: 1.2 names `scripts/concertino/start-servers.sh`; design.md and
tasks.md both cite `usePipelineDetailPage.ts:261-262`; 1.1 deletes the rationale comment with the entry; 2.7
uses `git diff --name-only main...HEAD`.

Independent ground-truth re-verification (I did not take the artifacts' word):

- `frontend/src/features/pipelines/ui/OpDropdown.tsx:42-49` — `useLayoutEffect` reading `anchorRef.current`,
  `setPos({ top, left, maxHeight })` fresh object, keyed `[anchorRef]`; `:63` `if (pos === null) return null;`.
- `grep -rn anchorRef frontend/src/features/pipelines/ui/` — exactly two object-literal sites
  (`PipelineRiverView.tsx:312`, `BranchAffordance.tsx:46`); `:361`/`:497` pass the real `addStepButtonRef`.
- `usePipelineDetailPage.ts` — the `window.setTimeout(... analyzePipeline(id) ..., 300)` at 261-262 and the
  mount dispatch at 219, both exactly as cited.
- `playwright.config.ts` — the `"**/hel912-lanes-rejoin.spec.ts"` entry with a 14-line HEL-912/HEL-972
  rationale block above it; `retries: 0` (:82) and `fullyParallel: false` (:83), so a `--repeat-each` tally
  is honest.
- `frontend/src/features/pipelines/ui/OpDropdown.test.tsx` and `e2e/hel968-multi-root-editor-flow.spec.ts`
  both exist — every task target is real.

### Verdict: REFUTE

One remaining blocking gap, narrow and cheap to close. Everything else in the plan I would ship as-is.

### Change Requests

1. **The baseline-triage branch that would produce a vacuously green verification is unhandled, and it
   contradicts design.md's own risk entry.** `tasks.md` 1.5 covers only two outcomes: BOTH baselines clean
   (STOP and escalate) and `hel968`-only clean (record a finding). The third case — **`hel912-lanes-rejoin`
   comes back 0/20 while `hel968` is flaky** — has no instruction, and it is not a hypothetical: D1 exists
   precisely because the 45% was measured on `a45e9881` and this branch forks from `62b428db`, ~20 commits
   later with several in the river editor. In that case the executor proceeds to 1.6/1.7 and classifies a D2
   probe against a loop that never fails (meaningless by construction), then satisfies 3.4's "require 20/20"
   on a spec that was already 20/20 pre-fix — a green that proves nothing, on the ticket's single hard
   acceptance criterion. 3.6 does not rescue it either: "recompute N so the result is equally decisive" has
   no solution at a measured base rate of zero. This also contradicts `design.md`'s Risks entry at :85-87,
   which says a near-zero re-measured baseline means "no experiment on this machine can confirm anything"
   and directs escalation — 1.5 narrows that to the both-clean case only. Rewrite 1.5 to triage all four
   baseline combinations explicitly, with, at minimum: if `hel912` is clean but `hel968` is not, `hel968`
   becomes the measurement harness for D1/D2/D6 (probe loop and post-fix N both run against it), and the
   `hel912` un-quarantine is then carried by 3.7's full-suite run plus the D5 unit guard rather than by a
   tally that cannot discriminate.

### Non-blocking notes

- `usePipelineDetailPage.ts:257-260` has a `skipNextAnalyzeRef` early-return guard immediately above the
  debounced dispatch. The D2 probe (1.6) comments out the `setTimeout` only, which is still a clean
  single-variable edit — but the executor should note in `probe-findings.md` whether that guard was already
  suppressing the dispatch in the failing iteration, since it changes what a 0/20 probe result means.
- 3.6's recompute clause is sequenced after 3.4/3.5, which read "run 20x". Reordering it before them (or
  folding the recomputed N into 3.4/3.5) would stop an executor from running 20, then re-running N.
- `design.md` D6 states the 0.55^20 ~ 1e-5 argument for `hel912`; once 1.4 gives `hel968` its own baseline,
  the same decisiveness computation should be stated for `hel968`'s rate too, not inherited from `hel912`'s.
