# HEL-1483: Pipeline editor shows the previous pipeline's step cards after switching pipelines in-app

## Description

Found by HEL-1478's final-gate skeptic while comparing the running app. Behaviour is identical on base 744c37720 and on HEL-1478's head, so it predates that change. Priority: Medium. Labels: Follow-up, Bug. Origin: HEL-1478.

**Repro (dev, throwaway user):**

1. Open pipeline A, which has 3 steps.
2. Navigate in-app (no full reload) to pipeline B, which has 1 step.
3. The editor still shows 3 step cards.

**Suspected cause (unconfirmed):** `usePipelineDetailPage`'s `stepsInitialized` / local `steps` state is never reset when the `:id` route param changes on the same component instance. Steps are only seeded from `persistedSteps` while `!stepsInitialized`.

Confirm the root cause with a probe before fixing (systematic-debugging law). Then widen the repro: check whether edits on B write against A's step ids, and whether the analyze/fingerprint path uses the stale steps.

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1478/evidence/skeptic-final-1/`.

## Acceptance Criteria

(Derived from the ticket text and the owner-approved driver brief.)

1. The root cause is confirmed by a recorded probe in the running app (or a red test reproducing the in-app switch) BEFORE the fix lands.
2. After an in-app switch from pipeline A to pipeline B (no full reload), the editor shows exactly B's persisted steps — never A's — via every in-app route that reaches `/pipelines/:id`: the pipelines list/sidebar, the command palette, recents, and browser back/forward.
3. No write intended for (or originating on) pipeline A lands on pipeline B, and no write is issued for B carrying A's step ids — including a debounced step-config save or other in-flight request for A that resolves after the switch. If any such cross-pipeline write exists today, it is fixed and covered by a test.
4. The analyze/fingerprint path after a switch uses B's steps only (no /analyze or other request built from A's stale steps against B's id).
5. Other per-pipeline page state (open sheets/modals, output-name field, unsaved drafts, debounce timers, run/SSE state) does not leak from A into B after the switch; whatever the fix resets is enumerated and justified.
6. A regression test that drives the in-app switch is red on base and green with the fix; an e2e is added if unit tests cannot show it.
7. No new `eslint-disable`; zero-warnings lint, typecheck, format and the jest suite pass.
