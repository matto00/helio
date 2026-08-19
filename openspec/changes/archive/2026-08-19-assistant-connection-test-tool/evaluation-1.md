## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 ("tool list includes `test_connection` ... invokes `Connector[Config].testConnection`/`ConnectionTest.run`
  for REST/SQL sources"): met. `testConnectionTool` added to `AssistantProtocol.assistantTools`
  (`AssistantProtocol.scala`), dispatches via `AssistantToolExecutor.executeTestConnection` to
  `SourceService.testRest`/`testSql`, which are the existing thin wrappers over
  `Connector.testConnection`/`ConnectionTest.run` (`SourceService.scala:115-127`, unmodified).
- AC2 ("tool-loop logic ... requires calling this tool on any REST/SQL data source before finalizing
  `propose_pipeline`/`propose_combined`"): met, and enforced structurally (not prompt-only) via
  `requireVerifiedInlineSource`, wired ahead of both `executeProposePipeline` and
  `executeProposeCombined`'s `validate` calls (`AssistantToolExecutor.scala:200-346`). System prompt
  also documents the rule (`AssistantSystemPrompt.scala`).
- AC3 ("nonexistent/unreachable endpoint caught ... self-corrects or clearly flags to the user"): met
  and **live-verified end-to-end** (see Phase 3) — reproduced the ticket's own `lm-api-reads.espn.com`
  scenario against the running app; the assistant called `test_connection`, got `ok=false`, and
  explicitly withheld the `propose_pipeline` call while explaining why, rather than finalizing a bogus
  proposal.
- AC4 ("existing `propose_dashboard`, `propose_patch_set`, `find`, `get_resource` unaffected"): met —
  `requireVerifiedInlineSource` is only called from `executeProposePipeline`/`executeProposeCombined`;
  no other dispatch case touched. Confirmed by the full backend test suite passing unchanged for those
  paths.
- AC5 ("non-REST/SQL sources, or pipelines with no new source, unaffected"): met —
  `requireVerifiedInlineSource` returns `Right(())` immediately for a `sourceId` source or an inline
  `csv`/`static` source (`AssistantToolExecutor.scala` tasks 1.4), covered by
  `AssistantToolExecutorSpec` tasks 2.7.

All `tasks.md` items (1.1–1.7, 2.1–2.9) are checked and each one's described change is actually present
in the diff — cross-checked task-by-task against `git diff main...HEAD`. No task claims work that isn't
there, and no diff hunk does something a task doesn't describe.

No scope creep: every file touched is exactly the file list in `proposal.md`'s Impact section
(`AssistantProtocol.scala`, `AssistantProposalToolSchemas.scala`, `AssistantToolExecutor.scala`,
`AssistantService.scala`, `AssistantSystemPrompt.scala`, `ApiRoutes.scala`, plus their test files).

No regressions: full `sbt test` run (3301 tests, see Phase 2) passes, including every pre-existing
route/service spec for the untouched tools.

No schema/route/API-contract changes: confirmed — `schemas/**` untouched, no new HTTP endpoint, and the
`ApiRoutes.scala` diff is a single-line constructor-argument passthrough (`sourceService` already
constructed there for other services) with zero change to any route's request/response contract. The
`test_connection` tool is internal to the Claude tool-use loop, never a wire-level HTTP addition.

Planning artifacts reflect the final implementation: `design.md`'s D1 (`VerifiedConfig` closed ADT +
`AtomicReference[Set[_]]`, same pattern as `capturedProposal`), D3 (`MaxHops` 3→4), D4 (shared
`requireVerifiedInlineSource` helper for both propose tools), and D5 (tool ordering, discriminated
`type`/`config` shape) all match the diff precisely. `spec.md`'s ADDED/MODIFIED requirements and every
one of its scenarios were independently confirmed — either by the executor's own tests or, for the two
central scenarios, by live reproduction against the running app (Phase 3).

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates run fresh in `WORKTREE_PATH`** (no `CLEAN_WORKTREE` flag was passed for this cycle):
- `cd backend && sbt test` → `3301 tests, 0 failed, 0 canceled` — **all pass** (full suite, not just the
  touched specs).
