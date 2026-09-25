## Standing Constraints

- [C1] Models: SONNET on all agents (orchestrator/executor/evaluator/skeptic/auditor); no promotion.
- [C2] ONE LANE for this ticket — no concurrent worktrees/lanes.
- [C3] Migration ledger: V110 is the highest existing Flyway migration (confirmed); V111 is the
  next free version if a migration turns out to be needed (not expected — no schema change here).
- [C4] Write ALL artifacts (probe evidence included) inside this worktree or
  `.concertino/runs/HEL-1174/` — never the main checkout root.
- [C5] `files-modified.md` must list EVERY touched file.
- [C6] Every `git commit`: Bash `timeout: 600000`. Never re-run a commit while one is in flight.
  Never `git add -A`.
- [C7] Budget exhaustion (including DEBUG_ATTEMPTS) is a mandatory escalation, never a
  self-approval.
- [C8] `ci-complete` must be PRESENT and SUCCESS. Do NOT re-run CI to get past a failure of
  `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` itself — that is evidence the fix is incomplete,
  not flake.
- [C9] Say "owner ruling" only for decisions the owner actually made.
- [C10] Follow-ups filed from this run: `origin_kind: followup` / `origin_ticket: HEL-1174`,
  `relatedTo` HEL-1174, the `Follow-up` label, and project `28f119e2-5738-46b1-a53b-42f73e06b053`
  (Helio v0.8).

## 1. Probe — confirm root cause before any fix (systematic-debugging law)

- [x] 1.1 Reproduce the failure deterministically: either loop
  `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` locally (capped at 3-4 parallel Playwright
  workers, `nice -n 19` — this is a 6-core desktop) until it reproduces, or write a targeted
  backend integration test that forces the reconnect-gap interleaving directly (subscribe,
  unsubscribe, publish a `succeeded` event into `PipelineRunRegistry` while unsubscribed, then
  resubscribe and assert the event is unobservable today). Done via
  `SseReconnectGapProbeSpec.scala` (targeted backend integration test route).
- [x] 1.2 During/around a reproduction, capture direct evidence discriminating candidates (a)-(e)
  from ticket.md/design.md Decision 1: `pipeline_runs` row count/status/timestamps for the test's
  pipeline, and the `pipeline_auto_run_debounce` row's `fire_at`/`claimed_at` state, at the moment
  the panel is stuck. In particular: does a second `succeeded` `pipeline_runs` row exist at all?
  Done — see probe-evidence.md; a second `succeeded` row DOES land (candidate (e) falsified).
- [x] 1.3 Record the verdict (which candidate(s), with the evidence) in a `probe-evidence.md` file
  in this change directory; persist it via `persist-evidence.sh` before proceeding to section 2.
  Persisted to `.concertino/runs/HEL-1174/evidence/openspec/changes/sse-reconnect-missed-run/probe-evidence.md`.
- [x] 1.4 If the evidence shows the second run was never created because of a legitimate guard
  policy decision (not a bug) — i.e. (e) as a genuine product question — STOP here and raise an
  `ESCALATION` with the evidence, options, and a recommendation, per ticket.md. Do not implement
  section 2 as a substitute for resolving that question. If (e) is instead a plain bug (e.g. a
  debounce/guard defect, not an intended policy), proceed to section 2 AND add a task to fix that
  bug specifically, informed by the actual defect found. Verdict: plain bug (structural SSE
  ephemeral-channel gap), not a guard rejection — no escalation; proceeded to section 2.

## 2. Backend — durable "latest run" read

- [x] 2.1 Add `PipelineRunRepository` support for reading the single most recent run row for a
  pipeline (id/status/completedAt/rowCount/errorLog) — reuse `listByPipelineInternal`'s existing
  sort or add a narrower, single-row query; prefer whichever keeps the change smallest. Done:
  `PipelineRunRepository.latestRunInternal`.
