# HEL-1581: Live draft preview (a): TypeScript client step evaluator, expression-engine port and Scala-oracle parity corpus

## Description

Restated on 2026-10-16 by owner ruling `split-and-restate` (escalation HEL-1581-1792170613043-ae7694). The HEL-1580 spike (`docs/live-draft-preview.md` section 12) recommended splitting the original HEL-1581 six ways. This ticket is piece (a), the foundation the others build on.

The live draft preview (HEL-1570) recomputes a pipeline in the browser as a step is edited, with no network request. HEL-1580 owner ruling B (`ts-evaluator-plus-corpus`) chose a hand-written TypeScript evaluator, held to the Scala engine by a shared vector corpus. No TS evaluator exists today.

## What

- **Client step evaluator** (`docs/live-draft-preview.md` sections 3.1-3.2) for the 23 non-server kinds:
  - 9 client kinds: `rename select limit filter groupby dedupe unpivot extractheadings splittext`.
  - 12 client* kinds: `sort cast aggregate datebucket fillnull pivot window stringops compute join union lookup`.
  - 2 identity kinds: `assert` and `upsertsource` pass rows through, never write, and carry no verdicts.
  - Port of the expression engine (`domain/engine/Expression*.scala`, contract `docs/compute-expression-grammar.md`) for `compute`. The exact in-scope expression features and step kinds are pinned by the design gate.
- **Config-level fallback.** `clientEvaluable(step, cache)` declines anything outside the ported set instead of guessing: an unported function or construct, a regex outside the safe JS subset, or a join/union/lookup secondary that is not completely cached. The 4 server kinds always decline.
- **Pipeline walk.** Recompute from an edited step downward over the engine's dependency edges, including the HEL-970 non-ancestor-lane rejoin. Per-step cache of rows, schema, count and status.
- **Parity corpus.** Vectors in `shared-test-fixtures/pipeline-step-parity/<kind>.json`.
  - A Scala spec runs every vector through the real `PipelineStep.Registry` decode and `evaluate` (the oracle), and a Jest spec runs the TS evaluator, so drift on either side fails CI.
  - `manifest.json` classifies all 27 kinds. A Scala check compares it to `Registry.keySet`; a Jest check compares it to the evaluator's kind set plus minimum vector counts.
  - Includes the named traps.
- **Latency.** The spike's budget is < 50 ms per edit, measured on the board pipeline at 1,000 rows.
- **No UI wiring** beyond what this needs. The draft UI is HEL-1631 (e).

## Acceptance criteria

- [ ] The TS evaluator covers exactly the kinds and expression features the design gate pins. Everything else is declined by `clientEvaluable`, with `expectClientDeclines` vectors proving it.
- [ ] The parity corpus is run by a Scala spec against the real engine and by a Jest spec against the TS evaluator. Every vector passes on both.
- [ ] The manifest agreement checks are in place and failable: an unmanifested registered kind is red in Scala; a missing evaluator or vector file is red in Jest. The named mutations (`Math.round`, `a - b` sort, `Number(s)` cast) are each shown red.
- [ ] Recompute from the edited step downward matches a full recompute, and the HEL-970 rejoin case is covered.
- [ ] Recompute latency on the 1,000-row board pipeline is within the < 50 ms budget, measured and recorded.

## Moved to (not in scope here)

HEL-1628 (b) sample endpoint and label; HEL-1629 (c) atomic bulk Save & run; HEL-1630 (d) NDJSON draft-preview endpoint; HEL-1631 (e) draft UI; HEL-1632 (f) Output column and render parity test.

## Owner rulings on record

- HEL-1580: A (NDJSON transport, delegated), B `ts-evaluator-plus-corpus`, C `client-memory`, D `head-1000-manual-refresh`, E `new-atomic-bulk-endpoint`, F `never-before-save`.
- 2026-10-16: `split-and-restate`, `reload-only`, `refuse-dependent-restore-rest`. The last two bind HEL-1629 and HEL-1631, not this ticket.
