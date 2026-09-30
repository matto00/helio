## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Fresh, cold re-read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`,
  and all three `specs/*/spec.md` deltas in full (not a diff-only pass against round 1).
- Ran `openspec validate viewer-control-bar-output-panels --strict` → `Change
  'viewer-control-bar-output-panels' is valid`.
- Re-read the live code round 1 cited and the code the four fixes now depend on:
  `backend/src/main/scala/com/helio/domain/model/model.scala:901-915` (`Output` domain case class —
  no `config` field on the domain type itself; `config` is protocol-layer `JsValue`),
  `backend/.../api/protocols/pipelines/OutputProtocol.scala:1-146` (`OutputResponse`/
  `outputResponseFrom` — confirms `config` is presentation-only: chart legend/tooltip/seriesColors/
  axisLabels or metric/collection `format`, never connector credentials — D8's new public
  `output-meta` route exposing `kind`/`config`/`schema`/`ownerId` does not leak anything beyond what
  the authenticated `GET /api/outputs/:id` already exposes to an owner), `frontend/src/features/
  panels/ui/PanelContent.tsx:1-60,253` (`ownerId={output.ownerId}` unconditional forward into
  `TableRenderer`), `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:37,266,296`
  (`ownerId` prop / `canWrite` derivation), `frontend/src/features/pipelines/types/output.ts:38-52`
  (`Output.ownerId: string` — non-nullable).
- Confirmed via `git log --oneline -5` and `git status --short` that this worktree's HEAD
  (`22c9ee1f`) is unchanged from `main` and the only local change is the untracked
  `openspec/changes/viewer-control-bar-output-panels/` directory — this is still the design gate,
  no execution has started.

### Re-verifying round 1's four required revisions (not assumed correct)

**CR1 (public rows `filter=` column restriction) — CLOSED.** `specs/public-dashboards/spec.md`'s
"Public panel rows accept sort and filter parameters" Requirement now carries an explicit SHALL
clause ("the SET OF COLUMNS this route accepts in `filter=` is narrower... rejected unless that
column is the bound `column` of one of the panel's own `output_controls`") plus a new negative
scenario ("A public rows request is rejected for a non-control column filter") mirroring the
sibling Requirement's existing one. This closes exactly the spec-vs-design.md contradiction round 1
found — an implementer building strictly from spec.md's Requirements text can no longer read license
to filter the rows route on any Output-eligible column.

**CR2 (public Output-metadata route) — CLOSED, and checked for a new gap: none found.**
`design.md` D8 adds `GET /api/dashboards/:dashboardId/panels/:panelId/output-meta`, resolved via the
same `panelRepo.findAllByDashboardId` → match-by-`panelId` pattern as D5/the existing rows route
(never a caller-supplied `outputId`), returning exactly `kind`/`config`/`schema`/`ownerId`.
`specs/public-dashboards/spec.md` gained a matching "A panel's bound Output metadata is available to
a public renderer" Requirement with matching scenarios (including denial parity with the rows
route). `tasks.md` gained 2.4 (backend) and updated 3.1 (frontend hook now fetches both `.../rows`
and `.../output-meta`). I checked whether exposing `config`/`schema` publicly could leak anything
beyond presentation config (chart legend/tooltip/axisLabels, metric/collection format) — confirmed
via `OutputProtocol.scala`'s doc comment and `outputResponseFrom` that `config` never carries
connector credentials or anything not already visible to an authenticated owner of that Output; this
is a strict subset of what `GET /api/outputs/:id` already returns. No new security gap.