- `node scripts/check-scala-quality.mjs` (CONTRIBUTING.md's mechanical Imports & Qualifiers + file-size
  check) → **clean**, 0 inline-FQN violations. 123 pre-existing file-size soft warnings across the whole
  repo (informational only per CONTRIBUTING.md); `AssistantToolExecutorSpec.scala` (537 lines) and
  `AssistantServiceSpec.scala` (576 lines) are among them but this is the established norm for this
  test suite (dozens of pre-existing specs already exceed 250 lines) — not a new class of violation this
  ticket introduces, and both are well under the ~400-line "propose a split" threshold for source files;
  neither is a source file anyway.

**Canonical standard compliance** (CONTRIBUTING.md, read in full): imports are all top-of-file, no
inline FQNs anywhere in the diff (mechanically confirmed above). No DESIGN.md review needed — no
`frontend/**` files changed.

**DRY**: `requireVerifiedInlineSource` is a single shared helper called from both `executeProposePipeline`
and `executeProposeCombined` (design.md D4) — no duplicated gate logic.

**Readable**: clear naming throughout (`VerifiedConfig`, `verifiedConfigs`, `requireVerifiedInlineSource`,
`executeTestConnection`); no magic values — the `"rest_api"`/`"sql"` discriminator strings mirror the
existing `PipelineProposalSourceSchema`/`SourcePreviewRoutes` convention, not new ad hoc constants.

**Modular**: `VerifiedConfig` is `private[services]`, never escapes `AssistantToolExecutor`; the gate
helper is a small, single-purpose function.

**Type safety**: `VerifiedConfig` is a closed ADT (`sealed trait` + two `final case class`es) reusing the
existing typed `RestApiConfigPayload`/`SqlSourceConfigPayload` case classes' `equals` — explicitly avoids
a JSON-string fingerprint per design.md D1. No untyped escape hatches introduced.

