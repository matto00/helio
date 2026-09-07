# Design — Concise modes for `get_workspace_context` and `analyze_pipeline`

## Measurement that motivates every decision below

A realistic-fidelity probe (`helio-mcp/src/hel865Fidelity.probe.test.ts`, run before any implementation)
measured the MCP workspace-context payload at 25 sources / 43 pipelines:

| Case | `estimatedSizeBytes` | Budget | Over? |
|---|---|---|---|
| Replica of the existing `context.test.ts:443-560` fixture | 50,870 | 200,000 | no |
| Realistic fidelity (~60 cols/source, ~7 steps/pipeline, populated lane trees, UUID ids) | **465,036** | 200,000 | **2.3x** |
| Oversized negative control (200 sources / 400 pipelines) | 52,471,869 | 200,000 | yes |

**Instrument verification.** The measurement was proven able to report the negative before any positive result
was trusted: the oversized control goes red, and the realistic case went red without being engineered to. A
measurement that could only ever return "under budget" would have made every other number here worthless.

**Marginal cost:** ~9,101 bytes per pipeline, ~2,978 bytes per data source. Pipelines are **84%** of the
payload (43 x 9.1KB = 391KB of 465KB).

## D1 — Why the existing fixture disagreed with the field report

`context.test.ts:443-560` asserts a 25/43 workspace fits the budget, and it passes. The field report measured
220,197 characters. The probe resolves this as **fixture thinness, not a stale field report**: the fixture uses
10 columns per source (vs ~60), 1 step per pipeline (vs ~7), 5-6 character ids instead of 36-char UUIDs, empty
`placements`, and — decisively — **an empty `laneTree` for all 43 pipelines**, because its fake API has no
`getPipeline` method and `context.ts:501-522`'s try/catch silently swallows the resulting failure. It measures
a shape no live workspace returns.

The alternative explanation — that 220,197 predates HEL-907's slimming — is refuted: the post-slimming shape at
honest fidelity is 465K, comfortably above the field report. If anything the field report was conservative.

This matters beyond bookkeeping: had we built against the existing fixture, the "proof" that concise mode works
would have been shrinking a payload that was already under budget — a red arm that cannot fire.

## D2 — Omit depth, not breadth (this inverts the ticket's default preference; argued, not defaulted)

The instinct, and this ticket's stated preference, is to omit **breadth** (fewer entities, plus a count and a
way to fetch the rest) rather than **depth** (fields missing from each entity), because a silently shallow
entity is a trap. That instinct is right about the failure mode and wrong about this payload.

The measurement says the bulk is depth. Fitting 200K by dropping entities alone would mean serving roughly
**14 of 43 pipelines** — which destroys the tool's entire stated purpose ("read this first to reason about what
exists ... instead of fanning out many calls yourself"). An agent given 14 of 43 pipelines cannot answer
"does a pipeline already produce this field?", which is the question the tool exists to answer. Truncating
breadth here converts a large-but-complete answer into a small and *wrong* one.

Trimming per-step projected column lists reclaims the majority of the 391KB while keeping all 43 pipelines
visible.

**The trap the preference warns about is avoided by construction, not by choosing breadth.** Depth omission is
dangerous specifically when a field is *silently* missing. Here every omitted list is **replaced by its element
count** in the same position, so a concise entry is self-evidently concise, and the truncation report names the
omitted detail kinds. The caller cannot mistake a trimmed entry for a complete one.

**What is never omitted:** each Output's own `schema`. The tool's own description states that "an Output's own
schema is the grounding source for a fieldMapping" — it is the field set an agent needs to *act*. Omitting it
would make concise mode exactly the trap the preference guards against. Per-step `outputColumns` on
intermediate steps, by contrast, are diagnostic: useful when debugging a projection, not required to bind an
Output to a panel. That asymmetry is why depth-trimming is safe *here* specifically, and is not a general
license to trim depth elsewhere.

## D3 — Opt-in, verbose default, byte-identical

Concise is requested explicitly; absent/false returns today's response with every existing field unchanged in
value. It is not *strictly* byte-identical: the full response additively gains `truncation.omittedDetailKinds:
[]`, because D4 requires that field always be present rather than `undefined`. That is a deliberate,
one-key additive change, not a silent alteration of existing data — and the spec states it that way rather
than asserting a byte-identity the code does not have. This follows the
precedent HEL-914 set for the analyze half (`PipelineRoutes.scala:52-56`) and for the same reason: changing the
default is a breaking change to every existing caller for a benefit only large-workspace callers need.