- [x] 2.2 Add `GET /api/pipelines/:id/runs/latest` (sharing-aware — owner/editor/viewer grantee →
  200 with the run summary, no grant → 404, never-run pipeline → 404), mirroring the ACL pattern
  actually used by `run-events` (`pipelineExistsShared`) and `run-history` (`findByIdShared`).
  **Do NOT model this on `runs/:runId`** (`PipelineRunStatusRoutes.scala`'s existing handler) — that
  route has no ownership/sharing check at all (safe only because it's keyed by an opaque, unguessable
  run id); copying it for a pipeline-id-keyed endpoint would leak cross-tenant run data (design-gate
  round 1 change request 1). **Route-matching order:** the new `path("runs" / "latest")` branch
  MUST be placed before `PipelineRunStatusRoutes.scala`'s existing `path("runs" / Segment)` wildcard
  in whichever `concat(...)` serves both, or the literal `"latest"` segment will be silently
  swallowed by the `Segment` matcher and the new route will never be reached (design-gate round 1
  change request 2 — verify via an actual backend request test, not just a compile check). Done:
  new `PipelineRunLatestRoutes.scala` mounted in `ApiRoutes.scala` BEFORE `PipelineRunStatusRoutes`;
  verified via `PipelineRunRoutesSpec`'s "is not shadowed by the runs/:runId wildcard route" test.
- [x] 2.3 Backend test coverage: access control (owner/editor/viewer/no-grant/unauthenticated),
  never-run pipeline, and the shape of the returned summary for a completed run. Done in
  `PipelineRunRoutesSpec.scala` (5 new tests).

## 3. Client — reconcile-on-connect in the fan-out manager

- [x] 3.1 In `pipelineRunFanout.ts`, call the new `runs/latest` endpoint at the start of every
  `connect()` invocation (initial subscribe, D3 post-terminal reconnect, and post-backoff retry
  alike); on a `succeeded` result whose run id differs from `entry.lastObservedRunId`, invoke every
  listener exactly as the live-event path does, then update `entry.lastObservedRunId`. On a
  non-succeeded (failed/dry_run) or unchanged result, update the bookkeeping without firing.
  Done, with one probe-confirmed correction beyond design.md's literal text: the very FIRST
  reconcile call for an entry (`lastObservedRunId` still `undefined`) establishes the baseline
  WITHOUT firing, even for an already-succeeded run — see files-modified.md for why (a live e2e
  run surfaced this). **Cycle 2 (skeptic-final-1.md REFUTE, Change Request 1):** that correction
  had its own dedup hole — a non-terminal (`"queued"`/`"running"`) reconcile result was adopted as
  the observed baseline unconditionally, silently deduping away that same run's later terminal
  live-SSE event. Fixed: `reconcile()` now no-ops entirely on a non-terminal status. See
  files-modified.md's "Cycle 2" section for the full defect/fix/RED-GREEN evidence.
- [x] 3.2 Resolve design.md Decision 3's open choice: add `runId` to the SSE wire payload
  (`RunStatusEvent`/`toSseBytes` backend, `RunStatusEventData` frontend) so the live-event path can
  also set `entry.lastObservedRunId` directly, avoiding the redundant-refire edge case — or
  document why the simpler no-wire-change alternative is sufficient if that's what's implemented
  instead. Record the actual decision made. Done — option (i) implemented: `runId` added to
  `RunStatusEvent`, `toSseBytes`, `PipelineRunNotifyBus` encode/decode, and all 8 `publish(...)`
  call sites in `PipelineRunService`.
- [x] 3.3 Check `usePipelineRunEvents.ts`'s callers for whether the same class of gap applies
  there (design.md Non-Goals) — extend the fix to it only if it does; otherwise state why not,
  briefly, in the PR description. Checked (`usePipelineDetailPage.ts`'s single caller): this hook
  never reconnects after a terminal event (it closes and returns) — no reconnect gap of this class
  exists. Not extended; only added the optional `runId` field to `RunStatusEventData` for wire-shape
  parity. See files-modified.md for the note on this hook's SEPARATE, already-known,
  already-mitigated (HEL-972 CR1 watchdog) subscribe-race gap, which is out of scope here.
- [x] 3.4 Update `openspec/specs/pipeline-run-sse/spec.md` scenarios' backing behavior — already
  drafted in this change's spec delta; keep code and delta in sync if the implementation deviates.
  Confirmed in sync — no deviation from the drafted delta.

## 4. Proof

- [x] 4.1 A deterministic unit/integration test that forces a run to complete inside the reconnect
  window, RED before the fix, GREEN after — this is the "systematic-debugging" and
  "verification-before-completion" evidence, not the e2e alone. Done:
  `pipelineRunFanout.test.ts`'s "HEL-1174 regression: a run completing entirely during the
  reconnect gap is still observed via reconcile-on-connect" — manually confirmed RED (reconcile
  call temporarily disabled) then GREEN (restored); see files-modified.md.
- [x] 4.2 Run `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` in a repeated local loop (e.g. 20x,
  capped at 3-4 parallel workers, `nice -n 19`) with zero failures. Do not raise its timeouts or
  accelerate the tick/debounce interval to make it pass. Done — 20/20 passed (3 workers, `nice -n
  19`); see files-modified.md for the pasted summary.
- [x] 4.3 Full backend + frontend test suites green; lint/typecheck/format clean (pre-commit
  parity). Done — `sbt test` 4831/4831; `npm test` 3982/3982 (271 root + 3711 frontend); lint/
  typecheck/format:check all clean; frontend build succeeds.
- [ ] 4.4 CI green on the actual PR — `ci-complete` present and SUCCESS — without re-running CI to
  get past a failure of this specific e2e spec (C8). Pending — not yet a PR (executor phase).

## 5. Delivery

- [x] 5.1 `files-modified.md` lists every touched file (C5).
- [ ] 5.2 Squash, archive, push, PR — per the orchestrator's Delivery phase.