**CR3 (force-disable `TableRenderer`'s owner-write path publicly) — CLOSED in principle; one
implementation-level nuance not fully closed (non-blocking, see below).** `design.md` D9 states the
mechanism (never pass a real `ownerId` down the public path, so `canWrite = ownerId != null && ...`
is structurally false) and `specs/public-dashboard-panel-content/spec.md`'s read-only Requirement
gained the matching "An owner previewing their own public link cannot write through it" scenario,
worded identically to D9's rationale. `tasks.md` 3.3 requires a red-first regression test
(simulating an owner's authenticated session, asserting no PATCH fires) — this is exactly the kind
of test that would actually catch the bug, not one that passes vacuously.

**CR4 (a11y live-region availability per render path) — CLOSED.** `design.md` D10 states, per path,
that only `PanelCard.tsx` has a live region today and that `MobilePanelStack.tsx`,
`PanelDetailModal.tsx`, the fullscreen overlay, and the public viewer each need one added (not
discovered as new scope mid-execution). `tasks.md` 5.5 now explicitly lists adding a live region to
all four of those paths, with 5.6 renumbered as the cross-path verification pass. D10 also correctly
resolves the potential spec.md/design.md tension round 1 implicitly raised: spec.md's a11y
Requirement text ("via the panel's existing live region (or equivalent), not a newly introduced,
separate one") is unchanged, but D10 states explicitly that "or equivalent" is satisfied by adding
the FIRST live region to a path that has none — it forbids a second, redundant region on a path that
already announces, not the first on a path that doesn't. This is a correct, non-contradictory
reading, not a reinterpretation that silently narrows the spec.

**Round-1 non-blocking notes** — both corrected: D5 now attributes `topDistinctValues` to
`NodeSnapshotRepository` (not `OutputFilterCapability`), and D1 now names both live Redux reads
inside the reused renderers (`canWrite`, force-disabled per D9; `crossFilter`, inert on the public
path since nothing there sets it and it's scoped to a different `panelId`) instead of claiming the
renderers are "purely prop-driven."

### New scrutiny of D8/D9/D10 for fresh inconsistencies (per this round's brief)

I specifically checked for the CR1-class defect (design.md prose vs. contradicting spec.md text) in
each new decision — found none: D8/D9/D10's spec.md counterparts (the new "Output metadata"
Requirement, the new read-only scenario, and the unchanged-but-correctly-interpreted a11y wording)
all state the same restriction design.md/tasks.md state, in the same direction, with no route left
un-narrowed the way CR1's rows-filter Requirement was.

**One genuine but non-blocking implementation nuance in D9's mechanism:** D9 says the fix is to
"never pass a real `ownerId`... (pass `null`)" at the call site, with "no `TableRenderer`/
`OutputPanelContent` change, no new prop." But `OutputPanelContent`'s `output` prop is typed as the
existing `Output` interface (`frontend/src/features/pipelines/types/output.ts:42`), which declares
`ownerId: string` — non-nullable. Literally "passing null" through that exact type will not compile
without either (a) widening `Output.ownerId` to `string | null` (a shared-type change every other
authenticated consumer of `Output` also sees, even though it touches no component code), or (b) the
public metadata object being a distinct, narrower type that isn't literally `Output`. D9's "no
new prop" framing is accurate for the component layer but doesn't acknowledge this type-level
decision. I'm not treating this as blocking because: (1) the underlying security mechanism is
sound and correctly reasoned (a null/absent `ownerId` does make `canWrite` false, whichever way it's
threaded), and (2) TypeScript's own compiler will force the executor to notice and resolve this the
moment they try to literally assign `null` — it fails loud at build time, not silently at runtime,
so there's low risk of the gap being papered over with an unstated sentinel. Still worth a one-line
addition to D9 stating how the null threads through the type (widen `Output.ownerId` to
`string | null`, or introduce a narrower public-metadata type) so it isn't rediscovered as a surprise
mid-execution — non-blocking, not a required revision.

### Standard design-gate scope (re-checked)

- **AC coverage:** unchanged from round 1's finding — every ticket AC still maps to a spec.md
  requirement across the three capabilities; the fold-in public AC is not silently dropped.
- **Sequencing (D7/C12):** unchanged, still sound — two-commit plan remains concretely
  evaluator-verifiable red-first at each layer.
- **Dependency order / no DB migration:** unchanged, still correct.
- **Scope drift:** none found — the four new decisions (D8-D10) are all direct, necessary
  consequences of round 1's findings, not unrelated expansion.

### Verdict: CONFIRM

### Non-blocking notes

1. D9 should ideally state, in one sentence, how the `null` `ownerId` actually threads through the
   existing (non-nullable) `Output` TypeScript type — widen `Output.ownerId` to `string | null`, or
   define a narrower public-metadata type — so it's a stated decision rather than something the
   executor discovers via a compile error. Not required to re-run this gate; low risk since the
   type system fails loud rather than silently reintroducing the write-bypass.
2. `specs/public-dashboards/spec.md`'s "Public filter/capability reads use the same ACL as public
   rows" Requirement's prose lists "filter-capabilities, distinct-values, and filtered-rows" but not
   the new `output-meta` route by name — its ACL binding is nonetheless independently and
   sufficiently stated inside the "Output metadata" Requirement's own scenarios, so this is a cosmetic
   completeness nit, not a gap.