## D4 — Truncation must be detectable, following HEL-861/HEL-890

`truncation.applied` is currently hardcoded `false` at `context.ts:241` and `:290` and is never set true
anywhere — `applyBudget` (`context.ts:280-297`) measures the overflow and returns the full payload regardless.
Concise mode is the first thing that will ever set it true.

The convention to follow is the one HEL-890 shipped: fields **always present, defaulted, never `undefined`**,
so a truncated response is never indistinguishable from a missing field (`helioApi.ts:104-137`, defaults
applied at the boundary at `:634-639`). Concise mode therefore reports `applied: true` plus an enumeration of
omitted detail kinds; a full response reports `applied: false` and an **empty** enumeration rather than an
absent one.

## D5 — The analyze passthrough, and why the ticket's own re-scope note is stale

HEL-865's re-scope note (2026-09-04) states HEL-914 "shipped the `analyze_pipeline` half." **It shipped only
the REST half.** `grep -rin concise helio-mcp/` returns zero hits (instrument verified: the same grep for
`analyze` hits 10+ files). `read.ts:159-171` declares `inputSchema: { pipelineId }`; `helioApi.ts:290-292`
issues the analyze GET with no query params.

The client was always capable of sending them — `runPipeline` at `helioApi.ts:622-626` passes `{ dry: "true" }`
— so this is an unwired passthrough, not a missing capability. Closing the epic with its headline capability
unreachable from the MCP surface would be the wrong ending, so the passthrough is folded back in: a `concise`
flag on the tool schema, forwarded as a query param. No backend change; that work is done and tested.

## D6 — This does **not** improve HEL-979

HEL-979 concerns `WorkspaceContextService.assemble`'s unbounded `pipelineService.listSummaries`
(`WorkspaceContextService.scala:141`) behind `GET /api/workspace/context`.

**The MCP `get_workspace_context` tool never calls that endpoint.** It builds its own snapshot client-side by
fanning out across ~8 REST endpoints (`context.ts:16-24`, `read.ts:272`). The two are different code paths, so
this change cannot half-solve HEL-979 — and equally, it does not help it at all. Concise mode bounds *response
size* on the MCP path; HEL-979 bounds *work performed* on the backend path. Nothing in this PR should be read
as having addressed HEL-979, and its acceptance criteria remain entirely open.

## D7 — No migration

No persisted state is added or changed; this is a response-representation change in the MCP client and its
tests. Main is at V102 and no migration is authored here.

## D8 — Concise headroom is thin, and that constrains future additions

The design gate measured the proposed omission rule against the realistic 465,036-byte fixture rather than
taking its feasibility on trust: **concise = 180,726 bytes** against the 200,000-byte budget. It fits, but with
only ~9.6% headroom.

Two consequences worth stating rather than discovering later. First, at roughly 2.6 KB per pipeline in concise
mode, a workspace of ~50 pipelines at this fidelity would exceed the budget **even in concise mode** — this
change buys headroom, it does not make the response unconditionally bounded. Second, **adding any per-entity
detail to the concise projection will bust the target**; concise mode is at 90% of budget on the reference
workspace and should be treated as full.

A genuinely unconditional bound (shedding until the payload fits, in a defined order) is the "general
response-size guard" this ticket lists and defers. It remains deferred.

## Risks

- **Fidelity assumptions.** The ~60-column source and ~7-step pipeline come from the field report and the
  codebase's shapes, not a live workspace dump. The result is 2.3x over budget, so it tolerates substantial
  error — but a workspace of 3-step pipelines over 20-column sources would sit under budget and see no benefit.
  Concise mode being opt-in makes that harmless.
- **The bound is conditional.** See D8: concise fits at 90% of budget on the 25/43 reference workspace, so a
  substantially larger workspace can still exceed it. The mode is opt-in and the truncation report is honest,
  so this degrades visibly rather than silently — but it is not a guarantee.
- **Replacing the existing fixture's fidelity** changes what `context.test.ts`'s existing size assertion means.
  The existing under-budget assertion must not simply be deleted to make room; it should become the explicit
  full-mode-exceeds-budget arm, so the change strengthens rather than removes a check.
