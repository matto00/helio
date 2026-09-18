## Context

HEL-1083..1089 shipped the form panel piece by piece, each with jsdom-level per-field coverage. This
ticket is the epic's final leaf: audit the *assembled* panel end-to-end against a running instance,
using computed accessibility-tree state (C8), and re-measure HEL-1158's three open findings in that
same assembled context. `e2e` is not a pre-commit gate (HEL-1157) — this ticket's primary evidence
lives in a Playwright spec enforced only by CI's `e2e` job, not by local gates.

## Goals / Non-Goals

**Goals:**
- Prove (or disprove) full keyboard-only submit completion against the running app, across every
  field type including file and counter.
- Measure focus management on submit/success/server-rejection and panel role/name in the grid via
  computed accessibility tree, not attribute presence (C8).
- Re-measure HEL-1158's three findings in the assembled-panel context and report status without
  duplicating that ticket.
- Fix any newly-found defect that actually blocks keyboard-only completion.

**Non-Goals:**
- Re-auditing isolated field components already covered by HEL-1083..1089's own ACs.
- Filing or fixing HEL-1158's three findings as new work items — only re-measure and report.
- Exercising the `gcs` upload backend against a live bucket (HEL-1086 never did; out of scope here).

## Decisions

1. **Evidence source: Playwright against the running dev app**, not jsdom/RTL. A new spec
   (`e2e/hel1090-form-panel-assembled-a11y.spec.ts`) drives a configured multi-field form panel
   (text/textarea/number/date/select/checkbox/file/counter) with keyboard-only interaction and reads
   the computed accessibility tree (`browser_snapshot` / accessibility tree queries), not DOM
   attribute presence — directly enforcing C8.
2. **Focus-management coverage includes a genuine server-side rejection**, not only a client-blocked
   validation failure — distinct code paths per HEL-1087's `FormSubmission.buildRow` (server) vs.
   client-side required-field checks. The spec triggers a real server rejection (e.g. a value that
   passes client validation but fails a server-only constraint) to measure this path honestly.
3. **HEL-1158 re-measurement is observational, not corrective.** The audit re-runs the same class of
   measurement HEL-1158 used (frame-level DOM/live-region capture, `getBoundingClientRect`) against
   the now-assembled panel and records whether each of the three findings still holds. If a finding
   is found to actually block keyboard-only completion (e.g. submit truly unreachable by keyboard,
   not just below the fold with a working scroll affordance), that reclassifies it as blocking in this
   audit's report — but no duplicate ticket is filed; HEL-1158 remains the tracking ticket.
4. **Mutation proof (C7):** each new assertion is proven capable of catching a real regression by a
   targeted mutation (e.g. removing `aria-describedby` wiring, or reverting a focus-management `useRef`
   call) that is verified red before being reverted byte-identical, mirroring HEL-1088/1089's approach.

## Risks / Trade-offs

- **e2e is not a local gate (HEL-1157):** the primary keyboard/AT evidence for this ticket is not
  enforced by local pre-commit or `assert-phase.sh`. Mitigation: the executor/evaluator/skeptic run
  the new spec manually against the dev server and capture its output as evidence, and CI's `e2e` job
  is checked directly in the PR before merge (per the audit gate-check requirement below).
- **No real assistive-technology session is available in this harness.** Where HEL-1158 already
  established that real-AT re-announcement is unmeasurable in this environment, this audit does not
  re-attempt to prove that specific claim differently — it states the same limitation explicitly
  rather than asserting a false positive via `observed.length > 0`.
- **Parallel-Playwright hazard:** this worktree shares a browser session with sibling worktrees.
  Screenshots/evidence are kept inside this run's evidence dir; both worktree and main-checkout roots
  are checked for strays before every commit and before finishing.
