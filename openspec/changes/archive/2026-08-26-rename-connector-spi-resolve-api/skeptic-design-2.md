## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 CR2 (file enumeration) — RESOLVED, verified accurate.**
Re-ran the enumeration grep myself in the worktree:
`grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[' --include=*.scala backend/src/{main,test}`
→ **18 main + 26 test = 44**, exactly matching ticket.md / proposal.md Impact / tasks.md 1.4–1.5 / 2.1.
Every named file in the docs is in the grep output and vice versa (checked both directions).
The doc-comment-only "compiler-invisible" set (`PipelineRowJson`, `InProcessPipelineEngine`,
`ClaudeWireModels`, `HttpClaudeTransport`, `ContentSourceSupport`, `PipelineService`,
`PipelineRunService`, `PipelineProposalService`) and DI wiring (`app/Main.scala`,
`api/ApiRoutes.scala`) are all real matches. No undercount remains.

**Round-1 CR3 (frontend task misfiled) — RESOLVED.** Task 3.1 is now in a frontend section with a
concrete grep verification; `TestConnectionAffordance.tsx:3` confirmed to reference `Connector[Config]`.

**Endpoint/tool consumer set — verified complete.**
`grep -rn '/api/connectors\b\|list_connectors\b'` (excluding `.git`/`node_modules`/`target`/`dist`)
returns exactly the backend (`ConnectorRegistry`, `ConnectorProtocol`, `ConnectorRoutes`,
`ConnectorRoutesSpec:14`, `ApiRoutesSpec:3164-3165`), `helio-mcp`
(`tools/read.ts:197`, `helioApi.ts:307`, `types.ts:444,453`, `scripts/verify.ts:64,71`), frontend
(`connectorService.ts:3,4,21`, `SourceTypeToggle.tsx:8`, `SourceTypeToggle.test.tsx:81`,
`AddSourceModal.test.tsx:18`) — all covered by tasks 3.2–3.5 — **plus ~15 hits under
`openspec/changes/archive/**`** (see CR4).

**Round-1 CR1 (five missing spec deltas) — deltas now exist, but they are NOT sound.** I diffed each
of the 7 delta files' requirement blocks against `openspec/specs/<cap>/spec.md` programmatically
(name-substitution + unified diff), then **reproduced actual archive behavior** on throwaway copies
(`/tmp/osx`, `/tmp/osx2` — the worktree was never mutated):

```
$ cp -r <worktree>/openspec /tmp/osx/openspec && cd /tmp/osx
$ openspec validate rename-connector-spi-resolve-api --type change
Change 'rename-connector-spi-resolve-api' is valid
$ openspec archive rename-connector-spi-resolve-api -y --json
"code": "archive_spec_update_failed",
"message": "connector-registry MODIFIED failed for header
           \"### Requirement: GET /api/connector-types returns the registry\" - not found"
```

`openspec validate` passing is **not** evidence the deltas apply. Confirmed against the tool's own
apply logic (`@fission-ai/openspec@1.10.0` `dist/core/specs-apply.js:326,335`): a `MODIFIED` header
that does not exist in the canonical spec is a hard error, and so is a `MODIFIED` block that omits a
scenario present in the canonical requirement. Both conditions are present here.

Then I patched the /tmp copy with `## RENAMED Requirements` sections and re-ran archive, which
surfaced the *second*, independent failure:

```
"message": "connector-registry MODIFIED failed for header \"### Requirement: list_connector_types MCP
 tool\" - current spec contains scenario(s) not present in the modified block: \"Agent enumerates
 connectors before creating a source\". Refresh the change spec before archiving to avoid dropping
 scenarios."
```

Both failures are deterministic tool errors reproduced on separate clean copies — not flaky readings.

**Enumerated defects found by the block-level diff:**

- 6 requirement *headers* renamed inside `## MODIFIED Requirements` with no `RENAMED` section:
  - `fetch-error-envelope`: "Envelope contract documented on Connector" → "...on ConnectorDriver"
  - `connector-spi`: "Shared Connector lifecycle trait" → "Shared ConnectorDriver lifecycle trait";
    "SqlConnector and RestApiConnector implement Connector" → "SqlConnectorDriver and
    RestApiConnectorDriver implement ConnectorDriver"; "Connector capability metadata" →
    "ConnectorDriver capability metadata"
  - `connector-registry`: "GET /api/connectors returns the registry" → "GET /api/connector-types
    returns the registry"; "list_connectors MCP tool" → "list_connector_types MCP tool"
- 6 *scenario* titles renamed (which archive rejects as dropped scenarios):
  `connector-spi` lines 28/33/38/51/56 (`SqlConnector is reachable as a Connector`,
  `RestApiConnector is reachable as a Connector`, `Existing SqlConnector/RestApiConnector behavior
  unchanged`, `SqlConnector exposes metadata`, `RestApiConnector exposes metadata`) and
  `connector-registry` ("Agent enumerates connectors before creating a source" → "...connector types...").
- Meanwhile `fetch-error-envelope:12` and `schema-inference-facade:7,12` **deliberately preserve** the
  old-name scenario titles (`Helper compiles against any Connector[Config] implementation`,
  `SqlConnector routes through the facade unchanged`, `RestApiConnector routes through the facade
  unchanged`). So the stated rule ("scenario titles deliberately left unchanged") is applied in 2 of
  the 4 affected capabilities and violated in the other 2. The strategy is internally inconsistent.
