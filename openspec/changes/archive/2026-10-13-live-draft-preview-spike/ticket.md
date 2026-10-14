# HEL-1580: Spike: live draft preview: client-side recompute, cached samples, transport

## Description

The owner wants pipelines to give real-time feedback: edit a step and immediately see row counts, preview rows **and
the rendered output** change. This is the feature the pipeline editor most lacks. It touches step evaluation, caching
and transport, so the approach has to be settled before building.

Owner guidance:

- Non-static sources (REST/SQL/connectors) preview against **cached sample values**, not live fetches.
- Optimise so **diffs stay small** and the browser can **recompute cheaply** without many network calls.
- The SSE setup is expected to be a lot of work. Evaluate whether a streaming alternative fits better. Not decided yet.

Questions to answer (write-up in an OpenSpec design or `docs/`):

1. **Where evaluation runs:** which step kinds can evaluate client-side over a sample (filter, sort, select, compute,
   cast, aggregate, window…), which must go to the server (join with large secondaries, AI steps, upsert), and how to
   keep the two evaluators in parity (shared spec/tests?).
2. **Sample policy:** size (e.g. ~200–1,000 rows), how a sample is taken and refreshed, where it's cached (client
   memory / IndexedDB / server), staleness labelling in the UI, and limits on the HEL-505 guards.
3. **Change unit:** recompute only from the edited step downward. What the client caches per step (rows, schema,
   counts).
4. **Transport for server-evaluated steps:** request/response with debouncing vs SSE vs WebSocket vs fetch-streaming,
   and how it interacts with the existing pipeline SSE (HEL-1438 notes reopen costs).
5. **Output render:** rendering an Output (chart/metric/table) from draft rows using the existing panel renderers,
   without persisting a snapshot.
6. **Draft vs saved:** draft state, discard, and "Save & run" semantics against undo/patch-sets.

## Acceptance criteria

- [ ] A written design answering 1–6, with a recommended approach and its rejected alternatives
- [ ] A throwaway prototype measures recompute latency for a 3-step pipeline over a 1,000-row sample in the browser
      (target < 50ms per edit), with the number recorded
- [ ] A list of step kinds marked client-evaluable / server-only, with a parity-testing plan
- [ ] Follow-up implementation scope confirmed or adjusted against the "Live draft preview" ticket (HEL-1581)

## Owner rulings and driver constraints (this run)

- Owner ruling (chat, recorded at the root as `escalation.answered`, answer_source=human): **start-now** — start the
  spike before its Linear blocker HEL-1579 lands; UI-facing answers are written against the approved HEL-1570 boards
  (`/home/matt/Development/helio/.concertino/design/HEL-1570/`, PipelineLive* / MotionLive--preview-* screenshots),
  not against today's pipeline page. Precedence: ticket ACs and owner rulings, then HANDOFF.md, then the boards.
- The prototype is throwaway: it must not ship as product code or become an unreviewed dependency. It is kept as
  evidence in the change directory with the exact command and environment to reproduce the number, measured in a real
  browser (not jsdom/node alone), naming which browser.
- The step-kind set is derived from the tree (the list above is illustrative). Reuse existing evaluator code paths
  where possible; say where a client evaluator would duplicate server logic. The parity plan names a concrete mechanism
  that can fail.
- Transport is grounded in the existing pipeline SSE code and HEL-1438's reopen-cost notes, with measurements where
  cheap. A genuine product/architecture call between viable options goes to the owner as an escalation with options.
- If HEL-1581's scope changes, comment it on HEL-1581; never edit its description silently.
- Do not touch DESIGN.md or frontend/src/theme/ (HEL-1571 lane).