**Security**: `test_connection` exposes `SourceService.testRest`/`testSql` — which can cause the backend
to make an outbound HTTP request or SQL connection to an assistant-chosen host — to the LLM tool loop for
the first time. This is not a new capability class: the identical call is already reachable today via the
authenticated `POST /api/sources/test` route (the ticket's own stated starting point), and this change
does not widen which hosts/ports are reachable, only adds an indirect (LLM-mediated) trigger for the same
authenticated user's own existing capability. Noted, not a Change Request.

**Error handling**: `executeTestConnection` wraps config decode in `Try`, returning a typed `Left` tool
error on failure rather than throwing; `ok=false` is correctly treated as a normal domain `Right` (not
swallowed, not conflated with a `Left`/tool-execution error) — matches `ConnectionTest.run`'s own
"domain outcome, not HTTP error" framing, and was independently confirmed live (Phase 3).

**Tests meaningful**: `AssistantToolExecutorSpec` adds a full gate-behavior suite — untested-source
rejection (rest + sql), verified-config pass-through, failed-test non-verification, edited-config
re-rejection, `sourceId`/`csv`/`static` exemption, `test_connection` dispatch to both `testRest`/`testSql`
for both `ok=true`/`false`. `AssistantServiceSpec`/`AssistantTelemetrySpec`/
`AssistantConversationRoutesSpec` are correctly updated for the `maxHops` 3→4 raise (hop-cap-exhausted
fixtures bumped from 4→5 scripted attempts, counters recomputed) rather than left stale. Each of these
would catch a real regression (e.g. reverting the gate, or reverting `MaxHops`).

**No dead code**: none found; no leftover TODO/FIXME in the diff.

**No over-engineering**: one new ADT + one shared helper, proportionate to the ticket.

**Behavior-preserving where expected**: the `MaxHops`/hop-count test updates are exactly the mechanical
recount the 3→4 raise requires, not a hidden behavior change; `propose_dashboard`/`propose_patch_set`/
`find`/`get_resource` code paths are byte-for-byte untouched.

### Phase 3: UI Review — PASS

Issues: none blocking (one non-blocking suggestion below).

Trigger analysis: no `frontend/**`, `schemas/**`, or `openspec/specs/**` files changed. `ApiRoutes.scala`
(a Phase-3 trigger by name) *was* touched, but only as a single-line constructor-argument passthrough —
no new route, no change to any route's request/response contract. Rather than treat this as N/A on that
basis alone, I verified live: the assistant chat feature *is* a reachable, live UI surface (`/chat` route,
`ChatPage.tsx`, wired in `AppRoutes.tsx`) sitting downstream of this change, so I ran the full dev-server
flow against it.

Dev servers started via the canonical script and asserted healthy:
```
scripts/concertino/start-servers.sh ... → READY backend=http://localhost:9095/health, READY frontend=http://localhost:6188
scripts/concertino/assert-phase.sh servers ... → PASS servers
```
(Both scripts printed a `emit-event.sh: No such file or directory` warning — that script is untracked in
git and absent from this worktree's checkout, same underlying cause as the `next-report-number.sh` gap
noted in Guardrails below; it did not affect either script's own READY/PASS outcome.)

**Live end-to-end verification against the running app** (via `/chat`):

1. **Unhappy path** — reproduced the ticket's own live incident: asked the assistant to
   `propose_pipeline` with an inline REST source at `https://lm-api-reads.espn.com/does-not-exist`.
   Observed: assistant called `test_connection` in its own hop (`Calling: test_connection(config:
   {"method":"GET","url":"https://lm-api-reads.espn.com/does-not-exist"}, type: "rest_api")`), got
   `{"error":"Request failed","ok":false}`, and **did not** call `propose_pipeline` — instead explained
   clearly to the user that the proposal was withheld because the source couldn't be verified. Exactly
   AC3's required behavior.
2. **Happy path** — same flow with a real reachable endpoint
   (`https://jsonplaceholder.typicode.com/todos/1`). Observed: `test_connection` → `{"ok":true}` →
   `propose_pipeline` proceeded and validated successfully → "Proposal ready" banner appeared → "Review
   proposal" navigated correctly to the (pre-existing, unmodified) Pipeline Proposal Review page.
3. No console errors (checked via `browser_console_messages`, level=error) across either flow or the
   review-page navigation.
4. Message composer is keyboard-accessible (submitted via Enter, not just mouse click on Send).
5. Empty state ("New conversation" / "Start a conversation to see it here.") renders via the existing
   shared empty-state pattern.
6. Breakpoints 1440 / 1100 / 768 / 390px: no layout breakage on `/chat` (screenshots taken and reviewed;
   this is pre-existing, unmodified UI, so this confirms no regression rather than new behavior).
7. Feature works from its one relevant entry point (`/chat`) — this ticket adds no new UI surface.

**Non-blocking finding**: `ToolCallIndicator.tsx`'s `VERB_BY_TOOL_NAME` map (line 24) has an entry for
every other tool (`find`→"Searching", `get_resource`→"Looking up", `propose_*`→"Proposing") but not
`test_connection`, so it falls back to the generic `"Calling"` verb (`verbFor`, line 33-34). This is
fully functional — confirmed live above, no crash, no broken label — just less polished than the other
rows. `proposalExtraction.ts`'s `KIND_BY_TOOL_NAME` also has no entry for `test_connection`, which is
correct (it's not a `propose_*` tool and must never be treated as one). Consistent with `proposal.md`'s
explicit "No frontend changes" scoping; a one-line addition to `VERB_BY_TOOL_NAME` would be a reasonable
follow-up but does not block this ticket.

### Overall: PASS

### Non-blocking Suggestions
- `frontend/src/features/assistant/ui/ToolCallIndicator.tsx:24` — add a `test_connection: "Verifying"`
  (or similar) entry to `VERB_BY_TOOL_NAME` so the new tool's transcript row reads better than the
  generic `"Calling"` fallback. Purely cosmetic; out of this ticket's stated backend-only scope.

### Guardrails / environment note
This worktree's `scripts/concertino/` is missing `next-report-number.sh`, `persist-evidence.sh`, and
`emit-event.sh` — all three are untracked in git in the main checkout (`git ls-files scripts/concertino/`
does not list them), so `git worktree add` never copied them in. I ran `next-report-number.sh` and will
run `persist-evidence.sh`/`emit-event.sh` from the main repo checkout
(`/home/matt/Development/helio/scripts/concertino/...`), passing this worktree's paths as arguments —
these scripts are pure path-parameterized filesystem/HTTP utilities with no worktree-local state, so
invoking the main checkout's copy against this worktree's paths is equivalent to running a local copy,
not a fallback/guess. Flagging this as a repo-hygiene gap (these three scripts should be tracked in git)
rather than a code issue with this ticket's diff.