- `connector-registry` delta lines 66 and 83 add *new prose* not present canonically ("The route
  previously served at `GET /api/connectors`", "The tool was previously named `list_connectors`; that
  name is retired") — beyond the proposal's stated "name-only" scope, and each re-introduces an old
  name into the canonical spec that task 5.3's zero-match grep will flag.
- Remaining diffs beyond names are pure line re-wrapping caused by longer identifiers — benign.

**Behavior preservation:** no drift found. Every delta edit is a name/wire-path change; no SHALL
semantics, method signature, response shape, or scenario WHEN/THEN logic is altered anywhere in the
7 delta files. Decisions 3/3a (`ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor`/
`ConnectorRoutes`/`ConnectorProtocol`/`ConnectorMetadataResponse`/`listConnectors` stay unrenamed)
are stated and consistent between design.md, proposal.md, and task 5.3's negative check.

### Verdict: REFUTE

The plan as written cannot complete: task 4.2 ("after archive") is unreachable, because
`openspec archive` hard-fails on these deltas today, and task 4.1's only verification
(`openspec validate`) demonstrably passes while archive fails. Shipping this design would hand the
executor a spec-sync step that is guaranteed to break at the last gate.

### Change Requests

1. **Add `## RENAMED Requirements` sections for the 6 renamed requirement headers** listed above, in
   `specs/fetch-error-envelope/spec.md` (1), `specs/connector-spi/spec.md` (3), and
   `specs/connector-registry/spec.md` (2). The tool's supported syntax (verified in
   `dist/core/parsers/change-parser.js` `parseRenames`) is:
   ```
   ## RENAMED Requirements
   - FROM: `### Requirement: GET /api/connectors returns the registry`
   - TO: `### Requirement: GET /api/connector-types returns the registry`
   ```
   `RENAMED` is applied before `MODIFIED`, and `specs-apply.js:179` requires the `MODIFIED` block to
   reference the **NEW** header — which the deltas already do, so only the `RENAMED` sections are
   missing. (Alternative: revert the 6 headers to their canonical spelling, accepting stale old names
   in requirement titles. Pick one and state it in design.md.)

2. **Resolve the scenario-title inconsistency, one way, for all 4 affected capabilities.** As written,
   `connector-spi` (5 titles) and `connector-registry` (1 title) rename scenario titles — which
   `specs-apply.js:335` rejects as dropped scenarios — while `fetch-error-envelope` and
   `schema-inference-facade` preserve them. Either:
   (a) preserve all scenario titles (revert those 6 to canonical spelling, body text stays renamed) —
       cheapest, consistent with the stated rule; or
   (b) express those requirements as `## REMOVED Requirements` (old header) + `## ADDED Requirements`
       (new header, renamed scenarios) — permitted when the names differ (`specs-apply.js:152-190`
       only rejects same-name cross-section collisions) and the only mechanism that can actually
       change a scenario title.
   Whichever is chosen, record it as an explicit design.md decision. Note that option (a) leaves 3+
   permanent old-name scenario titles in `openspec/specs/`, which interacts with CR4.

3. **Task 4.1's verification step is insufficient — replace it.** `openspec validate ... --type change`
   returned "is valid" on deltas that fail `openspec archive` in two independent ways. Task 4.1 must
   require an actual archive rehearsal against a *copy* of `openspec/` (e.g.
   `cp -r openspec /tmp/x/openspec && cd /tmp/x && openspec archive <change> -y --json`), asserting
   `"archive"` is non-null and no `archive_spec_update_failed` status, with the output pasted. Keep
   `validate` as a cheap pre-check, not as the acceptance signal.

4. **Fix the unachievable zero-match assertions in tasks 3.5 and 5.3.** Both demand zero remaining
   `list_connectors` / `/api/connectors` / old-trait-name matches repo-wide "outside git history", but
   `openspec/changes/archive/**` legitimately contains ~15 such prose references across
   `2026-07-24-connector-registry-capability-metadata/{proposal,design,tasks,evaluation-1}.md` and
   `2026-07-25-smart-shape-mcp-surface/{proposal,design,tasks,skeptic-design-1,evaluation-1}.md`.
   Those are immutable historical records of shipped work — rewriting them would falsify the archive
   and is not what AC 4 asks for. Add an explicit exclusion for `openspec/changes/archive/**` (plus
   whatever residual set CR2's chosen option leaves behind, and the two deliberate "previously named"
   mentions at `connector-registry` delta lines 66/83) so the executor is not driven to edit archives
   or to silently declare a failing grep "passed".

### Non-blocking notes

- `connector-registry`'s delta includes two requirements ("DataSourceKind derives from the registry",
  "Registry/DataSourceKind enumeration cannot silently drift") that are byte-identical to canonical.
  Harmless, but they are noise in a MODIFIED delta and make the diff harder to review.
- Task 2.1 lists `ConnectorRoutesSpec` among its "26 files", but it is **not** one of the 26 grep
  matches (its only hit is the `/api/connectors` prose at line 14, owned by task 3.2). The
  parenthetical does caveat this; consider just removing it from 2.1's list to keep the count honest.
- `schema-inference-facade`'s canonical text says `domain/Connector.scala` while the real path is
  `domain/connectors/Connector.scala`. The delta renames it to `domain/ConnectorDriver.scala`,
  preserving the pre-existing path error. Correcting it to `domain/connectors/ConnectorDriver.scala`
  would be a trivial, in-scope improvement — but it is a doc fix, not required.
- `scripts/concertino/` in this worktree is missing `next-report-number.sh`, `persist-evidence.sh`,
  and `emit-event.sh` (only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`,
  `lib`, `README.md` are present). I ran them from the main checkout instead. Not blocking this gate,
  but worth knowing before the final gate depends on them from inside the worktree.
