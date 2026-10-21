## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 4f729eed7dd52150f056b6f5a20eac856cb794a7 (origin/main; change dir untracked). Cold review of the current
ticket.md / proposal.md / design.md / tasks.md against the tree.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/draft-edit-latency-flake/HEL-1691`.
- **Ground-truth claims in design.md Context hold:**
  - `timedFilterEdit` is at `e2e/hel1631-draft-mode.spec.ts:128-160`. It does a native setter plus `input` dispatch, and a
    MutationObserver on the first `.spine-row__count` resolves with `performance.now() - start`.
  - The test's assertions are `latencies[0] < 100` and `max(latencies.slice(1)) < 50`, the same as C1.
  - `<React.StrictMode>` is at `frontend/src/main.tsx:113`.
  - `relax-cold-first-edit` is recorded in `openspec/changes/archive/2026-10-19-draft-mode-live-preview-ui/design.md`.
  - The JSON reporter writes `test-results/results.json` under CI (`playwright.config.ts:151-152`).
- **Round-1 change requests are each addressed:**
  1. *D3 outcomes → D5 actions.* Every outcome now has an action:
     - GC on the edit path's own allocation → fix; other GC → contention, so escalate.
     - Style, layout or compile work → app work (render/compile).
     - Dev-build-only cost → owner escalation under C1, with dev vs prod numbers.
     - Mixed results → tally per class; if no class reaches 80%, fix the app-work share and escalate the rest.
     - No over-budget edits in ≥ 6 samples → escalate.
  2. *Interval definition.* `console.timeStamp` marks sit immediately before the setter and in the observer callback.
     Wall = Δts and thread = Δtts between the marks. GC, script and style come from events inside the marks, and the
     enclosing task's dur/tdur is explicitly rejected. Round 1's probe confirmed that TimeStamp instants carry `tts` under
     `devtools.timeline`.
  3. *Tracing's own cost.* D2a adds an untraced CI arm (`HEL1691_TRACE=0`) classified from D1 `ThreadTime`. An app-work
     verdict needs the untraced arm to agree. A traced-only finding is reported as tracing overhead. Task 2.2 covers this.
  4. *AC2.* D6 and task 3.3 close AC2 in each branch:
     - App-work branch: 10 consecutive main runs after merge, and a failure reopens the ticket rather than triggering a rerun.
     - Contention and dev-build branches: the change stops at the owner escalation, and the owner's ruling closes AC2.
- **Feasibility of the dev-vs-prod check (D3):** `vite preview` can serve this app.
  - `shellRoutingPlugin` registers `configurePreviewServer` (`frontend/src/landing/shellRoutingPlugin.ts`), so `/pipelines/...`
    navigations reach `app.html` in preview too.
  - Vite's `preview.proxy` defaults to `server.proxy`, so `/api` reaches `BACKEND_PORT`.
- **AC coverage and scope:**
  - AC1 (root cause backed by a CI trace) is covered by tasks 2.1–2.3.
  - AC2 is covered by 3.3 and D6.
  - Non-goals exclude relaxing the budget, retries and HEL-1632.
  - Job reruns are framed as diagnostic samples on the unchanged budget, with every result recorded. That is consistent with
    the "No retries" constraint, and the Risks section says so.
  - There are no placeholders or TBDs. The executor's stop point (after 2.3) is explicit in D5 and tasks.md.

### Verdict: CONFIRM

The plan is diagnosis-first and decision-complete. Each evidence outcome maps to a pre-declared action, and every path that
would change the measurement goes to the owner (C1). I found no blocking ambiguity.

### Non-blocking notes

- **Untraced-arm denominator.** D1's `ThreadTime` delta brackets the whole `getMetrics → evaluate → getMetrics` span, so it is
  an upper bound against the `performance.now()` wall. That biases the untraced arm toward "thread-heavy". In task 1.3, measure
  the bracket's no-edit overhead locally (two `getMetrics` calls around a no-op evaluate) and report it alongside the CI
  numbers, so a borderline 50% call can be judged.
- **Order of the summary line.** Emit the D1/D2 summary lines before the first `expect` in the test, ahead of the existing
  `requests` assertion. A failure in that assertion should not lose the breakdown from `results.json`'s stdout.
- **Starting the preview server.** Task 1.3's prod-build comparison needs a server on the pinned ports. Stop the dev server with
  `stop-servers.sh`, then serve `vite preview --port $DEV_PORT --strictPort` with `BACKEND_PORT` exported. Record the exact
  command, because the canonical `start-servers.sh` only starts the dev server. The PWA service worker registers in preview.
  Use a fresh context so a cached shell does not skew the comparison.
- **D3 "script-dominated" vs "style/layout/compile-dominated".** This reads naturally as "largest share of thread time". State
  the tie-breaking rule in `evidence.md` when you tabulate.
- **D1 instrumentation stays after merge.** It changes the gaps between edits: there are CDP round-trips between edits, but the
  timed interval is unchanged. That does not change the asserted interval, but mention it in the PR body so the owner does not
  read it as a C1 change.
- **D6 follow-up.** Watching 10 main runs after merge outlives a normal orchestrator run. The hand-back should say who holds
  that watch (the driver) and where the result is recorded.
