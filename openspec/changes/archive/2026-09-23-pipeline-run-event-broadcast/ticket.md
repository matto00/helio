# HEL-1168: PipelineRunRegistry: deliver run events to every subscriber, across instances

## Description

While delivering HEL-1094 ("SSE fan-out: refresh panels bound to an affected Output"), premise validation and both the design-gate and final-gate skeptics confirmed a real limitation in `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala`:

`PipelineRunRegistry.subscribe(pipelineId)` stores exactly **one** `ActorRef` per `pipelineId` in a `ConcurrentHashMap` (`refs.put(pipelineId, ref)` — an unconditional overwrite). A second concurrent `subscribe` call for the same pipeline silently replaces the first subscriber's registry entry; `publish` then only reaches the second (latest) subscriber (`Option(refs.get(pipelineId)).foreach { ... }` — a map miss silently drops the event for the orphaned first subscriber, whose stream then hangs open with no further events and no error).

HEL-1094 worked around this entirely on the frontend: a module-scoped, ref-counted fan-out manager (`frontend/src/features/panels/services/pipelineRunFanout.ts`) consolidates to exactly **one** SSE connection per `pipelineId` per dashboard page, so no single page ever opens two connections to the same pipeline's `/api/pipelines/:id/run-events` endpoint. That closed the bug for HEL-1094's own AC (one dashboard, panels bound to one pipeline's Outputs).

## What's still unfixed

Two *different* page types/sessions watching the *same* pipeline concurrently still each open their own independent connection, and the registry's single-slot design means the earlier one is silently starved:

* A user with the pipeline's detail page open in one tab, and the same pipeline's Output bound to a panel on a dashboard open in another tab (or another user's session, for a shared pipeline).
* Two separate dashboards, each with a panel bound to an Output of the same pipeline, open concurrently.

## Suggested fix

Change `PipelineRunRegistry` from a single-`ActorRef`-per-pipeline map to a genuine multi-subscriber broadcast (e.g. a `Set`/list of refs per `pipelineId`, or a Pekko `BroadcastHub`/`MergeHub` source), so `publish` fans out to every live subscriber rather than only the most recently registered one. Should include a regression test for exactly this scenario: two concurrent `subscribe` calls for the same `pipelineId`, both must receive a subsequently `publish`ed event.

## Not required as part of the original scope

No frontend change is implied — `usePipelineRunEvents.ts` and HEL-1094's `pipelineRunFanout.ts` already correctly open a single connection per relevant pipeline from within one page; only the backend's multi-page/multi-session case was originally in scope.

## Owner ruling 2026-09-23 — reclassified: Scope addition, High, blocks the v0.8.4 release

The driver's review of HEL-1094 found a **second, larger** failure mode that this ticket did not originally cover:

**Cross-instance delivery.** `PipelineRunRegistry` is an in-memory `ConcurrentHashMap[String, ActorRef]` on each backend instance. Prod runs `--max-instances=2` with no session affinity (`.github/workflows/cd-backend.yml`). HEL-1093's auto-run is submitted by whichever instance's scheduler tick claims the debounce row, and its `succeeded` event is published only on that instance. A viewer whose SSE connection sits on the other instance never receives it, so HEL-1094's AC ("a form submit visibly updates a bound chart without manual refresh") fails intermittently in prod. Every local/CI gate runs on one instance and cannot see this (MISTAKES.md: gates all run on one machine).

**Why it's a scope addition, not a follow-up:** HEL-1094's AC is unmeetable in prod without it. The owner ruled: let #690 (the correct frontend half) merge, make this ticket the High blocker, run it next in the queue, and hold the v0.8.4 cut until it lands.

## Acceptance criteria

* Multiple concurrent subscribers per pipeline (tabs, users, detail page + dashboard) ALL receive every run event; the `put`-overwrite is gone.
* An event published on instance A reaches a subscriber connected to instance B, e.g. via Postgres `LISTEN/NOTIFY` or another mechanism the lane proposes and escalates if it is a real fork. Prove it with two registry/backend instances sharing one DB.
* Event visibility stays ACL-scoped (`pipelineExistsShared`): no cross-tenant leak.
* HEL-1094's frontend fan-out still opens one connection per pipeline per page.

## Must hold (driver brief, verify against tree)

* ACL scoping stays exactly as `PipelineRunStreamRoutes` → `pipelineExistsShared` has it today. Broadcasting must not deliver one tenant's run events to another. The NOTIFY channel/payload (if that mechanism is chosen) must not become a cross-tenant side channel.
* Prove cross-instance delivery with two registry/backend instances sharing one DB: an event published on A reaches a subscriber on B. Show the red with today's registry.
* Prove multiple concurrent subscribers on one instance all receive the event, with the red shown on the `put`-overwrite.
* HEL-1094's frontend contract (one connection per pipeline per page) and existing `usePipelineRunEvents` consumers (pipeline detail page) keep working.
* No blocking in actor paths; clean up subscribers on disconnect.
